#!/bin/sh
# Run from any directory; Python and OpenSSH are the only local dependencies.
set -eu
project_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
exec python3 "$project_dir/deploy/lxc/deploy.py" "$@"
