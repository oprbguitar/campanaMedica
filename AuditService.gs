function audit_(action, reservationId, dni, detail) {
  appendRows_(SHEET_NAMES_.AUDIT, [[nowText_(), action, reservationId || '', dni || '', detail || '']]);
}
