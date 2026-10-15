const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const Loader=require('../assets/js/audio-loader.js');
const hash=b=>createHash('sha256').update(b).digest('hex');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,{count=10,manual=false,fail=[],quota=false,storage=true,shared}={}) {
  let clock=0,serial=0,putCount=0;
  const timers=new Map(),calls=[],events=[],revoked=[],objects=new Set();
  const stores=shared||new Map();
  const voices=Array.from({length:count},(_,i)=>{const body=Buffer.from(`WAV ${String(i).padStart(6,'0')} test audio`);return {audioURL:`https://example.test/library/output/${i}.wav`,bytes:body.length,sha256:hash(body),body};});
  const env={Date:{now:()=>clock},document:{baseURI:'https://example.test/library/',visibilityState:'visible'},
    navigator:{onLine:true,storage:{estimate:async()=>({quota:1e10,usage:0})}},Response,AbortController,
    crypto:{subtle:{digest:async(_,buffer)=>new Uint8Array(createHash('sha256').update(Buffer.from(buffer)).digest()).buffer}},
    URL:{createObjectURL:()=>{const url=`blob:test-${++serial}`;objects.add(url);return url;},revokeObjectURL:url=>{objects.delete(url);revoked.push(url);}},
    setTimeout:(fn,delay)=>{const id=++serial;timers.set(id,{fn,when:clock+delay});return id;},clearTimeout:id=>timers.delete(id),
    fetch:(url,options)=>new Promise((resolve,reject)=>{
      const v=voices.find(v=>v.audioURL===url),call={url,options,resolve:()=>{if(fail.includes(url))resolve(new Response('404',{status:404}));else resolve(new Response(new Blob([v.body])));},reject};calls.push(call);
      options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});
      if(!manual)queueMicrotask(call.resolve);
    })};
  if(storage)env.caches={keys:async()=>[...stores.keys()],delete:async name=>stores.delete(name),open:async name=>{
    if(!stores.has(name))stores.set(name,new Map());const entries=stores.get(name);
    return {keys:async()=>[...entries.keys()].map(url=>new Request(url)),match:async key=>entries.get(typeof key==='string'?key:key.url)?.clone(),
      delete:async key=>entries.delete(typeof key==='string'?key:key.url),put:async(url,response)=>{if(quota)throw new DOMException('full','QuotaExceededError');putCount++;entries.set(url,response.clone());}};
  }};
  const loader=new Loader({env,onEvent:e=>events.push(e)});t.after(()=>loader.dispose());
  async function drain() {
    for(let i=0;i<count*8+100;i++) {
      await flush();
      const active=[...loader.jobs.values()].map(j=>j.promise.catch(()=>null));if(active.length)await Promise.all(active);
      const s=loader.snapshot();if(s.confirmed+s.httpOnly+s.failed===count&&!loader.jobs.size)return s;
      const next=[...timers].sort((a,b)=>a[1].when-b[1].when)[0];
      if(!next)throw new Error('Queue stopped before processing all entries');
      timers.delete(next[0]);clock=next[1].when;next[1].fn();
    }
    throw new Error('Unbounded queue');
  }
  return {loader,env,voices,calls,events,stores,objects,revoked,drain,get puts(){return putCount;}};
}

test('all 1000 real queue entries are processed and confirmed, not just the first page',async t=>{
  const f=fixture(t,{count:1000});await f.loader.setLibrary(f.voices);assert.equal(f.loader.records.size,1000);
  const s=await f.drain();assert.equal(s.confirmed,1000);assert.equal(s.complete,true);assert.equal(f.puts,1000);assert.equal(f.calls.length,1000);
  assert.equal(f.objects.size,0);
});
test('background concurrency stays at two and playback reduces it without stopping the library',async t=>{
  const f=fixture(t,{manual:true});await f.loader.setLibrary(f.voices);f.loader.pump();await flush();assert.equal(f.calls.length,2);
  f.loader.pump();await flush();assert.equal(f.calls.length,2);f.loader.setPlaybackActive(true);
  assert.equal([...f.loader.jobs.values()].filter(j=>!j.controller.signal.aborted).length,1);
  f.calls[0].resolve();await flush();
  f.loader.setPlaybackActive(false);f.loader.pump();await flush();assert([...f.loader.jobs.values()].filter(j=>!j.controller.signal.aborted).length<=2);
});
test('selected foreground starts without waiting for unrelated background',async t=>{
  const f=fixture(t,{manual:true});await f.loader.setLibrary(f.voices);f.loader.pump();await flush();
  const p=f.loader.acquire(f.voices[9].audioURL);await flush();assert(f.calls[0].options.signal.aborted);assert(f.calls[1].options.signal.aborted);
  assert.equal(f.calls.at(-1).url,f.voices[9].audioURL);assert.equal(f.calls.at(-1).options.priority,'high');f.calls.at(-1).resolve();await p;
});
test('in-flight background is promoted with no duplicate fetch',async t=>{
  const f=fixture(t,{manual:true});await f.loader.setLibrary(f.voices);f.loader.pump();await flush();
  const p=f.loader.acquire(f.voices[0].audioURL);await flush();assert.equal(f.calls.filter(c=>c.url===f.voices[0].audioURL).length,1);
  f.calls[0].resolve();assert.match(await p,/^blob:/);assert(f.events.some(e=>e.event==='promote'));
});
test('rapid selections cannot hand an old sound to the player and retain only one Blob URL',async t=>{
  const f=fixture(t,{manual:true});await f.loader.setLibrary(f.voices);
  const old=f.loader.acquire(f.voices[1].audioURL).catch(e=>e.name);await flush();
  const current=f.loader.acquire(f.voices[2].audioURL);await flush();f.calls.at(-1).resolve();await current;
  assert.equal(await old,'AbortError');assert.equal(f.objects.size,1);
  const next=f.loader.acquire(f.voices[3].audioURL);await flush();f.calls.at(-1).resolve();await next;assert.equal(f.objects.size,1);assert(f.revoked.length>0);
});
test('three failed attempts are terminal and do not block all other entries',async t=>{
  const f=fixture(t);f.env.fetch=((original)=> (url,options)=>url===f.voices[0].audioURL?Promise.resolve(new Response('404',{status:404})):original(url,options))(f.env.fetch);
  await f.loader.setLibrary(f.voices);const s=await f.drain();assert.equal(s.failed,1);assert.equal(s.confirmed,9);assert.equal(f.loader.records.get(f.voices[0].audioURL).attempts,3);
});
test('pause and resume preserve completed entries and process the rest',async t=>{
  const f=fixture(t);await f.loader.setLibrary(f.voices);f.loader.setEnabled(false);f.loader.pump();await flush();assert.equal(f.calls.length,0);
  f.loader.setEnabled(true);assert.equal((await f.drain()).confirmed,10);const calls=f.calls.length;
  f.loader.setEnabled(false);f.loader.setEnabled(true);f.loader.pump();await flush();assert.equal(f.calls.length,calls);
});
test('offline recovery resumes the remaining queue',async t=>{
  const f=fixture(t);f.env.navigator.onLine=false;await f.loader.setLibrary(f.voices);f.loader.pump();await flush();assert.equal(f.calls.length,0);
  f.env.navigator.onLine=true;f.loader.reconcile(true);assert.equal((await f.drain()).confirmed,10);
});
test('saveData pauses; slow network and hidden page still process the whole library at one request',async t=>{
  const f=fixture(t);f.env.navigator.connection={saveData:true};await f.loader.setLibrary(f.voices);f.loader.pump();await flush();assert.equal(f.calls.length,0);
  f.env.navigator.connection={effectiveType:'2g'};f.env.document.visibilityState='hidden';assert.equal(f.loader.policy().limit,1);
  f.loader.reconcile();assert.equal((await f.drain()).confirmed,10);
});
test('quota errors continue HTTP processing and never count as confirmed cache or break playback',async t=>{
  const f=fixture(t,{quota:true});await f.loader.setLibrary(f.voices);const s=await f.drain();
  assert.equal(s.confirmed,0);assert.equal(s.httpOnly,10);assert.equal(s.requested,10);assert.equal(s.complete,false);assert(s.warning.includes('配額'));
  assert.match(await f.loader.acquire(f.voices[0].audioURL),/^blob:/);
});
test('refresh restores confirmed entries and playback reads persistent cache without a fetch',async t=>{
  const f=fixture(t);await f.loader.setLibrary(f.voices);await f.drain();
  const second=fixture(t,{shared:f.stores});await second.loader.setLibrary(second.voices);
  assert.equal(second.loader.snapshot().confirmed,10);await second.loader.acquire(second.voices[9].audioURL);assert.equal(second.calls.length,0);assert(second.events.some(e=>e.event==='persistent-hit'));
});
test('missing Cache Storage degrades honestly to HTTP-only completion and working playback',async t=>{
  const f=fixture(t,{storage:false});await f.loader.setLibrary(f.voices);const s=await f.drain();assert.equal(s.confirmed,0);assert.equal(s.httpOnly,10);assert(!s.complete);
  assert.match(await f.loader.acquire(f.voices[0].audioURL),/^blob:/);
});
test('clear affects only this library, pauses work and allows later manual playback',async t=>{
  const f=fixture(t);await f.loader.setLibrary(f.voices);await f.drain();f.stores.set('other-application',new Map());
  await f.loader.clearCache();assert(f.stores.has('other-application'));assert.equal(f.loader.snapshot().confirmed,0);assert.equal(f.loader.enabled,false);
  assert.match(await f.loader.acquire(f.voices[1].audioURL),/^blob:/);
});
test('changed index SHA invalidates the old cache entry',async t=>{
  const f=fixture(t);await f.loader.setLibrary(f.voices);await f.drain();
  const second=fixture(t,{shared:f.stores});second.voices[0].sha256='0'.repeat(64);await second.loader.setLibrary(second.voices);assert.equal(second.loader.snapshot().confirmed,9);
});
test('updated audio revision refreshes stale HTTP data and saves only the changed file',async t=>{
  const f=fixture(t);await f.loader.setLibrary(f.voices);await f.drain();
  const next=fixture(t,{shared:f.stores});next.voices[0].body=Buffer.from('A changed audio revision');next.voices[0].bytes=next.voices[0].body.length;next.voices[0].sha256=hash(next.voices[0].body);
  await next.loader.setLibrary(next.voices);const result=await next.drain();
  assert.equal(result.confirmed,10);assert.equal(next.calls.length,1);assert.equal(next.calls[0].options.cache,'reload');
});
test('foreground does not wait for a full-library startup cache scan',async t=>{
  const f=fixture(t);const open=f.env.caches.open;let unblock;
  f.env.caches.open=async name=>{const cache=await open(name);cache.keys=()=>new Promise(resolve=>{unblock=()=>resolve([]);});return cache;};
  const boot=f.loader.setLibrary(f.voices);await flush();
  await f.loader.acquire(f.voices[9].audioURL);assert.equal(f.calls.length,1);assert.equal(f.loader.initialized,false);
  unblock();await boot;assert.equal((await f.drain()).confirmed,10);
});
test('a cancelled same-URL job cannot clear the newer playback priority',async t=>{
  const f=fixture(t,{manual:true});await f.loader.setLibrary(f.voices);const url=f.voices[1].audioURL;
  const old=f.loader.acquire(url).catch(()=>null);await flush();f.loader.release();
  const current=f.loader.acquire(url);await flush();assert.equal(f.loader.foreground,url);
  f.loader.pump();await flush();assert.equal(f.calls.length,2);f.calls.at(-1).resolve();await current;await old;
});
