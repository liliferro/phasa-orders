# PHASA Orders

Aplicación de operaciones de importación. Primera etapa publicada: https://phasa-orders.vercel.app

## Incluido

- Inicio de sesión por enlace al correo. Acceso mediante correo verificado configurado administrativamente en Supabase.
- Catálogos de empresas, funciones, domicilios, unidades, productos y precios por empresa/producto.
- Captura de Purchase Order con búsqueda por código o descripción, precios disponibles y peso.
- Guardado transaccional de la operación, partidas, revisión completa y cuatro versiones documentales.
- Edición de encabezados y cantidades/precios compartidos; consulta y edición desde revisiones anteriores.
- Idempotencia de guardado, detección de ediciones concurrentes y acceso de lectura exclusivo al historial.

## Pendiente antes de entrega completa

- Exportación PDF y XLSX individual y masiva, reproducción y revisión visual de cada plantilla original, almacenamiento privado de archivos y versiones de plantillas.
- Prueba completa de la interfaz con la sesión real del usuario. No se ha solicitado ni almacenado su contraseña.
- Edición de descripciones de partidas y presentación de columnas específica por documento.
- Folios automáticos, valores predeterminados comerciales y redondeo definitivo requieren reglas pendientes del negocio. Las órdenes se guardan como borradores; los importes usan provisionalmente precio de seis decimales y redondeo de cada partida a dos.
- Recepción, distribución y facturación posterior quedan fuera de esta primera etapa.

Actualmente no hay botones de exportación. Los borradores no son documentos listos para enviar a terceros.

## Desarrollo

Node.js 22.12 o posterior. Ejecutar `npm ci`, `npm run dev`, `npm test`, `npm run build`.

Solo se incluye una clave pública de Supabase; la protección está en la base. El repositorio público no contiene datos iniciales del cliente, libros originales, audios, correo autorizado ni claves privadas. Los archivos de importación locales se excluyen en Git y Vercel.

## Base y pruebas

Migraciones aplicadas al proyecto indicado. Catálogos con decimales exactos, integridad referencial y restricción de vigencias superpuestas. Sin permiso de eliminación/truncado para clientes de la API. Las tablas de órdenes e historial solo se modifican mediante una transacción privada validada y autorizada, expuesta por una función pública invocadora.

Las pruebas SQL en `supabase/tests` se ejecutan administrativamente en transacciones revertidas. Validan permisos, rechazo de escalamiento, vigencias, cuatro documentos por revisión, conservación de totales anteriores, idempotencia y conflicto de revisión. No quedan datos ni usuarios de prueba. Las pruebas de JavaScript validan redondeo, vigencia de precios, copias independientes al editar y escape HTML.

El asesor de seguridad informa RLS sin políticas en `private.configuracion_sistema`: es deliberado, porque la configuración no concede permisos al navegador y solo se mantiene administrativamente. Referencia: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

Los precios iniciales se registraron con vigencia desde la fecha de importación. Esa fecha no reconstruye la vigencia comercial histórica del archivo.
