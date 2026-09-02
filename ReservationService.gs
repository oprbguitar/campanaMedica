function createReservation(payload) {
  return withPublicErrorHandling_(function () {
    const input = validateReservationPayload_(payload);
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) throwAppError_('SYSTEM_BUSY', 'No se pudo obtener el bloqueo.');
    try {
      clearRowsCache_();
      const campaign = requireActiveCampaign_(input.campaignId);
      const slot = getSlotById_(input.slotId);
      if (!slot) throwAppError_('SLOT_NOT_FOUND', 'No existe el horario.');
      if (String(slot.campaign_id) !== input.campaignId) throwAppError_('VALIDATION_ERROR', 'El horario no pertenece a la campaña.');
      if (!isSlotAvailable_(slot)) throwAppError_('HORARIO_OCUPADO', 'El horario ya no está disponible.');

      const existingReservation = findActiveReservation_(input.dni, input.campaignId);
      if (existingReservation) {
        throwAppError_('PERSONA_YA_REGISTRADA', 'Ya existe una reserva para este DNI.', { existingReservation: reservationConfirmation_(existingReservation) });
      }

      const timestamp = nowText_();
      const person = findOrCreatePerson_(input, timestamp);
      const reservation = {
        reservation_id: Utilities.getUuid(),
        reservation_code: createReservationCode_(),
        campaign_id: input.campaignId,
        slot_id: input.slotId,
        person_id: person.person_id,
        dni: input.dni,
        fecha: slot.fecha,
        hora: slot.inicio,
        estado: 'RESERVADO',
        created_at: timestamp,
        updated_at: timestamp
      };
      appendRows_(SHEET_NAMES_.RESERVATIONS, [rowToValues_(SHEET_NAMES_.RESERVATIONS, reservation)]);
      const occupied = Number(slot.ocupados || 0) + 1;
      const updatedSlot = Object.assign({}, slot, { ocupados: occupied, estado: occupied >= Number(slot.capacidad) ? 'COMPLETO' : 'DISPONIBLE', updated_at: timestamp });
      updateRow_(SHEET_NAMES_.SLOTS, slot.rowNumber, rowToValues_(SHEET_NAMES_.SLOTS, updatedSlot));
      audit_('CREAR_RESERVA', reservation.reservation_id, input.dni, JSON.stringify({ campaignId: campaign.campaign_id, slotId: slot.slot_id }));
      SpreadsheetApp.flush();
      return { success: true, reservation: reservationConfirmation_(reservation, person) };
    } finally {
      lock.releaseLock();
    }
  });
}

function getReservation(reservationCode, dni) {
  return withPublicErrorHandling_(function () {
    const code = validateRequiredText_(reservationCode, 'código de reserva', 30).toUpperCase();
    const normalizedDni = validateDni_(dni);
    const reservation = readRows_(SHEET_NAMES_.RESERVATIONS).rows.find(function (row) {
      return String(row.reservation_code).toUpperCase() === code && String(row.dni) === normalizedDni;
    });
    if (!reservation) throwAppError_('RESERVATION_NOT_FOUND', 'No existe esa reserva.');
    const person = findPersonByDni_(normalizedDni);
    return { success: true, reservation: reservationConfirmation_(reservation, person) };
  });
}

function cancelReservation(reservationCode, dni) {
  return withPublicErrorHandling_(function () {
    const code = validateRequiredText_(reservationCode, 'código de reserva', 30).toUpperCase();
    const normalizedDni = validateDni_(dni);
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) throwAppError_('SYSTEM_BUSY', 'No se pudo obtener el bloqueo.');
    try {
      clearRowsCache_();
      const reservation = readRows_(SHEET_NAMES_.RESERVATIONS).rows.find(function (row) {
        return String(row.reservation_code).toUpperCase() === code && String(row.dni) === normalizedDni;
      });
      if (!reservation) throwAppError_('RESERVATION_NOT_FOUND', 'No existe esa reserva.');
      if (String(reservation.estado) === 'CANCELADO') throwAppError_('RESERVATION_ALREADY_CANCELLED', 'La reserva ya fue cancelada.');
      const timestamp = nowText_();
      const updatedReservation = Object.assign({}, reservation, { estado: 'CANCELADO', updated_at: timestamp });
      updateRow_(SHEET_NAMES_.RESERVATIONS, reservation.rowNumber, rowToValues_(SHEET_NAMES_.RESERVATIONS, updatedReservation));
      const slot = getSlotById_(reservation.slot_id);
      if (slot) {
        const occupied = Math.max(0, Number(slot.ocupados || 0) - 1);
        const updatedSlot = Object.assign({}, slot, { ocupados: occupied, estado: occupied < Number(slot.capacidad) ? 'DISPONIBLE' : 'COMPLETO', updated_at: timestamp });
        updateRow_(SHEET_NAMES_.SLOTS, slot.rowNumber, rowToValues_(SHEET_NAMES_.SLOTS, updatedSlot));
      }
      audit_('CANCELAR_RESERVA', reservation.reservation_id, normalizedDni, JSON.stringify({ slotId: reservation.slot_id }));
      SpreadsheetApp.flush();
      return { success: true, reservation: reservationConfirmation_(updatedReservation, findPersonByDni_(normalizedDni)) };
    } finally {
      lock.releaseLock();
    }
  });
}

function validateReservationPayload_(payload) {
  if (!payload || typeof payload !== 'object') throwAppError_('VALIDATION_ERROR', 'Faltan datos de reserva.');
  return {
    campaignId: validateCampaignId_(payload.campaignId),
    slotId: validateSlotId_(payload.slotId),
    dni: validateDni_(payload.dni),
    nombres: validateRequiredText_(payload.nombres, 'nombres', 120),
    apellidos: validateRequiredText_(payload.apellidos, 'apellidos', 160),
    telefono: optionalText_(payload.telefono, 30),
    area: optionalText_(payload.area, 120),
    correo: optionalText_(payload.correo, 160)
  };
}

function findActiveReservation_(dni, campaignId) {
  const byDni = indexRowsBy_(SHEET_NAMES_.RESERVATIONS, 'dni')[String(dni)] || [];
  return byDni.find(function (reservation) {
    return String(reservation.campaign_id) === String(campaignId) && String(reservation.estado) === 'RESERVADO';
  }) || null;
}

function createReservationCode_() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    const random = Array.from({ length: 5 }, function () { return alphabet.charAt(Math.floor(Math.random() * alphabet.length)); }).join('');
    code = 'CS-' + random;
  } while (findRowByField_(SHEET_NAMES_.RESERVATIONS, 'reservation_code', code));
  return code;
}

function reservationConfirmation_(reservation, person) {
  return {
    reservationCode: reservation.reservation_code,
    campaignId: reservation.campaign_id,
    name: person ? [person.nombres, person.apellidos].filter(Boolean).join(' ') : '',
    nombres: person ? person.nombres : '',
    apellidos: person ? person.apellidos : '',
    date: reservation.fecha,
    time: reservation.hora,
    status: reservation.estado
  };
}
