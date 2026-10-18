#!/bin/sh
# Run inside an existing unprivileged Debian 13 LXC, never on the Proxmox host.
set -eu
if [ "$(id -u)" -ne 0 ]; then echo 'Run as root inside the LXC guest.' >&2; exit 1; fi
project_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
if [ ! -f "$project_dir/dist/index.html" ]; then echo 'Build first: npm ci && npm run build; or provide a release including dist/.' >&2; exit 1; fi
if [ ! -f /etc/debian_version ] || [ ! -d /run/systemd/system ]; then echo 'This installer expects a Debian guest with systemd.' >&2; exit 1; fi
if command -v pveversion >/dev/null 2>&1; then echo 'Refusing to install on a Proxmox host. Run inside the LXC guest.' >&2; exit 1; fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y nginx ca-certificates
version=$(nginx -v 2>&1 | sed 's/.*nginx\///')
major=$(printf '%s' "$version" | cut -d. -f1)
minor=$(printf '%s' "$version" | cut -d. -f2)
if [ "$major" -lt 1 ] || { [ "$major" -eq 1 ] && [ "$minor" -lt 22 ]; }; then
    echo 'Use Debian 12/13 with nginx >= 1.22. No nginx configuration was changed.' >&2
    exit 1
fi
release="$(date -u +%Y%m%dT%H%M%SZ)-$$"
install -d -m 0755 /opt/qwen-image-studio/releases /etc/qwen-image-studio
install -d -m 0755 "/opt/qwen-image-studio/releases/$release"
cp -R "$project_dir/dist/." "/opt/qwen-image-studio/releases/$release/"
chmod -R a+rX "/opt/qwen-image-studio/releases/$release"
for config in server.conf http.conf.template site-auth.conf; do
    if [ ! -f "/etc/qwen-image-studio/$config" ]; then
        install -m 0644 "$project_dir/nginx/$config" "/etc/qwen-image-studio/$config"
    else
        install -m 0644 "$project_dir/nginx/$config" "/etc/qwen-image-studio/$config.distribution"
    fi
done
resolvers="${NGINX_RESOLVERS:-$(awk '$1 == "nameserver" && $2 !~ /:/ { printf "%s ", $2 }' /etc/resolv.conf)}"
if [ -z "$resolvers" ] || printf '%s' "$resolvers" | grep -q '[^0-9. :a-zA-Z_-]'; then echo 'Set NGINX_RESOLVERS to available IPv4 DNS servers.' >&2; exit 1; fi
sed "s/__RESOLVERS__/$resolvers/" /etc/qwen-image-studio/http.conf.template > /etc/qwen-image-studio/http.conf
if [ -f /opt/qwen-image-studio/current/config.json ]; then
    cp /opt/qwen-image-studio/current/config.json "/opt/qwen-image-studio/releases/$release/config.json"
fi
previous=$(readlink /opt/qwen-image-studio/current || true)
ln -sfn "/opt/qwen-image-studio/releases/$release" /opt/qwen-image-studio/current
printf 'include /etc/qwen-image-studio/http.conf;\ninclude /etc/qwen-image-studio/server.conf;\n' > /etc/nginx/conf.d/qwen-image-studio.conf
if ! nginx -t; then
    if [ -n "$previous" ]; then ln -sfn "$previous" /opt/qwen-image-studio/current; fi
    echo 'nginx validation failed; existing service was not reloaded. Fix /etc/qwen-image-studio configuration.' >&2
    exit 1
fi
systemctl enable --now nginx
systemctl reload nginx
printf 'Installed release %s. Visit http://GUEST_IP:8080\n' "$release"
printf 'Previous release: %s\n' "${previous:-none}"
