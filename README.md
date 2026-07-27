# Cashy Backend

API de Cashy construida con NestJS. Centraliza los flujos de seguridad de usuarios, recuperación de contraseñas, notificaciones push, recordatorios de vencimientos y exportación del historial financiero.

## Funcionalidades

- Control de intentos fallidos de inicio de sesión.
- Bloqueo y desbloqueo de cuentas en Firebase Authentication.
- Generación y verificación de códigos temporales enviados por correo.
- Sesiones opacas y de un solo uso para recuperación de contraseñas.
- Envío de correos transaccionales mediante Brevo y plantillas Handlebars.
- Suscripción y desuscripción de dispositivos para Firebase Cloud Messaging.
- Recordatorios de gastos vencidos y próximos a vencer.
- Eliminación automática de tokens push inválidos.
- Exportación CSV del historial mensual de gastos e inversiones.
- Rate limiting con Redis y fallback local en memoria.
- Respuestas REST con una estructura uniforme.

## Stack

- NestJS `11.1.27`
- TypeScript `5.9.3`
- Firebase Admin `14.1.0`
- Firestore
- Firebase Authentication
- Firebase Cloud Messaging
- Brevo `6.0.2`
- Handlebars `4.7.9`
- Redis mediante `ioredis` `5.11.1`
- Jest `30.4.2`

## Versiones del entorno

- Node.js `24.11.1`
- npm `11.6.2`

El proyecto fija sus versiones mediante `engines`, Volta, `.nvmrc`, `.npmrc` y `package-lock.json`.

## Instalación

```bash
nvm use
npm ci
```

Con Volta:

```bash
volta install node@24.11.1 npm@11.6.2
npm ci
```

Usá `npm ci` para instalar exactamente las versiones registradas. Reservá `npm install` para cambios intencionales de dependencias.

## Configuración

Creá un archivo `.env` en la raíz de `cashyback`:

```env
PORT=3000

FIREBASE_CREDENTIALS_PATH=./configuration-firebase.json
FIREBASE_WEB_PUSH_PUBLIC_KEY=tu_clave_vapid_publica

BREVO_API_KEY=tu_api_key_de_brevo
BREVO_SENDER_EMAIL=no-reply@tudominio.com
BREVO_SENDER_NAME=Cashy
MAIL_SUPPORT=soporte@tudominio.com
MAIL_FROM=Cashy <no-reply@tudominio.com>

FRONTEND_URL=http://localhost:4200
APP_BASE_URL=http://localhost:4200

REDIS_URL=redis://default:<password>@<host>:6379

CRON_SECRET=un_secreto_largo_y_aleatorio
DUE_SOON_REMINDER_DAYS=3
```

### Variables obligatorias

| Variable                           | Uso                                                      |
| ---------------------------------- | -------------------------------------------------------- |
| `FIREBASE_CREDENTIALS_PATH`        | Ruta al JSON de la cuenta de servicio de Firebase Admin. |
| `BREVO_API_KEY`                    | Credencial para enviar correos transaccionales.          |
| `BREVO_SENDER_EMAIL` o `MAIL_FROM` | Remitente verificado en Brevo.                           |

### Variables opcionales

| Variable                       | Valor predeterminado          | Uso                                                               |
| ------------------------------ | ----------------------------- | ----------------------------------------------------------------- |
| `PORT`                         | `3000`                        | Puerto HTTP.                                                      |
| `FIREBASE_WEB_PUSH_PUBLIC_KEY` | Sin valor                     | Clave VAPID pública. Sin ella, el envío push queda deshabilitado. |
| `BREVO_SENDER_NAME`            | Nombre de `MAIL_FROM`         | Nombre visible del remitente.                                     |
| `MAIL_SUPPORT`                 | `MAIL_FROM`                   | Dirección de soporte y `reply-to`.                                |
| `FRONTEND_URL`                 | `http://localhost:4200`       | Base del enlace de recuperación de contraseña.                    |
| `APP_BASE_URL`                 | `https://cashy-cd3e6.web.app` | Base de la URL abierta desde una notificación push.               |
| `REDIS_URL`                    | Memoria local                 | Almacenamiento compartido del rate limit.                         |
| `CRON_SECRET`                  | Sin valor                     | Bearer token requerido por el procesador de recordatorios.        |
| `DUE_SOON_REMINDER_DAYS`       | `3`                           | Anticipación de recordatorios de vencimiento.                     |
| `FIREBASE_DATABASE_ID`         | `(default)`                   | Identificador informativo de la base configurada.                 |

El archivo de credenciales de Firebase no debe subirse al repositorio. `FIREBASE_CREDENTIALS_PATH` se resuelve desde el directorio de ejecución del backend.

## Ejecución

Desarrollo:

```bash
npm run start:dev
```

Producción:

```bash
npm run build
npm run start:prod
```

La aplicación escucha en `0.0.0.0`, confía en un proxy y admite CORS desde:

- `http://localhost:4200`
- `https://cashy-cd3e6.web.app`

## Scripts

```bash
npm run start
npm run start:dev
npm run start:debug
npm run build
npm run lint
npm run format
npm run test
npm run test:watch
npm run test:e2e
npm run test:cov
```

## Respuesta estándar

Las respuestas de negocio utilizan esta forma:

```json
{
  "result": {},
  "message": "Operación completada",
  "description": "Descripción del resultado.",
  "statuscode": 200,
  "ok": true
}
```

Los errores normalizados usan:

```json
{
  "result": null,
  "message": "Operación rechazada",
  "description": "Descripción del error.",
  "statuscode": 400,
  "ok": false
}
```

## Autorización

El backend utiliza tres mecanismos:

- `FirebaseAuthGuard`: valida `Authorization: Bearer <Firebase ID token>`.
- `CronAuthGuard`: compara el bearer token con `CRON_SECRET`.
- `RateLimitGuard`: limita endpoints sensibles por correo, sesión, usuario o IP.

Los endpoints de `user` están protegidos actualmente por rate limiting. Los endpoints privados de `notifications` e `history` requieren Firebase Authentication.

## Endpoints

### Salud

| Método | Ruta      | Protección | Descripción                                  |
| ------ | --------- | ---------- | -------------------------------------------- |
| `GET`  | `/health` | Pública    | Comprueba que la aplicación está disponible. |

Ejemplo de respuesta:

```json
{
  "result": {
    "status": "ok",
    "timestamp": "2026-07-26T00:00:00.000Z"
  },
  "message": "Service is healthy",
  "description": "The application is running and ready to receive requests.",
  "statuscode": 200,
  "ok": true
}
```

### Usuarios y recuperación

Base: `/user`

| Método  | Ruta                          | Body                                           | Descripción                                             |
| ------- | ----------------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| `POST`  | `/:uid/block-code`            | Sin body                                       | Genera y envía un código para una cuenta bloqueada.     |
| `POST`  | `/:uid/block-code/verify`     | `{ "code": "123456" }`                         | Verifica el código y habilita la recuperación.          |
| `POST`  | `/block-code/check`           | `{ "email": "usuario@correo.com" }`            | Consulta bloqueo, recuperación pendiente e intentos.    |
| `POST`  | `/login-attempts/failure`     | `{ "email": "usuario@correo.com" }`            | Registra un intento fallido y bloquea al llegar a tres. |
| `POST`  | `/login-attempts/reset`       | `{ "email": "usuario@correo.com" }`            | Reinicia los intentos después de un acceso válido.      |
| `POST`  | `/:uid/password-reset/resend` | Sin body                                       | Renueva y reenvía una sesión de recuperación.           |
| `POST`  | `/password/manual`            | `{ "sessionId": "...", "newPassword": "..." }` | Cambia la contraseña y consume la sesión.               |
| `PATCH` | `/:uid/status`                | `{ "disabled": true }`                         | Activa o desactiva la cuenta en Firebase.               |

`POST /user/password/manual` mantiene compatibilidad con el campo heredado `token`, aunque el contrato actual utiliza `sessionId`.

### Notificaciones

Base: `/notifications`

| Método   | Ruta                     | Protección    | Descripción                                            |
| -------- | ------------------------ | ------------- | ------------------------------------------------------ |
| `GET`    | `/web/config`            | Pública       | Devuelve disponibilidad y clave VAPID pública.         |
| `GET`    | `/status`                | Firebase      | Informa cuántos dispositivos activos tiene el usuario. |
| `POST`   | `/subscribe`             | Firebase      | Registra o actualiza una suscripción web push.         |
| `DELETE` | `/subscribe`             | Firebase      | Elimina la suscripción correspondiente al token.       |
| `POST`   | `/process-due-reminders` | `CRON_SECRET` | Procesa los recordatorios diarios.                     |

Body de suscripción:

```json
{
  "token": "fcm-registration-token",
  "platform": "web",
  "deviceId": "identificador-estable",
  "userAgent": "Mozilla/5.0 ..."
}
```

Body de desuscripción:

```json
{
  "token": "fcm-registration-token"
}
```

### Historial

Base: `/history`

| Método | Ruta                       | Protección | Descripción                                     |
| ------ | -------------------------- | ---------- | ----------------------------------------------- |
| `GET`  | `/export/csv/:year/:month` | Firebase   | Descarga el historial cerrado de un mes en CSV. |

El CSV:

- Incluye resumen mensual, gastos fijos, gastos variables e inversiones.
- Usa `;` como separador y BOM UTF-8.
- Ordena los movimientos por fecha descendente.
- Utiliza el sueldo de `monthlyBudgets` para calcular ocupado y restante.
- Solo considera movimientos anteriores al mes actual.
- Devuelve `404` cuando el período solicitado no tiene historial exportable.

## Flujo de bloqueo y recuperación

1. El frontend consulta `POST /user/block-code/check`.
2. Cada fallo se registra mediante `POST /user/login-attempts/failure`.
3. Al tercer intento, Firebase Authentication se desactiva y se envía un código de seis dígitos.
4. El código dura 5 minutos y se almacena únicamente como hash.
5. `POST /user/:uid/block-code/verify` valida el código, habilita la cuenta y crea una sesión de recuperación.
6. La sesión dura 10 minutos; Firestore guarda solamente el hash de su identificador.
7. El correo dirige al frontend mediante `FRONTEND_URL`.
8. `POST /user/password/manual` valida la sesión, actualiza la contraseña, revoca refresh tokens y consume la sesión.
9. Las sesiones anteriores quedan expiradas y no pueden reutilizarse.

`tokensValidAfterTime` de Firebase se usa como señal secundaria para detectar que la contraseña ya fue modificada y cerrar una recuperación pendiente.

## Recordatorios de vencimiento

El procesamiento diario:

1. Consulta gastos fijos pendientes vencidos y por vencer.
2. Agrupa los gastos por usuario.
3. Omite usuarios ya notificados en esa fecha.
4. Omite usuarios sin suscripciones activas.
5. Prioriza vencidos sobre próximos vencimientos.
6. Envía el mensaje a todos los dispositivos activos.
7. Actualiza metadatos de éxito o error de cada suscripción.
8. Elimina tokens inválidos informados por Firebase.
9. Registra los envíos en `due_reminder_notification_log`.

Un usuario recibe como máximo un recordatorio diario. El enlace abre `${APP_BASE_URL}/fijos`.

### GitHub Actions

`.github/workflows/due-reminders.yml` ejecuta diariamente:

1. `GET /health` para despertar el backend.
2. Una espera de 20 segundos por el cold start.
3. `POST /notifications/process-due-reminders`.

El workflow programado usa `30 13 * * *`, es decir, `13:30 UTC`.

Secrets requeridos en el environment `cashy`:

- `BACKEND_BASE_URL`
- `CRON_SECRET`

También puede ejecutarse manualmente mediante `workflow_dispatch`.

## Rate limiting

Los endpoints sensibles combinan límites por identidad e IP:

- Solicitud y verificación de códigos.
- Consulta del estado de bloqueo.
- Registro y reinicio de intentos.
- Reenvío de recuperación.
- Cambio manual de contraseña.
- Activación y desactivación de cuentas.

Si `REDIS_URL` está configurado, los contadores se comparten entre instancias mediante operaciones atómicas. Si Redis no está disponible, el backend utiliza buckets en memoria y limpia periódicamente los vencidos.

Para múltiples instancias en producción, Redis es necesario para que los límites sean consistentes.

## Correos

Brevo envía dos plantillas:

- `src/common/templates/user-blocked.hbs`
- `src/common/templates/password-reset.hbs`

El cliente utiliza:

- Timeout de 30 segundos.
- Hasta 2 reintentos.
- Manejo específico de credenciales inválidas, rate limit y timeout.

Las fechas se presentan en `America/Argentina/Buenos_Aires`.

## Colecciones de Firestore

| Colección                         | Propósito                                                            |
| --------------------------------- | -------------------------------------------------------------------- |
| `user_block_codes`                | Código hasheado, vencimiento, verificación y recuperación pendiente. |
| `user_login_attempts`             | Intentos fallidos y estado de bloqueo por correo.                    |
| `user_password_recovery_sessions` | Sesiones hasheadas, activas, consumidas o expiradas.                 |
| `user_push_subscriptions`         | Tokens y metadatos de dispositivos push.                             |
| `due_reminder_notification_log`   | Control de idempotencia y métricas de recordatorios diarios.         |
| `fixedExpenses`                   | Gastos fijos consultados por historial y recordatorios.              |
| `variableExpenses`                | Gastos variables utilizados por el historial.                        |
| `investments`                     | Movimientos de inversión utilizados por el historial.                |
| `monthlyBudgets`                  | Sueldo mensual utilizado por el historial.                           |

## Estructura

```text
src/
├── common/
│   ├── auth/          # Guards de Firebase y cron
│   ├── rate-limit/    # Reglas, guard y almacenamiento Redis/memoria
│   ├── services/      # Firebase Admin, Brevo y correo
│   └── templates/     # Plantillas Handlebars
├── history/           # Exportación CSV del historial
├── notifications/     # Suscripciones push y recordatorios
├── user/              # Bloqueo, intentos y recuperación
├── health.controller.ts
├── app.module.ts
└── main.ts
```

## Verificación

```bash
npm run lint
npm run test
npm run test:e2e
npm run build
```

Para probar el health check local:

```bash
curl http://localhost:3000/health
```

Para endpoints protegidos por Firebase:

```bash
curl \
  -H "Authorization: Bearer <FIREBASE_ID_TOKEN>" \
  http://localhost:3000/notifications/status
```

Para ejecutar recordatorios manualmente:

```bash
curl \
  -X POST \
  -H "Authorization: Bearer <CRON_SECRET>" \
  http://localhost:3000/notifications/process-due-reminders
```

## Consideraciones de producción

- No subir `.env` ni el JSON de Firebase al repositorio.
- Configurar `REDIS_URL` cuando exista más de una instancia.
- Usar un `CRON_SECRET` largo, aleatorio y diferente de otras credenciales.
- Verificar el remitente de Brevo antes del despliegue.
- Configurar `APP_BASE_URL` y `FRONTEND_URL` con URLs HTTPS.
- Mantener sincronizado `CRON_SECRET` entre el backend y GitHub Actions.
- Revisar los logs de `processedUsers`, `deliveredCount` y `failedCount` después de cada ejecución programada.
