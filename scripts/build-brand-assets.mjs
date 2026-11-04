// Rasterize the vector master at every required size; never upscale an input bitmap.
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const desktop=resolve(root,'apps/desktop'),assets=resolve(desktop,'src/assets'),icons=resolve(desktop,'src-tauri/icons'),temporary=resolve(root,'.tools/brand-build');
const cli=resolve(desktop,'node_modules/@tauri-apps/cli/tauri.js');
for(const directory of [assets,icons,temporary])mkdirSync(directory,{recursive:true});
const mark=readFileSync(resolve(assets,'ycore-mark.svg'),'utf8'),inner=mark.slice(mark.indexOf('>')+1,mark.lastIndexOf('</svg>'));
const frame='<defs><linearGradient id="frame" x2="1" y2="1"><stop stop-color="#00E5FF"/><stop offset=".48" stop-color="#6D28FF"/><stop offset="1" stop-color="#FF4FD8"/></linearGradient></defs>';
writeFileSync(resolve(desktop,'app-icon.svg'),`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 256 256">${frame}<rect x="7" y="7" width="242" height="242" rx="56" fill="#0B0B14" stroke="url(#frame)" stroke-width="1.5"/><svg x="8" y="8" width="240" height="240" viewBox="0 0 256 256">${inner}</svg></svg>\n`);
const wordmark=`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="176" viewBox="0 0 600 176"><svg width="176" height="176" viewBox="0 0 256 256">${inner}</svg><text x="210" y="105" fill="#E6E8FF" font-family="Segoe UI,Arial,sans-serif" font-size="92" font-weight="700" textLength="350" lengthAdjust="spacing">YCORE</text><text x="215" y="155" fill="#A855FF" font-family="Segoe UI,Arial,sans-serif" font-size="30" font-weight="600" textLength="340" lengthAdjust="spacing">MUSIC</text></svg>`;
writeFileSync(resolve(assets,'ycore-wordmark.svg'),wordmark);
const run=(input,output,sizes=[])=>execFileSync(process.execPath,[cli,'icon',input,'--output',output,...sizes.flatMap(size=>['--png',String(size)])],{cwd:root,stdio:'ignore'});
run(resolve(desktop,'app-icon.svg'),resolve(temporary,'standard'));
const sizes=[16,24,32,48,64,128,256];run(resolve(desktop,'app-icon.svg'),resolve(temporary,'sizes'),sizes);
run(resolve(assets,'ycore-mark.svg'),resolve(temporary,'mark'),[128,256,512]);
for(const file of ['32x32.png','64x64.png','128x128.png','128x128@2x.png','icon.png','icon.icns','Square30x30Logo.png','Square44x44Logo.png','Square71x71Logo.png','Square89x89Logo.png','Square107x107Logo.png','Square142x142Logo.png','Square150x150Logo.png','Square284x284Logo.png','Square310x310Logo.png','StoreLogo.png'])copyFileSync(resolve(temporary,'standard',file),resolve(icons,file));
const pngs=sizes.map(size=>{const file=`${size}x${size}.png`,data=readFileSync(resolve(temporary,'sizes',file));if(data.readUInt32BE(16)!==size||data.readUInt32BE(20)!==size)throw Error('Invalid raster dimensions');copyFileSync(resolve(temporary,'sizes',file),resolve(icons,file));return data;});
const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=header.length;
sizes.forEach((size,index)=>{const at=6+16*index;header[at]=header[at+1]=size===256?0:size;header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(pngs[index].length,at+8);header.writeUInt32LE(offset,at+12);offset+=pngs[index].length;});
writeFileSync(resolve(icons,'icon.ico'),Buffer.concat([header,...pngs]));
for(const size of [128,256,512])copyFileSync(resolve(temporary,'mark',`${size}x${size}.png`),resolve(assets,`ycore-mark-${size}.png`));
const require=createRequire(resolve(desktop,'package.json')), {chromium}=require('playwright');
let browser;try{browser=await chromium.launch({channel:'chrome'});}catch{browser=await chromium.launch();}
try{
 const page=await browser.newPage({viewport:{width:600,height:176}});await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${wordmark}`);await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:resolve(assets,'ycore-wordmark.png'),omitBackground:true});
 const samples=sizes.map(size=>`<div><img width="${size}" height="${size}" src="data:image/png;base64,${pngs[sizes.indexOf(size)].toString('base64')}"><span>${size}px</span></div>`).join('');
 await page.setViewportSize({width:900,height:400});await page.setContent(`<style>body{margin:0;padding:24px;background:#0B0B14;color:#E6E8FF;font:14px 'Segoe UI',sans-serif;display:flex;align-items:center;gap:22px;height:350px}div{display:flex;flex-direction:column;align-items:center;gap:18px}img{object-fit:contain}</style>${samples}`);await page.screenshot({path:resolve(temporary,'icon-sizes.png')});
}finally{await browser.close();}
console.log('Brand assets built from SVG. ICO frames: '+sizes.join(', ')+'. PNG wordmark and transparent marks exported.');
