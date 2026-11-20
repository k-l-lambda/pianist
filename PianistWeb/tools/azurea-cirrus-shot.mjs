#!/usr/bin/env node
// One-page, fixed-time raster/GI comparison of Azurea's Day horizon clouds.
// node tools/azurea-cirrus-shot.mjs [port=5222] [output-directory]
// PLAYWRIGHT_MODULE, CHROME_PATH and __EGL_VENDOR_LIBRARY_FILENAMES may override
// this machine's shared headless-NVIDIA setup. Images are never added to git.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? '/tmp/pianist-tools/node_modules/playwright-core');
const port = Number(process.argv[2] ?? 5222);
const out = resolve(process.argv[3] ?? 'Footages.local/render/azurea-cirrus');
await mkdir(out, { recursive:true });
const lobby = { position:[6.7041624688,2.0522652307,14.043426127], target:[-1.5839907226,0.9041803703,0.492089768], fov:36 };
const sky = { position:[-2,8,-100], target:[-4,18,-200], fov:70 };
const shots = [
  { name:'before-lobby', camera:lobby, light:{ clouds:0.25, wisps:0, cloudHorizon:0, cloudWind:0 } },
  { name:'before-wide-sky', camera:sky, light:{ clouds:0.25, wisps:0, cloudHorizon:0, cloudWind:0 } },
  { name:'after-lobby', camera:lobby }, { name:'after-wide-sky', camera:sky },
  { name:'clouds-black', camera:sky, light:{ atmosphere:false, skyFallback:'Clouds on black' } },
  { name:'clear-black', camera:sky, light:{ atmosphere:false, skyFallback:'Clouds on black', clouds:0, wisps:0 } },
];
const browser = await chromium.launch({
  executablePath:process.env.CHROME_PATH ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`,
  headless:true,
  env:{ ...process.env, __EGL_VENDOR_LIBRARY_FILENAMES:process.env.__EGL_VENDOR_LIBRARY_FILENAMES ?? '/tmp/pianist-tools/nvidia_egl.json' },
  args:['--use-gl=angle','--use-angle=gl-egl','--ignore-gpu-blocklist'],
});
const errors=[], results=[];
try {
  const page = await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
  page.on('pageerror', e => errors.push(`PAGEERR ${e.message}`));
  page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  await page.addInitScript(() => {
    let s=1;
    Math.random=()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};
  });
  await page.goto(`http://127.0.0.1:${port}/?style=grand-crystal&preset=Day#?gi`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__pianist?.azurea?.pack&&window.__pianist.venue===window.__pianist.azurea,null,{timeout:300000});
  await page.addStyleTag({content:'.lil-gui,#hud,#power,#ptshot,#play,#start,#hallbar{display:none!important}'});
  await page.waitForTimeout(3000);
  await page.evaluate(async()=>{
    const {clock}=await import('/src/rendermode.js');clock.now=()=>12000;
    window.__pianist.settings.autoExposure=false;
  });
  for (const shot of shots) {
    const state=await page.evaluate(({camera,light})=>{
      const P=window.__pianist,A=P.azurea;
      Object.assign(A.light,A.presets.Day,{atmosphere:true,skyFallback:'Photo'},light??{});
      A.updateLights();
      P.camera.position.set(...camera.position);P.controls.target.set(...camera.target);P.controls.update();
      P.camera.fov=camera.fov;P.camera.updateProjectionMatrix();
      return { light:{...A.light}, bank:A.sky.uniforms.uCloudHorizon.value, windRadians:A.sky.uniforms.uCloudWind.value };
    },shot);
    await page.evaluate(async()=>{ for(let i=0;i<16;i++) await new Promise(r=>requestAnimationFrame(r)); });
    const path=join(out,`${shot.name}.png`);
    await page.screenshot({path});results.push({...shot,...state,path});
    console.log(shot.name,JSON.stringify({bank:state.bank,windRadians:state.windRadians,path}));
  }
  await writeFile(join(out,'capture.json'),JSON.stringify({timeSeconds:12,viewport:[1280,720],seed:1,errors,results},null,2));
  if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); }
