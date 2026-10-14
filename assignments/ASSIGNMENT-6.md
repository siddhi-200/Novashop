# Assignment 6 — NovaShop across Multiple VMs

This guide uses the existing gateway, Product service, Order service, and their separate databases. The Product and Order service databases exchange business events over internal service endpoints. Only the gateway is reachable from the public internet.

> The assignment phrase “each DB should sync between themselves” can mean either application-level synchronization or full database replication. This project implements **application-level event synchronization**: order-created and inventory-reserved/released events are stored in both databases. It does not replicate every business table or turn the two service databases into multi-primary replicas. Confirm with the instructor if physical/full-schema database replication is specifically required.

## 6.1 — Two-VM baseline (one application and one database)

To demonstrate the first part on its own before building the larger layout:

1. Create two Ubuntu VMs in the same VPC/subnet, preferably without external IPs except for a temporary bastion or IAP access.
2. On VM2, run a PostgreSQL container bound to VM2's **internal IP** on port 5432 and use a named volume.
3. On VM1, run a Dockerized application with `DB_HOST=<VM2_INTERNAL_IP>` and the correct database credentials.
4. Use a VPC firewall rule permitting TCP 5432 from the application VM only. Do not publish 5432 to the internet.
5. Verify the app health endpoint and then restart the DB container to show its named volume preserves data.

Example database command on VM2 (replace values):

```bash
sudo apt-get update && sudo apt-get install -y docker.io
sudo systemctl enable --now docker
sudo docker volume create lab-db-data
sudo docker run -d --name lab-db --restart unless-stopped \
  -p DB_VM_INTERNAL_IP:5432:5432 \
  -e POSTGRES_DB=novashop -e POSTGRES_USER=novashop \
  -e POSTGRES_PASSWORD='replace_with_a_strong_lab_password' \
  -v lab-db-data:/var/lib/postgresql/data postgres:16-alpine
```

Then use the DB VM's internal IP in the app container's `DB_HOST` environment variable.

## 6.2 — Microservices layout

Use five VMs in the same Google Cloud VPC. Reserve or record each private IP and do not assign external IPs to the four backend VMs.

| VM | Public access | Workload | Port allowed inbound |
|---|---|---|---|
| `novashop-gateway` | External IP | Gateway + storefront | TCP 8080 from the internet; SSH only from your IP/IAP |
| `novashop-product-app` | No external IP | Product service | TCP 3001 only from gateway/order-app VMs |
| `novashop-product-db` | No external IP | PostgreSQL `products` database | TCP 5432 only from product-app VM |
| `novashop-order-app` | No external IP | Order service | TCP 3002 only from gateway/product-app VMs |
| `novashop-order-db` | No external IP | PostgreSQL `orders` database | TCP 5432 only from order-app VM |

All five VMs should use the same VPC and a compatible subnet. Example naming tags are the VM names above; use matching target tags in firewall rules.

### A. Create the VMs

The Cloud Console is easiest for a first lab. Create five Ubuntu 24.04 VMs in the same zone. Give only `novashop-gateway` an external IP. Add these network tags:

- Gateway: `novashop-gateway`
- Product app: `novashop-product-app`
- Product DB: `novashop-product-db`
- Order app: `novashop-order-app`
- Order DB: `novashop-order-db`

For private VMs, enable IAP TCP forwarding or use your controlled bastion to administer/copy files. Do not add public ingress rules to the private app or DB VMs.

### B. Configure firewall rules

Create ingress firewall rules targeting the relevant tags:

1. Gateway: allow TCP 8080 from `0.0.0.0/0`.
2. Product app: allow TCP 3001 only from source tags `novashop-gateway` and `novashop-order-app`.
3. Order app: allow TCP 3002 only from source tags `novashop-gateway` and `novashop-product-app`.
4. Product DB: allow TCP 5432 only from source tag `novashop-product-app`.
5. Order DB: allow TCP 5432 only from source tag `novashop-order-app`.
6. SSH for private VMs: prefer IAP (source range `35.235.240.0/20`, TCP 22) and appropriate IAM permissions. Do not use a broad public SSH rule.

A default network may contain other firewall rules. Review effective rules and remove any broad rule that exposes backend ports publicly.

### C. Copy the project and install Docker

Install Docker on each VM:

```bash
sudo apt-get update
sudo apt-get install -y docker.io unzip
sudo systemctl enable --now docker
```

From your local machine, copy the project directory to each app VM. Replace the zone and folder path as necessary. For private VMs, use IAP tunnelling and ensure the IAP API and firewall permission have been configured:

```bash
gcloud compute scp --recurse ./novashop-ecommerce novashop-gateway:~/novashop-ecommerce --zone=asia-south1-a
gcloud compute scp --tunnel-through-iap --recurse ./novashop-ecommerce novashop-product-app:~/novashop-ecommerce --zone=asia-south1-a
gcloud compute scp --tunnel-through-iap --recurse ./novashop-ecommerce novashop-order-app:~/novashop-ecommerce --zone=asia-south1-a
```

### D. Start the two databases

On the `novashop-product-db` VM, retrieve its internal IP from the VM details page. Then run the following, replacing `PRODUCT_DB_INTERNAL_IP` and the lab password:

```bash
sudo docker volume create product-db-data
sudo docker run -d --name product-db --restart unless-stopped \
  -p PRODUCT_DB_INTERNAL_IP:5432:5432 \
  -e POSTGRES_DB=products -e POSTGRES_USER=novashop \
  -e POSTGRES_PASSWORD='PRODUCT_DB_PASSWORD' \
  -v product-db-data:/var/lib/postgresql/data postgres:16-alpine
```

On the `novashop-order-db` VM, do the equivalent:

```bash
sudo docker volume create order-db-data
sudo docker run -d --name order-db --restart unless-stopped \
  -p ORDER_DB_INTERNAL_IP:5432:5432 \
  -e POSTGRES_DB=orders -e POSTGRES_USER=novashop \
  -e POSTGRES_PASSWORD='ORDER_DB_PASSWORD' \
  -v order-db-data:/var/lib/postgresql/data postgres:16-alpine
```

The examples intentionally do not use `-p 5432:5432`, which would bind to all host interfaces. Bind to each database VM's internal IP only.

### E. Start Product and Order service containers

On the Product app VM, from `~/novashop-ecommerce/microservices/product-service`, replace `PRODUCT_DB_INTERNAL_IP`, `ORDER_APP_INTERNAL_IP`, and the DB password:

```bash
sudo docker build -t novashop-product:assignment6 .
sudo docker run -d --name novashop-product --restart unless-stopped \
  -p 3001:3001 \
  -e PORT=3001 -e DB_HOST=PRODUCT_DB_INTERNAL_IP -e DB_PORT=5432 \
  -e DB_NAME=products -e DB_USER=novashop -e DB_PASSWORD='PRODUCT_DB_PASSWORD' \
  -e ORDER_SERVICE_URL=http://ORDER_APP_INTERNAL_IP:3002 \
  novashop-product:assignment6
```

On the Order app VM, from `~/novashop-ecommerce/microservices/order-service`, replace `ORDER_DB_INTERNAL_IP`, `PRODUCT_APP_INTERNAL_IP`, and the DB password:

```bash
sudo docker build -t novashop-order:assignment6 .
sudo docker run -d --name novashop-order --restart unless-stopped \
  -p 3002:3002 \
  -e PORT=3002 -e DB_HOST=ORDER_DB_INTERNAL_IP -e DB_PORT=5432 \
  -e DB_NAME=orders -e DB_USER=novashop -e DB_PASSWORD='ORDER_DB_PASSWORD' \
  -e PRODUCT_SERVICE_URL=http://PRODUCT_APP_INTERNAL_IP:3001 \
  novashop-order:assignment6
```

The event-sync workers use each other's private service URLs. The firewall rules must allow product app → order app TCP 3002 and order app → product app TCP 3001.

### F. Start the public gateway

On the gateway VM, from `~/novashop-ecommerce/microservices/gateway`, replace the two internal app IPs:

```bash
sudo docker build -t novashop-gateway:assignment6 .
sudo docker run -d --name novashop-gateway --restart unless-stopped \
  -p 8080:8080 -e PORT=8080 \
  -e PRODUCT_SERVICE_URL=http://PRODUCT_APP_INTERNAL_IP:3001 \
  -e ORDER_SERVICE_URL=http://ORDER_APP_INTERNAL_IP:3002 \
  novashop-gateway:assignment6
```

Open `http://GATEWAY_EXTERNAL_IP:8080`. Only the gateway VM should accept public application traffic.

### G. Verify synchronization and capture evidence

1. Browse the storefront through the gateway's external IP and create an order.
2. Check health endpoints from the appropriate internal VMs: `http://PRODUCT_APP_INTERNAL_IP:3001/health` and `http://ORDER_APP_INTERNAL_IP:3002/health`.
3. On the product DB VM, inspect synced events:

   ```bash
   sudo docker exec -it product-db psql -U novashop -d products -c 'SELECT event_type, synced, created_at FROM sync_events ORDER BY created_at DESC LIMIT 10;'
   ```

4. On the order DB VM:

   ```bash
   sudo docker exec -it order-db psql -U novashop -d orders -c 'SELECT event_type, synced, created_at FROM sync_events ORDER BY created_at DESC LIMIT 10;'
   ```

5. Take screenshots of the five VM resources and private IPs, firewall rules, `docker ps` on each VM, the public storefront, and matching event records. Do not show real secret passwords in screenshots.

## Troubleshooting checklist

- `502` at the gateway: check internal IPs, firewall source/target tags, and service logs.
- Database connection failure: confirm the DB container is running, the database port is bound to its internal IP, and the app VM is allowed through the VPC firewall.
- Events not appearing on both DBs: verify each service has the correct peer URL and that both directions of TCP 3001/3002 are allowed between app VMs; allow at least five seconds for retry.
- Do not assign external IPs to DB VMs, do not open 5432 to `0.0.0.0/0`, and do not expose the internal `/sync/events` route through the gateway.

## Official references

- [Use VPC firewall rules](https://docs.cloud.google.com/firewall/docs/using-firewalls)
- [Use IAP for TCP forwarding](https://docs.cloud.google.com/iap/docs/using-tcp-forwarding)
- [Add and remove network tags](https://docs.cloud.google.com/vpc/docs/add-remove-network-tags)
