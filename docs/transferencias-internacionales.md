# Transferencias internacionales de datos

Fecha de revisión técnica: 4 de agosto de 2026.

Este inventario documenta los flujos detectados en el código de Cashy. No reemplaza la revisión legal ni confirma por sí solo que los contratos de cada proveedor estén vigentes.

## Criterio aplicable

La transferencia de datos personales desde Argentina se rige por el artículo 12 de la Ley 25.326 y sus normas complementarias. Antes de enviar datos a otro país se debe verificar si el destino posee un nivel adecuado. Para destinos no adecuados se necesita una excepción legal o una garantía válida, como las Cláusulas Contractuales Modelo aprobadas por la AAIP.

Estados Unidos no integra actualmente la lista argentina de países adecuados. La Unión Europea sí la integra.

## Inventario actual

| Proveedor o servicio | Flujo detectado | Datos involucrados | Destino conocido | Situación a verificar |
| --- | --- | --- | --- | --- |
| Google Firebase | Authentication, Firestore, Storage, Cloud Messaging, Hosting y Analytics opcional | Identidad, correo, datos financieros cargados, preferencias, archivos, tokens push, eventos de uso y datos técnicos | Authentication: Estados Unidos. Otros productos: infraestructura global o región del recurso | Conservar los términos de tratamiento de Firebase; identificar la región efectiva de Firestore y Storage; validar con asesoría el mecanismo argentino para los flujos a Estados Unidos y otros destinos no adecuados |
| Render | Alojamiento de la API | IP, token Firebase en tránsito, metadatos de solicitudes y logs técnicos; la API procesa los datos enviados a sus endpoints | Estados Unidos según la configuración declarada del servicio | Descargar y conservar el DPA; verificar región y subencargados; complementar con cláusulas AAIP o el mecanismo aprobado que corresponda |
| Brevo | Correos transaccionales | Correo, nombre opcional, asunto y contenido de verificación, recuperación o seguridad | Unión Europea: Francia, Alemania y Bélgica según Brevo | Conservar el DPA y revisar periódicamente subencargados; la UE es destino adecuado para Argentina |
| Redis configurado por `REDIS_URL` | Rate limiting distribuido | Claves y contadores temporales derivados de IP, correo, sesión, token o UID | Pendiente: depende del proveedor y la región contratados | Registrar proveedor, región, retención, DPA y subencargados antes de usarlo en producción |
| DolarAPI | Consulta de cotización del dólar MEP desde el navegador | IP y metadatos técnicos que recibe normalmente el servidor externo; Cashy no envía identidad ni datos financieros del usuario en la consulta | Pendiente de confirmación por el proveedor | Verificar política, infraestructura y retención. Evaluar trasladar la consulta al backend para no exponer la IP del usuario directamente |

## Acciones obligatorias antes de considerar cerrado el ticket legal

- [ ] Confirmar y registrar las regiones productivas de Firestore, Storage y Render.
- [ ] Identificar el proveedor Redis real o confirmar que producción utiliza únicamente memoria local.
- [ ] Descargar y archivar las versiones vigentes de los DPA de Firebase, Render y Brevo.
- [ ] Obtener la lista de subencargados de cada proveedor y definir una revisión periódica.
- [ ] Determinar con asesoría legal el instrumento aplicable a Firebase y Render para transferencias a Estados Unidos. Un DPA comercial no debe asumirse automáticamente equivalente a las Cláusulas Contractuales Modelo de la AAIP.
- [ ] Completar la identidad y el canal de contacto del responsable de Cashy en la Política de Privacidad.
- [ ] Revisar DolarAPI y decidir si la cotización debe consultarse desde el backend.
- [ ] Guardar evidencia de cada verificación con fecha, versión contractual y responsable interno.

## Fuentes oficiales de referencia

- AAIP: https://www.argentina.gob.ar/transferencias-internacionales
- Firebase Privacy and Security: https://firebase.google.com/support/privacy/
- Firebase Data Processing and Security Terms: https://firebase.google.com/terms/data-processing-terms/
- Render Data Processing Addendum: https://render.com/dpa
- Brevo, ubicación de datos: https://help.brevo.com/hc/es/articles/360001005510-D%C3%B3nde-se-almacenan-los-datos
