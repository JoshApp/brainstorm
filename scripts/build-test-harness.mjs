import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
const sv = { name:'sv', setup(b){ b.onResolve({filter:/^virtual:/},a=>({path:a.path,namespace:'virt'})); b.onLoad({filter:/.*/,namespace:'virt'},()=>({contents:'export const registerSW=()=>{};export default {};'})); } };
const sa = { name:'sa', setup(b){ b.onResolve({filter:/\.(woff2?|ttf|otf|eot|png|jpe?g|gif|svg|webp|css)(\?\S*)?$/},a=>({path:a.path,namespace:'asset'})); b.onLoad({filter:/.*/,namespace:'asset'},()=>({contents:'export default "";'})); } };
await build({ entryPoints:['scripts/test-interact-capture.ts'], bundle:true, platform:'node', format:'esm', define:{'import.meta.env.DEV':'false','import.meta.env.PROD':'true','import.meta.env.MODE':'"production"','import.meta.env.SSR':'false','import.meta.env.BASE_URL':'"/"'}, plugins:[sv,sa], outfile:'/tmp/test-interact.mjs', logLevel:'error' });
const r = spawnSync('node',['/tmp/test-interact.mjs'],{stdio:'inherit'}); process.exit(r.status??0);
