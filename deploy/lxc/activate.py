#!/usr/bin/env python3
"""Activate a tested static release and server-only RunPod defaults, with rollback."""
import argparse
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import stat
import ssl
import subprocess
import sys
import tempfile
import time
from urllib.request import urlopen
from urllib.error import HTTPError
import uuid

from deploy import normalize_runpod, normalize_turbo

PUBLIC_FIELDS = {'gpuGiB', 'offload', 'workerOffload', 'safetyGiB', 'historyLimit'}


def atomic_write(path, content, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix='.' + path.name + '.', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as output:
            os.fchmod(output.fileno(), mode)
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def point_current(current, target):
    temporary = current.parent / ('.current-' + uuid.uuid4().hex)
    temporary.symlink_to(target)
    try:
        os.replace(temporary, current)
    finally:
        if temporary.is_symlink():
            temporary.unlink()


def resolver_list(settings, base):
    value = settings.get('NGINX_RESOLVERS', '').strip()
    if not value:
        lines = (base / 'etc/resolv.conf').read_text().splitlines()
        addresses = [line.split()[1] for line in lines
                     if line.split() and line.split()[0] == 'nameserver' and len(line.split()) > 1]
        value = ' '.join(address for address in addresses if ':' not in address)
    if not value:
        raise ValueError('Set NGINX_RESOLVERS to IPv4 DNS servers available inside the LXC.')
    for address in value.split():
        ipaddress.IPv4Address(address)
    return value


def ensure_certificate(directory, host):
    """Keep an existing matching certificate; renew within 30 days of expiry."""
    try:
        address = ipaddress.ip_address(host)
        identity = ['-checkip', str(address)]
        san = 'IP:' + str(address)
    except ValueError:
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]*', host):
            raise ValueError('Invalid certificate hostname.')
        identity = ['-checkhost', host]
        san = 'DNS:' + host
    certificate, private_key = directory / 'selfsigned.crt', directory / 'private.key'
    directory.mkdir(parents=True, exist_ok=True)
    directory.chmod(0o700)
    def openssl(*args):
        return subprocess.run(['openssl', *map(str, args)], capture_output=True, check=False)
    if certificate.is_file() and private_key.is_file():
        valid = openssl('x509', '-in', certificate, '-noout', '-checkend', '2592000', *identity)
        public = openssl('x509', '-in', certificate, '-noout', '-pubkey')
        key_public = openssl('pkey', '-in', private_key, '-pubout')
        if valid.returncode == public.returncode == key_public.returncode == 0 and public.stdout == key_public.stdout:
            private_key.chmod(0o600)
            return certificate, private_key
    with tempfile.TemporaryDirectory(prefix='.certificate-', dir=directory) as temporary:
        cert, key = Path(temporary) / 'cert.pem', Path(temporary) / 'key.pem'
        result = openssl('req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-days', '365',
                         '-subj', '/CN=' + host, '-addext', 'subjectAltName=' + san + ',IP:127.0.0.1,DNS:localhost',
                         '-addext', 'basicConstraints=critical,CA:FALSE',
                         '-addext', 'keyUsage=critical,digitalSignature,keyEncipherment',
                         '-addext', 'extendedKeyUsage=serverAuth', '-keyout', key, '-out', cert)
        if result.returncode:
            raise RuntimeError('OpenSSL could not generate the self-signed certificate.')
        atomic_write(private_key, key.read_bytes())
        atomic_write(certificate, cert.read_bytes(), 0o644)
    return certificate, private_key


def health_check(endpoint, certificate=None):
    # Loopback only. This does not call RunPod or submit inference.
    origins = [('http://127.0.0.1', {})]
    if certificate:
        origins.append(('https://127.0.0.1', {'context': ssl.create_default_context(cafile=str(certificate))}))
    for attempt in range(20):
        try:
            for origin, options in origins:
                with urlopen(origin + '/healthz', timeout=2, **options) as response:
                    if response.status != 200 or response.read().strip() != b'ok':
                        raise ValueError('Unexpected health response')
                try:
                    with urlopen(origin + '/config.json', timeout=2, **options) as response:
                        public = json.load(response)
                except HTTPError as error:
                    # Preserve existing site Basic auth; /healthz intentionally bypasses it.
                    if error.code == 401 and error.headers.get('WWW-Authenticate', '').lower().startswith('basic '):
                        continue
                    raise
                if public.get('endpointId') != endpoint or public.get('serverAuth') is not True:
                    raise ValueError('Unexpected public configuration')
            return
        except (OSError, ValueError):
            pass
        time.sleep(0.25)
    raise RuntimeError('The new site did not pass its local health/config checks.')


def activate(source, settings, base=Path('/'), run=subprocess.run, check_health=health_check):
    runpod = {**normalize_runpod(settings), **normalize_turbo(settings)}
    endpoint, key = runpod['RUNPOD_ENDPOINT_ID'], runpod['RUNPOD_API_KEY']
    dist = source / 'dist'
    if not (dist / 'index.html').is_file():
        raise ValueError('Build output is missing; the current release was not changed.')
    resolvers = resolver_list(settings, base)
    app = base / 'opt/qwen-image-studio'
    releases = app / 'releases'
    config = base / 'etc/qwen-image-studio'
    current = app / 'current'
    for directory in (app, releases, config):
        directory.mkdir(parents=True, exist_ok=True)
        directory.chmod(0o755)
    if current.exists() and not current.is_symlink():
        raise ValueError('current must be a release symlink; refusing to replace a directory.')
    previous = os.readlink(current) if current.is_symlink() else None
    release = releases / (time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + uuid.uuid4().hex[:8])
    shutil.copytree(dist, release, symlinks=True)
    for path in [release, *release.rglob('*')]:
        if path.is_symlink():
            raise ValueError('Build output must not contain symlinks.')
        path.chmod(0o755 if path.is_dir() else 0o644)
    defaults = json.loads((dist / 'config.json').read_text())
    if previous and (current / 'config.json').is_file():
        defaults.update(json.loads((current / 'config.json').read_text()))
    public = {name: value for name, value in defaults.items() if name in PUBLIC_FIELDS}
    if public.get('workerOffload') in {'none', 'text_encoder', 'model', 'sequential'}:
        public['offload'] = public['workerOffload']
    public.update({'endpointId': endpoint, 'serverAuth': True})
    if runpod.get('RUNPOD_TURBO_API_KEY'):
        models = defaults.get('models', {})
        turbo_defaults = {name: value for name, value in models.get('turbo', {}).items() if name in PUBLIC_FIELDS}
        public['models'] = {
            'base': {**public},
            'turbo': {**turbo_defaults, 'endpointId': runpod['RUNPOD_TURBO_ENDPOINT_ID'], 'serverAuth': True},
        }
    atomic_write(release / 'config.json', (json.dumps(public, indent=2) + '\n').encode(), 0o644)
    http = (source / 'nginx/http.conf.template').read_text()
    marker = '# __RUNPOD_AUTH_DEFAULT__'
    if http.count(marker) != 1:
        raise ValueError('Nginx auth template is missing its deployment marker.')
    # An empty browser key can use the server key only for this exact endpoint.
    credentials = [(endpoint, key)]
    if runpod.get('RUNPOD_TURBO_API_KEY'):
        if runpod['RUNPOD_TURBO_ENDPOINT_ID'] == endpoint:
            raise ValueError('Base and Turbo defaults must use separate endpoint IDs.')
        credentials.append((runpod['RUNPOD_TURBO_ENDPOINT_ID'], runpod['RUNPOD_TURBO_API_KEY']))
    rules = '\n    '.join(f'"~^:/api/runpod/{id}/(?:run|health|status/[A-Za-z0-9_-]+|cancel/[A-Za-z0-9_-]+)$" "{secret}";'
                          for id, secret in credentials)
    http = http.replace('__RESOLVERS__', resolvers).replace(marker, rules)
    entry = base / 'etc/nginx/conf.d/qwen-image-studio.conf'
    default_site = base / 'etc/nginx/sites-enabled/default'
    tls = config / 'tls'
    managed = [config / 'runtime.env', config / 'http.conf', config / 'server.conf',
               config / 'site-auth.conf', entry, default_site, tls / 'selfsigned.crt', tls / 'private.key']
    snapshots = {path: ('link', os.readlink(path)) if path.is_symlink() else
                 ('file', path.read_bytes(), stat.S_IMODE(path.stat().st_mode)) if path.exists() else None
                 for path in managed}
    def command(*args, check=True):
        result = run(list(args), text=True, capture_output=True, check=False)
        if check and result.returncode:
            diagnostic = result.stderr or result.stdout or ''
            for _, secret in credentials:
                diagnostic = diagnostic.replace(secret, '[redacted]')
            diagnostic = diagnostic.strip()
            raise RuntimeError(f'{args[0]} failed: {diagnostic}')
        return result
    try:
        host = settings.get('LXC_HOST', 'localhost')
        certificate, private_key = ensure_certificate(tls, host)
        runtime = {**runpod, 'NGINX_RESOLVERS': resolvers, 'LXC_HOST': host}
        atomic_write(config / 'runtime.env', ''.join(f"{name}='{value}'\n" for name, value in runtime.items()).encode())
        atomic_write(config / 'http.conf', http.encode())
        atomic_write(config / 'server.conf', (source / 'nginx/server.conf').read_bytes(), 0o644)
        if not (config / 'site-auth.conf').exists():
            atomic_write(config / 'site-auth.conf', (source / 'nginx/site-auth.conf').read_bytes(), 0o644)
        # Keep the native LXC and container configurations on the same source template.
        server = (config / 'server.conf').read_text().replace('/etc/qwen-image-studio/', str(config) + '/')
        server = server.replace('/opt/qwen-image-studio/current', str(current))
        server = server.replace('    listen 8080;',
                                '    listen 80 default_server;\n'
                                '    listen 443 ssl default_server;\n'
                                f'    ssl_certificate {certificate};\n'
                                f'    ssl_certificate_key {private_key};\n'
                                '    ssl_protocols TLSv1.2 TLSv1.3;\n'
                                '    ssl_session_cache shared:QwenTLS:10m;\n'
                                '    ssl_session_tickets off;')
        atomic_write(config / 'server.conf', server.encode(), 0o644)
        atomic_write(entry, f'include {config}/http.conf;\ninclude {config}/server.conf;\n'.encode(), 0o644)
        default_site.unlink(missing_ok=True)
        point_current(current, release)
        command('nginx', '-t')
        command('systemctl', 'enable', 'nginx')
        command('systemctl', 'restart', 'nginx')
        check_health(endpoint, certificate)
    except Exception:
        for path, snapshot in snapshots.items():
            if snapshot is None:
                path.unlink(missing_ok=True)
            elif snapshot[0] == 'link':
                point_current(path, snapshot[1])
            else:
                atomic_write(path, snapshot[1], snapshot[2])
        if previous is None:
            current.unlink(missing_ok=True)
        else:
            point_current(current, previous)
        command('nginx', '-t', check=False)
        command('systemctl', 'restart', 'nginx', check=False)
        print('Activation failed; previous release and configuration restored.', file=sys.stderr)
        raise
    print(f'Activated {release.name}; Nginx restarted; local health checks passed.')
    print(f'Previous release: {previous or "none"}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--settings', required=True, type=Path)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise ValueError('Activation must run inside the LXC as root.')
    activate(args.source, json.loads(args.settings.read_text()))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, RuntimeError) as error:
        print(f'Activation failed: {error}', file=sys.stderr)
        sys.exit(1)
