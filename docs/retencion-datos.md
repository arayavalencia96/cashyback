# Política operativa de retención de datos

Fecha de revisión: 4 de agosto de 2026.

Esta política traduce los plazos informados en la Política de Privacidad a controles técnicos concretos. Los plazos se revisan cuando cambia una finalidad, un proveedor o una obligación legal.

## Plazos definidos

| Categoría                                                                             | Retención                                                                      | Eliminación                                                                                      |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Cuenta, perfil, presupuestos, gastos, inversiones, historial, preferencias y archivos | Mientras la cuenta exista                                                      | Borrado individual cuando la función lo permita o eliminación integral desde Configuración       |
| Evidencia de aceptación legal                                                         | Mientras la cuenta exista                                                      | Se elimina con la cuenta, salvo obligación legal o reclamo que requiera conservación restringida |
| Código de bloqueo                                                                     | Validez de 5 minutos; registro técnico hasta 24 horas después del vencimiento  | Limpieza diaria del backend basada en `deleteAt`                                                 |
| Sesión de recuperación de contraseña                                                  | Validez de 10 minutos; registro técnico hasta 24 horas después del vencimiento | Limpieza diaria del backend basada en `deleteAt`                                                 |
| Intentos fallidos de acceso                                                           | 90 días desde el último evento                                                 | Limpieza diaria del backend basada en `deleteAt`                                                 |
| Registro de entrega de recordatorios                                                  | 30 días desde el envío                                                         | Limpieza diaria del backend basada en `deleteAt`                                                 |
| Contadores de rate limit                                                              | Duración de la ventana configurada para cada endpoint                          | Expiración nativa de Redis o limpieza del almacenamiento en memoria                              |
| Suscripciones push                                                                    | Hasta desuscripción, token inválido o eliminación de cuenta                    | Eliminación inmediata desde Cashy; el proveedor completa su ciclo de borrado                     |
| Google Analytics                                                                      | Máximo de 2 meses para datos a nivel de usuario y evento                       | Configuración administrativa de la propiedad GA4                                                 |
| Logs y backups de proveedores                                                         | El plazo mínimo disponible compatible con seguridad y diagnóstico              | Según la configuración, el DPA y el ciclo técnico del proveedor                                  |

Cashy no elimina automáticamente datos financieros por antigüedad. Hacerlo impediría consultar el historial que la persona decidió conservar.

## Implementación de la limpieza

Las colecciones temporales utilizan un campo `deleteAt` de tipo `Date and time`:

- `user_block_codes`
- `user_password_recovery_sessions`
- `user_login_attempts`
- `due_reminder_notification_log`

El plan gratuito de Firestore no permite activar eliminaciones TTL administradas. Por eso el procesador diario de recordatorios ejecuta primero una limpieza de estas cuatro colecciones y elimina en lotes únicamente los documentos cuyo `deleteAt` ya venció. La limpieza utiliza la cuota gratuita ordinaria de lecturas y eliminaciones.

Los documentos históricos creados antes de esta implementación no contienen `deleteAt`. El backfill incorporado permite revisarlos y completarlos una sola vez:

```powershell
# Solo informa cantidades; no escribe datos
npm run retention:backfill

# Agrega deleteAt a los documentos históricos compatibles
npm run retention:backfill:apply
```

## Configuraciones externas pendientes

- [ ] Google Analytics: establecer la retención de datos de usuario y eventos en **2 meses**.
- [ ] Render: registrar la retención efectiva de logs del plan productivo y seleccionar el mínimo operativo disponible.
- [ ] Brevo: registrar la retención de logs y contenido de correos transaccionales aplicable a la cuenta.
- [ ] Firebase: conservar evidencia de los plazos de eliminación y backups aplicables a Authentication, Hosting, FCM, Firestore y Storage.
- [ ] Redis: registrar proveedor, región, persistencia y política de backups; evitar persistencia cuando no sea necesaria para rate limiting.
- [ ] Ejecutar `npm run retention:backfill` y luego `npm run retention:backfill:apply` sobre producción.
- [ ] Confirmar en los logs del cron diario la ejecución de la limpieza de retención.
- [ ] Revisar esta matriz al menos una vez al año o ante cambios de proveedores.

## Eliminación de cuenta

El endpoint de eliminación borra los movimientos financieros, presupuestos, suscripciones push, registros de recordatorios, sesiones de recuperación, intentos de acceso, códigos de bloqueo, aceptaciones legales, perfil, archivos y usuario de Firebase Authentication asociados al UID.

La eliminación en Cashy comienza inmediatamente. Algunos proveedores pueden mantener copias limitadas durante sus ciclos de respaldo o seguridad. Esas copias no deben utilizarse para finalidades ordinarias y deben desaparecer conforme a los plazos contractuales del proveedor.

## Referencias

- Ley 25.326, artículo 4: https://www.argentina.gob.ar/normativa/nacional/64790/texto
- Derechos de acceso, rectificación y supresión: https://www.argentina.gob.ar/aaip/datospersonales/derechos
- Firestore TTL: https://firebase.google.com/docs/firestore/ttl
- Retención de Firebase: https://firebase.google.com/support/privacy/
- Retención de Google Analytics: https://support.google.com/analytics/answer/7667196?hl=es-419
