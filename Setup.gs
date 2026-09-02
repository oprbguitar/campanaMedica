function setupSystem() {
  return withPublicErrorHandling_(function () {
    assertAdminExecution_();
    const spreadsheet = getSpreadsheet_();
    Object.keys(SHEET_NAMES_).forEach(function (key) {
      const sheetName = SHEET_NAMES_[key];
      let sheet = spreadsheet.getSheetByName(sheetName);
      if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
      ensureHeaders_(sheet, SHEET_HEADERS_[sheetName]);
      formatSheet_(sheetName, sheet);
    });
    ensureDefaultConfig_();
    return { success: true, spreadsheetId: spreadsheet.getId(), sheets: Object.keys(SHEET_NAMES_).map(function (key) { return SHEET_NAMES_[key]; }) };
  });
}

function seedDemoSchedule() {
  return migrateDemoToHourly();
}

function migrateDemoToHourly() {
  return withPublicErrorHandling_(function () {
    assertAdminExecution_();
    const configTable = readRows_(SHEET_NAMES_.CONFIG);
    const durationRow = configTable.rows.find(function (row) { return String(row.CLAVE) === 'DURACION_SLOT'; });
    if (durationRow) updateRow_(SHEET_NAMES_.CONFIG, durationRow.rowNumber, ['DURACION_SLOT', '60']);

    const oldCampaign = getCampaignById_('CAM-DEMO-2026');
    if (oldCampaign && isTrueValue_(oldCampaign.activo)) {
      updateRow_(SHEET_NAMES_.CAMPAIGNS, oldCampaign.rowNumber, rowToValues_(SHEET_NAMES_.CAMPAIGNS, Object.assign({}, oldCampaign, { activo: false, updated_at: nowText_() })));
    }

    const campaignId = 'CAM-DEMO-60-2026';
    let campaign = getCampaignById_(campaignId);
    if (!campaign) {
      const timestamp = nowText_();
      appendRows_(SHEET_NAMES_.CAMPAIGNS, [[
        campaignId,
        'Demo - Horarios de una hora',
        'Horarios de prueba de 60 minutos',
        '2026-09-03',
        '2026-09-05',
        true,
        timestamp,
        timestamp
      ]]);
      campaign = getCampaignById_(campaignId);
    }
    const dates = ['2026-09-03', '2026-09-04', '2026-09-05'];
    const results = dates.map(function (date) {
      return generateSlots({ campaignId: campaign.campaign_id, date: date, start: '08:00', end: '13:00', durationMinutes: 60, capacity: 1 });
    });
    return {
      success: true,
      campaignId: campaignId,
      dates: dates,
      created: results.reduce(function (total, result) { return total + Number(result.created || 0); }, 0)
    };
  });
}

function ensureHeaders_(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
}

function formatSheet_(sheetName, sheet) {
  const textColumns = {
    CAMPANAS: [1, 4, 5],
    HORARIOS: [1, 2, 3, 4, 5],
    PERSONAS: [1, 2],
    RESERVAS: [1, 2, 3, 4, 5, 6, 7, 8],
    AUDITORIA: [1, 3, 4],
    CONFIG: [1, 2]
  };
  (textColumns[sheetName] || []).forEach(function (column) {
    sheet.getRange(2, column, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat('@');
  });
}

function ensureDefaultConfig_() {
  const table = readRows_(SHEET_NAMES_.CONFIG);
  const existingKeys = table.rows.map(function (row) { return String(row.CLAVE).trim(); });
  const missingRows = Object.keys(DEFAULT_CONFIG_)
    .filter(function (key) { return existingKeys.indexOf(key) === -1; })
    .map(function (key) { return [key, DEFAULT_CONFIG_[key]]; });
  appendRows_(SHEET_NAMES_.CONFIG, missingRows);
}
