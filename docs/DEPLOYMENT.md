# Deploying Augastam Test Studio

This guide puts Test Studio on a Linux VM with Docker, behind an HTTPS reverse proxy, for team use. The container runs one portal process that owns one data volume. Do not run two containers against the same volume.

## 1. Requirements

- Linux VM (Ubuntu 22.04+ suggested), Docker Engine 24+ with the compose plugin.
- 2 vCPU / 4 GB RAM minimum for `PORTAL_WORKERS=1`; see [Sizing](#8-sizing-and-speed).
- A DNS name pointing at the VM (for HTTPS), ports 80 and 443 open to your team network only.
- Outbound network access from the VM to the application under test (see [section 6](#6-network-access-to-the-target-app)).

## 2. First deployment

```bash
git clone <your-repo-url> augastam-test-studio   # or copy the project folder to the VM
cd augastam-test-studio
cp .env.example .env
nano .env        # set PORTAL_ADMIN_PASSWORD, PORTAL_WORKERS, INTAKE_MAX_MB, optional ANTHROPIC_API_KEY
chmod 600 .env
docker compose up -d --build
docker compose ps          # STATUS should become "healthy"
docker compose logs -f portal
```

The compose file publishes the portal on `127.0.0.1:4173` only, so it is unreachable from the network until the reverse proxy is in place. Quick local check on the VM:

```bash
curl -fsS http://127.0.0.1:4173/api/health
```

Persistent data lives in two named volumes: `portal_data` (mounted at `/data`, holding `.portal`: database, uploads, runs, reports, logs) and `auth_data` (`/app/.auth`, browser session files). The image contains no secrets, `.env`, `.auth` files or the large demo `.mp4` videos.

## 3. HTTPS reverse proxy (Caddy)

Caddy obtains and renews certificates automatically. Install Caddy on the VM (or run it as another container) and use this `Caddyfile`:

```caddyfile
testing.your-internal-domain.example {
    encode zstd gzip
    request_body {
        max_size 2GB            # keep at or above INTAKE_MAX_MB (default 2048)
    }
    reverse_proxy 127.0.0.1:4173 {
        health_uri /api/health
        transport http {
            read_timeout 30m    # long uploads and report downloads
        }
    }
}
```

Then set `PORTAL_PUBLIC_HOST=testing.your-internal-domain.example` in `.env` and run `docker compose up -d`. For an internal-only name without public DNS, use Caddy's internal CA (`tls internal`) and distribute its root certificate to your team, or terminate TLS on your existing company proxy (nginx example: `proxy_pass http://127.0.0.1:4173; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; client_max_body_size 2048m; proxy_read_timeout 1800s; proxy_request_buffering off;`; without the Host and X-Forwarded-Proto headers every login is rejected with 403).

## 4. First administrator

On first start, when no users exist, the portal creates an administrator from `PORTAL_ADMIN_USER` and `PORTAL_ADMIN_PASSWORD`.

1. Open `https://testing.your-internal-domain.example` and sign in with those values.
2. Change the password immediately and create accounts for each team member.
3. Remove `PORTAL_ADMIN_PASSWORD` from `.env` (or replace it with a throwaway value) and run `docker compose up -d` again. It is only used for bootstrapping.

## 5. Per-project target URL and credentials

Each project (client application) is tested against its own URL and login. Do not put these in the image.

1. Sign in as an administrator and open **Settings**.
2. Add a **login profile**: name, target base URL, username, password, and tenant/facility/role fields where the application needs them.
3. Select that profile when creating a run. Saved sessions are stored per profile under the `auth_data` volume (`/app/.auth`) or the profile's own session directory.

Credentials entered in Settings are stored in the `portal_data` volume, so treat backups as sensitive. The `BASE_URL` / `AUGASTAM_*` variables remain only as a legacy default profile. Use a test environment with synthetic data; test runs create and edit records.

## 6. Network access to the target app

The browser runs inside the container, so the container's network path matters, not your laptop's.

- Confirm the VM can reach the target: `docker compose exec portal node -e "fetch(process.argv[1]).then(r=>console.log(r.status)).catch(e=>console.error(e.cause??e))" https://target.example`.
- If the target is allow-listed by IP, allow the VM's outbound IP.
- If the target is on a VPN or private network, connect the VM (not the container) to it. Containers use the host's routes through Docker NAT. Add `extra_hosts` to `docker-compose.yml` for names that only resolve through `/etc/hosts`.
- If the target uses a private certificate authority, mount the CA file and add `NODE_EXTRA_CA_CERTS` to the service environment.
- Targets that use SSO with MFA cannot be automated unattended; use a dedicated test account without MFA.

## 7. Backup, restore and upgrade

Back up while the portal is stopped so the SQLite database and WAL/SHM files are consistent.

```bash
# Backup
docker compose stop portal
docker run --rm -v augastam-test-studio_portal_data:/data -v "$PWD/backups":/backup alpine \
  tar czf /backup/portal-$(date +%F).tgz -C /data .
docker compose start portal

# Restore (into an empty or replaced volume)
docker compose stop portal
docker run --rm -v augastam-test-studio_portal_data:/data -v "$PWD/backups":/backup alpine \
  sh -c "rm -rf /data/* /data/.[!.]* ; tar xzf /backup/portal-YYYY-MM-DD.tgz -C /data && chown -R 1000:1000 /data"
docker compose start portal
```

The volume name is `<project-folder>_portal_data`; check with `docker volume ls`. UID 1000 is the image's `node` user. Back up `auth_data` the same way only if your policy allows storing session files. Schedule the backup with cron and copy archives off the VM.

Upgrade:

```bash
# take a backup first
git pull            # or copy the new project files
docker compose up -d --build
docker compose ps
```

Data volumes are kept across rebuilds; the portal migrates its database on start. To roll back, check out the previous version, rebuild, and restore the backup if the schema was migrated.

## 8. Sizing and speed

- Each worker runs one Chromium and needs about 1 GB RAM and 1 CPU. Set `PORTAL_WORKERS` to at most (vCPUs - 1) and keep total memory below 75% of RAM.
- `shm_size: 1gb` in compose prevents Chromium crashes; raise it with more workers.
- Most run time is waiting on the target application. A VM close to the target (same region/network) is faster than a bigger VM.
- Keep screenshots/traces on fast local SSD; do not place the volume on a network share.
- Reuse saved sessions (login profiles) so runs skip the login flow.
- Large intake videos: raise `INTAKE_MAX_MB` together with the proxy body limit, and ensure free disk of several times the largest upload.
- Disk grows with runs. Periodically delete old runs in the portal or prune old `runs/` folders after a backup.

## 9. Security checklist

- [ ] Reachable only through HTTPS; container port published on `127.0.0.1` only.
- [ ] Firewall allows 80/443 from the team network only, never the public internet.
- [ ] Default admin password changed; bootstrap password removed from `.env`.
- [ ] `.env` has mode 600 and is not in source control; the image build excludes it.
- [ ] `ANTHROPIC_API_KEY`, if used, is a dedicated key with a spend limit. Note that insights send run content to the provider; leave it blank if client data must not leave your network.
- [ ] Target credentials belong to dedicated test accounts on a non-production environment, with synthetic data only.
- [ ] Backups are encrypted or stored in access-controlled storage (they contain credentials and screenshots).
- [ ] Container runs as the non-root `node` user; keep Docker and the base image updated (`docker compose build --pull`).
- [ ] Individual accounts are used; no shared logins. Review users periodically.
- [ ] Disk usage and `docker compose ps` health are monitored (the health endpoint is `GET /api/health`).

## 10. Adding module adapters in Docker

The image copies `qa/modules` and `tests/modules` at build time, and the portal loads module adapters (`qa/modules/<id>/adapter.json`) only when it starts. Adding a module adapter therefore needs one of:

- **Rebuild and restart** (default): add the files to the project, then `docker compose up -d --build`. After restart, connect the module to its adapter in the portal.
- **Mount the folders as volumes** (no rebuild): add to the `portal` service in `docker-compose.yml`

  ```yaml
      volumes:
        - ./qa/modules:/app/qa/modules
        - ./tests/modules:/app/tests/modules
  ```

  Then new or edited adapter files are visible inside the container, but you must still restart the portal (`docker compose restart portal`) because adapters load at startup. Keep these mounts read-only (`:ro`) on shared servers.

The Registration ID-proof fixture `qa/modules/registration/data/agent-test-id-proof.pdf` is explicitly allowed in `.dockerignore` (other `*.pdf` files are excluded from the build context).
