// Coplanar-face audit of the grand (z-fighting): node tools/coplanar-audit.mjs PORT [STYLE].
// Lists pairs of different meshes whose triangles lie in one plane and overlap (rough: bounding boxes in the
// plane), largest first, with each mesh's colour, clear flag and box. Needs the dev server and playwright-core.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || '/tmp/pianist-tools/node_modules/playwright-core');
const [, , port, style = 'grand-crystal'] = process.argv;
const browser = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome', headless: true, env: {...process.env, __EGL_VENDOR_LIBRARY_FILENAMES:'/tmp/pianist-tools/nvidia_egl.json'}, args:['--use-gl=angle','--use-angle=gl-egl','--ignore-gpu-blocklist'] });
const page = await browser.newPage({viewport:{width:640,height:360}});
await page.goto(`http://localhost:${port}/?style=${style}&preset=Day`, {waitUntil:'domcontentloaded'});
await page.waitForFunction(() => window.__pianist?.azurea?.pack && window.__pianist.venue === window.__pianist.azurea, null, {timeout:300000});
const r = await page.evaluate(() => {
  const P = window.__pianist; let g = null;
  P.scene.traverse(o => { if (o.name === 'grand' && !g) g = o; });
  g.updateMatrixWorld(true);
  const tris = []; let mi = 0; const names = [];
  g.traverse(o => { if (!o.isMesh || !o.visible || o.isInstancedMesh || !o.geometry.attributes.position) return; const pos = o.geometry.attributes.position, idx = o.geometry.index; const id = mi++;
    o.geometry.computeBoundingBox(); const bx=o.geometry.boundingBox; names.push('#'+id+(o.name?':'+o.name:'')+' col'+o.material.color?.getHexString()+(o.material.transmission>0||o.material.transparent?' clear':'')+' y['+bx.min.y.toFixed(3)+','+bx.max.y.toFixed(3)+'] z['+bx.min.z.toFixed(2)+','+bx.max.z.toFixed(2)+']');
    const e = o.matrixWorld.elements; const W = i => { const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i); return [e[0]*x+e[4]*y+e[8]*z+e[12],e[1]*x+e[5]*y+e[9]*z+e[13],e[2]*x+e[6]*y+e[10]*z+e[14]]; };
    const n = idx ? idx.count : pos.count;
    for (let f = 0; f < n; f += 3) { const I = k => idx ? idx.getX(f+k) : f+k; const a=W(I(0)),b=W(I(1)),c=W(I(2));
      const u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]], v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]]; let N=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]; const L=Math.hypot(...N); if (L<1e-9) continue; N=N.map(q=>q/L);
      // canonical sign
      const s = (Math.abs(N[0])>1e-6?N[0]:Math.abs(N[1])>1e-6?N[1]:N[2])<0?-1:1; const Nc=N.map(q=>q*s); const d=Nc[0]*a[0]+Nc[1]*a[1]+Nc[2]*a[2];
      tris.push({id, Nc, d, a, b, c, area:L/2}); } });
  const key = t => t.Nc.map(q=>Math.round(q*200)).join(',') + '|' + Math.round(t.d*2000);
  const B = new Map(); for (const t of tris) { const k = key(t); if (!B.has(k)) B.set(k, []); B.get(k).push(t); }
  const pairs = new Map();
  const bb = t => [0,1,2].map(k=>[Math.min(t.a[k],t.b[k],t.c[k]),Math.max(t.a[k],t.b[k],t.c[k])]);
  for (const [k, L] of B) { const ids = new Set(L.map(t=>t.id)); if (ids.size < 2) continue;
    for (let i=0;i<L.length;i++) for (let j=i+1;j<L.length;j++) { const p=L[i],q=L[j]; if (p.id===q.id) continue; const A=bb(p),Bq=bb(q); let ov=1;
      for (let k=0;k<3;k++){ const w=Math.min(A[k][1],Bq[k][1])-Math.max(A[k][0],Bq[k][0]); if (w< -1e-6){ov=0;break;} if (Math.abs(p.Nc[k])<0.9) ov*=Math.max(w,0);} 
      if (ov>1e-8) { const pk=[p.id,q.id].sort((x,y)=>x-y).join('-'); const o=pairs.get(pk)||{area:0,n:0,plane:k}; o.area+=ov; o.n++; pairs.set(pk,o);} } }
  return [...pairs].sort((x,y)=>y[1].area-x[1].area).slice(0,40).map(([k,o])=>{const [i,j]=k.split('-');return `${o.area.toExponential(2)} m2 n=${o.n} ${names[i]} <> ${names[j]} plane ${o.plane}`;});
});
console.log(r.join('\n')); await browser.close();
