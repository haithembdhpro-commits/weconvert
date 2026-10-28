import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
const root=new URL('../',import.meta.url);
const get=path=>readFile(new URL(path,root),'utf8');
await mkdir(new URL('dist/',root),{recursive:true});
const approved=await get('references/approved-frontend.html');
const head=approved.split('<style>')[0].replace('une maquette interactive de CRM e-commerce COD. Commandes, confirmation, livraison, stock, finances et tracking.','votre CRM e-commerce COD. Commandes, confirmation et équipe.');
const shell=approved.split('<a class="skip-link"')[1].split("<script>'use strict';")[0];
// Environment override (staging, other domain): WECONVERT_SUPABASE_URL + WECONVERT_SUPABASE_KEY (publishable key only).
const baseConfig=JSON.parse(await get('src/config.json'));
const runtimeConfig={...baseConfig,...(process.env.WECONVERT_SUPABASE_URL?{url:process.env.WECONVERT_SUPABASE_URL}:{}),...(process.env.WECONVERT_SUPABASE_KEY?{key:process.env.WECONVERT_SUPABASE_KEY}:{})};
if(/service_role|sb_secret_/.test(runtimeConfig.key))throw new Error('Refusing to embed a secret key in the browser bundle.');
const entry="import {createClient} from '@supabase/supabase-js';\nimport {createLiveSync} from './src/live-sync.mjs';\nimport {renderIcon} from './src/icon-registry.mjs';\nimport {STATUS,PENDING,CHANNELS,initialsOf,orderAmount,csvCell,localInputToISO,errorMessage,requestId} from './src/domain.mjs';\nimport {algerToday,reportRange,reportRate,reportBuckets} from './src/report-domain.mjs';\nconst CONFIG="+JSON.stringify(runtimeConfig)+";\n"+await get('src/ui.js')+'\n'+await get('src/woocommerce-ui.js')+'\n'+await get('src/shopify-ui.js')+'\n'+await get('src/youcan-ui.js')+'\n'+await get('src/performance-ui.js')+'\n'+await get('src/finance-ui.js')+'\n'+await get('src/shipping-ui.js')+'\n'+await get('src/crm.js');
await build({stdin:{contents:entry,resolveDir:new URL('../',import.meta.url).pathname,sourcefile:'crm-entry.js'},bundle:true,format:'iife',target:['es2022'],outfile:new URL('dist/app.js',root).pathname,minify:true,legalComments:'eof'});
await writeFile(new URL('dist/styles.css',root),await get('src/style.css')+'\n'+await get('src/crm.css')+'\n'+await get('src/visual.css'));
// CSP for the hosted page: the Supabase session lives in localStorage, so any injected script must be refused.
const api=new URL(runtimeConfig.url);
const csp=["default-src 'self'","script-src 'self'","style-src 'self' 'unsafe-inline' https://fonts.googleapis.com","font-src https://fonts.gstatic.com",`connect-src 'self' ${api.origin} wss://${api.host}`,"img-src 'self' data: blob:","object-src 'none'","base-uri 'none'","form-action 'self'"].join('; ');
await writeFile(new URL('dist/index.html',root),head+'<meta http-equiv="Content-Security-Policy" content="'+csp+'"><meta name="referrer" content="no-referrer"><link rel="stylesheet" href="./styles.css"></head><body><div id="auth-root"></div><div id="app-root" hidden><a class="skip-link"'+shell+'</div><script src="./app.js" defer></script></body></html>');
// Downloadable frontend remains complete, using the same exact built JavaScript and CSS.
await writeFile(new URL('WeConvert-CRM-COD.html',root),head+'<meta name="referrer" content="no-referrer"><style>'+await get('dist/styles.css')+'</style></head><body><div id="auth-root"></div><div id="app-root" hidden><a class="skip-link"'+shell+'</div><script>'+ (await get('dist/app.js')).replaceAll('</script','<\\/script')+'</script></body></html>');
// Cloudflare Pages / Workers static assets: HTTP security headers (frame-ancestors only works as a header).
await writeFile(new URL('dist/_headers',root),'/*\n  Content-Security-Policy: '+csp+"; frame-ancestors 'none'\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Strict-Transport-Security: max-age=31536000; includeSubDomains\n\n/index.html\n  Cache-Control: no-cache\n");
console.log('Built WeConvert CRM with the approved workflows and visual guideline. No demo data included.');
