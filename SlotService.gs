function generateSlots(config) {
  return withPublicErrorHandling_(function () {
    assertAdminExecution_();
    const input = config || {};
    const campaignId = validateCampaignId_(input.campaignId);
    const date = validateIsoDate_(input.date);
    const start = validateTime_(input.start);
    const end = validateTime_(input.end);
    const durationMinutes = positiveInteger_(input.durationMinutes || getConfigValue_('DURACION_SLOT'), 'La duración');
    const minimumMinutes = positiveInteger_(getConfigValue_('DURACION_MINIMA') || 60, 'La duración mínima');
    if (durationMinutes < minimumMinutes) {
      throwAppError_('VALIDATION_ERROR', 'Cada cita debe ocupar al menos ' + minimumMinutes + ' minutos.');
    }
    const capacity = positiveInteger_(input.capacity, 'La capacidad');
    const campaign = getCampaignById_(campaignId);
    if (!campaign) throwAppError_('CAMPAIGN_NOT_FOUND', 'No existe la campaña.');
    if (campaign.fecha_inicio && date < campaign.fecha_inicio || campaign.fecha_fin && date > campaign.fecha_fin) {
      throwAppError_('VALIDATION_ERROR', 'La fecha está fuera del periodo de la campaña.');
    }
    const startMinutes = timeToMinutes_(start);
    const endMinutes = timeToMinutes_(end);
    if (endMinutes <= startMinutes) throwAppError_('VALIDATION_ERROR', 'El horario final debe ser posterior al inicial.');

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) throwAppError_('SYSTEM_BUSY', 'No se pudo obtener el bloqueo.');
    try {
      clearRowsCache_();
      const existing = readRows_(SHEET_NAMES_.SLOTS).rows;
      const keys = existing.reduce(function (result, slot) {
        result[slotKey_(slot.campaign_id, slot.fecha, slot.inicio)] = true;
        return result;
      }, {});
      const newRows = [];
      for (let minute = startMinutes; minute + durationMinutes <= endMinutes; minute += durationMinutes) {
        const slotStart = minutesToTime_(minute);
        const key = slotKey_(campaignId, date, slotStart);
        if (keys[key]) continue;
        const slotEnd = minutesToTime_(minute + durationMinutes);
        const timestamp = nowText_();
        newRows.push([Utilities.getUuid(), campaignId, date, slotStart, slotEnd, capacity, 0, 'DISPONIBLE', timestamp, timestamp]);
        keys[key] = true;
      }
      appendRows_(SHEET_NAMES_.SLOTS, newRows);
      SpreadsheetApp.flush();
      return { success: true, created: newRows.length, skippedDuplicates: Math.max(0, Math.floor((endMinutes - startMinutes) / durationMinutes) - newRows.length) };
    } finally {
      lock.releaseLock();
    }
  });
}

function getAvailableSlots(campaignId, date) {
  return withPublicErrorHandling_(function () {
    const normalizedCampaignId = validateCampaignId_(campaignId);
    const normalizedDate = validateIsoDate_(date);
    if (normalizedDate < todayText_()) throwAppError_('VALIDATION_ERROR', 'La fecha seleccionada ya pasó.');
    requireActiveCampaign_(normalizedCampaignId);
    const slots = readRows_(SHEET_NAMES_.SLOTS).rows
      .filter(function (slot) { return String(slot.campaign_id) === normalizedCampaignId && String(slot.fecha) === normalizedDate && isSlotAvailable_(slot); })
      .sort(function (left, right) { return String(left.inicio).localeCompare(String(right.inicio)); })
      .map(function (slot) {
        return { slotId: slot.slot_id, date: slot.fecha, start: slot.inicio, end: slot.fin, capacity: Number(slot.capacidad), available: Number(slot.capacidad) - Number(slot.ocupados || 0) };
      });
    return { success: true, slots: slots };
  });
}

function isSlotAvailable_(slot) {
  const state = String(slot.estado || '').toUpperCase();
  return state !== 'BLOQUEADO' && state !== 'CANCELADO' && Number(slot.ocupados || 0) < Number(slot.capacidad || 0);
}

function timeToMinutes_(time) {
  const parts = time.split(':').map(Number);
  return parts[0] * 60 + parts[1];
}

function minutesToTime_(minutes) {
  return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
}

function slotKey_(campaignId, date, start) {
  return [campaignId, date, start].join('|');
}

function getSlotById_(slotId) {
  return findRowByField_(SHEET_NAMES_.SLOTS, 'slot_id', slotId);
}
