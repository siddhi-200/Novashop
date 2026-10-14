# NovaShop Cloud and Docker Assignments (3–7)

This project now includes implementations and lab runbooks for the five assignments shown in the class screenshots.

| Assignment | Implementation | Guide |
|---|---|---|
| 3 — Docker without Compose | Node/Express monolith + PostgreSQL container, user-defined network, named database volume | [ASSIGNMENT-3.md](ASSIGNMENT-3.md) |
| 4 — Docker Compose | Gateway + Product service + Order service + two PostgreSQL databases, bridge network, named volumes | [ASSIGNMENT-4.md](ASSIGNMENT-4.md) |
| 5 — Ubuntu VM on Google Cloud | Install Docker on a GCP VM and publish NovaShop on port 8080 | [ASSIGNMENT-5.md](ASSIGNMENT-5.md) |
| 6 — Multi-VM app and databases | Gateway, product service, order service and their databases on separate VMs; service-owned event logs synchronize between databases | [ASSIGNMENT-6.md](ASSIGNMENT-6.md) |
| 7 — Azure Windows VM + GCP Cloud SQL | RDP into Windows VM, run Cloud SQL Auth Proxy, connect using MySQL Workbench | [ASSIGNMENT-7.md](ASSIGNMENT-7.md) |

## Recommended order

1. Complete Assignment 3 locally and capture screenshots.
2. Stop/remove its containers (do not remove the volume), then complete Assignment 4 and capture Compose output and the app.
3. Deploy Assignment 5 to a GCP Ubuntu VM.
4. Complete Assignment 6 only after Assignment 4 works. It needs multiple VMs and more firewall configuration.
5. Complete Assignment 7 separately; it uses MySQL Workbench and Cloud SQL rather than NovaShop's PostgreSQL database.

## Important lab notes

- The passwords in examples are for a disposable lab. Change them before deployment and never commit real secrets to Git.
- Do not publish PostgreSQL port 5432 to the internet. Keep database VMs private and use internal IP addresses.
- Assignment 6 synchronizes a shared event log across the product and order databases through private service-to-service endpoints. The business tables remain owned by their respective services; this is not full physical database replication.
- Cloud deployments may incur charges. Use the smallest suitable VM/Cloud SQL configurations, stop or delete resources after taking screenshots, and verify current prices in the cloud console.
- The lab application has no authentication or payment processing and should not be treated as production software.

## Evidence checklist

For each assignment, include terminal or console screenshots showing its required resources. In particular, capture the running storefront, health endpoints, named volumes/networks or Compose services, cloud VM details, firewall/NSG rules, and successful application access through the expected address.
