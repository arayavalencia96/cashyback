# cashyback

Backend NestJS de Cashy para bloqueo de usuarios, verificacion de codigo, recuperacion de password, rate limiting y envio de correos.

## Stack

- NestJS `11.1.27`
- Firebase Admin `14.1.0`
- Brevo `6.0.2`
- Redis con `ioredis` `5.11.1`
- TypeScript `5.9.3`

## Versiones fijadas

- Node.js `24.11.1`
- npm `11.6.2`

Este repo incluye:

- `package-lock.json` para fijar dependencias exactas
- `.nvmrc` para usar la misma version de Node
- `packageManager` y `volta` en `package.json` para fijar Node y npm
- `.npmrc` con `engine-strict=true`
- dependencias sin rangos `^`, `~` ni `*` en `package.json`

## Instalacion reproducible

```bash
nvm use
npm ci
```

Si usas Volta:

```bash
volta install node@24.11.1 npm@11.6.2
npm ci
```

Usa `npm ci` para reinstalar exactamente lo definido en `package-lock.json`.
Usa `npm install` solo cuando quieras cambiar dependencias de forma intencional.

## Que hace

- Bloquea usuarios en Firebase Auth cuando superan el limite de intentos
- Genera y valida codigos de verificacion
- Reenvia codigos cuando detecta cuenta bloqueada
- Inicia y controla sesiones de recuperacion de password
- Envia correos por Brevo
- Expone rate limiting por usuario e IP
- Usa Redis para compartir limites entre instancias cuando `REDIS_URL` esta definido

## Requisitos

- Node.js `24.11.1`
- npm `11.6.2`
- Firebase Authentication habilitado
- service account de Firebase Admin
- cuenta de Brevo
- Redis recomendado en cualquier entorno con mas de una instancia

## Configuracion local

1. Instala dependencias:

```bash
nvm use
npm ci
```

2. Crea un archivo `.env` en la raiz del proyecto.

3. Usa como base este contenido:

```env
PORT=3000
FIREBASE_CREDENTIALS_PATH=./configuration-firebase.json
BREVO_API_KEY=tu_api_key_de_brevo
BREVO_SENDER_EMAIL=tu_correo_verificado@tudominio.com
BREVO_SENDER_NAME=Cashy
MAIL_SUPPORT=soporte@tudominio.com
MAIL_FROM=Cashy <no-reply@tudominio.com>
FRONTEND_URL=http://localhost:4200
REDIS_URL=redis://default:<tu_password>@<tu-host-interno>:6379
```

## Variables importantes

- `FIREBASE_CREDENTIALS_PATH`: path al JSON del service account
- `FRONTEND_URL`: URL del frontend que recibe el flujo de recuperacion
- `REDIS_URL`: backend de rate limiting y sesiones compartidas; si no se define, cae a memoria local

En Render, `REDIS_URL` debe ser la `Internal Key Value URL` de tu instancia Redis.
No hace falta cambiar codigo para usarla: el backend la detecta automaticamente al iniciar.

El archivo del service account no debe subirse al repo.

## Scripts

```bash
npm run start
npm run start:dev
npm run start:prod
npm run build
npm run lint
npm run test
npm run test:e2e
npm run test:cov
```

## Ejecucion

Desarrollo:

```bash
npm run start:dev
```

Produccion:

```bash
npm run build
npm run start:prod
```

## Verificacion

Chequeo de tipos:

```bash
npx tsc --noEmit
```

Health check:

```bash
GET /health
```

## Endpoints

Base path: `/user`

- `POST /user/:uid/block-code`
- `POST /user/:uid/block-code/verify`
- `POST /user/block-code/check`
- `POST /user/login-attempts/failure`
- `POST /user/login-attempts/reset`
- `POST /user/:uid/password-reset/resend`
- `POST /user/password/manual`
- `PATCH /user/:uid/status`

## Respuesta estandar

```json
{
  "result": {},
  "message": "string",
  "description": "string",
  "statuscode": 200,
  "ok": true
}
```

## Flujo de recuperacion actual

1. `POST /user/block-code/check`
   - si la cuenta sigue bloqueada, reenvia codigo y responde `blocked = true`
   - si la cuenta tiene recuperacion pendiente y la sesion sigue vigente, responde `passwordResetPending = true`
   - si la recuperacion pendiente vencio, vuelve a exigir codigo y reenvia uno nuevo

2. `POST /user/:uid/block-code/verify`
   - valida el codigo
   - desbloquea la cuenta
   - crea o renueva la sesion de recuperacion
   - envia el correo para cambiar password

3. `POST /user/:uid/password-reset/resend`
   - reenvia el correo de recuperacion para una sesion activa

4. `POST /user/password/manual`
   - permite actualizar la password con `sessionId` o `token`
   - invalida la sesion al completar el cambio

## Rate limiting

Hay limites por usuario y por IP en los endpoints sensibles:

- solicitud de codigo
- verificacion de codigo
- consulta de bloqueo
- intentos fallidos de login
- reset de intentos
- reenvio de recuperacion
- cambio manual de password

Si vas a correr multiples instancias, usa Redis para que esos limites no queden aislados por proceso.

## Estructura relevante

- `src/main.ts` bootstrap y carga de `.env`
- `src/app.module.ts` modulo raiz
- `src/common/` Firebase, Brevo, Redis, rate limiting y helpers
- `src/common/templates/` templates HTML de correo
- `src/user/` controladores, DTOs y servicio de bloqueo/recuperacion
