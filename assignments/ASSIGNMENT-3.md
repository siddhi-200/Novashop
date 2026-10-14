# Assignment 3 — Monolithic NovaShop with Docker, without Docker Compose

## Goal

Run the monolithic application and its PostgreSQL database as two separate containers. Put both on one user-defined Docker network and use a named Docker volume so database rows survive container recreation. Do not use Docker Compose for this assignment.

## Files

- `monolith/Dockerfile` — builds the Node.js application image.
- `monolith/server.js` — connects to PostgreSQL and creates/seeds the schema at startup.
- PostgreSQL runs in its own official image.

## 1. Build the app image

From the repository root:

```bash
docker network create novashop-monolith-net
docker volume create novashop-postgres-data
docker build -t novashop-monolith:assignment3 ./monolith
```

If Docker reports that the network already exists, continue using it.

## 2. Start the database container

```bash
docker run -d \
  --name novashop-db \
  --network novashop-monolith-net \
  --restart unless-stopped \
  --health-cmd='pg_isready -U novashop -d novashop' \
  --health-interval=5s \
  --health-timeout=3s \
  --health-retries=20 \
  -e POSTGRES_DB=novashop \
  -e POSTGRES_USER=novashop \
  -e POSTGRES_PASSWORD='siddhishree' \
  -v novashop-postgres-data:/var/lib/postgresql/data \
  postgres:16-alpine
```

The database has no `-p`/published port. The app reaches it by the Docker DNS name `novashop-db` on the shared network.

Wait until it is healthy:

```bash
docker ps --filter name=novashop-db
```

## 3. Start the app container

```bash
docker run -d \
  --name novashop-app \
  --network novashop-monolith-net \
  --restart unless-stopped \
  -p 3000:3000 \
  -e PORT=3000 \
  -e DB_HOST=novashop-db \
  -e DB_PORT=5432 \
  -e DB_NAME=novashop \
  -e DB_USER=novashop \
  -e DB_PASSWORD='siddhishree' \
  novashop-monolith:assignment3
```

Open <http://localhost:3000>. Check the database-aware health endpoint:

```bash
curl http://localhost:3000/api/health
docker logs novashop-app
docker network inspect novashop-monolith-net
docker volume inspect novashop-postgres-data
```

The health response should include `"status":"ok"` and `"database":"connected"`.

## 4. Prove persistence

1. Place a test order through the storefront and note its order ID.
2. Restart both containers:

   ```bash
   docker restart novashop-db
   docker restart novashop-app
   ```

3. Wait for startup, then reload the storefront and open `/order?id=YOUR_ORDER_ID`.
4. For a stronger volume test, remove and recreate only the database container while keeping its volume:

   ```bash
   docker rm -f novashop-db
   docker run -d --name novashop-db --network novashop-monolith-net --restart unless-stopped \
     --health-cmd='pg_isready -U novashop -d novashop' --health-interval=5s --health-timeout=3s --health-retries=20 \
     -e POSTGRES_DB=novashop -e POSTGRES_USER=novashop -e POSTGRES_PASSWORD='change_this_lab_password' \
     -v novashop-postgres-data:/var/lib/postgresql/data postgres:16-alpine
   docker restart novashop-app
   ```

   The same order should still exist because `novashop-postgres-data` was not removed.

**Do not run `docker volume rm novashop-postgres-data` during the persistence demonstration.** Deleting the volume deletes this lab database.

## 5. Screenshot evidence

Capture the storefront, `docker ps`, `docker network inspect novashop-monolith-net`, `docker volume inspect novashop-postgres-data`, and a successful health response. Optionally show the order still exists after container recreation.
