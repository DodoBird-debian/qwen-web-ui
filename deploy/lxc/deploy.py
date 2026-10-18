#!/usr/bin/env python3
"""Upload source over SSH and build/activate it on a Debian LXC."""
import argparse
import fnmatch
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from urllib.parse import urlsplit
import uuid

ROOT = Path(__file__).resolve().parents[2]
ROOT_FILES = (
    'package.json', 'package-lock.json', 'index.html', 'tsconfig.json',
    'vite.config.ts', 'vitest.config.ts', 'playwright.config.ts',
    'README.md', 'CHANGELOG.md', 'PLAN.md', 'Dockerfile', 'compose.yaml',
    '.gitignore', '.dockerignore', 'deploy.sh',
)
SOURCE_DIRS = ('src', 'public', 'nginx', 'deploy/lxc', 'tests', 'docs')
SKIP_DIRS = {'.git', '.aws', '.ssh', '.agents', '.codex', '.deploy', 'secrets',
             'credentials', 'node_modules', 'dist', '.cache', '.vite', '__pycache__',
             'test-results', 'playwright-report', 'blob-report', 'coverage'}
SKIP_NAMES = ('.env*', '*.local', '*.local.*', '*.pem', '*.key', '*.p12', '*.pfx',
              '*.jks', '*.keystore', '*htpasswd*', '.npmrc', '.netrc',
              '.git-credentials', '.pypirc', '*.log', '*.swp', '*.swo', '*~',
              '*.pyc', '*.pyo', '*.tsbuildinfo', '.DS_Store', 'Thumbs.db')


def read_env(path):
    """Read literal dotenv values without executing shell commands or expansions."""
    values = {}
    if not path.is_file():
        return values
    for number, raw in enumerate(path.read_text().splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        match = re.fullmatch(r'(?:export\s+)?([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.*)', line)
        if not match:
            raise ValueError(f'{path.name}:{number}: expected NAME=value')
        name, value = match.groups()
        if value.startswith(('"', "'")):
            quote = value[0]
            end = value.find(quote, 1)
            if end < 0 or (value[end + 1:].strip() and not value[end + 1:].strip().startswith('#')):
                raise ValueError(f'{path.name}:{number}: use a single-line quoted value')
            value = value[1:end]
        else:
            value = re.split(r'\s+#', value, maxsplit=1)[0].rstrip()
        values[name] = value
    return values


def normalize_runpod(values):
    key = values.get('RUNPOD_API_KEY', '').strip()
    if not key:
        raise ValueError('Set RUNPOD_API_KEY in .env before deploying.')
    # Restrict interpolation into Nginx and the remote dotenv file to token characters.
    if not re.fullmatch(r'[A-Za-z0-9_.-]+', key):
        raise ValueError('RUNPOD_API_KEY contains unsupported characters.')
    endpoint = values.get('RUNPOD_ENDPOINT_ID', '').strip()
    url = values.get('RUNPOD_ENDPOINT_URL', '').strip()
    if url:
        parsed = urlsplit(url)
        if parsed.scheme != 'https' or parsed.netloc != 'api.runpod.ai' or parsed.query or parsed.fragment:
            raise ValueError('RUNPOD_ENDPOINT_URL must be an HTTPS api.runpod.ai/v2/ endpoint URL.')
        match = re.fullmatch(r'/v2/([A-Za-z0-9_-]+)(?:/(?:run|runsync|health))?/?', parsed.path)
        if not match:
            raise ValueError('RUNPOD_ENDPOINT_URL must contain /v2/ENDPOINT_ID.')
        if endpoint and endpoint != match[1]:
            raise ValueError('RUNPOD_ENDPOINT_ID and RUNPOD_ENDPOINT_URL disagree.')
        endpoint = match[1]
    if not re.fullmatch(r'[A-Za-z0-9_-]+', endpoint):
        raise ValueError('Set RUNPOD_ENDPOINT_URL or RUNPOD_ENDPOINT_ID in .env.')
    return {'RUNPOD_API_KEY': key, 'RUNPOD_ENDPOINT_ID': endpoint,
            'RUNPOD_ENDPOINT_URL': f'https://api.runpod.ai/v2/{endpoint}'}


def source_paths(root=ROOT):
    paths = [root / name for name in ROOT_FILES if (root / name).is_file()]
    for directory in SOURCE_DIRS:
        paths.extend(p for p in (root / directory).rglob('*') if p.is_file())
    for path in sorted(set(paths)):
        relative = path.relative_to(root)
        if any(part in SKIP_DIRS for part in relative.parts):
            continue
        if any(fnmatch.fnmatch(path.name, pattern) for pattern in SKIP_NAMES):
            continue
        if path.is_symlink() or any(parent.is_symlink() for parent in path.parents if parent != root):
            raise ValueError(f'Symlinks cannot be deployed: {relative}')
        yield path


def make_archive(target, root=ROOT):
    with tarfile.open(target, 'w:gz') as archive:
        for path in source_paths(root):
            archive.add(path, arcname=str(path.relative_to(root)), recursive=False)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', type=Path, default=ROOT / '.env', help='RunPod defaults (default: project .env)')
    parser.add_argument('--ssh-env-file', type=Path, default=ROOT / '.env.deploy', help='LXC login (default: project .env.deploy)')
    parser.add_argument('--check', action='store_true', help='validate settings and list the deployment plan without connecting')
    args = parser.parse_args(argv)
    values = {**read_env(args.env_file), **read_env(args.ssh_env_file), **os.environ}
    runpod = normalize_runpod(values)
    host = values.get('LXC_HOST', '')
    user = values.get('LXC_USER', 'root')
    port = values.get('LXC_PORT', '22')
    password = values.get('LXC_PASSWORD', '')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]*', host):
        raise ValueError('Set a valid LXC_HOST in .env.deploy.')
    if user != 'root':
        raise ValueError('The fresh Debian installer requires LXC_USER=root.')
    if not port.isdigit() or not 1 <= int(port) <= 65535:
        raise ValueError('LXC_PORT must be between 1 and 65535.')
    resolvers = values.get('NGINX_RESOLVERS', '').strip()
    if resolvers and not re.fullmatch(r'[0-9. :A-Za-z_-]+', resolvers):
        raise ValueError('NGINX_RESOLVERS contains unsupported characters.')
    settings = {**runpod, 'NGINX_RESOLVERS': resolvers, 'LXC_HOST': host}
    count = len(list(source_paths()))
    print(f'Target: {user}@{host}:{port}; RunPod endpoint: {runpod["RUNPOD_ENDPOINT_ID"]}', flush=True)
    print(f'Upload {count} source files; install build tools and Nginx; run npm ci, tests and build; activate and restart.', flush=True)
    if args.check:
        print('Configuration valid. No connection made; credential values are hidden.')
        return 0
    if not shutil.which('ssh'):
        raise ValueError('Install the OpenSSH client on this machine.')
    state = ROOT / '.deploy'
    state.mkdir(mode=0o700, exist_ok=True)
    os.chmod(state, 0o700)
    release = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + uuid.uuid4().hex[:8]
    remote = '/opt/qwen-image-studio/source/' + release
    with tempfile.TemporaryDirectory(prefix='qwen-deploy-') as temporary:
        temp = Path(temporary)
        env = dict(os.environ)
        # Credentials are sent only in the SSH prompt or encrypted stdin, never argv.
        for name in ('RUNPOD_API_KEY', 'LXC_PASSWORD'):
            env.pop(name, None)
        if password:
            password_file = temp / 'password'
            password_file.write_text(password + '\n')
            password_file.chmod(0o600)
            askpass = temp / 'askpass'
            askpass.write_text('#!/bin/sh\nexec cat "$QWEN_DEPLOY_PASSWORD_FILE"\n')
            askpass.chmod(0o700)
            env.update({'SSH_ASKPASS': str(askpass), 'SSH_ASKPASS_REQUIRE': 'force',
                        'DISPLAY': ':qwen-deploy', 'QWEN_DEPLOY_PASSWORD_FILE': str(password_file)})
        ssh = ['ssh', '-p', port, '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15',
               '-o', 'ServerAliveCountMax=3', '-o', 'StrictHostKeyChecking=accept-new',
               '-o', f'UserKnownHostsFile={state / "known_hosts"}',
               '-o', 'ControlMaster=auto', '-o', 'ControlPersist=60',
               '-o', f'ControlPath={temp / "control"}', '-o', 'NumberOfPasswordPrompts=1']
        if password:
            ssh += ['-o', 'PreferredAuthentications=password,keyboard-interactive']
        ssh.append(f'{user}@{host}')
        archive = temp / 'source.tar.gz'
        make_archive(archive)
        try:
            upload = f'umask 077; mkdir -p {shlex.quote(remote)} && tar -xzf - -C {shlex.quote(remote)}'
            with archive.open('rb') as source:
                subprocess.run(ssh + [upload], stdin=source, env=env, check=True)
            command = f'sh {shlex.quote(remote + "/deploy/lxc/remote-deploy.sh")}'
            subprocess.run(ssh + [command], input=json.dumps(settings).encode(), env=env, check=True)
        finally:
            subprocess.run(ssh[:-1] + ['-O', 'exit', ssh[-1]], stdin=subprocess.DEVNULL,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env, check=False)
    print(f'Deployed successfully: http://{host} and https://{host} (self-signed certificate)')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError) as error:
        print(f'Deployment failed: {error}', file=sys.stderr)
        sys.exit(1)
    except subprocess.CalledProcessError as error:
        print(f'Deployment command failed (exit {error.returncode}); see the command output above.', file=sys.stderr)
        sys.exit(1)
