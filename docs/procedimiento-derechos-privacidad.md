# Procedimiento para derechos de privacidad

## Alcance

Este procedimiento se aplica a solicitudes de acceso, rectificación, actualización, supresión,
portabilidad u oposición recibidas desde Cashy. El trámite autenticado genera un identificador,
fecha de recepción, plazo previsto y estado consultable por la persona.

## Plazos operativos

| Solicitud | Plazo máximo adoptado |
| --- | --- |
| Acceso | 10 días corridos desde la recepción |
| Rectificación, actualización o supresión | 5 días hábiles desde la recepción |
| Portabilidad u oposición | 10 días corridos como plazo interno, salvo que una norma aplicable exija otro menor |
| Solicitudes sujetas a CCPA, si Cashy alcanzara su ámbito de aplicación | 45 días corridos, con la extensión y aviso permitidos por esa norma |

## Flujo interno

1. Revisar diariamente la colección backend-only `privacy_requests` y priorizar por
   `responseDueAt`.
2. Confirmar que la solicitud provino de una sesión Firebase válida. No pedir DNI ni documentación
   adicional por defecto. Si existe una duda razonable, solicitar solo la verificación mínima y no
   enviar datos hasta resolverla.
3. Cambiar el estado a `in_review` y delimitar los datos, proveedores y operaciones comprendidos.
4. Buscar información únicamente por el `uid` verificado en Authentication, Firestore, Storage,
   registros controlados por Cashy y proveedores aplicables.
5. Para rectificación o supresión, bloquear o marcar los datos cuestionados mientras se verifica la
   solicitud cuando ello sea necesario para evitar un uso incorrecto.
6. Ejecutar la acción. Si esos datos se comunicaron a un tercero, notificar la corrección o supresión
   dentro del plazo legal aplicable.
7. Responder al correo verificado con un lenguaje claro. No incluir contraseñas, tokens, secretos,
   datos de otras personas ni información que comprometa la seguridad.
8. Cambiar el estado a `completed` o `rejected`. Una negativa debe indicar su fundamento y el canal
   para reclamar. Conservar solo el comprobante necesario mientras exista la cuenta, salvo una
   obligación legal o reclamo que justifique otra conservación.

## Reglas de decisión

- La supresión puede limitarse por una obligación legal, derechos de terceros, prevención de fraude
  o un reclamo pendiente. Los datos retenidos deben quedar bloqueados y usarse solo para ese fin.
- La baja total de cuenta se realiza mediante el flujo específico de Configuración, no mediante una
  supresión selectiva.
- No se cobra por el trámite ni se perjudica al usuario por ejercer un derecho.
- No afirmar que CCPA aplica a Cashy sin revisar sus umbrales y alcance con asesoría legal.
- Ante una duda, un pedido de autoridad o un conflicto entre jurisdicciones, detener el trámite y
  escalar a asesoría legal antes de entregar o eliminar datos.

## Control previo a producción

- Definir la persona responsable de revisar solicitudes y su reemplazo.
- Configurar un canal de soporte monitoreado y probar la respuesta de punta a punta.
- Crear una vista o proceso administrativo autenticado para cambiar estados; hasta entonces, los
  cambios se realizan exclusivamente mediante Firebase Admin por personal autorizado.
- Registrar fecha, operador, fuentes revisadas, acción tomada y fundamento de cualquier limitación.

## Fuentes oficiales

- AAIP, derechos sobre datos personales: https://www.argentina.gob.ar/aaip/datospersonales/derechos
- Ley 25.326 actualizada: https://www.argentina.gob.ar/normativa/nacional/64790/actualizacion
- California Attorney General, CCPA: https://oag.ca.gov/privacy/ccpa
