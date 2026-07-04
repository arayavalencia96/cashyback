# cashyback

Backend NestJS para bloqueo y desbloqueo de usuarios con Firebase Authentication, Firestore y envío de correos por Brevo.

## Que hace

- Bloquea usuarios en Firebase Auth.
- Genera y valida codigos de desbloqueo.
- Guarda el estado del codigo en Firestore.
- Envia correo con template HTML.
- Genera link de reseteo de contraseña cuando el codigo se valida correctamente.
- Permite habilitar o deshabilitar cuentas manualmente.

## Endpoints

Base path: `/user`

- `POST /user/:uid/block-code`
- `POST /user/:uid/block-code/verify`
- `POST /user/block-code/check`
- `POST /user/login-attempts/failure`
- `POST /user/login-attempts/reset`
- `PATCH /user/:uid/status`

### Respuesta estandar

Todos los endpoints responden con este formato:

```json
{
  "result": {},
  "message": "string",
  "description": "string",
  "statuscode": 200,
  "ok": true
}
```

## Requisitos

- Node.js 20 o superior
- npm
- Una cuenta de Firebase con Authentication habilitado
- Un archivo de servicio de Firebase Admin
- Una cuenta en Brevo para enviar correos

## Configuracion local

1. Instala dependencias:

```bash
npm install
```

2. Crea un archivo `.env` en la raiz del proyecto.

3. Usa como base este contenido:

```env
PORT=3000

FIREBASE_CREDENTIALS_PATH=./configuration-firebase.json

BREVO_API_KEY=tu_api_key_de_brevo
BREVO_SENDER_EMAIL=tu_correo_verificado@tudominio.com
BREVO_SENDER_NAME=YourApp
MAIL_SUPPORT=example@tudominio.com
MAIL_FROM=App Name <example@gmail.com>
```

## Archivo de Firebase

`FIREBASE_CREDENTIALS_PATH` debe apuntar al archivo JSON del service account.

Ejemplo:

```env
FIREBASE_CREDENTIALS_PATH=./configuration-firebase.json
```

Ese archivo no debe subirse al repo.

## Levantar el proyecto

### Desarrollo

```bash
npm run start:dev
```

### Produccion

```bash
npm run build
npm run start:prod
```

## Probar el flujo

### 1. Solicitar codigo

```bash
POST /user/:uid/block-code
```

Bloquea al usuario y envia el codigo por correo.

### 1.1 Consultar bloqueo por correo

```bash
POST /user/block-code/check
```

Body:

```json
{
  "email": "user@example.com"
}
```

Si el usuario esta bloqueado:

- retorna `result.blocked = true`
- reenvia un nuevo codigo de desbloqueo
- mantiene la cuenta deshabilitada en Firebase Auth

Si no esta bloqueado:

- retorna `result.blocked = false`
- no envia correo

### 1.2 Registrar intento fallido

```bash
POST /user/login-attempts/failure
```

Body:

```json
{
  "email": "user@example.com"
}
```

Si llega al tercer intento:

- bloquea la cuenta en Firebase Auth
- envia un nuevo codigo de desbloqueo
- retorna `result.blocked = true`

### 1.3 Reiniciar intentos

```bash
POST /user/login-attempts/reset
```

Body:

```json
{
  "email": "user@example.com"
}
```

Se usa despues de un login exitoso para dejar el contador en cero.

### 2. Validar codigo

```bash
POST /user/:uid/block-code/verify
```

Body:

```json
{
  "code": "123456"
}
```

Si el codigo es correcto:

- desbloquea el usuario
- marca el codigo como verificado
- genera el link de reseteo de contraseña
- envia el correo de restablecimiento

### 3. Cambiar estado manualmente

```bash
PATCH /user/:uid/status
```

Body:

```json
{
  "disabled": true
}
```

Sirve para bloquear o habilitar una cuenta manualmente.

## Estructura relevante

- `src/main.ts` bootstrap de la app y carga de `.env`
- `src/app.module.ts` modulo raiz
- `src/common/` servicios compartidos, Brevo, Firebase y templates
- `src/common/templates/` templates HTML de correos
- `src/user/` flujo de bloqueo, verificacion y estado de usuario

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
