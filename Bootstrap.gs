/**
 * Arranque de una campaña nueva desde cero.
 *
 * crearCampanaMedica() crea un Spreadsheet NUEVO en tu Drive, apunta el script
 * hacia él y lo deja listo con estructura, campaña y horarios de una hora.
 * No toca ninguna hoja anterior: el SPREADSHEET_ID previo se reemplaza, pero
 * el archivo viejo sigue intacto en tu Drive.
 *
 * Ejecútala UNA vez desde el editor de Apps Script. Sin argumentos usa los
 * valores por defecto; con un objeto puedes ajustar fechas y horario:
 *
 *   crearCampanaMedica({ dias: 3, horaInicio: '09:00', horaFin: '13:00' });
 *   crearCampanaMedica({ fechas: ['2026-09-10', '2026-09-11'] });
 *
 * Privacidad: un Spreadsheet creado por el script queda como archivo privado
 * del dueño de la cuenta; nadie más puede abrirlo mientras no lo compartas.
 * El script no pide permisos de Drive a propósito, para no ampliar los
 * alcances de un proyecto que además expone un endpoint público. Verifica el
 * botón "Compartir" del archivo una vez y no lo compartas con nadie.
 */

const BOOTSTRAP_DEFAULTS_ = Object.freeze({
  dias: 5,
  horaInicio: '08:00',
  horaFin: '17:00',
  duracionMinutos: 60,
  capacidad: 1,
  nombre: 'Campaña de Salud',
  descripcion: 'Reserva de atención médica'
});

function crearCampanaMedica(options) {
  return withPublicErrorHandling_(function () {
    assertAdminExecution_();
    const input = Object.assign({}, BOOTSTRAP_DEFAULTS_, options || {});
    const dates = resolveCampaignDates_(input);
    if (!dates.length) throwAppError_('VALIDATION_ERROR', 'No se pudo determinar ninguna fecha para la campaña.');

    const spreadsheet = SpreadsheetApp.create(buildSpreadsheetName_(dates));
    PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', spreadsheet.getId());
    clearSpreadsheetCache_();

    const structure = setupSystem();
    if (!structure.success) return structure;
    removeDefaultSheet_(spreadsheet);

    const timestamp = nowText_();
    const campaignId = 'CAM-' + Utilities.formatDate(new Date(), getTimeZone_(), 'yyyyMMdd-HHmmss');
    appendRows_(SHEET_NAMES_.CAMPAIGNS, [[
      campaignId,
      input.nombre,
      input.descripcion,
      dates[0],
      dates[dates.length - 1],
      'TRUE',
      timestamp,
      timestamp
    ]]);

    let created = 0;
    dates.forEach(function (date) {
      const result = generateSlots({
        campaignId: campaignId,
        date: date,
        start: input.horaInicio,
        end: input.horaFin,
        durationMinutes: input.duracionMinutos,
        capacity: input.capacidad
      });
      if (!result.success) throwAppError_(result.code || 'INTERNAL_ERROR', result.message);
      created += Number(result.created || 0);
    });

    SpreadsheetApp.flush();
    return {
      success: true,
      spreadsheetId: spreadsheet.getId(),
      spreadsheetUrl: spreadsheet.getUrl(),
      campaignId: campaignId,
      fechas: dates,
      horariosCreados: created,
      siguientePaso: 'Despliega la aplicación web y pega su URL /exec en docs/config.js.'
    };
  });
}

function resolveCampaignDates_(input) {
  if (Array.isArray(input.fechas) && input.fechas.length) {
    return input.fechas.map(validateIsoDate_).sort();
  }
  const total = positiveInteger_(input.dias, 'La cantidad de días');
  const start = input.desde ? validateIsoDate_(input.desde) : addDaysText_(todayText_(), 1);
  const dates = [];
  for (let offset = 0; offset < total; offset++) {
    dates.push(addDaysText_(start, offset));
  }
  return dates;
}

function addDaysText_(dateText, days) {
  const parts = dateText.split('-').map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
  return Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd');
}

function buildSpreadsheetName_(dates) {
  return 'Campaña de Salud - Reservas ' + dates[0] + ' a ' + dates[dates.length - 1];
}

function removeDefaultSheet_(spreadsheet) {
  const systemNames = Object.keys(SHEET_NAMES_).map(function (key) { return SHEET_NAMES_[key]; });
  spreadsheet.getSheets().forEach(function (sheet) {
    if (systemNames.indexOf(sheet.getName()) === -1 && spreadsheet.getSheets().length > 1) {
      spreadsheet.deleteSheet(sheet);
    }
  });
}
