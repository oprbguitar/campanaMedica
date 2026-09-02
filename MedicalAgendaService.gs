function buildMedicalAgenda() {
  return withPublicErrorHandling_(function () {
    assertAdminExecution_();
    const people = readRows_(SHEET_NAMES_.PEOPLE).rows.reduce(function (result, person) {
      result[person.person_id] = person;
      return result;
    }, {});
    const agendaRows = readRows_(SHEET_NAMES_.RESERVATIONS).rows
      .filter(function (reservation) { return String(reservation.estado) !== 'CANCELADO'; })
      .map(function (reservation) {
        const person = people[reservation.person_id] || {};
        return [reservation.fecha, reservation.hora, reservation.dni, person.nombres || '', person.apellidos || '', person.area || '', reservation.estado, reservation.reservation_code, reservation.created_at || ''];
      })
      .sort(function (left, right) { return (left[0] + left[1]).localeCompare(right[0] + right[1]); });
    const sheet = getSheet_(SHEET_NAMES_.MEDICAL_AGENDA);
    const currentRows = sheet.getLastRow();
    if (currentRows > 1) sheet.getRange(2, 1, currentRows - 1, SHEET_HEADERS_.AGENDA_MEDICO.length).clearContent();
    if (agendaRows.length) sheet.getRange(2, 1, agendaRows.length, SHEET_HEADERS_.AGENDA_MEDICO.length).setValues(agendaRows);
    SpreadsheetApp.flush();
    return { success: true, rows: agendaRows.length };
  });
}
