import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('/tmp/pianist-tools/node_modules/playwright-core');
const [ , , port, out, shotsJson ] = process.argv;
const shots = JSON.parse( shotsJson );
const browser = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome', headless: true, env: {...process.env, __EGL_VENDOR_LIBRARY_FILENAMES:'/tmp/pianist-tools/nvidia_egl.json'}, args:['--use-gl=angle','--use-angle=gl-egl','--ignore-gpu-blocklist'] });
const page = await browser.newPage({viewport:{width:1280,height:720}, deviceScaleFactor:1});
page.on('pageerror', e => console.log('PAGEERR', e.message));
page.on('console', m => { if (m.type()==='error') console.log('CONSOLE', m.text().slice(0,400)); });
await page.goto(`http://localhost:${port}/?style=grand-crystal&preset=Day#?gi`, {waitUntil:'domcontentloaded'});
await page.waitForFunction(() => window.__pianist?.azurea?.pack && window.__pianist.venue === window.__pianist.azurea, null, {timeout:300000});
await page.addStyleTag({content:'.lil-gui,#hud,#power,#ptshot,#play,#start,#hallbar{display:none!important}'});
await page.waitForTimeout(6000);
for (const s of shots) {
  const info = await page.evaluate(([preset,light,p,t,f,s_hide])=>{
    const P=window.__pianist, A=P.azurea;
    if (preset) Object.assign(A.light, A.presets[preset]);
    if (window.__hide) for (const o of window.__hide) o.visible = true; window.__hide = [];
    if (s_hide) A.scene.traverse(o=>{ if (o.isMesh && s_hide.some(k=>A.materials[k]===o.material) && o.visible) { o.visible=false; window.__hide.push(o); } });
    if (light) Object.assign(A.light, light);
    A.updateLights?.();
    P.camera.position.set(...p); P.controls.target.set(...t); P.controls.update();
    if(f){P.camera.fov=f;P.camera.updateProjectionMatrix();}
    return JSON.stringify({outside:A.light.outside, rayH:A.light.skyRayH, sat:A.light.skySat, haze:+(A.light.haze??0), mean:A.sky.mean.map(v=>+v.toFixed(3))});
  },[s.preset,s.light,s.pos,s.target,s.fov,s.hide]);
  await page.waitForTimeout(4000);
  await page.screenshot({path:`${out}-${s.name}.png`});
  console.log(s.name, info);
}
await browser.close();
