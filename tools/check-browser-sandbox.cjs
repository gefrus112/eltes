/* Optional browser regression: start npm start with both shells disabled first.
   Install playwright-core and @sparticuz/chromium in a separate tools directory;
   set ELTES_BROWSER_MODULES to that directory's node_modules. No live provider calls:
   the last test intercepts a provider request with deterministic fixtures. */
const path = require('node:path');
const { createRequire } = require('node:module');
const browserRequire = process.env.ELTES_BROWSER_MODULES
  ? createRequire(path.resolve(process.env.ELTES_BROWSER_MODULES, '..', 'package.json')) : require;
const { chromium } = browserRequire('playwright-core');
const binary = browserRequire('@sparticuz/chromium').default;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'eltes-browser-test-'));
const baseURL = process.env.ELTES_TEST_URL || 'http://127.0.0.1:4173';

(async()=>{
const tf=require('../assets/js/vendor/tf.min.js');await tf.setBackend('cpu');await tf.ready();const model=tf.sequential();model.add(tf.layers.dense({units:1,inputShape:[1]}));model.setWeights([tf.tensor2d([2],[1,1]),tf.tensor1d([1])]);await model.save(tf.io.withSaveHandler(async a=>{fs.writeFileSync(path.join(tmp, 'model.json'),JSON.stringify({modelTopology:a.modelTopology,weightsManifest:[{paths:['weights.bin'],weights:a.weightSpecs}]}));fs.writeFileSync(path.join(tmp, 'weights.bin'),Buffer.from(a.weightData));return {modelArtifactsInfo:{}}}));
const b=await chromium.launch({executablePath:await binary.executablePath(),args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],headless:true});
try{const page=await b.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{if(window===top)localStorage.setItem('eltes.setup.v1','1')});await page.goto(baseURL + '/app.html');await page.waitForFunction(()=>!!window.Eltes);await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
async function snippet(code,tfjs=false,files=false){await page.evaluate(code=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());const s=window.Eltes.state; s.chats=[{id:'test',title:'test',model:'eltes-cai-1',messages:[{id:'m',role:'assistant',content:'```js\n'+code+'\n```',tools:[],ts:Date.now()}]}];s.activeId='test';window.Eltes.renderAll();},code);await page.locator('[data-run-js]').click();await page.locator('#jsSandboxTfjs').setChecked(tfjs);if(files)await page.locator('#jsSandboxModelFiles').setInputFiles([path.join(tmp, 'weights.bin'),path.join(tmp, 'model.json')]);await page.locator('#runJsSandboxBtn').click();await page.waitForFunction(()=>/Finished|Stopped/.test(document.querySelector('#jsSandboxStatus').textContent),null,{timeout:35000});return page.locator('#jsSandboxOutput').textContent();}
assert.match(await snippet('console.log(await tf.tensor([2,3]).square().array()); return 42;',true), /\[4,9\]\n42/);
assert.match(await snippet('const m = await loadLocalLayersModel(); console.log(await m.predict(tf.tensor2d([3],[1,1])).array());',true,true), /\[\[7\]\]/);
assert.match(await snippet('try { await fetch("https://example.com"); console.log("FAIL"); } catch { console.log("network blocked"); } console.log(typeof document);'), /network blocked.*\n.*undefined/);
assert.match(await snippet('console.log("</script><script>parent.document.body.innerHTML = 1</script>"); return 6 < 7;'), /true/);
await snippet('while(true) {}');assert.match(await page.locator('#jsSandboxStatus').textContent(),/8-second/);
await page.locator('#jsSandboxDialog [data-close]').first().click();await page.locator('#openProjectSandbox').click();
for (const [name,code] of Object.entries({'index.html':'<h1 id="test">Before</h1><link rel="stylesheet" href="styles.css"><script src="app.js"></script>','styles.css':'h1 {color:rgb(255, 0, 0)}','app.js':'document.querySelector("h1").textContent="Rendered";'})){await page.locator('#projectSandboxNewName').fill(name);await page.locator('#projectSandboxAdd').click();await page.locator('#projectSandboxEditor').fill(code);await page.locator('#projectSandboxSave').click();}
await page.locator('#projectSandboxRun').click();assert.equal(await page.frameLocator('#projectSandboxPreview').locator('h1').innerText(),'Rendered');assert.equal(await page.frameLocator('#projectSandboxPreview').locator('h1').evaluate(e=>getComputedStyle(e).color),'rgb(255, 0, 0)');await page.locator('#projectSandboxStop').click();assert.equal(await page.locator('#projectSandboxPreview').getAttribute('srcdoc'),'');
await page.locator('#projectSandboxDialog [data-close]').click();
let calls = 0;
await page.route('**/test-provider/chat/completions', async route => {
  calls++;
  const message = calls === 1 ? {role:'assistant',content:'Plan: create index.html in the virtual project, then review the preview.',tool_calls:[{id:'build-test',type:'function',function:{name:'write_project_file',arguments:JSON.stringify({filename:'index.html',content:'<h1>Approved by test</h1>'})}}]} : {role:'assistant', content:'Source saved. Review and preview it in the workspace.'};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message}],usage:{prompt_tokens:10,completion_tokens:10}})});
});
await page.evaluate(()=>{const s=window.Eltes.state; s.settings.customBaseUrl=location.origin+'/test-provider';s.settings.customModel='test-fixture';s.settings.tools=true;s.settings.stream=false;s.settings.backendDisabled=true;window.Eltes.selectModel('custom-endpoint');});
await page.locator('#input').fill('Build a website in the browser coding workspace.');await page.locator('#sendBtn').click();await page.locator('#artifactApprovalDialog').waitFor({state:'visible'});await page.locator('#approveArtifactBtn').click();await page.locator('#projectSandboxDialog').waitFor({state:'visible'});await page.waitForFunction(()=>!window.Eltes.state.sending);assert.equal(calls,2);assert.equal(await page.locator('#projectSandboxEditor').inputValue(),'<h1>Approved by test</h1>');assert.equal(await page.locator('#projectSandboxPreview').getAttribute('srcdoc'),'');
assert.deepEqual(errors,[]);console.log('PASS: chat boot; TFJS math; real selected-file Layers inference; blocked fetch; no DOM in worker; source escaping; infinite-loop timeout; multi-file website editor/preview/stop; fixture-driven agent approval and follow-up loop.');
}finally{await b.close(); fs.rmSync(tmp, { recursive: true, force: true });}})().catch(e=>{console.error(e);process.exitCode=1;});
