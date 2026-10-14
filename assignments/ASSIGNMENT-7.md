# Assignment 7 — Azure Windows VM + Google Cloud SQL for MySQL

## Goal

Create a Windows VM in Azure, connect to it using RDP, install MySQL Workbench, create a managed Cloud SQL for MySQL instance in Google Cloud, and use the Cloud SQL Auth Proxy on the Windows VM so Workbench connects through the VM. The database port is not opened to the internet and Cloud SQL does not need a broad authorized-network entry.

## 1. Create the Azure Windows VM

1. In Azure Portal, create a Windows Server VM (for example, Windows Server 2022) in a resource group.
2. Use a small suitable VM size for the lab and configure a public IP so you can connect by RDP.
3. In the Network Security Group, allow inbound TCP 3389 **only from your own public IP address**. Do not add an inbound rule for TCP 3306.
4. Set a strong local administrator password and connect using Azure Portal's RDP download/connect option.

After RDP login, install MySQL Workbench using its official Windows installer.

## 2. Create the managed Cloud SQL MySQL instance

In Google Cloud Console:

1. Select your GCP project and enable the Cloud SQL Admin API.
2. Open SQL → Create instance → MySQL.
3. Pick a MySQL version compatible with the Workbench installer (MySQL 8.x is suitable for this lab), a small lab configuration, and a region.
4. Set an administrative password and create a separate, non-root database user for Workbench.
5. Wait until the instance is ready. Copy its **Instance connection name** from the Overview page; it has the format `PROJECT_ID:REGION:INSTANCE_ID`.
6. You can leave public IP enabled for proxy connectivity, but do **not** add `0.0.0.0/0` or a broad authorized network. The Auth Proxy authenticates and encrypts its connection.

Official reference: [Connect using the Cloud SQL Auth Proxy](https://docs.cloud.google.com/sql/docs/mysql/connect-auth-proxy).

## 3. Give the Azure VM permission to connect

The Cloud SQL Auth Proxy needs Google credentials with the `Cloud SQL Client` IAM role.

For this lab, create a dedicated service account in the GCP project and grant it **Cloud SQL Client** (not Owner). Create a JSON key for that service account and transfer it securely to the Azure Windows VM. Store it in a restricted folder, for example `C:\cloudsql\service-account.json`, and do not place it in a public repository or screenshot. Remove the key and/or revoke it after the assignment is complete.

For a production deployment, prefer a keyless identity federation design instead of a downloaded service-account key.

## 4. Download and start the Cloud SQL Auth Proxy on Windows

Inside the Azure VM, create `C:\cloudsql`. Download the Windows 64-bit Cloud SQL Auth Proxy from the official Google Cloud documentation and save it as `C:\cloudsql\cloud-sql-proxy.exe`:

<https://docs.cloud.google.com/sql/docs/mysql/connect-auth-proxy>

Open PowerShell and run:

```powershell
cd C:\cloudsql
.\cloud-sql-proxy.exe --credentials-file="C:\cloudsql\service-account.json" PROJECT_ID:REGION:INSTANCE_ID
```

Replace `PROJECT_ID:REGION:INSTANCE_ID` with the actual Instance connection name. Keep this PowerShell window open. The proxy should report that it is listening on `127.0.0.1:3306` and ready for connections.

The proxy listens on localhost by default. Do not change it to `0.0.0.0`, and do not expose port 3306 in the Azure NSG. The proxy is running **inside the Azure Windows VM**, so Workbench on that same VM uses localhost.

## 5. Connect through MySQL Workbench

1. Open MySQL Workbench in the RDP desktop.
2. Create a new MySQL connection with:
   - Connection Method: Standard TCP/IP
   - Hostname: `127.0.0.1`
   - Port: `3306`
   - Username: the MySQL database user created in Cloud SQL
   - Password: store it in Workbench only if needed for the demo
3. Click **Test Connection**, then connect.
4. Run a small verification query:

   ```sql
   SELECT VERSION();
   CREATE DATABASE IF NOT EXISTS assignment7_demo;
   SHOW DATABASES;
   ```

This demonstrates that MySQL Workbench on the Azure VM can connect to the GCP-managed database via the proxy. Cloud SQL does not require a public authorized-network rule for the Azure VM's IP when using the Auth Proxy.

## 6. Screenshot evidence and cleanup

Capture the Azure VM overview, successful RDP desktop with Workbench installed, Cloud SQL instance details with the instance connection name visible (hide passwords and keys), the Auth Proxy terminal showing it is ready, Workbench's successful test/connection, and the SQL query results.

Afterward, stop/delete the Azure VM, delete the Cloud SQL test instance if it is no longer needed, and delete/revoke the temporary service-account key. Cloud SQL and compute resources can incur charges while running.
