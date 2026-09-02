# Sistema Express de Reservas para Campaña de Salud

Aplicación web *mobile-first* para que las personas reserven su cita en una campaña de salud ocupacional, construida íntegramente sobre **Google Apps Script (runtime V8)** con **Google Sheets como base de datos**, y HTML/CSS/JavaScript vanilla en el cliente. No almacena historia clínica, no consulta RENIEC y no requiere servidores ni costos de infraestructura.

---

## 1. Qué es esto, en detalle

### El problema que resuelve

En una campaña de salud (por ejemplo, exámenes ocupacionales de una empresa durante tres días), el cuello de botella es la coordinación: listas en papel, mensajes de WhatsApp cruzados, dos personas citadas a la misma hora, y un médico que no sabe a quién le toca a las 9:15. Este sistema reemplaza todo eso con **un solo enlace público** que se comparte por WhatsApp o código QR.

### Cómo funciona, en una frase

El administrador crea una campaña y genera los horarios disponibles desde el editor de Apps Script; la persona abre el enlace en su celular, ingresa su DNI, confirma sus datos, elige un horario libre y recibe un **código de reserva**; el médico obtiene su agenda del día ordenada por hora en una hoja del Spreadsheet.

### Arquitectura

Hay **dos interfaces** sobre el mismo backend y la misma hoja de cálculo: la app alojada dentro de Apps Script y el portal estático de GitHub Pages (sección 3).

```text
┌──────────────────────────┐   ┌──────────────────────────┐
│  App en Apps Script      │   │  Portal en GitHub Pages  │
│  Index/Styles/Scripts    │   │  docs/index.html         │
└───────────┬──────────────┘   └───────────┬──────────────┘
            │ google.script.run             │ fetch GET/POST JSON
            │ (lista blanca de funciones)   │ (Api.gs)
┌───────────▼───────────────────────────────▼──────────────┐
│  Apps Script V8 — Main / Validation / *Service.gs / Api  │
│  Lógica + LockService: bloqueo global, una sola verdad   │
└───────────────────────────┬──────────────────────────────┘
                            │ SpreadsheetApp
┌───────────────────────────▼──────────────────────────────┐
│  Google Spreadsheet PRIVADO (nunca se comparte)          │
│  CONFIG · CAMPANAS · HORARIOS · PERSONAS · RESERVAS ·    │
│  AUDITORIA · AGENDA_MEDICO                               │
└──────────────────────────────────────────────────────────┘
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

Claves de `CONFIG` con valores por defecto: `EMPRESA`, `TITULO_APP`, `DURACION_SLOT` (60), `ZONA_HORARIA` (`America/Lima`), `RESERVAS_POR_PERSONA` (1).

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
| `Api.gs` | API JSON que consume el portal estático |
| `docs/index.html` | Portal público de una sola página para GitHub Pages |
| `docs/config.js` | URL de la implementación de Apps Script que usa el portal |
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

---

## 3. Portal público (GitHub Pages)

Además de la aplicación alojada dentro de Apps Script, el repositorio incluye un **portal estático** en `docs/`, pensado para publicarse en GitHub Pages y compartirse por WhatsApp o QR.

### Qué es

Una sola página (`docs/index.html`), sin dependencias ni frameworks, con logo médico en SVG en línea. Un formulario corto —**nombres, apellidos y DNI obligatorios**; teléfono, área y correo opcionales, plegados tras "Datos opcionales"— y un calendario que despliega la disponibilidad **por mes, por día y por hora**:

- Flechas ‹ › para moverse entre los meses que tienen cupo; se deshabilitan en los extremos.
- Rejilla mensual con la semana empezando en lunes. Solo los días con horarios libres quedan habilitados y llevan un punto.
- Al elegir un día aparecen las horas disponibles como botones.

### Por qué no hay conflictos de horario

GitHub Pages solo sirve archivos estáticos: **no puede impedir por sí mismo que dos personas tomen la misma hora**. El portal es únicamente la interfaz; la garantía sigue estando en Apps Script.

1. Al cargar, el portal pide la disponibilidad y muestra solo slots con cupo.
2. Al confirmar, envía la reserva a `createReservation()`, que decide **dentro de `LockService.getScriptLock()`**, releyendo el slot antes de escribir.
3. Si otra persona ganó ese horario en el intervalo, el servidor responde `HORARIO_OCUPADO`; el portal recarga la disponibilidad, deselecciona la hora y pide elegir otra.
4. Si el DNI ya tenía cita en la campaña, muestra la reserva existente con su fecha, hora y código.

El portal no puede crear una reserva que el servidor no haya aceptado: la hoja de cálculo es la única fuente de verdad.

### API JSON

`Api.gs` expone la API que consume el portal; el enrutamiento entra por `doGet`/`doPost` en `Main.gs`. La aplicación HTML alojada en Apps Script sigue funcionando igual: `doGet` solo entrega JSON cuando la petición trae `?action=`.

| Método | Acción | Devuelve |
|---|---|---|
| `GET ?action=bootstrap` | Carga inicial | Config de la app, campaña activa y días con horarios |
| `GET ?action=availability` | Refresco | Campaña y días con horarios |
| `POST {action:'reserve', ...}` | Crear reserva | Reserva confirmada con su código |
| `POST {action:'status', ...}` | Consultar | Reserva por código + DNI |
| `POST {action:'cancel', ...}` | Cancelar | Reserva cancelada y cupo liberado |

Las lecturas van por GET porque no llevan datos personales. Las escrituras van por **POST con cuerpo JSON enviado como texto plano**: es una petición simple (sin preflight CORS) y evita que el DNI y los nombres queden en la query string ni en los registros de URL.

### Puesta en marcha del portal

1. Despliega el proyecto de Apps Script como aplicación web (`Implementar > Nueva implementación > Aplicación web`), con acceso **"Cualquier usuario"** para que el portal pueda llamarlo sin sesión de Google. Copia la URL que termina en `/exec`.
2. Edita [`docs/config.js`](docs/config.js) y pega esa URL en `apiUrl`. Deja `campaignId` vacío para que use automáticamente la primera campaña activa.
3. Publica: `Settings > Pages > Source: Deploy from a branch`, rama `main`, carpeta `/docs`.
4. Comparte la URL de Pages. Mientras `apiUrl` esté vacío, el portal muestra un aviso de configuración pendiente en vez del formulario.

Cada cambio en el código de Apps Script exige **crear una nueva versión de la implementación** (o actualizar la existente); si no, la URL `/exec` seguirá sirviendo la versión anterior y el portal no verá la API.

### Consideraciones del portal público

- La URL `/exec` queda visible en `docs/config.js` y, por tanto, en el repositorio público y en el código fuente de la página. Es un endpoint anónimo de escritura: cualquiera que la encuentre puede intentar registrar reservas. Las defensas actuales son las validaciones del servidor (DNI de 8 dígitos, una reserva activa por DNI y campaña, capacidad por slot) y el hecho de que solo existan los horarios que tú generas. Para una campaña real y acotada en el tiempo suele bastar; si necesitas más, la V2 contempla una capa externa con límite de intentos.
- El Spreadsheet **sigue siendo privado**. El portal nunca lo toca directamente: solo llama a las funciones públicas de Apps Script.
- El portal no consulta DNI contra el padrón de `PERSONAS` para autocompletar nombres. Es deliberado: un endpoint público de búsqueda por DNI permitiría enumerar documentos y obtener nombres.
- La página lleva `<meta name="robots" content="noindex">` para que no aparezca en buscadores.

