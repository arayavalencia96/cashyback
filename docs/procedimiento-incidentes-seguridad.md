# Procedimiento interno ante incidentes de seguridad

Fecha de revisión: 5 de agosto de 2026.

## Objetivo y alcance

Este procedimiento se aplica ante accesos no autorizados, pérdida, alteración, divulgación, indisponibilidad o eliminación accidental de datos personales tratados por Cashy o por sus proveedores.

## Responsabilidades

- Responsable legal y operativo de Cashy: **Axel Araya**.
- Canal legal y de privacidad: **supportechnicalcashy@gmail.com**.
- La persona que detecte un evento debe comunicarlo inmediatamente al responsable operativo de Cashy.
- El responsable operativo coordina la investigación, preserva la evidencia y mantiene el registro del incidente.
- La persona designada como responsable legal evalúa, con asesoría especializada cuando corresponda, las notificaciones a la AAIP, a las personas afectadas, a proveedores y a otras autoridades.
- Ninguna comunicación pública debe incluir datos personales, credenciales, tokens ni detalles que aumenten el riesgo.

## Procedimiento

1. **Registrar:** asignar un identificador, fecha, fuente del aviso, sistemas involucrados y persona responsable del seguimiento.
2. **Contener:** revocar sesiones y credenciales comprometidas, aislar componentes, limitar accesos y preservar logs y evidencia sin alterar los originales.
3. **Evaluar:** identificar causa, período, categorías de datos, cantidad aproximada de personas, países involucrados, posibilidad de recuperar o descifrar la información y riesgos previsibles.
4. **Erradicar y recuperar:** corregir la causa, rotar secretos, restaurar el servicio desde fuentes verificadas y aumentar temporalmente el monitoreo.
5. **Decidir notificaciones:** documentar la evaluación jurídica y de riesgo. Como objetivo interno, iniciar la evaluación durante las primeras 24 horas y resolver dentro de las 72 horas desde que Cashy tomó conocimiento. Si todavía faltan datos, registrar el motivo y ampliar la información posteriormente.
6. **Comunicar:** cuando corresponda, explicar en lenguaje claro qué ocurrió, qué datos y personas podrían estar afectados, las consecuencias posibles, las medidas adoptadas, las acciones recomendadas y un canal de contacto.
7. **Cerrar:** elaborar un informe final, incorporar acciones correctivas con responsable y fecha, y revisar controles, proveedores y este procedimiento.

## Registro mínimo del incidente

- Identificador, fechas de detección, conocimiento, contención y cierre.
- Descripción, causa conocida o probable y sistemas o proveedores afectados.
- Categorías de datos y cantidad aproximada de registros y personas afectadas.
- Alcance geográfico y consecuencias posibles.
- Evidencia preservada, acciones realizadas y decisiones de notificación con su fundamento.
- Comunicaciones emitidas y acciones preventivas pendientes.

## Preparación y revisión

- Mantener actualizado el inventario de proveedores y canales de soporte de emergencia.
- Probar al menos una vez al año la restauración y el flujo de respuesta.
- Revisar este documento después de cada incidente material o cambio relevante de arquitectura.
- Definir y mantener fuera del repositorio los teléfonos, correos y suplencias del equipo de respuesta.

## Referencias

- Ley 25.326, artículo 9: https://www.argentina.gob.ar/normativa/nacional/64790/texto
- Resolución AAIP 47/2018: https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-47-2018-312662/texto
- Plan de Protección de Datos Personales de la AAIP: https://www.argentina.gob.ar/sites/default/files/aaip_rite_modulo_proteccion_de_datos_plan.pdf
