import {build} from 'esbuild';
await build({entryPoints:['node_modules/@google/genai/dist/web/index.mjs'], bundle:true, platform:'browser', format:'esm', outfile:'public/vendor/genai.js', minify:true});
console.log('Bundled the native Google GenAI SDK for the browser.');
