import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {once} from 'node:events';
import readline from 'node:readline';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'vite';

import {mkdtempSync, rmSync, existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repository = process.argv[2] || join(root, "../qwen-image-2.1-worker");
const revision = "99c28f5d8a7fe0a5fa489ef4d619b1453198fccb";
const sandbox = mkdtempSync(join(tmpdir(), "qwen-frozen-worker-"));
let worker, vite, browser, origin, workerBase;

async function start() {
  const archive = join(sandbox, "worker.tar");
  execFileSync("git", ["-C", repository, "archive", "-o", archive, revision]);
  execFileSync("tar", ["-xf", archive, "-C", sandbox]);
  const fixture = fileURLToPath(new URL("./frozen_worker.py", import.meta.url));
  worker = spawn("uv", ["run", "--no-project", "--with", "Pillow==12.3.0", "python", fixture], {
    cwd: sandbox,
    env: { ...process.env, PYTHONPATH: sandbox },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const lines = readline.createInterface({ input: worker.stdout });
  const [first] = await Promise.race([
    once(lines, "line"),
    once(lines, "close").then(() => { throw new Error("Archived worker fixture exited at startup"); }),
  ]);
  const port = Number(first);
  assert.ok(Number.isInteger(port) && port > 0, first);
  workerBase = "http://127.0.0.1:" + port;
  vite = await createServer({
    root, mode: "test", envFile: false, logLevel: "error",
    plugins: [{ name: "frozen-worker-config", configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== "/config.json") return next();
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ endpointId: "frozen-fixture", serverAuth: true }));
      });
    } }],
    server: { host: "127.0.0.1", port: 0, proxy: { "/api/runpod": {
      target: workerBase,
      rewrite: path => path.replace(/^\/api\/runpod/, "/v2"),
      configure: proxy => proxy.on("proxyReq", req => req.setHeader("Authorization", "Bearer fixture-old-key")),
    } } },
  });
  await vite.listen();
  origin = "http://127.0.0.1:" + vite.httpServer.address().port;
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    args: ["--no-sandbox"],
  });
}
const records=()=>fetch(workerBase+'/fixture-records').then(r=>r.json());
async function open() {
  const p=await browser.newPage({viewport:{width:1440,height:960}});
  await p.goto(origin);
  await expect(p.locator('#connection-label')).toHaveText('frozen-fixture');
  return p;
}
async function settings(p, prompt, width=256, height=width) {
  await p.locator('#prompt').fill(prompt);
  await p.locator('#width').fill(String(width));
  await p.locator('#height').fill(String(height));
}
async function generate(p) {
  const button=p.locator('#generate');
  await expect(button).toBeEnabled();
  await button.click();
}
async function verifyResult(p, seeds, mime='image/png') {
  await expect(p.locator('.result-seed')).toHaveText(seeds.map(s=>'Seed '+s));
  const outputs=p.locator('.raw-variant img');
  assert.equal(await outputs.count(),seeds.length);
  for (const result of await outputs.all()) {
    const info=await result.evaluate(async el=>{
      await el.decode(); return {type:(await (await fetch(el.src)).blob()).type,width:el.naturalWidth};
    });
    assert.ok(info.width >= 256);
    assert.equal(info.type,mime);
  }
}
async function png(p) {
 return Buffer.from(await p.evaluate(()=>{
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
  const c=canvas.getContext('2d');c.fillStyle='rgb(32,64,96)';c.fillRect(0,0,256,256);
  return canvas.toDataURL().split(',')[1];
 }),'base64');
}
try {
  await start();
  const basic=await open();
  await basic.locator('#connection-open').click();
  await basic.locator('#connection-test').click();
  await expect(basic.locator('#health-result')).toContainText('"ready": 1');
  await basic.keyboard.press('Escape');
  await settings(basic,'A blue cube with a soft shadow');
  await basic.locator('#seed').fill('9223372036854775807');
  await basic.locator('#steps').fill('12');
  await generate(basic);
  await verifyResult(basic,['9223372036854775807']);
  let last=(await records()).at(-1);
  assert.equal(last.num_inference_steps,12);
  assert.equal(last.images,0);
  assert.equal(last.seeds[0],'9223372036854775807');
  console.log('PASS authenticated health, /run and /status; PNG with exact 63-bit maximum seed.');
  await basic.close();

  const series=await open();
  await settings(series,'Transparent red ceramic tiles');
  await series.locator('#format').selectOption('webp');
  await series.locator('#transparent').check();
  await series.locator('#seed').fill('9223372036854775806');
  await series.locator('#run-kind').selectOption('series');
  await series.locator('#series-total').fill('5');
  await generate(series);
  await expect(series.locator('#run-progress')).toContainText('completed · 5 / 5');
  await verifyResult(series,['9223372036854775806','9223372036854775807','0','1','2'],'image/webp');
  const seriesRequests=(await records()).slice(-2);
  assert.deepEqual(seriesRequests.map(x=>x.num_images),[4,1]);
  assert.ok(seriesRequests.every(x=>x.transparent && x.output_format==='webp' && !x.error));
  const alpha=await series.locator('.raw-variant img').first().evaluate(async el=>{
    await el.decode();const c=document.createElement('canvas');c.width=el.naturalWidth;c.height=el.naturalHeight;
    const x=c.getContext('2d');x.drawImage(el,0,0);return x.getImageData(0,0,1,1).data[3];
  });
  assert.equal(alpha,0);
  console.log('PASS 4+1 series, exact seed wrap, WebP and alpha from original worker encoder.');
  await series.close();

  const refs=await open();
  const image=await png(refs);
  await refs.locator('#reference-upload').setInputFiles({name:'ref.png',mimeType:'image/png',buffer:image});
  await refs.locator('[data-mode=edit]').click();
  await settings(refs,'Make the colour warmer in <image1>');
  await refs.locator('#seed').fill('55');
  await refs.locator('#format').selectOption('jpeg');
  await refs.locator('#negative-enable').click();
  await refs.locator('#negative-prompt').fill('letters');
  await generate(refs);
  await verifyResult(refs,['55'],'image/jpeg');
  last=(await records()).at(-1);
  assert.equal(last.images,1);
  assert.equal(last.negative_prompt,'letters');
  assert.ok(last.true_cfg_scale>1);
  await refs.close();

  const editor=await open();
  await editor.locator('[data-mode=inpaint]').click();
  await editor.locator('#source-upload').setInputFiles({name:'source.png',mimeType:'image/png',buffer:image});
  await settings(editor,'Add a warm colour inside the mask');
  await editor.locator('#seed').fill('61');
  await editor.locator('#crop-mask').uncheck();
  const mask=editor.locator('.mask-layer');
  await expect(mask).toBeVisible();await mask.scrollIntoViewIfNeeded();
  const rect=await mask.boundingBox();
  await editor.mouse.click(rect.x+rect.width/2,rect.y+rect.height/2);
  await generate(editor);
  await verifyResult(editor,['61']);
  await expect(editor.locator('.composite-variant img')).toHaveCount(1);
  const color=await editor.locator('.composite-variant img').evaluate(async el=>{
    await el.decode();const c=document.createElement('canvas');c.width=el.naturalWidth;c.height=el.naturalHeight;
    const x=c.getContext('2d');x.drawImage(el,0,0);return [...x.getImageData(0,0,1,1).data];
  });
  assert.deepEqual(color,[32,64,96,255]);
  last=(await records()).at(-1);
  assert.equal(last.images,2);
  for (const key of ['mask','strength','inpaint','asynchronous','batch_size','total_images'])
    assert.ok(!last.allowed_keys.includes(key));
  console.log('PASS reference-edit JPEG with CFG; inpaint sent two legacy guides, no new API fields, and composited locally.');
  await editor.close();

  const limit=await open();
  await settings(limit,'Inline cap fixture',2048);
  await limit.locator('#seed').fill('70');
  await generate(limit);
  await expect(limit.locator('#job-status')).toContainText('Encoded images exceed the inline output limit');
  await settings(limit,'Small PNG after output limit',256);
  await generate(limit);
  await verifyResult(limit,['70']);
  console.log('PASS legacy 8 MB rejection is surfaced and a smaller retry works.');
  await limit.close();
  console.log('Frozen browser requests handled:',(await records()).length);
} finally {
  await browser?.close();
  await vite?.close();
  if (worker && worker.exitCode === null && worker.signalCode === null) {
    const exited = once(worker, "exit");
    worker.kill();
    await exited;
  }
  rmSync(sandbox, { recursive: true, force: true });
}
