# Avances del proyecto

## 2026-11-26 · Docker Compose para Windows

- Se agregó una imagen de producción para el frontend y el backend, con un servicio de Compose publicado solo en localhost y una plantilla para conectar a SQL Server 2022 en Windows.
- Se verificó en Docker Desktop para Mac que la imagen compila, sirve el frontend y sus recursos, corre con un usuario sin privilegios y alcanza el estado `healthy` al conectarse a la base de demostración mediante `host.docker.internal`. Se confirmaron las dos migraciones con una consulta de lectura.
- Pasaron la comprobación de tipos y las 8 pruebas automatizadas. Se documentó la instalación, inicialización y prueba operativa en Windows.

## 2026-11-26 · Arranque local

- Se actualizó la configuración de Vite para que funcione con su cargador nativo y se eliminó la segunda carga de `.env` durante el arranque.
- Se verificó el arranque sin la advertencia de Vite y con conexión a SQL Server. Pasaron las 8 pruebas automatizadas, la comprobación de tipos y las compilaciones con ambos cargadores de Vite.
- Se creó el registro de avances y acciones pendientes en `documentacion`.

## 2026-11-24 · Preparación de la primera prueba

- Se creó `BoticaERP_Dev` en el contenedor `sql2025`, se aplicaron las dos migraciones y se confirmaron 29 tablas. Se creó el administrador inicial y se cargaron datos de demostración.
- Se corrigieron el conflicto de dependencias de npm y los permisos SQL que impedían el inicio de sesión. Se documentó el arranque local en el README.
- Se verificaron por API el inicio y cierre de sesión, el panel, inventario, compras y configuración. La venta de prueba `TK-26295941` descontó del lote apto con vencimiento más próximo y quedó registrada en Kardex y reportes. El turno cerró sin descuadre y se validaron las exportaciones PDF y Excel.
