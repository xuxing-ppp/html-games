import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
const entry=fileURLToPath(new URL('../tools/dev.mjs',import.meta.url));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function run(env,...args){const child=spawn(process.execPath,[entry,'--no-open',...args],{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.result=new Promise(resolve=>child.on('exit',code=>resolve({code,output})));return child;}
async function waitForState(path){for(let n=0;n<100;n++){try{return JSON.parse(await readFile(path,'utf8'));}catch{await delay(20);}}throw new Error('startup timed out');}
function get(port,path='/',options={}){return new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,path,...options},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode,body,type:res.headers['content-type']}));});req.on('error',reject);req.end();});}
test('Launcher reuses its own game, serves modules, stops and restarts cleanly',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'kart-dev-test-')),stateFile=join(dir,'state.json');const env={KART_DEV_STATE_FILE:stateFile,KART_DEV_PORT:'0'};const children=[];
 t.after(async()=>{for(const c of children)if(c.exitCode===null)c.kill('SIGTERM');await Promise.all(children.map(c=>c.result));await rm(dir,{recursive:true,force:true});});
 const first=run(env);children.push(first);const saved=await waitForState(stateFile);
 assert.match((await get(saved.port)).body,/<title>街机赛车/);
 assert.match((await get(saved.port,'/src/game.js')).type,/javascript/);
 assert.equal((await get(saved.port,'/',{method:'HEAD'})).body,'');
 assert.equal((await get(saved.port,'/__kart_dev/stop',{method:'POST'})).status,403);
 const duplicate=run(env);children.push(duplicate);const reused=await duplicate.result;assert.equal(reused.code,0);assert.match(reused.output,/已经启动/);assert.equal(first.exitCode,null);
 const stop=run(env,'--stop');children.push(stop);assert.equal((await stop.result).code,0);assert.equal((await first.result).code,0);
 await assert.rejects(get(saved.port));
 const again=run({...env,KART_DEV_PORT:String(saved.port)});children.push(again);assert.equal((await waitForState(stateFile)).port,saved.port);
 again.kill('SIGINT');assert.equal((await again.result).code,0);await assert.rejects(get(saved.port));
 const stopped=run(env,'--stop');children.push(stopped);assert.equal((await stopped.result).code,0);
});
test('Busy port falls back without stopping or replacing the unrelated server',async t=>{
 const unrelated=http.createServer((req,res)=>res.end('other app'));
 await new Promise(resolve=>unrelated.listen(0,'127.0.0.1',resolve));const preferred=unrelated.address().port;
 const dir=await mkdtemp(join(tmpdir(),'kart-busy-test-')),stateFile=join(dir,'state.json');const env={KART_DEV_STATE_FILE:stateFile,KART_DEV_PORT:String(preferred)};const first=run(env);
 t.after(async()=>{if(first.exitCode===null)first.kill('SIGTERM');await first.result;await new Promise(resolve=>unrelated.close(resolve));await rm(dir,{recursive:true,force:true});});
 const saved=await waitForState(stateFile);assert.notEqual(saved.port,preferred);assert.equal((await get(preferred)).body,'other app');assert.equal((await get(saved.port)).status,200);
 const stop=run(env,'--stop');assert.equal((await stop.result).code,0);await first.result;assert.equal((await get(preferred)).body,'other app');
});
