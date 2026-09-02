/**
 * Capa de acceso al Spreadsheet.
 *
 * Rendimiento: cada llamada a SpreadsheetApp cuesta cientos de milisegundos.
 * Una reserva necesita mirar CAMPANAS, HORARIOS, PERSONAS y RESERVAS, así que
 * sin caché son cuatro o cinco lecturas completas por operación. Aquí se
 * memoriza el Spreadsheet, cada hoja y cada tabla leída durante la ejecución,
 * y se invalida en cuanto se escribe. La ejecución dura milisegundos, no vive
 * entre peticiones, y createReservation() limpia la caché al tomar el bloqueo:
 * lo que lee dentro del lock siempre viene del Spreadsheet real.
 */

let SPREADSHEET_CACHE_ = null;
let SHEET_CACHE_ = {};
let ROWS_CACHE_ = {};

function clearSpreadsheetCache_() {
  SPREADSHEET_CACHE_ = null;
  SHEET_CACHE_ = {};
  ROWS_CACHE_ = {};
}

function clearRowsCache_(sheetName) {
  if (sheetName) delete ROWS_CACHE_[sheetName];
  else ROWS_CACHE_ = {};
}

function getSpreadsheet_() {
  if (SPREADSHEET_CACHE_) return SPREADSHEET_CACHE_;
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!spreadsheetId) {
    throwAppError_('SPREADSHEET_NOT_CONFIGURED', 'Falta la propiedad SPREADSHEET_ID.');
  }
  try {
    SPREADSHEET_CACHE_ = SpreadsheetApp.openById(spreadsheetId);
  } catch (error) {
    throwAppError_('SPREADSHEET_NOT_CONFIGURED', 'No se pudo abrir el Spreadsheet configurado.');
  }
  return SPREADSHEET_CACHE_;
}

function getSheet_(sheetName) {
  if (SHEET_CACHE_[sheetName]) return SHEET_CACHE_[sheetName];
  const allowedNames = Object.keys(SHEET_NAMES_).map(function (key) { return SHEET_NAMES_[key]; });
  if (allowedNames.indexOf(sheetName) === -1) {
    throwAppError_('INTERNAL_ERROR', 'Hoja no permitida.');
  }
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) {
    throwAppError_('INTERNAL_ERROR', 'Falta una hoja del sistema.');
  }
  SHEET_CACHE_[sheetName] = sheet;
  return sheet;
}

function readRows_(sheetName) {
  if (ROWS_CACHE_[sheetName]) return ROWS_CACHE_[sheetName];
  const sheet = getSheet_(sheetName);
  const lastRow = sheet.getLastRow();
  const headers = SHEET_HEADERS_[sheetName];
  let table;
  if (lastRow < 2) {
    table = { sheet: sheet, headers: headers, values: [], rows: [] };
  } else {
    const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getDisplayValues();
    const rows = values.map(function (valuesRow, index) {
      const row = { rowNumber: index + 2 };
      headers.forEach(function (header, columnIndex) {
        row[header] = valuesRow[columnIndex];
      });
      return row;
    });
    table = { sheet: sheet, headers: headers, values: values, rows: rows };
  }
  ROWS_CACHE_[sheetName] = table;
  return table;
}

/**
 * Índice por campo para no recorrer la tabla completa en cada búsqueda.
 * Se construye sobre la tabla ya cacheada, así que no añade lecturas.
 */
function indexRowsBy_(sheetName, field) {
  const table = readRows_(sheetName);
  if (!table.indexes) table.indexes = {};
  if (table.indexes[field]) return table.indexes[field];
  const index = table.rows.reduce(function (result, row) {
    const key = String(row[field]);
    if (!result[key]) result[key] = [];
    result[key].push(row);
    return result;
  }, {});
  table.indexes[field] = index;
  return index;
}

function appendRows_(sheetName, values) {
  if (!values.length) return;
  const table = readRows_(sheetName);
  table.sheet.getRange(table.sheet.getLastRow() + 1, 1, values.length, SHEET_HEADERS_[sheetName].length).setValues(values);
  clearRowsCache_(sheetName);
}

function updateRow_(sheetName, rowNumber, values) {
  const sheet = getSheet_(sheetName);
  sheet.getRange(rowNumber, 1, 1, values.length).setValues([values]);
  clearRowsCache_(sheetName);
}

function rowToValues_(sheetName, row) {
  return SHEET_HEADERS_[sheetName].map(function (header) { return row[header] == null ? '' : row[header]; });
}

function findRowByField_(sheetName, field, value) {
  const matches = indexRowsBy_(sheetName, field)[String(value)];
  return matches && matches.length ? matches[0] : null;
}
