#!/bin/sh
# Match Dockerfile's build runtime without changing Debian's system Node packages.
set -eu
version=24.11.0
case "$(uname -m)" in
    x86_64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) echo 'The build runtime supports x86_64 and arm64 LXC guests.' >&2; exit 1 ;;
esac
name="node-v$version-linux-$arch"
cache="${QWEN_NODE_CACHE:-/opt/qwen-image-studio/build-tools}"
node_dir="$cache/$name"
if [ ! -d "$node_dir" ]; then
    temporary=$(mktemp -d /tmp/qwen-node.XXXXXX)
    trap 'rm -rf "$temporary"' EXIT HUP INT TERM
    archive="$name.tar.xz"
    base="https://nodejs.org/dist/v$version"
    curl --fail --location --retry 2 --connect-timeout 15 --max-time 300 \
        --output "$temporary/$archive" "$base/$archive"
    curl --fail --location --retry 2 --connect-timeout 15 --max-time 60 \
        --output "$temporary/SHASUMS256.txt" "$base/SHASUMS256.txt"
    awk -v wanted="$archive" '$2 == wanted { print; matches++ } END { if (matches != 1) exit 1 }' \
        "$temporary/SHASUMS256.txt" > "$temporary/checksum"
    (cd "$temporary" && sha256sum --check --status checksum)
    tar -xJf "$temporary/$archive" -C "$temporary"
    mkdir -p "$cache"
    mv "$temporary/$name" "$node_dir"
fi
if [ ! -x "$node_dir/bin/node" ] || [ "$("$node_dir/bin/node" --version)" != "v$version" ]; then
    echo 'The cached Node runtime is invalid; inspect the build-tools directory.' >&2
    exit 1
fi
printf '%s/bin\n' "$node_dir"
