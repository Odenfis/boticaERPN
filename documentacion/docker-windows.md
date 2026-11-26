# Botica ERP con Docker Compose y SQL Server 2022 en Windows

Esta instalación está destinada a **Máquina Prueba Windows**. Docker Desktop ejecuta la aplicación y SQL Server 2022 conserva los datos en Windows. El ERP se publica en `http://localhost:3000` para uso desde ese equipo.

## 1. Preparar Windows y clonar el proyecto

Abre PowerShell con Docker Desktop iniciado en modo de contenedores Linux y comprueba que `docker info --format '{{.OSType}}'` devuelve `linux`.

```powershell
docker compose version
git clone https://github.com/Odenfis/boticaERPN.git
cd boticaERPN
```

Si ya tienes un clon, actualízalo con `git pull --ff-only` desde su directorio. La revisión descargada debe incluir `compose.yaml` y `Dockerfile`.

## 2. Habilitar la conexión TCP a SQL Server

1. Abre SQL Server Configuration Manager (`SQLServerManager16.msc`). En **SQL Server Network Configuration**, abre los protocolos de la instancia correcta y habilita **TCP/IP**.
2. Conserva su puerto fijo si ya está configurado. Si usa uno dinámico y tienes autorización para cambiarlo, configura un puerto fijo libre. Para **Listen All = Yes**, borra **TCP Dynamic Ports** y asigna **TCP Port** en **IPAll**. Usa `1433` si está libre. Con **Listen All = No**, configura las entradas IP correspondientes. Reinicia el servicio de esa instancia si cambiaste la configuración.
3. En SSMS, comprueba que puedes entrar con autenticación de Windows por `tcp:localhost,1433` o por el puerto elegido. En **Server Properties → Security**, verifica que la instancia admite autenticación de SQL Server y Windows. Si habilitas ese modo, reinicia el servicio. Puedes dejar `sa` deshabilitado.
4. Si el firewall bloquea el acceso desde Docker Desktop, permite solo el puerto TCP elegido y limita la regla al origen de Docker Desktop y al perfil de red aplicable.

[Configuración de puertos TCP en SQL Server](https://learn.microsoft.com/en-us/sql/tools/configuration-manager/tcp-ip-properties-ip-addresses-tab) · [Firewall de Windows para SQL Server](https://learn.microsoft.com/en-us/sql/database-engine/configure-windows/configure-the-windows-firewall-to-allow-sql-server-access)

## 3. Crear la base de demostración y las cuentas

En SSMS, con una cuenta administradora de la instancia, ejecuta este bloque para una base nueva. Si el nombre ya existe, detente y verifica a qué entorno pertenece antes de continuar. Sustituye las dos contraseñas por valores distintos y robustos. En un literal T-SQL, representa una comilla simple dentro de la contraseña con dos comillas simples.

```sql
USE [master];
GO
CREATE DATABASE [BoticaERP_Dev];
GO
CREATE LOGIN [botica_setup_windows] WITH PASSWORD = N'<contraseña temporal>',
    CHECK_POLICY = ON, DEFAULT_DATABASE = [BoticaERP_Dev];
CREATE LOGIN [botica_app_windows] WITH PASSWORD = N'<contraseña de aplicación>',
    CHECK_POLICY = ON, DEFAULT_DATABASE = [BoticaERP_Dev];
GO
USE [BoticaERP_Dev];
GO
CREATE USER [botica_setup_windows] FOR LOGIN [botica_setup_windows];
ALTER ROLE [db_owner] ADD MEMBER [botica_setup_windows];
CREATE USER [botica_app_windows] FOR LOGIN [botica_app_windows];
GO
```

Selecciona `BoticaERP_Dev` en SSMS y ejecuta el contenido de [permissions_least_privilege.sql](../sql/permissions_least_privilege.sql). Después, en la misma base, ejecuta:

```sql
ALTER ROLE [rol_botica_app] ADD MEMBER [botica_app_windows];
```

## 4. Construir e inicializar

En PowerShell, desde el proyecto:

```powershell
Copy-Item .env.windows.example .env
```

Si ya tienes un `.env`, edítalo directamente. Completa `MSSQL_PASSWORD` con la contraseña de **botica_app_windows** y ajusta `MSSQL_PORT`. Las comillas simples en `.env` permiten escribir un signo `$` literal. En esta instancia de prueba, si usas un certificado autofirmado, puedes configurar `MSSQL_TRUST_SERVER_CERTIFICATE=true` manteniendo `MSSQL_ENCRYPT=true`. El nombre `host.docker.internal` permite que el contenedor llegue a Windows. [Redes de Docker Desktop](https://docs.docker.com/desktop/features/networking/networking-how-tos/)

```powershell
docker compose config --quiet
docker compose build
```

En una terminal interactiva, introduce la contraseña SQL **temporal** cuando PowerShell la solicite. El asistente de `db:create-admin` pedirá el usuario, el nombre y la contraseña del ERP. Esa cuenta es independiente de los logins SQL.

```powershell
$setup = Get-Credential -UserName 'botica_setup_windows' -Message 'Credenciales SQL de inicialización'
try {
    $env:MSSQL_USER = $setup.UserName
    $env:MSSQL_PASSWORD = $setup.GetNetworkCredential().Password
    foreach ($command in 'db:migrate', 'db:create-admin', 'db:seed') {
        docker compose run --rm -e MSSQL_USER -e MSSQL_PASSWORD app npm run $command
        if ($LASTEXITCODE -ne 0) { throw "Falló $command" }
    }
} finally {
    Remove-Item Env:MSSQL_USER, Env:MSSQL_PASSWORD -ErrorAction SilentlyContinue
    Remove-Variable setup -ErrorAction SilentlyContinue
}
```

Cuando los tres comandos terminen correctamente, confirma que `dbo.SchemaMigrations` contiene `001_schema` y `002_seed_rbac`. Retira la cuenta temporal desde SSMS:

```sql
USE [BoticaERP_Dev];
GO
ALTER ROLE [db_owner] DROP MEMBER [botica_setup_windows];
DROP USER [botica_setup_windows];
GO
USE [master];
GO
DROP LOGIN [botica_setup_windows];
GO
```

## 5. Iniciar y comprobar

```powershell
docker compose up -d
docker compose ps
Invoke-RestMethod http://localhost:3000/api/health
```

- Confirma el estado `healthy` y el campo `connected: true`. Abre el ERP en [localhost:3000](http://localhost:3000) e ingresa con el administrador del ERP para acceder a **Botica Central Lima**.
- Abre caja, registra una venta de prueba y verifica el descuento por lote en Kardex. Exporta los reportes en PDF y Excel, y cierra el turno. Ejecuta `docker compose up -d --force-recreate` y vuelve a comprobar la venta y el turno.
- Comprueba en SSMS que `botica_app_windows` tiene acceso a las tablas y carece de permisos para modificar el esquema.
- Para detener el ERP, ejecuta `docker compose down`. Al actualizar el repositorio, ejecuta `docker compose up -d --build`. Los datos permanecen en SQL Server de Windows.

Si el puerto web 3000 ya está ocupado, agrega `BOTICA_HOST_PORT=3001` a `.env`, recrea el contenedor y abre `http://localhost:3001`. Si la app no se conecta a SQL, revisa `docker compose logs app` y el campo `message` de `/api/health`. Un tiempo de espera apunta a la escucha TCP, el puerto o el firewall. Un error de autenticación requiere revisar el modo mixto y el usuario en la base. Un error TLS requiere revisar el certificado y la configuración de cifrado.
