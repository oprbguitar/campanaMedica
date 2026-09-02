function runValidationTests() {
  const assertions = [];
  assertTest_(assertions, 'acepta DNI de ocho dígitos', function () { return validateDni_('12345678') === '12345678'; });
  assertTest_(assertions, 'rechaza DNI inválido', function () { return throwsCode_(function () { validateDni_('1234'); }, 'VALIDATION_ERROR'); });
  assertTest_(assertions, 'rechaza fecha inválida', function () { return throwsCode_(function () { validateIsoDate_('2026-02-30'); }, 'VALIDATION_ERROR'); });
  assertTest_(assertions, 'rechaza hora inválida', function () { return throwsCode_(function () { validateTime_('25:00'); }, 'VALIDATION_ERROR'); });
  return { success: assertions.every(function (item) { return item.passed; }), tests: assertions };
}

function assertTest_(assertions, name, test) {
  try {
    assertions.push({ name: name, passed: Boolean(test()) });
  } catch (error) {
    assertions.push({ name: name, passed: false, error: error.message });
  }
}

function throwsCode_(operation, expectedCode) {
  try {
    operation();
    return false;
  } catch (error) {
    return error.code === expectedCode;
  }
}
