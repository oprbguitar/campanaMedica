const SHEET_NAMES_ = Object.freeze({
  CONFIG: 'CONFIG',
  CAMPAIGNS: 'CAMPANAS',
  SLOTS: 'HORARIOS',
  PEOPLE: 'PERSONAS',
  RESERVATIONS: 'RESERVAS',
  AUDIT: 'AUDITORIA',
  MEDICAL_AGENDA: 'AGENDA_MEDICO'
});

const SHEET_HEADERS_ = Object.freeze({
  CONFIG: ['CLAVE', 'VALOR'],
  CAMPANAS: ['campaign_id', 'nombre', 'descripcion', 'fecha_inicio', 'fecha_fin', 'activo', 'created_at', 'updated_at'],
  HORARIOS: ['slot_id', 'campaign_id', 'fecha', 'inicio', 'fin', 'capacidad', 'ocupados', 'estado', 'created_at', 'updated_at'],
  PERSONAS: ['person_id', 'dni', 'nombres', 'apellidos', 'telefono', 'area', 'correo', 'created_at', 'updated_at'],
  RESERVAS: ['reservation_id', 'reservation_code', 'campaign_id', 'slot_id', 'person_id', 'dni', 'fecha', 'hora', 'estado', 'created_at', 'updated_at'],
  AUDITORIA: ['timestamp', 'accion', 'reservation_id', 'dni', 'detalle'],
  AGENDA_MEDICO: ['fecha', 'hora', 'DNI', 'nombres', 'apellidos', 'area', 'estado', 'reservation_code']
});

const DEFAULT_CONFIG_ = Object.freeze({
  EMPRESA: 'Campaña de Salud',
  TITULO_APP: 'Reserva tu cita',
  DURACION_SLOT: '15',
  ZONA_HORARIA: 'America/Lima',
  RESERVAS_POR_PERSONA: '1'
});

function getConfigValue_(key) {
  const config = getConfigMap_();
  return config[key] || DEFAULT_CONFIG_[key] || '';
}

function getConfigMap_() {
  const rows = readRows_(SHEET_NAMES_.CONFIG).rows;
  return rows.reduce(function (result, row) {
    const key = String(row.CLAVE || '').trim();
    if (key) {
      result[key] = String(row.VALOR == null ? '' : row.VALOR).trim();
    }
    return result;
  }, {});
}

function getTimeZone_() {
  return getConfigValue_('ZONA_HORARIA') || 'America/Lima';
}

function nowText_() {
  return Utilities.formatDate(new Date(), getTimeZone_(), "yyyy-MM-dd'T'HH:mm:ss");
}

function todayText_() {
  return Utilities.formatDate(new Date(), getTimeZone_(), 'yyyy-MM-dd');
}
