function validateDni_(dni) {
  const normalizedDni = String(dni == null ? '' : dni).trim();
  if (!/^\d{8}$/.test(normalizedDni)) {
    throwAppError_('VALIDATION_ERROR', 'El DNI debe tener exactamente 8 dígitos.');
  }
  return normalizedDni;
}

function validateIsoDate_(dateText) {
  const normalizedDate = String(dateText == null ? '' : dateText).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
    throwAppError_('VALIDATION_ERROR', 'La fecha no tiene un formato válido.');
  }
  const parts = normalizedDate.split('-').map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() !== parts[1] - 1 || date.getUTCDate() !== parts[2]) {
    throwAppError_('VALIDATION_ERROR', 'La fecha no es válida.');
  }
  return normalizedDate;
}

function validateTime_(timeText) {
  const normalizedTime = String(timeText == null ? '' : timeText).trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(normalizedTime)) {
    throwAppError_('VALIDATION_ERROR', 'La hora no tiene un formato válido.');
  }
  return normalizedTime;
}

function validateRequiredText_(value, fieldName, maxLength) {
  const normalized = String(value == null ? '' : value).trim();
  if (!normalized || normalized.length > maxLength) {
    throwAppError_('VALIDATION_ERROR', 'Revisa el campo ' + fieldName + '.');
  }
  return normalized;
}

function optionalText_(value, maxLength) {
  const normalized = String(value == null ? '' : value).trim();
  if (normalized.length > maxLength) {
    throwAppError_('VALIDATION_ERROR', 'Uno de los datos opcionales es demasiado largo.');
  }
  return normalized;
}

function validateCampaignId_(campaignId) {
  return validateRequiredText_(campaignId, 'campaña', 100);
}

function validateSlotId_(slotId) {
  return validateRequiredText_(slotId, 'horario', 100);
}

function isTrueValue_(value) {
  return ['TRUE', '1', 'SI', 'SÍ', 'VERDADERO', 'ACTIVO'].indexOf(String(value).trim().toUpperCase()) >= 0;
}

function positiveInteger_(value, fieldName) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throwAppError_('VALIDATION_ERROR', fieldName + ' debe ser un entero positivo.');
  }
  return number;
}
