# NovaShop Ecommerce — Monolith, Microservices, and Cloud Assignments

NovaShop is an educational ecommerce storefront supplied with two implementations:

1. **Monolith** — one Node.js/Express app serves the storefront and product/order APIs.
2. **Microservices** — a gateway serves the same storefront and routes API calls to Product and Order services.

Both implementations now use PostgreSQL for persistent product and order data. Product inventory remains owned by the product side in the microservices version; orders are stored by the order side. A small retrying event-sync worker copies inventory/order events between the two service databases for the multi-VM assignment.

## Storefront features

- Product catalogue, category filtering, and search
- Product details and related products
- Browser-based shopping cart
- Checkout with name and delivery address
- Order confirmation, order lookup, and order history UI
- Help/FAQ page and custom 404 page

## Main routes

| Route | Purpose |
|---|---|
| `/` | Shop and product search |
| `/product?id=N` | Product details |
| `/cart` | Shopping cart |
| `/checkout` | Checkout form |
| `/order?id=ID` | Order confirmation and lookup |
| `/orders` | Orders page |
| `/about` | Help and FAQ |
| `/api/health` | App health endpoint |

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Health + architecture + database status (monolith) |
| GET | `/api/products?q=&category=` | List/search products |
| GET | `/api/products/:id` | Product detail |
| POST | `/api/orders` | Place an order and update stock |
| GET | `/api/orders/:id` | Fetch a single order |

> Lab note: there is no authentication, payment processing, or production-grade security hardening. The application is for learning purposes only.

## Requirements

- Docker Engine (recommended for these assignments)
- Docker Compose plugin for Assignment 4
- Node.js 18+ if you want to run a service locally
- Google Cloud and Azure accounts for Assignments 5–7; cloud use may incur charges

## Run the monolith locally (requires PostgreSQL)

Set up a PostgreSQL database named `novashop` with user `novashop` and set `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` as environment variables. Then:

```bash
cd monolith
npm install
npm start
```

Open <http://localhost:3000>.

## Run microservices with Docker Compose

```bash
cp microservices/.env.example microservices/.env
# Edit microservices/.env and change the lab password.
docker compose --env-file microservices/.env -f microservices/docker-compose.yml up --build -d
```

Open <http://localhost:8080>.

Stop but preserve the data volumes:

```bash
docker compose --env-file microservices/.env -f microservices/docker-compose.yml down
```

## Assignments 3–7

Detailed instructions with exact commands and evidence checklists are in [`assignments/README.md`](assignments/README.md). Start with Assignment 3 and continue in order.

## Project layout

```text
novashop-ecommerce/
├── monolith/                  # Monolith + Dockerfile + PostgreSQL client
├── microservices/
│   ├── gateway/                # Public storefront/API gateway
│   ├── product-service/        # Catalogue/stock owner and event sync endpoint
│   ├── order-service/          # Order persistence and event sync endpoint
│   └── docker-compose.yml      # Gateway, services, databases, network, volumes
└── assignments/                # Step-by-step guides for Assignments 3–7
```
