// Produces a local manifest only. It never publishes releases or handles private keys.
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {basename,resolve} from 'node:path';
import assert from 'node:assert/strict';

const args=process.argv.slice(2),entries=[],root=resolve(import.meta.dirname,'..');
let output,notes='';
for(let index=0;index<args.length;index++){
 const name=args[index],value=args[++index];assert(value,'Missing argument for '+name);
 if(name==='--entry')entries.push(value);
 else if(name==='--output')output=value;
 else if(name==='--notes')notes=readFileSync(value,'utf8');
 else throw Error('Unknown option: '+name);
}
assert(output&&entries.length>0&&entries.length<=8,'Usage: --entry windows-x86_64=path/to/installer.exe [--entry ...] --output latest.json [--notes notes.txt]');
const {version}=JSON.parse(readFileSync(resolve(root,'apps/desktop/src-tauri/tauri.conf.json'),'utf8'));
assert(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version),'Invalid application version');
const platforms={};
for(const entry of entries){
 const separator=entry.indexOf('=');assert(separator>0,'Entry must be platform=artifact');
 const platform=entry.slice(0,separator),file=resolve(entry.slice(separator+1));
 assert(/^(windows|linux|darwin)-(x86_64|aarch64|i686|armv7)(?:-(nsis|msi|appimage|deb|rpm))?$/.test(platform),'Unknown updater platform');
 assert(!platforms[platform],'Duplicate platform');
 assert(statSync(file).isFile()&&statSync(file).size>0,'Missing package');
 const name=basename(file),signature=readFileSync(file+'.sig','utf8').trim();
 assert(signature.length>0&&signature.length<=8192,'Invalid signature file');
 const trustedComment=Buffer.from(signature,'base64').toString('utf8').split('\n').find(line=>line.startsWith('trusted comment:'));
 assert(trustedComment?.split(/\s+/).includes('version:'+version),'Signature must be bound to the current application version');
 assert(platform.startsWith('windows-')?/\.(exe|msi)$/.test(name):platform.startsWith('darwin-')?/\.app\.tar\.gz$/.test(name):/\.(AppImage|deb|rpm)$/.test(name),'Package format does not match its platform');
 // GitHub replaces spaces in uploaded release asset names with periods.
 const assetName=name.replace(/ /g,'.');
 platforms[platform]={url:'https://github.com/BjornSkarsgard/YCoreMusic/releases/download/'+encodeURIComponent('v'+version)+'/'+encodeURIComponent(assetName),signature};
}
writeFileSync(output,JSON.stringify({version,notes:notes.slice(0,12000),pub_date:new Date().toISOString(),platforms},null,2)+'\n');
console.log('Local update manifest prepared for '+Object.keys(platforms).length+' platform(s). Nothing published.');
