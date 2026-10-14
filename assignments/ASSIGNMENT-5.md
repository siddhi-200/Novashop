# Assignment 5 — Host NovaShop on an Ubuntu VM in Google Cloud

## Goal

Create an Ubuntu VM in Google Cloud, install Docker, run the monolithic NovaShop app and its database, open the application port in a VPC firewall rule, and browse to `EXTERNAL_IP:8080`.

This uses manual `docker run` commands rather than Compose so the deployment is easy to demonstrate in the terminal.

## 1. Create the VM and firewall rule

In Google Cloud Console:

1. Select a project and enable Compute Engine if prompted.
2. Create a Compute Engine VM. Choose Ubuntu 24.04 LTS, a small general-purpose machine type, and a boot disk large enough for Docker images.
3. Add network tag `novashop-web`.
4. Note the VM's external IP.
5. In VPC network → Firewall, create an ingress rule that targets `novashop-web`, permits TCP port `8080`, and uses source `0.0.0.0/0` for this public demo. Keep SSH access restricted to your own IP/IAP; do not open PostgreSQL port 5432.

Optional `gcloud` equivalent (run after setting your project):

```bash
ZONE=asia-south1-a
gcloud compute instances create novashop-vm \
  --zone="$ZONE" \
  --machine-type=e2-small \
  --image-family=ubuntu-2404-lts-amd64 \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=20GB \
  --tags=novashop-web

gcloud compute firewall-rules create novashop-allow-8080 \
  --direction=INGRESS --action=ALLOW --rules=tcp:8080 \
  --source-ranges=0.0.0.0/0 --target-tags=novashop-web
```

## 2. Connect and install Docker

SSH into the VM from the console, or use `gcloud compute ssh`. Then run:

```bash
sudo apt-get update
sudo apt-get install -y docker.io unzip
sudo systemctl enable --now docker
sudo docker --version
```

## 3. Copy the project to the VM

From your local machine, in the directory containing `novashop-ecommerce-fixed.zip`:

```bash
gcloud compute scp novashop-ecommerce-fixed.zip novashop-vm:~/ --zone=asia-south1-a
```

Back on the VM:

```bash
unzip novashop-ecommerce-fixed.zip
cd novashop-ecommerce/monolith
```

If your code is already in a public Git repository, you can clone it instead. Use the correct repository URL and directory name.

## 4. Build the image and start the database

```bash
sudo docker network create novashop-gcp-net
sudo docker volume create novashop-gcp-postgres-data
sudo docker build -t novashop-monolith:gcp .

sudo docker run -d \
  --name novashop-db \
  --network novashop-gcp-net \
  --restart unless-stopped \
  --health-cmd='pg_isready -U novashop -d novashop' \
  --health-interval=5s --health-timeout=3s --health-retries=20 \
  -e POSTGRES_DB=novashop \
  -e POSTGRES_USER=novashop \
  -e POSTGRES_PASSWORD='replace_with_a_strong_lab_password' \
  -v novashop-gcp-postgres-data:/var/lib/postgresql/data \
  postgres:16-alpine
```

Wait for the database:

```bash
sudo docker ps --filter name=novashop-db
```

## 5. Start the app on host port 8080

```bash
sudo docker run -d \
  --name novashop-app \
  --network novashop-gcp-net \
  --restart unless-stopped \
  -p 8080:3000 \
  -e PORT=3000 \
  -e DB_HOST=novashop-db \
  -e DB_PORT=5432 \
  -e DB_NAME=novashop \
  -e DB_USER=novashop \
  -e DB_PASSWORD='replace_with_a_strong_lab_password' \
  novashop-monolith:gcp
```

Use the same password in the two `docker run` commands. Check the app:

```bash
sudo docker ps
sudo docker logs --tail=100 novashop-app
curl http://localhost:8080/api/health
```

On your computer, open `http://EXTERNAL_IP:8080`. The external IP is shown on the VM details page. Do not add a port-forward or firewall rule for 5432.

## 6. Screenshot evidence and cleanup

Capture the VM details showing Ubuntu and its external IP, the firewall rule for TCP 8080, `docker ps`, the health response, and the storefront in a browser.

When finished, stop or delete the VM and any temporary firewall rule to limit charges. Keep the named volume only if you intend to reuse the same VM/database.

## Official references

- [Create and start a Compute Engine instance](https://docs.cloud.google.com/compute/docs/instances/create-start-instance)
- [Use VPC firewall rules](https://docs.cloud.google.com/firewall/docs/using-firewalls)
- [Docker volumes](https://docs.docker.com/engine/storage/volumes/)

find ~/novashop-deploy -name Dockerfile -print