"""Offline tests for credential transport, release activation and rollback."""
import contextlib
import hashlib
import io
import json
import os
import platform
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'deploy/lxc'))
import deploy as deployment
import activate

DUMMY_KEY = 'rpa_fixture_only_not_a_real_key'
SETTINGS = {'RUNPOD_API_KEY': DUMMY_KEY, 'RUNPOD_ENDPOINT_URL': 'https://api.runpod.ai/v2/fixture/run',
            'LXC_HOST': '192.168.2.5'}


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='qwen-deploy-test-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)

    def fixture(self):
        source = self.base / 'source'
        source.mkdir()
        shutil.copytree(ROOT / 'nginx', source / 'nginx')
        (source / 'dist').mkdir()
        (source / 'dist/index.html').write_text('<h1>new release</h1>')
        (source / 'dist/config.json').write_text(json.dumps({'gpuGiB': 80, 'apiKey': 'discard-this-field'}))
        host = self.base / 'host'
        (host / 'etc').mkdir(parents=True)
        (host / 'etc/resolv.conf').write_text('nameserver 192.168.2.1\nnameserver 2001:db8::1\n')
        return source, host

    def activate(self, source, host, run=None, health=None):
        success = lambda *args, **kwargs: subprocess.CompletedProcess(args[0], 0, '', '')
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return activate.activate(source, SETTINGS, base=host, run=run or success,
                                     check_health=health or (lambda endpoint, certificate=None: None))

    def test_dotenv_preserves_password_punctuation_without_shell_execution(self):
        env = self.base / 'settings'
        env.write_text("export LXC_PASSWORD='fixture@? # $()'\nRUNPOD_API_KEY=fixture-key # comment\nEMPTY=\n")
        values = deployment.read_env(env)
        self.assertEqual(values['LXC_PASSWORD'], 'fixture@? # $()')
        self.assertEqual(values['RUNPOD_API_KEY'], 'fixture-key')
        self.assertEqual(values['EMPTY'], '')
        env.write_text('invalid config line')
        with self.assertRaises(ValueError):
            deployment.read_env(env)

    def test_endpoint_normalization_and_injection_rejection(self):
        self.assertEqual(deployment.normalize_runpod(SETTINGS)['RUNPOD_ENDPOINT_ID'], 'fixture')
        self.assertEqual(deployment.normalize_runpod({**SETTINGS, 'RUNPOD_ENDPOINT_ID': 'fixture'})['RUNPOD_ENDPOINT_URL'],
                         'https://api.runpod.ai/v2/fixture')
        for url in ['http://api.runpod.ai/v2/fixture', 'https://api.runpod.ai.evil.test/v2/fixture',
                    'https://user:password@api.runpod.ai/v2/fixture', 'https://api.runpod.ai/v2/fixture?key=secret',
                    'https://api.runpod.ai/v2/fixture/../../other']:
            with self.assertRaises(ValueError):
                deployment.normalize_runpod({**SETTINGS, 'RUNPOD_ENDPOINT_URL': url})
        with self.assertRaises(ValueError):
            deployment.normalize_runpod({**SETTINGS, 'RUNPOD_ENDPOINT_ID': 'different'})
        with self.assertRaises(ValueError):
            deployment.normalize_runpod({**SETTINGS, 'RUNPOD_API_KEY': 'unsafe";'} )

    def test_source_upload_excludes_secrets_builds_and_credentials(self):
        root = self.base / 'project'
        for name in ['package.json', '.env', '.env.deploy', '.env.example', '.deploy/known_hosts',
                     'qwen-image-studio.tar.gz', 'dist/index.html', 'src/app.ts', 'src/.env',
                     'src/node_modules/vendor.js', 'nginx/site-auth.conf', 'nginx/htpasswd',
                     'nginx/private.pem', 'nginx/site-auth.local.conf', 'tests/fixtures/input.json']:
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('fixture')
        archive = self.base / 'upload.tar.gz'
        deployment.make_archive(archive, root)
        with tarfile.open(archive) as stream:
            self.assertEqual(set(stream.getnames()), {'package.json', 'src/app.ts',
                                                     'nginx/site-auth.conf', 'tests/fixtures/input.json'})
        (root / 'src/external.ts').symlink_to(self.base / 'outside')
        (self.base / 'outside').write_text('private fixture')
        with self.assertRaises(ValueError):
            list(deployment.source_paths(root))

    def test_activation_keeps_key_out_of_public_files_and_preserves_site_auth(self):
        source, host = self.fixture()
        config = host / 'etc/qwen-image-studio'
        config.mkdir()
        (config / 'site-auth.conf').write_text('# existing operator config\n')
        calls = []
        def run(command, **kwargs):
            calls.append(command)
            return subprocess.CompletedProcess(command, 0, '', '')
        self.activate(source, host, run)
        current = host / 'opt/qwen-image-studio/current'
        public = json.loads((current / 'config.json').read_text())
        self.assertEqual(public, {'endpointId': 'fixture', 'serverAuth': True, 'gpuGiB': 80})
        for path in current.rglob('*'):
            if path.is_file():
                self.assertNotIn(DUMMY_KEY.encode(), path.read_bytes())
        self.assertIn(DUMMY_KEY, (config / 'runtime.env').read_text())
        http = (config / 'http.conf').read_text()
        self.assertIn('~^:/api/runpod/fixture/', http)
        self.assertIn('default $http_x_runpod_api_key;', http)
        self.assertNotIn('__RESOLVERS__', http)
        self.assertIn('192.168.2.1', http)
        self.assertNotIn('2001:db8', http)
        for name in ['runtime.env', 'http.conf']:
            self.assertEqual(stat.S_IMODE((config / name).stat().st_mode), 0o600)
        self.assertEqual((config / 'site-auth.conf').read_text(), '# existing operator config\n')
        self.assertEqual(stat.S_IMODE(current.resolve().stat().st_mode), 0o755)
        self.assertIn(['systemctl', 'restart', 'nginx'], calls)
        server = (config / 'server.conf').read_text()
        self.assertIn('listen 80 default_server;', server)
        self.assertIn('listen 443 ssl default_server;', server)
        self.assertNotIn('listen 8080;', server)
        self.assertIn('ssl_certificate_key', server)

    def test_failed_nginx_validation_restores_previous_release_and_redacts_key(self):
        source, host = self.fixture()
        self.activate(source, host)
        current = host / 'opt/qwen-image-studio/current'
        previous = os.readlink(current)
        config = host / 'etc/qwen-image-studio'
        snapshots = {p: p.read_bytes() for p in config.rglob('*') if p.is_file()}
        calls = []
        def fail_once(command, **kwargs):
            calls.append(command)
            if len(calls) == 1:
                return subprocess.CompletedProcess(command, 1, '', 'bad config ' + DUMMY_KEY)
            return subprocess.CompletedProcess(command, 0, '', '')
        with self.assertRaises(RuntimeError) as error:
            self.activate(source, host, fail_once)
        self.assertNotIn(DUMMY_KEY, str(error.exception))
        self.assertIn('[redacted]', str(error.exception))
        self.assertEqual(os.readlink(current), previous)
        for path, content in snapshots.items():
            self.assertEqual(path.read_bytes(), content)
        self.assertIn(['systemctl', 'restart', 'nginx'], calls)

    def test_new_worker_offload_survives_preserved_legacy_profile_on_redeployment(self):
        source, host = self.fixture()
        self.activate(source, host)
        current = host / 'opt/qwen-image-studio/current'
        legacy = json.loads((current / 'config.json').read_text())
        legacy.update({'offload': 'text_encoder', 'gpuGiB': 24, 'safetyGiB': 2})
        (current / 'config.json').write_text(json.dumps(legacy))
        (source / 'dist/config.json').write_text(json.dumps({
            'gpuGiB': 80, 'offload': 'model', 'workerOffload': 'model', 'safetyGiB': 3,
        }))
        self.activate(source, host)
        public = json.loads((current / 'config.json').read_text())
        self.assertEqual(public['workerOffload'], 'model')
        self.assertEqual(public['offload'], 'model')
        self.assertEqual(public['gpuGiB'], 24)
        self.assertEqual(public['safetyGiB'], 2)

    def test_failed_first_health_check_removes_new_configuration(self):
        source, host = self.fixture()
        def unhealthy(endpoint, certificate=None):
            raise RuntimeError('fixture health failure')
        with self.assertRaisesRegex(RuntimeError, 'fixture health failure'):
            self.activate(source, host, health=unhealthy)
        self.assertFalse((host / 'opt/qwen-image-studio/current').is_symlink())
        self.assertFalse((host / 'etc/qwen-image-studio/runtime.env').exists())
        self.assertFalse((host / 'etc/nginx/conf.d/qwen-image-studio.conf').exists())

    def test_failed_restart_restores_previous_release_and_restarts_it(self):
        source, host = self.fixture()
        self.activate(source, host)
        current = host / 'opt/qwen-image-studio/current'
        previous = os.readlink(current)
        restarts = []
        def run(command, **kwargs):
            if command == ['systemctl', 'restart', 'nginx']:
                restarts.append(command)
                if len(restarts) == 1:
                    return subprocess.CompletedProcess(command, 1, '', 'fixture restart failure')
            return subprocess.CompletedProcess(command, 0, '', '')
        with self.assertRaisesRegex(RuntimeError, 'fixture restart failure'):
            self.activate(source, host, run)
        self.assertEqual(os.readlink(current), previous)
        self.assertEqual(len(restarts), 2)

    def test_ssh_upload_sends_runpod_over_stdin_without_login_password(self):
        env_file = self.base / 'runpod.env'
        env_file.write_text('RUNPOD_API_KEY=' + DUMMY_KEY + '\nRUNPOD_ENDPOINT_ID=fixture\n')
        ssh_file = self.base / 'ssh.env'
        ssh_file.write_text('LXC_HOST=192.168.2.5\nLXC_PASSWORD=fixture-login-password\n')
        calls = []
        def run(command, **kwargs):
            calls.append(command)
            self.assertNotIn(DUMMY_KEY, ' '.join(command))
            self.assertNotIn('fixture-login-password', ' '.join(command))
            self.assertNotIn('LXC_PASSWORD', kwargs['env'])
            self.assertNotIn('RUNPOD_API_KEY', kwargs['env'])
            if len(calls) == 1:
                with tarfile.open(fileobj=kwargs['stdin'], mode='r:gz') as archive:
                    self.assertNotIn('.env', archive.getnames())
                    self.assertNotIn('.env.deploy', archive.getnames())
                password_path = Path(kwargs['env']['QWEN_DEPLOY_PASSWORD_FILE'])
                self.assertEqual(password_path.read_text(), 'fixture-login-password\n')
                self.assertEqual(stat.S_IMODE(password_path.stat().st_mode), 0o600)
            elif len(calls) == 2:
                payload = json.loads(kwargs['input'])
                self.assertEqual(payload['RUNPOD_API_KEY'], DUMMY_KEY)
                self.assertNotIn('LXC_PASSWORD', payload)
            return subprocess.CompletedProcess(command, 0, '', '')
        with patch.object(deployment, 'ROOT', self.base), patch.object(deployment.subprocess, 'run', run), \
                patch.dict(os.environ, {}, clear=True), contextlib.redirect_stdout(io.StringIO()):
            deployment.main(['--env-file', str(env_file), '--ssh-env-file', str(ssh_file)])
        self.assertEqual(len(calls), 3)

    def test_check_mode_makes_no_ssh_connection_and_hides_values(self):
        env = self.base / 'runpod.env'
        env.write_text("RUNPOD_API_KEY='" + DUMMY_KEY + "'\nRUNPOD_ENDPOINT_ID=fixture\n")
        login = self.base / 'ssh.env'
        login.write_text('LXC_HOST=192.168.2.5\nLXC_PASSWORD=fixture-password\n')
        clean = {k: v for k, v in os.environ.items() if not k.startswith(('RUNPOD_', 'LXC_'))}
        result = subprocess.run([sys.executable, str(ROOT / 'deploy/lxc/deploy.py'), '--check',
                                 '--env-file', str(env), '--ssh-env-file', str(login)],
                                env=clean, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('No connection made', result.stdout)
        self.assertNotIn(DUMMY_KEY, result.stdout + result.stderr)
        self.assertNotIn('fixture-password', result.stdout + result.stderr)

    def test_health_check_supports_existing_site_basic_auth(self):
        class Healthy(io.BytesIO):
            status = 200
        responses = [Healthy(b'ok\n'), HTTPError('http://127.0.0.1/config.json', 401,
                     'Unauthorized', {'WWW-Authenticate': 'Basic realm="fixture"'}, None)]
        with patch.object(activate, 'urlopen', side_effect=responses) as request:
            activate.health_check('fixture')
        self.assertEqual(request.call_count, 2)

    def test_certificate_covers_lxc_ip_and_is_reused_on_redeployment(self):
        cert, key = activate.ensure_certificate(self.base / 'tls', '192.168.2.5')
        original = cert.read_bytes(), key.read_bytes()
        for address in ['192.168.2.5', '127.0.0.1']:
            checked = subprocess.run(['openssl', 'x509', '-in', str(cert), '-noout', '-checkip', address],
                                     capture_output=True)
            self.assertEqual(checked.returncode, 0)
        activate.ensure_certificate(self.base / 'tls', '192.168.2.5')
        self.assertEqual((cert.read_bytes(), key.read_bytes()), original)
        self.assertEqual(stat.S_IMODE(key.stat().st_mode), 0o600)

    def test_tls_health_check_verifies_certificate_and_checks_both_ports(self):
        cert, _ = activate.ensure_certificate(self.base / 'tls', '192.168.2.5')
        class Healthy(io.BytesIO):
            status = 200
        config = json.dumps({'endpointId': 'fixture', 'serverAuth': True}).encode()
        responses = [Healthy(b'ok\n'), Healthy(config), Healthy(b'ok\n'), Healthy(config)]
        with patch.object(activate, 'urlopen', side_effect=responses) as request:
            activate.health_check('fixture', cert)
        self.assertEqual([call.args[0] for call in request.call_args_list], [
            'http://127.0.0.1/healthz', 'http://127.0.0.1/config.json',
            'https://127.0.0.1/healthz', 'https://127.0.0.1/config.json'])
        context = request.call_args_list[2].kwargs['context']
        self.assertTrue(context.check_hostname)
        self.assertEqual(context.verify_mode, activate.ssl.CERT_REQUIRED)

    def test_failed_activation_restores_debian_default_site_symlink(self):
        source, host = self.fixture()
        default = host / 'etc/nginx/sites-enabled/default'
        default.parent.mkdir(parents=True)
        default.symlink_to('/etc/nginx/sites-available/default')
        def unhealthy(endpoint, certificate=None):
            self.assertFalse(default.is_symlink())
            raise RuntimeError('fixture health failure')
        with self.assertRaisesRegex(RuntimeError, 'fixture health failure'):
            self.activate(source, host, health=unhealthy)
        self.assertTrue(default.is_symlink())
        self.assertEqual(os.readlink(default), '/etc/nginx/sites-available/default')

    def test_node_bootstrap_verifies_download_before_installing(self):
        arch = 'x64' if platform.machine() == 'x86_64' else 'arm64'
        name = 'node-v24.11.0-linux-' + arch
        archive = self.base / (name + '.tar.xz')
        binary = b'#!/bin/sh\nprintf "v24.11.0\\n"\n'
        with tarfile.open(archive, 'w:xz') as contents:
            entry = tarfile.TarInfo(name + '/bin/node')
            entry.mode = 0o755
            entry.size = len(binary)
            contents.addfile(entry, io.BytesIO(binary))
        fakebin = self.base / 'bin'
        fakebin.mkdir()
        curl = fakebin / 'curl'
        curl.write_text('#!' + sys.executable + '\nimport os,shutil,sys\n'
                        'source=os.environ["QWEN_TEST_SUMS"] if sys.argv[-1].endswith("SHASUMS256.txt") else os.environ["QWEN_TEST_ARCHIVE"]\n'
                        'shutil.copyfile(source,sys.argv[sys.argv.index("--output")+1])\n')
        curl.chmod(0o755)
        sums = self.base / 'SHASUMS256.txt'
        for valid in [True, False]:
            with self.subTest(valid_checksum=valid):
                digest = hashlib.sha256(archive.read_bytes()).hexdigest() if valid else '0' * 64
                sums.write_text(digest + '  ' + name + '.tar.xz\n')
                cache = self.base / ('valid' if valid else 'invalid')
                env = {**os.environ, 'PATH': str(fakebin) + ':' + os.environ.get('PATH', os.defpath),
                       'QWEN_TEST_SUMS': str(sums), 'QWEN_TEST_ARCHIVE': str(archive), 'QWEN_NODE_CACHE': str(cache)}
                result = subprocess.run(['sh', str(ROOT / 'deploy/lxc/install-node.sh')], env=env,
                                        text=True, capture_output=True)
                if valid:
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(result.stdout.strip(), str(cache / name / 'bin'))
                    self.assertTrue((cache / name / 'bin/node').is_file())
                else:
                    self.assertNotEqual(result.returncode, 0)
                    self.assertFalse((cache / name).exists())


if __name__ == '__main__':
    unittest.main()
