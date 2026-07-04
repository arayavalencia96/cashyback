# cashyback

Backend NestJS para bloqueo y desbloqueo de usuarios con Firebase Authentication, Firestore y envío de correos por SMTP.

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
- Una cuenta SMTP para enviar correos

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
FIREBASE_DATABASE_ID=

MAIL_HOST=smtp.gmail.com
MAIL_USER=tu_correo@gmail.com
MAIL_PASS=xxxx xxxx xxxx xxxx
MAIL_FROM="YourApp <tu_correo@gmail.com>"
MAIL_PORT=587
MAIL_SECURE=false
MAIL_SUPPORT=example@tudominio.com
```

## Variables de entorno

### Firebase

- `FIREBASE_CREDENTIALS_PATH`
- `FIREBASE_DATABASE_ID`

### Mail

- `MAIL_HOST`
- `MAIL_USER`
- `MAIL_PASS`
- `MAIL_FROM`

Opcionales:

- `MAIL_PORT`
- `MAIL_SECURE`
- `MAIL_SUPPORT`

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

## Formato de fechas

- Las fechas de expiracion se devuelven en formato `DD/MM/YYYY HH:MM:SS`.
- La zona horaria usada es `America/Argentina/Buenos_Aires`.

## Estructura relevante

- `src/main.ts` bootstrap de la app y carga de `.env`
- `src/app.module.ts` modulo raiz
- `src/common/` servicios compartidos, SMTP, Firebase y templates
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

## Validaciones recomendadas antes de desplegar

- Verificar que `MAIL_FROM` exista y sea valido.
- Verificar que `FIREBASE_CREDENTIALS_PATH` apunte al JSON correcto.
- Verificar que el usuario de Firebase tenga email.
- Probar el flujo completo:
  - solicitar codigo
  - validar codigo incorrecto
  - validar codigo correcto
  - reenviar codigo

## Deploy

El proyecto esta listo para un host Node.js.

Puntos importantes para produccion:

- configurar todas las variables de entorno
- subir el archivo de Firebase por un mecanismo seguro fuera del repo
- confirmar que el SMTP permita envio desde el `MAIL_FROM`

## Notas de seguridad

- No subas `.env`.
- No subas `configuration-firebase.json`.
- No subas archivos de llaves privadas o certificados.
- Si agregas nuevos secretos, agregalos al `.gitignore`.
