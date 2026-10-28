import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('delivered frontend retains every approved base CSS rule after the font update',()=>{
 const reference=readFileSync('references/approved-frontend.html','utf8');
 const base=reference.split('<style>')[1].split('</style>')[0];
 const current=readFileSync('src/style.css','utf8');
 assert.equal(current.replace(/^@import url\('https:\/\/fonts\.googleapis\.com\/css2\?family=Noto\+Sans\+Arabic[^\n]+\n/m,base.match(/^@import[^\n]+\n/m)[0]),base);
 assert.ok(readFileSync('dist/styles.css','utf8').startsWith(current));
 assert.ok(readFileSync('dist/styles.css','utf8').includes('.wc-kpi-spark'));
});
test('published app contains neither a service credential nor visual QA data',()=>{
 const code=readFileSync('dist/app.js','utf8');
 // The SDK itself mentions the prefix when rejecting secret keys in browsers.
 assert.ok(!/sb_secret_[A-Za-z0-9_-]{20,}/.test(code));
 assert.ok(!code.includes('20000000-0000-4000-8000-000000000005'));
 assert.ok(!code.includes('Test visuel · données fictives'));
 assert.ok(!code.includes('weconvert-cod-studio-v1'));
 assert.ok(JSON.parse(readFileSync('src/config.json','utf8')).key.startsWith('sb_publishable_'));
});
