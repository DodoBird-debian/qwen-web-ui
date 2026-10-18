# Native Proxmox LXC deployment

## One-command deployment and updates

For a fresh **Debian 13 LXC running systemd**, use the root-level deploy command.
The local machine needs Python 3 and OpenSSH; Node.js and npm are installed in
the guest along with Nginx. The Node 24.11.0 binary matches Dockerfile's pin and
is checked against the official SHA-256 manifest before installation; Debian's
system Node packages are left alone. Root SSH password login must already work.

If the private settings files do not exist, create them:

```sh
cp .env.example .env
cp .env.deploy.example .env.deploy
chmod 600 .env .env.deploy
```

Otherwise edit the existing files. `.env` holds global RunPod settings:

```dotenv
RUNPOD_API_KEY='your-runpod-key'
RUNPOD_ENDPOINT_URL='https://api.runpod.ai/v2/YOUR_ENDPOINT_ID'
```

`RUNPOD_ENDPOINT_ID` can replace the URL. URLs ending in `/run`, `/runsync` or
`/health` are normalized to the endpoint base; the app still uses asynchronous
`/run`. If both values are present, their endpoint IDs must agree.

`.env.deploy` holds the SSH connection:

```dotenv
LXC_HOST=192.168.2.5
LXC_PORT=22
LXC_USER=root
LXC_PASSWORD='your-lxc-password'
```

Both files are ignored by Git. Shell variables override file values. Values are
literal, single-line dotenv values; shell commands and `${...}` expansion are never
executed. Omit the password to use normal SSH key authentication. Custom locations
are supported with `--env-file` and `--ssh-env-file`.

```sh
./deploy.sh --check  # validate settings without connecting
./deploy.sh          # first installation or any later update
```

The command uploads selected source files over SSH, excluding environment files,
login credentials, private keys, archives and generated output. Inside the LXC it
installs Debian packages, runs `npm ci`, unit tests and a fresh production build,
switches the static release, validates Nginx and restarts it. `/healthz` and the
public configuration are checked without calling RunPod or submitting paid jobs.
Build failures leave the active release in place; activation/restart/health
failures restore the previous configuration and release and restart Nginx.

Open **http://192.168.2.5** (port 80) or **https://192.168.2.5** (port 443) after
a successful deployment. Both serve the app directly. Repeat the same
command after changing code or `.env`; no manual upload or restart is needed.

Automation creates a self-signed TLS certificate for `LXC_HOST`, also covering
loopback for local HTTPS checks. The certificate and private key live in
`/etc/qwen-image-studio/tls/`; the private key is mode `0600`. Redeployment reuses
the certificate unless it expires within 30 days or no longer matches the host
or key. The certificate is valid for one year. Browsers will show a trust warning
until you trust the certificate. Deployment health checks verify HTTPS using the
generated certificate as a trusted certificate, with hostname checking enabled.
The Debian default welcome site is disabled; rollback restores its prior state.

RunPod defaults go to **`/etc/qwen-image-studio/runtime.env`**, mode `0600`. The
key also lives in a root-readable Nginx map outside the web root. Only the endpoint
ID and `serverAuth: true` are added to public `config.json`. The browser connects
automatically and can leave the key empty for that exact endpoint. Other endpoints
require their own key. An entered browser key overrides the server default and
stays in tab memory. The SSH password stays local and is never uploaded, embedded
in source or placed in command arguments.

Anyone who can access the configured site can use its default endpoint. Use the
existing site authentication when sharing it. Automation
manages `server.conf`, `http.conf` and `runtime.env`; existing `site-auth.conf`
and non-secret GPU/history preferences are preserved.

Source/build workspaces remain under `/opt/qwen-image-studio/source/`; static
releases remain under `/opt/qwen-image-studio/releases/`. SSH host keys are pinned
in ignored `.deploy/known_hosts`: new hosts are accepted once, and changed host
keys stop the connection. Deployment output does not include passwords.

Offline deployment/rollback tests:

```sh
python3 -m unittest discover -s tests/packaging -p test_lxc_deploy.py -v
```

## Manual prebuilt deployment

Create an **unprivileged Debian 12 or 13** guest in Proxmox. Start with 1 vCPU,
512 MiB RAM and 2 GiB disk for a prebuilt release; no GPU passthrough or nesting.
Build on another machine so Node is unnecessary in the guest.

```sh
# Development/build machine, inside this standalone project
npm ci
npm run build
tar -czf qwen-studio-release.tar.gz dist nginx deploy/lxc
```

Copy the archive into the guest, extract it into a directory and run:

```sh
# Inside the guest, as root
sh deploy/lxc/install.sh
```

The guest needs nginx >= 1.22. The installer refuses to run on a Proxmox host.
It serves port 8080 without replacing the distribution's default port-80 site.
Inspect the script before running; it installs native nginx and CA packages.

Configuration lives in `/etc/qwen-image-studio/`. On updates, existing configuration
is preserved and new distribution files are written alongside it for review.
Non-secret UI defaults live in `/opt/qwen-image-studio/current/config.json` and
are carried forward. Re-run the installer with a new built release to update.
Nginx is validated before reload. Monitor with `systemctl status nginx` and
`journalctl -u nginx`.

The installer prints the previous release. Roll back its static files with:

```sh
ln -sfn /opt/qwen-image-studio/releases/PREVIOUS_RELEASE /opt/qwen-image-studio/current
nginx -t && systemctl reload nginx
```

Place HTTPS at an existing reverse proxy or add TLS to the guest's server config.
The proxy must accept at least 10,000,000 request bytes and preserve the
`X-RunPod-Api-Key` header. For shared access, enable the included site-auth
configuration and create a standard nginx htpasswd file. Site authentication
uses the browser's Authorization header; RunPod uses a separate header which
nginx converts to Bearer authorization upstream.

DNS is derived from `/etc/resolv.conf`. To override during installation:
`NGINX_RESOLVERS='192.168.1.1' sh deploy/lxc/install.sh`.
Update `/etc/qwen-image-studio/http.conf` if guest DNS changes afterward.

Projects, job history and results are browser-session data by default, not on LXC disk.
Enable browser storage and save projects explicitly to keep them after reload.
Download important results before closing a session or clearing browser data. API keys are never part
of these backups. The health check is `GET /healthz` and does not contact RunPod.
