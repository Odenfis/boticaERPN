<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/715bbcf4-1b42-411f-a3b5-0123c924a3da

## Prueba local con SQL Server

Usa Node.js 24, npm y una instancia de SQL Server accesible desde el equipo.
Si SQL Server está en Docker, consulta el puerto publicado con `docker ps`.
El ERP puede arrancar e iniciar sesión sin una clave de Gemini.

1. Crea una base de prueba vacía, por ejemplo `BoticaERP_Dev`, desde tu cliente SQL.
2. Ejecuta `npm install` y copia `.env.example` a `.env`. Configura el servidor,
   el puerto publicado, la base y las credenciales SQL. Si el contenedor local
   usa un certificado autofirmado, establece `MSSQL_TRUST_SERVER_CERTIFICATE=true`.
3. Con una cuenta autorizada para crear tablas, ejecuta:

   ```sh
   npm run db:migrate
   npm run db:create-admin
   npm run db:seed
   ```

   El último comando es opcional y carga el catálogo, el inventario por lotes y
   una orden de compra de demostración. Para usar una cuenta SQL limitada en la
   operación diaria, aplica `sql/permissions_least_privilege.sql` como DBA,
   asigna la cuenta al rol `rol_botica_app` y úsala en `.env`.
4. Ejecuta `npm run dev` y abre [Botica ERP](http://localhost:3000). Ingresa
   con el administrador que acabas de crear para acceder a **Botica Central Lima**.
   Si falla la conexión, revisa el campo `connected` de
   [la respuesta de diagnóstico](http://localhost:3000/api/health).

Usa `npm test`, `npm run lint` y `npm run build` para comprobar el proyecto.
