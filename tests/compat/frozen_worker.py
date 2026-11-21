"""Loopback RunPod fixture using the archived parser, handler and image encoder."""

import hashlib
import json
import logging
import random
import re
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from types import SimpleNamespace

from PIL import Image, ImageDraw
import handler
from qwen_worker.config import Settings
from qwen_worker.memory import GIB
from qwen_worker.service import ImageService

sys.path.insert(0, 'tests')
from test_fail_closed import fake_pipe, RequestPreflight
logging.disable(logging.CRITICAL)

def pixels(prompt, width, height, generator, **kwargs):
    seeds = generator if isinstance(generator, list) else [generator]
    if prompt.startswith('Inline cap fixture'):
        images = [Image.frombytes('RGBA', (width, height),
                  random.Random(seed).randbytes(width * height * 4)) for seed in seeds]
    else:
        images = []
        for seed in seeds:
            color = hashlib.sha256(f'{prompt}:{seed}'.encode()).digest()
            image = Image.new('RGBA', (width, height))
            if 'RGBA image with transparency' in prompt:
                ImageDraw.Draw(image).rectangle((width//4, height//4, 3*width//4, 3*height//4), fill=(*color[:3],255))
            else:
                image.paste((*color[:3],255), (0,0,width,height))
            images.append(image)
    return SimpleNamespace(images=images)

handler._service = ImageService(pixels, lambda seed: seed, Settings(),
                                memory_budget=lambda: 78 * GIB,
                                preflight=RequestPreflight(fake_pipe()))
jobs = {}
seen = []
class Fixture(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def answer(self, value, code=200):
        data = json.dumps(value).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(data))
        self.end_headers()
        self.wfile.write(data)
    def do_POST(self):
        if self.headers.get('Authorization') != 'Bearer fixture-old-key':
            return self.answer({'error': 'fixture authorization'}, 401)
        if self.path != '/v2/frozen-fixture/run':
            return self.answer({'error': 'fixture route'}, 404)
        data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        job_id = 'frozen-' + str(len(jobs) + 1)
        result = handler.handler({'id': job_id, 'input': data['input']})
        inputs = data['input']
        seen.append({
            **{key: val for key,val in inputs.items() if key != 'images'},
            'images': len(inputs.get('images', [])),
            'allowed_keys': sorted(inputs),
            'seeds': [str(item['seed']) for item in result.get('images', [])],
            'error': result.get('error'),
        })
        output = ({'status':'FAILED','error': result['error']} if 'error' in result
                  else {'status':'COMPLETED','output': result})
        jobs[job_id] = {'id':job_id,**output}
        self.answer({'id': job_id, 'status':'IN_QUEUE'})
    def do_GET(self):
        if self.path == '/fixture-records':
            return self.answer(seen)
        if self.headers.get('Authorization') != 'Bearer fixture-old-key':
            return self.answer({'error': 'fixture authorization'}, 401)
        if self.path == '/v2/frozen-fixture/health':
            return self.answer({'jobs': {'failed': 0, 'inProgress': 0}, 'workers': {'ready': 1}})
        match = re.fullmatch(r'/v2/frozen-fixture/status/(frozen-[0-9]+)', self.path)
        if match and match[1] in jobs:
            return self.answer(jobs[match[1]])
        self.answer({'error': 'not found'}, 404)

server = HTTPServer(('127.0.0.1',0),Fixture)
print(server.server_port,flush=True)
server.serve_forever()
