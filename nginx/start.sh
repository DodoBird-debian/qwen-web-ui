#!/bin/sh
set -eu
mkdir -p /tmp/qwen/client_body /tmp/qwen/proxy
resolvers="${NGINX_RESOLVERS:-$(awk '$1 == "nameserver" && $2 !~ /:/ { printf "%s ", $2 }' /etc/resolv.conf)}"
if [ -z "$resolvers" ] || printf '%s' "$resolvers" | grep -q '[^0-9. :a-zA-Z_-]'; then
    echo 'Set NGINX_RESOLVERS to IPv4 DNS servers available to this container.' >&2
    exit 1
fi
sed "s/__RESOLVERS__/$resolvers/" /etc/qwen-image-studio/http.conf.template > /tmp/qwen/http.conf
nginx -t
exec nginx -g 'daemon off;'
