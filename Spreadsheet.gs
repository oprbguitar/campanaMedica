function getSpreadsheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!spreadsheetId) {
    throwAppError_('SPREADSHEET_NOT_CONFIGURED', 'Falta la propiedad SPREADSHEET_ID.');
  }
  try {
    return SpreadsheetApp.openById(spreadsheetId);
  } catch (error) {
    throwAppError_('SPREADSHEET_NOT_CONFIGURED', 'No se pudo abrir el Spreadsheet configurado.');
  }
}

function getSheet_(sheetName) {
  const allowedNames = Object.keys(SHEET_NAMES_).map(function (key) { return SHEET_NAMES_[key]; });
  if (allowedNames.indexOf(sheetName) === -1) {
    throwAppError_('INTERNAL_ERROR', 'Hoja no permitida.');
  }
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) {
    throwAppError_('INTERNAL_ERROR', 'Falta una hoja del sistema.');
  }
  return sheet;
}

function readRows_(sheetName) {
  const sheet = getSheet_(sheetName);
  const lastRow = sheet.getLastRow();
  const headers = SHEET_HEADERS_[sheetName];
  if (lastRow < 2) {
    return { sheet: sheet, headers: headers, values: [], rows: [] };
  }
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getDisplayValues();
  const rows = values.map(function (valuesRow, index) {
    const row = { rowNumber: index + 2 };
    headers.forEach(function (header, columnIndex) {
      row[header] = valuesRow[columnIndex];
    });
    return row;
  });
  return { sheet: sheet, headers: headers, values: values, rows: rows };
}

function appendRows_(sheetName, values) {
  if (!values.length) return;
  const table = readRows_(sheetName);
  table.sheet.getRange(table.sheet.getLastRow() + 1, 1, values.length, SHEET_HEADERS_[sheetName].length).setValues(values);
}

function updateRow_(sheetName, rowNumber, values) {
  const sheet = getSheet_(sheetName);
  sheet.getRange(rowNumber, 1, 1, values.length).setValues([values]);
}

function rowToValues_(sheetName, row) {
  return SHEET_HEADERS_[sheetName].map(function (header) { return row[header] == null ? '' : row[header]; });
}

function findRowByField_(sheetName, field, value) {
  return readRows_(sheetName).rows.find(function (row) {
    return String(row[field]) === String(value);
  }) || null;
}
