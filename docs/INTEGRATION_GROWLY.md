# Integración con Growly

## Responsabilidades

Cashy es la fuente del presupuesto mensual de ahorro e inversión. Growly es la fuente de objetivos, cartera y movimientos. Vincular cuentas autoriza consultas y aportes, pero no fusiona usuarios ni transfiere dinero real.

Al desvincular:

- se bloquean nuevas consultas y nuevos aportes vinculados;
- los aportes confirmados se conservan y siguen descontados del mes correspondiente;
- el historial mantiene identificadores suficientes aunque el objetivo de Growly ya no exista;
- una vinculación posterior no duplica operaciones anteriores.

## Seguridad y configuración

La configuración se mantiene únicamente en `.env` tomando `.env.template` como referencia.

- `INTEGRATION_ENABLED` habilita el módulo.
- `INTEGRATION_PEER_API_URL` apunta a Growly Back e incluye `/api/v1`.
- `INTEGRATION_PEER_FRONTEND_URL` apunta a Growly Front.
- `INTEGRATION_CALLBACK_URL` es el retorno visible de Cashy.
- `INTEGRATION_INBOUND_SECRET` valida mensajes recibidos de Growly.
- `INTEGRATION_OUTBOUND_SECRET` firma mensajes enviados a Growly.
- Los secretos deben ser distintos y tener al menos 32 caracteres.
- En producción las URLs de integración deben usar HTTPS.

`CORS_ALLOWED_ORIGINS` controla únicamente los frontends autorizados a llamar Cashy Back desde un navegador. La integración backend a backend no depende de CORS.

## Presupuesto mensual

El asignado se calcula en centavos a partir del sueldo y la distribución vigente. El disponible descuenta aportes confirmados, reservas activas y ajustes aplicables. Las operaciones usan el período `YYYY-MM` de `America/Buenos_Aires`.

Una reserva no mueve dinero: evita confirmar simultáneamente más presupuesto del disponible. Confirmar vuelve definitivo el consumo; cancelar libera la reserva. Todas las mutaciones usan claves idempotentes y revisiones para evitar dobles efectos.

## Endpoints principales

Todos usan el prefijo `/integration` sobre la URL de la API.

- `GET /link`: estado de vinculación del usuario Cashy.
- `POST /link/start`: inicia autorización con PKCE, state y vencimiento.
- `POST /link/complete`: confirma la cuenta revisada.
- `POST /link/revoke`: inicia la desvinculación coordinada.
- `GET /allocation`: presupuesto mensual visible para el usuario.
- `POST /peer/allocation`: presupuesto autorizado para Growly.
- `POST /peer/contribution/reserve`: reserva un aporte.
- `POST /peer/contribution/confirm`: confirma su impacto.
- `POST /peer/contribution/cancel`: libera una reserva.
- `POST /peer/contribution/adjust`: corrige o anula con control de revisión.
- `GET /portfolio`: consulta la cartera contable autorizada de Growly.

Los endpoints `peer` requieren autenticación entre servicios. Los endpoints de usuario requieren el token Firebase de Cashy.

## Verificación

```bash
npm run lint
npm test -- --runInBand
npm run build
npm run integration:check
```

El check de integración requiere ambos backends iniciados y cuentas de prueba configuradas.
