#!/bin/sh
# Uploaded by deploy.sh; stdin contains only the RunPod runtime settings JSON.
set -eu
umask 077
project_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
[ "$(id -u)" -eq 0 ] || { echo 'Run inside the LXC as root.' >&2; exit 1; }
[ -d /run/systemd/system ] || { echo 'The LXC must run systemd.' >&2; exit 1; }
if command -v pveversion >/dev/null 2>&1; then
    echo 'Refusing to deploy on the Proxmox host.' >&2; exit 1
fi
. /etc/os-release
[ "$ID" = debian ] && [ "$VERSION_ID" = 13 ] || {
    echo 'Automated deployment expects Debian 13.' >&2; exit 1;
}
settings=$(mktemp /tmp/qwen-runtime.XXXXXX)
trap 'rm -f "$settings"' EXIT HUP INT TERM
cat > "$settings"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends nginx ca-certificates openssl python3 curl xz-utils
PATH="$(sh "$project_dir/deploy/lxc/install-node.sh"):$PATH"
export PATH
cd "$project_dir"
npm ci --no-audit --no-fund
npm test
npm run build
python3 deploy/lxc/activate.py --source "$project_dir" --settings "$settings"
