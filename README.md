# Sistema Express de Reservas para Campaña de Salud

Aplicación web *mobile-first* para que las personas reserven su cita en una campaña de salud ocupacional, construida íntegramente sobre **Google Apps Script (runtime V8)** con **Google Sheets como base de datos**, y HTML/CSS/JavaScript vanilla en el cliente. No almacena historia clínica, no consulta RENIEC y no requiere servidores ni costos de infraestructura.

---

## 1. Qué es esto, en detalle

### El problema que resuelve

En una campaña de salud (por ejemplo, exámenes ocupacionales de una empresa durante tres días), el cuello de botella es la coordinación: listas en papel, mensajes de WhatsApp cruzados, dos personas citadas a la misma hora, y un médico que no sabe a quién le toca a las 9:15. Este sistema reemplaza todo eso con **un solo enlace público** que se comparte por WhatsApp o código QR.

### Cómo funciona, en una frase

El administrador crea una campaña y genera los horarios disponibles desde el editor de Apps Script; la persona abre el enlace en su celular, ingresa su DNI, confirma sus datos, elige un horario libre y recibe un **código de reserva**; el médico obtiene su agenda del día ordenada por hora en una hoja del Spreadsheet.

### Arquitectura

```text
┌──────────────────────────┐
│  Navegador (celular)     │  Index.html + Styles.html + Scripts.html
│  Flujo de 4 pasos        │  JavaScript vanilla, sin frameworks
└───────────┬──────────────┘
            │ google.script.run  (RPC de Apps Script, lista blanca de funciones)
┌───────────▼──────────────┐
│  Apps Script V8          │  Main / Validation / *Service.gs
│  Lógica + LockService    │  Bloqueo global para evitar dobles reservas
└───────────┬──────────────┘
            │ SpreadsheetApp
┌───────────▼──────────────┐
│  Google Spreadsheet      │  7 hojas: CONFIG, CAMPANAS, HORARIOS,
│  PRIVADO (no compartido) │  PERSONAS, RESERVAS, AUDITORIA, AGENDA_MEDICO
└──────────────────────────┘
```

El Spreadsheet **nunca se comparte**. La aplicación web se despliega con `executeAs: USER_DEPLOYING`, de modo que la app corre con los permisos del dueño y el visitante anónimo jamás toca la hoja directamente: solo puede invocar las funciones públicas listadas más abajo.

### Flujo del usuario final (4 pasos)

| Paso | Pantalla | Qué ocurre en el servidor |
|---|---|---|
| 1 | Ingresa DNI (8 dígitos) | `lookupPersonByDni` — si el DNI ya existe en `PERSONAS`, precarga nombres y apellidos |
| 2 | Confirma nombres, apellidos, teléfono y área | Validación en cliente; nada se persiste todavía |
| 3 | Elige fecha → horario | `getActiveCampaigns` (la campaña se autoselecciona), `getCampaignDates`, `getAvailableSlots` |
| 4 | Confirmación con código `CS-XXXXX` | `createReservation` dentro de `LockService.getScriptLock()` |

La interfaz muestra un indicador de progreso, estados de carga y mensajes de error legibles (nunca trazas técnicas).

El paso 3 **no expone un selector de campaña**: el cliente llama a `getActiveCampaigns()` y toma automáticamente la primera campaña activa, guardándola en `state.selectedCampaignId`. Esto simplifica el flujo en el caso normal (una sola campaña vigente a la vez); si hubiera varias activas en simultáneo, la persona siempre reservaría en la primera que devuelva la hoja `CAMPANAS`.

### Modelo de datos (7 hojas)

| Hoja | Rol | Columnas |
|---|---|---|
| `CONFIG` | Parámetros editables sin tocar código | `CLAVE`, `VALOR` |
| `CAMPANAS` | Campañas de salud | `campaign_id`, `nombre`, `descripcion`, `fecha_inicio`, `fecha_fin`, `activo`, `created_at`, `updated_at` |
| `HORARIOS` | Slots generados por rango horario | `slot_id`, `campaign_id`, `fecha`, `inicio`, `fin`, `capacidad`, `ocupados`, `estado`, `created_at`, `updated_at` |
| `PERSONAS` | Padrón de personas por DNI | `person_id`, `dni`, `nombres`, `apellidos`, `telefono`, `area`, `correo`, `created_at`, `updated_at` |
| `RESERVAS` | Citas | `reservation_id`, `reservation_code`, `campaign_id`, `slot_id`, `person_id`, `dni`, `fecha`, `hora`, `estado`, `created_at`, `updated_at` |
| `AUDITORIA` | Bitácora append-only | `timestamp`, `accion`, `reservation_id`, `dni`, `detalle` |
| `AGENDA_MEDICO` | Vista reconstruible para el médico | `fecha`, `hora`, `DNI`, `nombres`, `apellidos`, `area`, `estado`, `reservation_code` |

Claves de `CONFIG` con valores por defecto: `EMPRESA`, `TITULO_APP`, `DURACION_SLOT` (15), `ZONA_HORARIA` (`America/Lima`), `RESERVAS_POR_PERSONA` (1).

Todos los identificadores usan `Utilities.getUuid()`. El `reservation_code` tiene formato `CS-XXXXX` con un alfabeto sin caracteres ambiguos (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`) y se reintenta hasta encontrar uno no usado. Las columnas de ID, fecha y hora se formatean como texto (`@`) para que Sheets no las reinterprete como números o fechas.

### Concurrencia: por qué no hay doble reserva

`createReservation()` es la sección crítica del sistema. Toma `LockService.getScriptLock()` con espera de 10 s y, **ya dentro del lock**, vuelve a leer todo desde el Spreadsheet antes de escribir:

1. Revalida que la campaña exista, esté activa y no haya terminado.
2. Relee el slot por `slot_id` y verifica que pertenezca a esa campaña.
3. Comprueba `ocupados < capacidad` y que el estado no sea `BLOQUEADO`/`CANCELADO`.
4. Busca una reserva activa existente para el par `dni + campaign_id`.
5. Crea o actualiza la persona, inserta la reserva, incrementa `ocupados`, marca el slot como `COMPLETO` si se llenó.
6. Registra la acción en `AUDITORIA` y llama a `SpreadsheetApp.flush()`.
7. Libera el lock en un bloque `finally`.

Si un segundo usuario intenta el mismo slot, entra al lock después y encuentra el slot lleno: recibe `HORARIO_OCUPADO`. `cancelReservation()` y `generateSlots()` usan el mismo patrón de bloqueo.

### Idempotencia

- `setupSystem()` crea solo las hojas que faltan, escribe cabeceras solo si la hoja está vacía y añade únicamente las claves de `CONFIG` ausentes. Ejecutarla dos veces no duplica ni borra nada.
- `generateSlots()` construye una clave `campaign_id|fecha|inicio` de los slots existentes y omite los repetidos, devolviendo cuántos creó y cuántos saltó.
- `buildMedicalAgenda()` limpia el contenido de `AGENDA_MEDICO` y lo reconstruye desde `RESERVAS` + `PERSONAS`, excluyendo las canceladas y ordenando por fecha y hora.

### Seguridad

- **El Spreadsheet permanece privado.** Solo se comparte la URL de la aplicación web.
- **Lista blanca de hojas:** `getSheet_()` rechaza cualquier nombre que no esté en `SHEET_NAMES_`; el cliente nunca envía un nombre de hoja.
- **Funciones administrativas protegidas:** `setupSystem`, `generateSlots` y `buildMedicalAgenda` llaman a `assertAdminExecution_()`, que exige un usuario activo autenticado y, si se definió la propiedad de script `ADMIN_EMAIL`, que coincida con ese correo. Desde el flujo público anónimo `Session.getActiveUser().getEmail()` viene vacío y la llamada falla con `ADMIN_ONLY`.
- **Sin secretos en el repositorio:** el `SPREADSHEET_ID` vive en Script Properties, no en el código; `.clasp.json` está en `.gitignore`.
- **Errores saneados:** `withPublicErrorHandling_()` captura toda excepción, registra el detalle técnico en Stackdriver y devuelve al cliente únicamente un código y un mensaje en español apto para el usuario.
- **Validación estricta de entrada:** DNI de exactamente 8 dígitos, fechas `YYYY-MM-DD` con verificación de calendario real (rechaza `2026-02-30`), horas `HH:MM` en 24 h, y longitudes máximas en todos los campos de texto.

### Códigos de error

| Código | Significado |
|---|---|
| `VALIDATION_ERROR` | Datos de entrada inválidos |
| `SPREADSHEET_NOT_CONFIGURED` | Falta o es inválida la propiedad `SPREADSHEET_ID` |
| `CAMPAIGN_NOT_FOUND` / `CAMPAIGN_NOT_ACTIVE` | Campaña inexistente, desactivada o vencida |
| `SLOT_NOT_FOUND` | El horario ya no existe |
| `HORARIO_OCUPADO` | El slot se llenó (típicamente, carrera con otro usuario) |
| `PERSONA_YA_REGISTRADA` | Ese DNI ya tiene reserva activa en la campaña; la respuesta incluye la reserva existente |
| `SYSTEM_BUSY` | No se pudo obtener el lock en 10 s |
| `RESERVATION_NOT_FOUND` / `RESERVATION_ALREADY_CANCELLED` | Problemas al consultar o cancelar |
| `ADMIN_ONLY` | Se intentó una operación administrativa fuera del editor |
| `INTERNAL_ERROR` | Cualquier otro fallo |

### Contenido del repositorio

| Archivo | Responsabilidad |
|---|---|
| `appsscript.json` | Manifiesto: V8, zona `America/Lima`, web app anónima ejecutada como el desplegador |
| `Main.gs` | `doGet`, `getAppConfig`, manejo de errores, guarda administrativa |
| `Config.gs` | Nombres y cabeceras de hojas, valores por defecto, utilidades de fecha/hora |
| `Spreadsheet.gs` | Capa de acceso a datos: leer, insertar, actualizar, buscar por campo |
| `Validation.gs` | Validadores de DNI, fecha, hora, texto y enteros |
| `Setup.gs` | `setupSystem()` idempotente y formato de columnas |
| `CampaignService.gs` | Campañas activas y fechas con cupo |
| `SlotService.gs` | Generación y consulta de horarios, aritmética de tiempos |
| `PersonService.gs` | Búsqueda por DNI y *upsert* de personas |
| `ReservationService.gs` | Crear, consultar y cancelar reservas (núcleo transaccional) |
| `AuditService.gs` | Escritura en la bitácora |
| `MedicalAgendaService.gs` | Reconstrucción de la agenda del médico |
| `Tests.gs` | `runValidationTests()` con aserciones básicas |
| `Index.html` / `Styles.html` / `Scripts.html` | Interfaz de 4 pasos, estilos y lógica de cliente |
| `.clasp.json.example` / `.claspignore` | Plantilla y exclusiones para desarrollo con clasp |
| `artifact-build/` | Script Node que genera un `.xlsx` semilla con las 7 hojas y sus cabeceras |
| `outputs/` | Artefactos generados: el `.xlsx` semilla y capturas PNG de cada hoja |

### Alcance explícito

**Sí hace:** reservar, consultar y cancelar citas; evitar duplicados por DNI; evitar sobrecupo bajo concurrencia; auditar; producir la agenda del médico.

**No hace:** almacenar historia clínica, resultados o diagnósticos; consultar RENIEC ni validar identidad contra fuente oficial; enviar WhatsApp, correo o SMS; autenticar al personal médico dentro de la app.

---

## 2. Puesta en marcha

### Árbol de archivos

```text
appsscript.json
Main.gs
Config.gs
Spreadsheet.gs
Validation.gs
Setup.gs
CampaignService.gs
SlotService.gs
PersonService.gs
ReservationService.gs
AuditService.gs
MedicalAgendaService.gs
Tests.gs
Index.html
Styles.html
Scripts.html
```

### Configuración en Google

1. Crea un Google Spreadsheet privado en tu cuenta.
2. Copia su ID desde la URL: `https://docs.google.com/spreadsheets/d/ID/edit`.
3. Abre `Extensiones > Apps Script` y configura la propiedad de script `SPREADSHEET_ID` con ese valor. También puede hacerse desde el editor:

   ```javascript
   PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', 'PEGA_AQUI_EL_ID');
   ```

   Opcionalmente define `ADMIN_EMAIL` con el correo de la cuenta administradora. Las funciones `setupSystem`, `generateSlots` y `buildMedicalAgenda` exigen una ejecución autenticada desde el editor y nunca deben llamarse desde el flujo público.

4. Copia estos archivos al proyecto o usa `clasp push`.
5. Ejecuta `setupSystem()` desde el editor y autoriza el proyecto. La función es idempotente: crea las hojas faltantes y no elimina información existente.
6. Edita `CONFIG` si necesitas cambiar empresa, título, duración o zona horaria. La zona prevista es `America/Lima`.
7. Crea una campaña en `CAMPANAS`, por ejemplo:

   ```text
   CAM-001 | Campaña septiembre | Reserva de atención | 2026-09-03 | 2026-09-05 | TRUE
   ```

   `campaign_id` debe permanecer inmutable. Completa `created_at` y `updated_at` con texto ISO si deseas trazabilidad manual.
8. Ejecuta `generateSlots()` desde Apps Script, por ejemplo:

   ```javascript
   generateSlots({
     campaignId: 'CAM-001',
     date: '2026-09-03',
     start: '08:00',
     end: '13:00',
     durationMinutes: 15,
     capacity: 1
   });
   ```

   Repetir la ejecución no duplica horarios.

### Desarrollo local con clasp

Instala clasp y autentícate:

```bash
npm install -g @google/clasp
clasp login
clasp clone SCRIPT_ID
```

Si estás trabajando en esta carpeta después de crear el proyecto en Apps Script, crea un `.clasp.json` local (no se publica):

```json
{
  "scriptId": "SCRIPT_ID",
  "rootDir": "."
}
```

Puedes copiar `.clasp.json.example` como `.clasp.json` y reemplazar el ID del proyecto de Apps Script.

Luego:

```bash
clasp push
clasp open
```

No agregues el Spreadsheet ID a `.clasp.json`; debe permanecer en Script Properties.

### Despliegue

En Apps Script: `Implementar > Nueva implementación > Aplicación web`.

- Ejecutar como: tu cuenta.
- Quién tiene acceso: cualquiera con el enlace, o cualquiera, según tu política.

Comparte solamente la URL de la aplicación mediante WhatsApp o QR. El Spreadsheet debe mantenerse privado. Después de cambios, crea una nueva versión o actualiza la implementación existente y prueba la URL pública real desde un teléfono.

### Funciones desarrolladas

Públicas para la aplicación: `getAppConfig`, `getActiveCampaigns`, `getCampaignDates`, `getAvailableSlots`, `lookupPersonByDni`, `createReservation`, `getReservation` y `cancelReservation`.

Operativas desde el editor: `setupSystem`, `generateSlots`, `buildMedicalAgenda` y `runValidationTests`. Las funciones auxiliares terminan en `_` y las hojas se resuelven mediante una lista interna, nunca desde el cliente.

`createReservation()` valida de nuevo dentro de `LockService.getScriptLock()`, vuelve a leer el slot, comprueba campaña, capacidad y duplicidad por `dni + campaign_id`, guarda persona y reserva, actualiza ocupados, audita y libera el lock en `finally`.

### Pruebas

Ejecuta `runValidationTests()` desde Apps Script para las pruebas unitarias básicas. Para la aceptación completa del MVP, usa una campaña de prueba y verifica:

1. reserva correcta;
2. segundo intento con el mismo DNI: `PERSONA_YA_REGISTRADA`;
3. dos navegadores reservando el mismo slot: solo una reserva debe crearse;
4. slot completo: `HORARIO_OCUPADO`;
5. DNI inválido;
6. campaña inexistente;
7. slot inexistente;
8. slot de otra campaña;
9. campaña inactiva;
10. cancelación y liberación de capacidad;
11. dos ejecuciones de `setupSystem()` sin duplicar hojas ni configuración;
12. dos ejecuciones de `generateSlots()` sin duplicar horarios.

La prueba de concurrencia debe hacerse con dos sesiones/navegadores independientes contra la implementación web; ejecutar dos llamadas consecutivas desde el editor no reproduce una carrera real.

### Agenda médica

Ejecuta `buildMedicalAgenda()` desde Apps Script para reconstruir `AGENDA_MEDICO` con fecha, hora, DNI, nombres, apellidos, área, estado y código. No es un dashboard y el Spreadsheet debe seguir siendo privado.

### Limitaciones conocidas y V2

- El enlace público anónimo no implementa cuentas ni autenticación de personal médico; la protección administrativa depende de ejecutar esas funciones desde el editor y mantener privado el Spreadsheet.
- No hay envío automático por WhatsApp, correo ni SMS.
- La cancelación pública requiere código y DNI, pero no existe todavía una interfaz visual de cancelación.
- Para V2: autenticación administrativa, interfaz de agenda protegida, recordatorios, límite de intentos por IP mediante una capa externa y exportación controlada.
