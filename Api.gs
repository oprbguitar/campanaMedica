/**
 * API JSON pública consumida por el portal estático (GitHub Pages).
 * El enrutamiento entra por doGet/doPost en Main.gs.
 *
 * Lecturas (bootstrap, availability) por GET: no llevan datos personales.
 * Escrituras (reserve, status, cancel) por POST con cuerpo JSON, para que el
 * DNI y los nombres nunca viajen en la query string ni queden en logs de URL.
 */

function handleApiRequest_(action, params) {
  const input = params || {};
  let result;
  switch (String(action || '')) {
    case 'bootstrap':
      result = apiBootstrap_(input.campaignId);
      break;
    case 'availability':
      result = apiAvailability_(input.campaignId);
      break;
    case 'reserve':
      result = createReservation(input);
      break;
    case 'status':
      result = getReservation(input.reservationCode, input.dni);
      break;
    case 'cancel':
      result = cancelReservation(input.reservationCode, input.dni);
      break;
    default:
      result = { success: false, code: 'VALIDATION_ERROR', message: 'Acción no reconocida.' };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function apiBootstrap_(campaignId) {
  return withPublicErrorHandling_(function () {
    const availability = apiAvailabilityPayload_(campaignId);
    return {
      success: true,
      app: {
        title: getConfigValue_('TITULO_APP') || 'Reserva tu cita',
        timeZone: getTimeZone_()
      },
      campaign: availability.campaign,
      days: availability.days,
      today: availability.today
    };
  });
}

function apiAvailability_(campaignId) {
  return withPublicErrorHandling_(function () {
    const availability = apiAvailabilityPayload_(campaignId);
    return { success: true, campaign: availability.campaign, days: availability.days, today: availability.today };
  });
}

function apiAvailabilityPayload_(campaignId) {
  const campaign = apiResolveCampaign_(campaignId);
  const today = todayText_();
  const grouped = {};
  readRows_(SHEET_NAMES_.SLOTS).rows.forEach(function (slot) {
    if (String(slot.campaign_id) !== String(campaign.campaign_id)) return;
    const date = String(slot.fecha);
    if (date < today || !isSlotAvailable_(slot)) return;
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push({
      slotId: slot.slot_id,
      start: String(slot.inicio),
      end: String(slot.fin),
      available: Number(slot.capacidad) - Number(slot.ocupados || 0)
    });
  });
  const days = Object.keys(grouped).sort().map(function (date) {
    return {
      date: date,
      slots: grouped[date].sort(function (left, right) { return left.start.localeCompare(right.start); })
    };
  });
  return {
    campaign: {
      campaignId: campaign.campaign_id,
      name: campaign.nombre,
      description: campaign.descripcion,
      startDate: campaign.fecha_inicio,
      endDate: campaign.fecha_fin
    },
    days: days,
    today: today
  };
}

function apiResolveCampaign_(campaignId) {
  const today = todayText_();
  const campaigns = readRows_(SHEET_NAMES_.CAMPAIGNS).rows.filter(function (campaign) {
    return isTrueValue_(campaign.activo) && (!campaign.fecha_fin || String(campaign.fecha_fin) >= today);
  });
  if (!campaigns.length) throwAppError_('CAMPAIGN_NOT_FOUND', 'No hay campañas activas.');
  const requested = String(campaignId == null ? '' : campaignId).trim();
  if (!requested) return campaigns[0];
  const found = campaigns.find(function (campaign) { return String(campaign.campaign_id) === requested; });
  if (!found) throwAppError_('CAMPAIGN_NOT_FOUND', 'La campaña solicitada no está disponible.');
  return found;
}
