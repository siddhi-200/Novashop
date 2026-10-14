# Assignment 4 — NovaShop Microservices with Docker Compose

## Goal

Run NovaShop as a gateway plus two independent services. Give the Product service and Order service their own PostgreSQL databases and named volumes. Use Compose to create the services, network, health checks, and dependencies.

## Architecture

```text
Browser
  |
  | http://localhost:8080
  v
Gateway :8080 (only published application port)
  |----------------------------|
  v                            v
Product service :3001       Order service :3002
  |                            |
  v                            v
Product PostgreSQL           Order PostgreSQL
  |                            |
product_data volume          order_data volume
```

The databases are not published to the host. Product and order data stay in their service-owned databases. A retrying event-sync worker copies inventory/order events into a `sync_events` table in both databases, over private container networking.

## 1. Configure local lab values

From the repository root:

```bash
cp microservices/.env.example microservices/.env
```

Edit `microservices/.env` and set a strong lab password. Use that file only for local testing; it is excluded from Docker build contexts.

## 2. Build and run the stack

```bash
docker compose --env-file microservices/.env -f microservices/docker-compose.yml up --build -d
```

Open <http://localhost:8080>.

Useful checks:

```bash
docker compose --env-file microservices/.env -f microservices/docker-compose.yml ps
docker compose --env-file microservices/.env -f microservices/docker-compose.yml logs --tail=100
docker network ls
docker volume ls
curl http://localhost:8080/api/health
curl http://localhost:8080/api/products
```

Create an order through the storefront. Confirm it appears on the order confirmation page, then inspect the product stock after refreshing the catalogue.

## 3. Demonstrate persistence and event synchronization

Restart the services:

```bash
docker compose --env-file microservices/.env -f microservices/docker-compose.yml restart
```

Orders and product stock should persist because the databases use `order_data` and `product_data`.

For a simple view of the synchronized event records, run:

```bash
docker exec -it $(docker ps -qf name=product-db) psql -U novashop -d products -c 'SELECT event_type, synced, created_at FROM sync_events ORDER BY created_at DESC LIMIT 10;'
docker exec -it $(docker ps -qf name=order-db) psql -U novashop -d orders -c 'SELECT event_type, synced, created_at FROM sync_events ORDER BY created_at DESC LIMIT 10;'
```

Allow up to five seconds for a new event to reach the peer database. Both services keep unsent events in their local database and retry, so a brief service restart does not immediately discard the event. The event table demonstrates application-level synchronization; it does not replicate every product table into the order database.

## 4. Stop the stack

To stop the containers but preserve data:

```bash
docker compose --env-file microservices/.env -f microservices/docker-compose.yml down
```

To delete the lab databases as well (not needed for your assignment evidence):

```bash
docker compose --env-file microservices/.env -f microservices/docker-compose.yml down -v
```

## 5. Screenshot evidence

Capture the storefront at port 8080, `docker compose ps`, container logs, `docker volume ls`, the `novashop-net` network, and matching recent event records in both databases.
