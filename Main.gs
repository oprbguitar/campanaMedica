function doGet() {
  const template = HtmlService.createTemplateFromFile('Index');
  let title = 'Campaña de Salud';
  try {
    title = getConfigValue_('TITULO_APP') || title;
  } catch (error) {
    console.error(JSON.stringify({ code: 'APP_NOT_CONFIGURED', message: error && error.message }));
  }
  return template.evaluate()
    .setTitle(title)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getAppConfig() {
  return withPublicErrorHandling_(function () {
    return {
      success: true,
      app: {
        company: getConfigValue_('EMPRESA') || '',
        title: getConfigValue_('TITULO_APP') || 'Campaña de Salud',
        timeZone: getConfigValue_('ZONA_HORARIA') || 'America/Lima'
      }
    };
  });
}

/**
 * Punto de entrada único para las operaciones usadas por la interfaz web.
 * El navegador invoca este método explícito de google.script.run y aquí se
 * enruta únicamente a funciones públicas permitidas.
 */
function runServerFunction(functionName, args) {
  const values = Array.isArray(args) ? args : [];

  switch (functionName) {
    case 'getAppConfig':
      return getAppConfig();
    case 'getActiveCampaigns':
      return getActiveCampaigns();
    case 'getCampaignDates':
      return getCampaignDates(values[0]);
    case 'getAvailableSlots':
      return getAvailableSlots(values[0], values[1]);
    case 'lookupPersonByDni':
      return lookupPersonByDni(values[0]);
    case 'createReservation':
      return createReservation(values[0]);
    case 'getReservation':
      return getReservation(values[0], values[1]);
    case 'cancelReservation':
      return cancelReservation(values[0], values[1]);
    default:
      throw new Error('Operación no disponible.');
  }
}

function withPublicErrorHandling_(operation) {
  try {
    return operation();
  } catch (error) {
    const code = error && error.code ? error.code : 'INTERNAL_ERROR';
    console.error(JSON.stringify({ code: code, message: error && error.message }));
    const response = {
      success: false,
      code: code,
      message: getPublicErrorMessage_(code)
    };
    if (error && error.details && error.details.existingReservation) {
      response.existingReservation = error.details.existingReservation;
    }
    return response;
  }
}

function throwAppError_(code, message, details) {
  const error = new Error(message || code);
  error.code = code;
  error.details = details || null;
  throw error;
}

function getPublicErrorMessage_(code) {
  const messages = {
    VALIDATION_ERROR: 'Revisa los datos ingresados.',
    SPREADSHEET_NOT_CONFIGURED: 'El sistema aún no está configurado.',
    CAMPAIGN_NOT_FOUND: 'La campaña seleccionada ya no está disponible.',
    CAMPAIGN_NOT_ACTIVE: 'La campaña seleccionada no está activa.',
    SLOT_NOT_FOUND: 'El horario seleccionado ya no está disponible.',
    HORARIO_OCUPADO: 'Este horario acaba de ser reservado. Selecciona otro horario disponible.',
    PERSONA_YA_REGISTRADA: 'Este DNI ya tiene una reserva activa en la campaña.',
    SYSTEM_BUSY: 'Hay muchas solicitudes en este momento. Intenta nuevamente.',
    RESERVATION_NOT_FOUND: 'No encontramos esa reserva.',
    RESERVATION_ALREADY_CANCELLED: 'La reserva ya fue cancelada.',
    ADMIN_ONLY: 'Esta operación solo puede ejecutarse desde el editor de Apps Script.',
    INTERNAL_ERROR: 'No pudimos completar la operación. Intenta nuevamente.'
  };
  return messages[code] || messages.INTERNAL_ERROR;
}

function assertAdminExecution_() {
  const activeEmail = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  const configuredAdmin = String(PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL') || '').trim().toLowerCase();
  if (!activeEmail || configuredAdmin && activeEmail !== configuredAdmin) {
    throwAppError_('ADMIN_ONLY', 'Operación administrativa no autorizada.');
  }
}
