# Tailscale aliases via Caddy

Serve admin / VoltMem (and a third app) as **separate hostnames on port 80** so you never type `:8787` / `:8080`.

| Alias (example) | Backend | Open |
|-----------------|---------|------|
| `admin.hsv` | `127.0.0.1:8787` | `http://admin.hsv` |
| `mem.hsv` | `127.0.0.1:8080` | `http://mem.hsv/ui/` |
| `third.hsv` | `127.0.0.1:<port>` | `http://third.hsv` |

Example config: [`Caddyfile.example`](./Caddyfile.example).

DNS/hostnames do **not** carry ports. Caddy listens on **:80** and routes by `Host`. Extra names must resolve to the ThinkPad’s **Tailscale IP** (MagicDNS alone only gives you `hsv`).

Keep this Tailscale-only — do not port-forward `:80` on the public router.

---

## 1. Backends on loopback (ThinkPad)

Prefer backends on `127.0.0.1` so only Caddy is public-to-the-tailnet:

```bash
# community.env — omit ADMIN_HOST or set loopback (Caddy will proxy)
# ADMIN_HOST=127.0.0.1

sudo systemctl restart relay-community-admin.service   # your unit name
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/
curl -sS http://127.0.0.1:8080/health
```

VoltMem can stay published as `127.0.0.1:8080:8080` in compose (stricter) or `8080:8080` — Caddy still proxies to `127.0.0.1:8080`.

---

## 2. Install Caddy (ThinkPad)

Ubuntu / Debian:

```bash
sudo apt update
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
caddy version
```

Or follow [Caddy install docs](https://caddyserver.com/docs/install) if the apt recipe changes.

---

## 3. Install Caddyfile

```bash
# From your app tree (adjust path)
sudo cp /opt/relay-os/app/deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile
# - Confirm admin.hsv → :8787 and mem.hsv → :8080
# - Uncomment/edit third.hsv + CHANGE_ME_PORT if you have a third service
# - Rename hosts if you prefer (must match laptop /etc/hosts below)
```

Validate and start:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl enable --now caddy
sudo systemctl status caddy --no-pager
ss -ltnp | grep ':80 '
```

Reload after edits:

```bash
sudo caddy reload --config /etc/caddy/Caddyfile
# or: sudo systemctl reload caddy
```

---

## 4. Point aliases at the ThinkPad (laptop)

On the **ThinkPad**:

```bash
tailscale ip -4
# e.g. 100.x.y.z
```

On the **laptop** `/etc/hosts` (macOS / Linux — needs sudo):

```text
100.x.y.z  admin.hsv mem.hsv third.hsv
```

Replace `100.x.y.z` with the ThinkPad Tailscale IP. Keep or drop `third.hsv` to match the Caddyfile.

Flush DNS if needed:

```bash
# macOS
sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder
```

Optional shell helpers:

```bash
# ~/.zshrc
alias hsv-admin='open http://admin.hsv'
alias hsv-mem='open http://mem.hsv/ui/'
```

---

## 5. Verify

From the **laptop** (on Tailscale):

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Host: admin.hsv' http://admin.hsv/
curl -sS -H 'Host: mem.hsv' http://mem.hsv/health
# browser:
#   http://admin.hsv
#   http://mem.hsv/ui/
```

From the ThinkPad (local):

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Host: admin.hsv' http://127.0.0.1/
```

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| `admin.hsv` does not resolve | Laptop `/etc/hosts` IP matches `tailscale ip -4` on ThinkPad |
| Connection refused on `:80` | `systemctl status caddy`; `ss -ltnp \| grep ':80 '` |
| Wrong site / blank | `Host` name in browser must match a site block in the Caddyfile |
| Admin still only on `:8787` | Expected until Caddy is up; `ADMIN_HOST=0.0.0.0` is optional once Caddy proxies |
| VoltMem `/ui` assets 404 | Open `http://mem.hsv/ui/` (with trailing path); proxy is to the whole `:8080` app |
| Port 80 busy | Another service owns `:80` — stop it or change Caddy’s listen (harder on clients) |

---

## HTTPS with `tls internal` (no public domain)

Public Let’s Encrypt cannot certify `*.hsv`. For padlock URLs on Tailscale, use Caddy’s **internal CA**.

### 1. ThinkPad — Caddyfile

Replace the `http://…` sites (and remove `auto_https off` if you like — optional with `tls internal`) with:

```caddy
reddit-relay.hsv {
	tls internal
	reverse_proxy 127.0.0.1:8787
}

voltmem.hsv {
	tls internal
	reverse_proxy 127.0.0.1:8080
}

beszel.hsv {
	tls internal
	reverse_proxy 127.0.0.1:8090
}
```

Do **not** keep a default `:80 { file_server }` welcome block. Do **not** put `bind 0.0.0.0` on every site.

```bash
sudo nano /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl restart caddy
ss -ltnp | grep -E ':80 |:443 '
```

### 2. Laptop — same `/etc/hosts` as before

```text
100.123.154.59  reddit-relay.hsv voltmem.hsv beszel.hsv
```

(Use your ThinkPad Tailscale IP.)

### 3. Open HTTPS URLs

- `https://reddit-relay.hsv`
- `https://voltmem.hsv/ui/`
- `https://beszel.hsv`

First visit: browser warns (untrusted local CA). Either proceed once, or trust Caddy’s root (below).

### 4. Trust Caddy’s local CA (optional, kills the warning)

On the **ThinkPad**, find the root cert (path varies by install; common locations):

```bash
sudo ls /var/lib/caddy/.local/share/caddy/pki/authorities/local/
# look for root.crt
```

Copy `root.crt` to the laptop, then:

**macOS**

```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain /path/to/root.crt
```

**Linux (Debian/Ubuntu)**

```bash
sudo cp root.crt /usr/local/share/ca-certificates/caddy-local.crt
sudo update-ca-certificates
```

Restart the browser after trusting.

### 5. Beszel `APP_URL` (if using HTTPS)

In `/opt/beszel/docker-compose.yml` prefer:

```yaml
APP_URL: https://beszel.hsv
HUB_URL: https://beszel.hsv
```

Then `docker compose up -d` in that directory so redirects match the alias.

### Verify

```bash
# ThinkPad
curl -k -sI https://127.0.0.1/ -H 'Host: reddit-relay.hsv' | head -5

# Laptop (after hosts)
curl -k -sI https://reddit-relay.hsv | head -5
# drop -k once the CA is trusted
```

---

## Optional: keep direct `:8787` / `:8080`

Not required. With Caddy you can leave admin on `127.0.0.1` only and VoltMem on loopback. Direct `http://hsv:8787` only works if that process still binds `0.0.0.0`.
