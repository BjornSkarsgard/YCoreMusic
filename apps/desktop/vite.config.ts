import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({build:{assetsInlineLimit:0,rolldownOptions:{input:{main:fileURLToPath(new URL('./index.html',import.meta.url)),lyrics:fileURLToPath(new URL('./lyrics.html',import.meta.url)),scene:fileURLToPath(new URL('./scene.html',import.meta.url)),playerHost:fileURLToPath(new URL('./player-host.html',import.meta.url)),mirrorProbe:fileURLToPath(new URL('./mirror-probe.html',import.meta.url))}}}});
