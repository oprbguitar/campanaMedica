function lookupPersonByDni(dni) {
  return withPublicErrorHandling_(function () {
    const normalizedDni = validateDni_(dni);
    const person = findPersonByDni_(normalizedDni);
    if (!person) return { success: true, found: false };
    return { success: true, found: true, person: { personId: person.person_id, nombres: person.nombres, apellidos: person.apellidos } };
  });
}

function findPersonByDni_(dni) {
  return findRowByField_(SHEET_NAMES_.PEOPLE, 'dni', dni);
}

function findOrCreatePerson_(payload, timestamp) {
  const existing = findPersonByDni_(payload.dni);
  if (existing) {
    const updated = Object.assign({}, existing, {
      nombres: payload.nombres,
      apellidos: payload.apellidos,
      telefono: payload.telefono,
      area: payload.area,
      correo: payload.correo,
      updated_at: timestamp
    });
    updateRow_(SHEET_NAMES_.PEOPLE, existing.rowNumber, rowToValues_(SHEET_NAMES_.PEOPLE, updated));
    return updated;
  }
  const person = {
    person_id: Utilities.getUuid(),
    dni: payload.dni,
    nombres: payload.nombres,
    apellidos: payload.apellidos,
    telefono: payload.telefono,
    area: payload.area,
    correo: payload.correo,
    created_at: timestamp,
    updated_at: timestamp
  };
  appendRows_(SHEET_NAMES_.PEOPLE, [rowToValues_(SHEET_NAMES_.PEOPLE, person)]);
  return person;
}
