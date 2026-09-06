# PHASA Orders

Aplicación de operaciones de importación. Primera etapa publicada: https://phasa-orders.vercel.app

## Incluido

- Inicio de sesión por enlace al correo. Acceso mediante correo verificado configurado administrativamente en Supabase.
- Catálogos de empresas, funciones, domicilios, unidades, productos y precios por empresa/producto.
- Captura de Purchase Order con búsqueda por código o descripción, precios disponibles y peso.
- Guardado transaccional de la operación, partidas, revisión completa y cuatro versiones documentales.
- Edición de encabezados y cantidades/precios compartidos; consulta y edición desde revisiones anteriores.
- Vista automática de las cuatro pestañas con sus propias columnas, partes comerciales, importes y pesos. Referencias de Invoice y folio/fecha/referencia de Packing List derivados de sus documentos origen.
- Explicación de precios ausentes por empresa, unidad, moneda o vigencia; recarga explícita desde catálogo sin sustituir precios de otro cliente o proveedor.
- Idempotencia de guardado, detección de ediciones concurrentes y acceso de lectura exclusivo al historial.
- Descargas individuales PDF/Excel, PDF combinado, Excel con cuatro hojas y ZIP con cuatro PDF. Plantillas originales privadas, logos, colores, columnas, fórmulas y paginación de partidas. Archivos privados asociados a la revisión y su plantilla; descarga de archivos anteriores sin sobrescribirlos.
- Papelera de versiones con eliminación recuperable y restauración. No modifica las instantáneas, los archivos ni el contador de revisiones.
- Todos los productos activos están disponibles en la búsqueda, incluso sin precios, peso o unidades completos. El precio se consulta exclusivamente para la empresa, unidad, moneda y fecha seleccionadas; los faltantes permanecen vacíos.
- Vista completa del catálogo con las columnas del Master: descripciones, tres unidades, KGS, factor de unidad, AOCHEN, HUANTENG, venta a HEQ e importes HEQ/KIMIX/PHA. Los tres últimos campos adicionales se importan como valores de origen; no se infieren nuevas reglas de cálculo comercial.

## Pendiente antes de entrega completa

- Edición de descripciones de partidas.
- Folios automáticos, valores predeterminados comerciales y redondeo definitivo requieren reglas pendientes del negocio. Las órdenes se guardan como borradores; los importes usan provisionalmente precio de seis decimales y redondeo de cada partida a dos.
- Recepción, distribución y facturación posterior quedan fuera de esta primera etapa.

En la captura, la sección «4. Descargar documentos» permite exportar el documento seleccionado o todo el flujo. Los cambios pendientes se guardan primero; datos y folios incompletos impiden exportar. Al abrir una revisión anterior se exportan sus datos históricos. Las plantillas y fuentes se cargan después de autenticar y nunca se incluyen en el repositorio público. Las columnas se ajustan al ancho de la página para evitar los cortes de los ejemplos originales. Los logos de una empresa no se reutilizan para otros clientes.

## Desarrollo

Node.js 22.12 o posterior. Ejecutar `npm ci`, `npm run dev`, `npm test`, `npm run build`.

Solo se incluye una clave pública de Supabase; la protección está en la base. El repositorio público no contiene datos iniciales del cliente, libros originales, audios, correo autorizado ni claves privadas. Los archivos de importación locales se excluyen en Git y Vercel.

## Base y pruebas

Migraciones aplicadas al proyecto indicado. Catálogos con decimales exactos, integridad referencial y restricción de vigencias superpuestas. Sin permiso de eliminación/truncado para clientes de la API. Las tablas de órdenes e historial solo se modifican mediante una transacción privada validada y autorizada, expuesta por una función pública invocadora.

Las pruebas SQL en `supabase/tests` se ejecutan administrativamente en transacciones revertidas. Validan permisos, rechazo de escalamiento, vigencias, cuatro documentos por revisión, conservación de totales anteriores, idempotencia y conflicto de revisión. No quedan datos ni usuarios de prueba. Las pruebas de JavaScript validan redondeo, vigencia de precios, copias independientes al editar y escape HTML.

El asesor de seguridad informa RLS sin políticas en `private.configuracion_sistema`: es deliberado, porque la configuración no concede permisos al navegador y solo se mantiene administrativamente. Referencia: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

Los precios iniciales se registraron con vigencia desde la fecha de importación. Esa fecha no reconstruye la vigencia comercial histórica del archivo.
