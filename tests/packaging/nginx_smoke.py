"""Exercise the real nginx image against a local TLS mock; no RunPod calls."""
import hashlib
import http.client
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
IMAGE = os.environ.get('QWEN_TEST_IMAGE', 'qwen-image-studio:1.2.1')
ENV = dict(os.environ)
for key in ('DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'):
    ENV.pop(key, None)
DOCKER = ['docker', '--host=unix:///var/run/docker.sock']
suffix = str(os.getpid())
network, mock, ui = (f'qwen-test-{suffix}', f'qwen-mock-{suffix}', f'qwen-ui-{suffix}')


def docker(*args, check=True):
    result = subprocess.run([*DOCKER, *args], env=ENV, check=check, text=True, capture_output=True)
    if check and result.stderr and result.returncode:
        print(result.stderr)
    return (result.stdout + (result.stderr if args and args[0] == 'logs' else '')).strip()


def request(port, method, path, body=None, headers=None):
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=15)
    connection.request(method, path, body=body, headers=headers or {})
    response = connection.getresponse()
    result = (response.status, response.read(), dict(response.getheaders()))
    connection.close()
    return result


try:
    with tempfile.TemporaryDirectory(prefix='qwen-nginx-') as temp:
        fixture = Path(temp)
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                        '-subj', '/CN=api.runpod.ai', '-addext', 'subjectAltName=DNS:api.runpod.ai',
                        '-keyout', str(fixture / 'key.pem'), '-out', str(fixture / 'cert.pem')],
                       check=True, capture_output=True)
        (fixture / 'cert.pem').chmod(0o644)
        (fixture / 'mock.cjs').write_text('''
const https=require('node:https'),fs=require('node:fs'),crypto=require('node:crypto');
https.createServer({key:fs.readFileSync('/fixture/key.pem'),cert:fs.readFileSync('/fixture/cert.pem')},(req,res)=>{
  const buffers=[];req.on('data',chunk=>buffers.push(chunk));req.on('end',()=>{
    const body=Buffer.concat(buffers);res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({path:req.url,bytes:body.length,sha256:crypto.createHash('sha256').update(body).digest('hex'),
      bearer:req.headers.authorization==='Bearer fixture-key',leakedHeader:!!req.headers['x-runpod-api-key'],host:req.headers.host}));
  });
}).listen(8443,'0.0.0.0');
''')
        server = (ROOT / 'nginx/server.conf').read_text().replace('set $qwen_runpod_host api.runpod.ai;', 'set $qwen_runpod_host fixture:8443;').replace('/etc/ssl/certs/ca-certificates.crt', '/fixture/cert.pem')
        (fixture / 'server.conf').write_text(server)
        (fixture / 'server.conf').chmod(0o644)
        with socket.socket() as port_socket:
            port_socket.bind(('127.0.0.1', 0))
            port = port_socket.getsockname()[1]
        docker('network', 'create', network)
        docker('run', '-d', '--name', mock, '--network', network, '--network-alias', 'fixture',
               '--mount', f'type=bind,src={fixture},dst=/fixture,readonly',
               'node:24.11.0-alpine', 'node', '/fixture/mock.cjs')
        docker('run', '-d', '--name', ui, '--network', network, '--read-only', '--cap-drop', 'ALL',
               '--security-opt', 'no-new-privileges:true', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m,mode=1777',
               '-p', f'127.0.0.1:{port}:8080',
               '--mount', f'type=bind,src={fixture / "server.conf"},dst=/etc/qwen-image-studio/server.conf,readonly',
               '--mount', f'type=bind,src={fixture / "cert.pem"},dst=/fixture/cert.pem,readonly', IMAGE)
        for _ in range(40):
            try:
                if request(port, 'GET', '/healthz')[0] == 200:
                    break
            except OSError:
                time.sleep(0.1)
        else:
            raise RuntimeError('nginx did not become ready: ' + docker('logs', ui))
        status, body, headers = request(port, 'GET', '/')
        assert status == 200 and b'Qwen Image Studio' in body
        assert 'Content-Security-Policy' in headers
        # Dynamic inspector/export/ZIP chunks must be served as assets, not SPA HTML.
        for asset in sorted((ROOT / 'dist' / 'assets').iterdir()):
            code, content, asset_headers = request(port, 'GET', '/assets/' + asset.name)
            assert code == 200 and content == asset.read_bytes(), asset.name
            if asset.suffix == '.js':
                assert 'javascript' in asset_headers.get('Content-Type', ''), asset.name
        for method, path, expected in [('GET', '/api/runpod/test/run', 405),
                                        ('POST', '/api/runpod/test/health', 405),
                                        ('GET', '/api/runpod/test/purge-queue', 404),
                                        ('GET', '/api/runpod/test/health', 401)]:
            assert request(port, method, path)[0] == expected, (method, path)
        headers = {'X-RunPod-Api-Key': 'fixture-key', 'Content-Type': 'application/json'}
        baseline = b'{"input":{"prompt":"x","images":["' + b'A' * 100 + b'"]}}'
        payload = baseline.replace(b'A' * 100, b'A' * (10_000_000 - len(baseline) + 100))
        status, body, _ = request(port, 'POST', '/api/runpod/test/run', payload, headers)
        assert status == 200, (status, body[:200], docker('logs', ui))
        echo = json.loads(body)
        assert echo['bytes'] == 10_000_000 and echo['sha256'] == hashlib.sha256(payload).hexdigest()
        assert echo['path'] == '/v2/test/run' and echo['bearer'] and not echo['leakedHeader']
        assert echo['host'] == 'api.runpod.ai'
        # Send oversized Content-Length without transmitting its body. nginx rejects early.
        status, _, _ = request(port, 'POST', '/api/runpod/test/run', None,
                               {**headers, 'Content-Length': '10000001'})
        assert status == 413
        status, body, _ = request(port, 'GET', '/api/runpod/test/status/job-1', headers=headers)
        assert status == 200 and json.loads(body)['path'] == '/v2/test/status/job-1'
        subprocess.run(['node', str(ROOT / 'tests/packaging/browser_smoke.cjs'), f'http://127.0.0.1:{port}'], cwd=ROOT, check=True)
        print('PASS: nginx non-root/read-only runtime, TLS proxy, route/method allowlist, auth conversion, unchanged 10 MB body and 413 boundary.')
finally:
    for name in (ui, mock):
        docker('stop', '-t', '1', name, check=False)
        docker('rm', name, check=False)
    docker('network', 'rm', network, check=False)
