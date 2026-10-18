/* Exercise lazy tools under the production Nginx CSP; all inference is mocked. */
const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto(process.argv[2]);
    const image=async colour=>page.evaluate(colour=>{const c=document.createElement('canvas');c.width=c.height=512;const x=c.getContext('2d');x.fillStyle=colour;x.fillRect(0,0,512,512);return c.toDataURL().split(',')[1];},colour);
    const source=await image('#204060'),generated=await image('#cc5500');let input,job=0;
    await page.route('**/api/runpod/**',async route=>{
      if(route.request().url().endsWith('/run')){input=JSON.parse(route.request().postData()).input;job++;return route.fulfill({json:{id:`production-${job}`,status:'IN_QUEUE'}});}
      return route.fulfill({json:{id:`production-${job}`,status:'COMPLETED',output:{images:Array.from({length:input.num_images},(_,i)=>({image_base64:generated,mime_type:'image/png',width:512,height:512,seed:input.seed+i}))}}});
    });
    await page.locator('#connection-open').click();await page.locator('#endpoint-id').fill('fixture');await page.locator('#api-key').fill('fixture-key');await page.locator('#connection-form button[type=submit]').click();
    await page.locator('#open-outpaint').click();await page.locator('#source-upload').setInputFiles({name:'source.png',mimeType:'image/png',buffer:Buffer.from(source,'base64')});
    await page.locator('#width').fill('512');await page.locator('#height').fill('512');await page.locator('#seed').fill('100');await page.locator('#prompt').fill('Extend the blue scene');
    await page.locator('#generate:enabled').click();await page.locator('.raw-variant img').waitFor();await page.locator('.composite-variant img').waitFor();
    await page.locator('.raw-variant').getByRole('button',{name:'Inspect raw',exact:true}).click();await page.locator('.inspection-tools select').nth(1).selectOption('slider');await page.locator('.inspector .notice').filter({hasText:'mapped to source'}).waitFor();await page.locator('.inspector').getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('button',{name:'Export raw',exact:true}).click();await page.locator('[data-format]').selectOption('webp');await page.getByRole('button',{name:'Preview export',exact:true}).click();await page.locator('.export-dialog .notice').filter({hasText:'image/webp'}).waitFor();await page.locator('.export-dialog').getByRole('button',{name:'Close',exact:true}).click();
    const zip=page.waitForEvent('download');await page.getByRole('button',{name:'Download selected ZIP',exact:true}).click();assert.equal((await zip).suggestedFilename(),'qwen-results.zip');
    await page.screenshot({path:'docs/studio.png',fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('PASS: production CSP, outpainting, visible raw/composite pair, lazy inspector/WebP export/ZIP modules, no browser errors.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
