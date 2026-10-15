/* Whole-library queue. Cache Storage is explicit, verified and scoped to this site.
 * No Service Worker. Only the selected sound becomes a temporary Blob URL. */
(function(root) {
  'use strict';
  class BreezeAudioLoader {
    constructor(options = {}) {
      this.env=options.env||root; this.onState=options.onState||(()=>{}); this.onEvent=options.onEvent||(()=>{});
      this.enabled=options.enabled!==false; this.records=new Map(); this.jobs=new Map();
      this.foreground=null; this.playing=false; this.timer=null; this.initialized=false; this.disposed=false;
      this.epoch=0; this.selection=0; this.objectURL=null; this.requested=new Set();
      this.maxAttempts=3; this.maxConcurrent=2; this.availableBytes=Infinity; this.storageWarning='';
      const base=new URL(options.baseURL||this.env.document?.baseURI||'https://example.test/');
      this.baseURL=new URL('./',base); this.cachePrefix=`breeze-audio:${this.baseURL.pathname}:`;
      this.cacheName=this.cachePrefix+'v2'; this.cache=null; this.boot=Promise.resolve(); this.cacheReady=Promise.resolve();this.clearing=false;
      this.supported=!!(this.env.fetch&&this.env.AbortController&&this.env.URL?.createObjectURL);
    }
    now() { return this.env.Date?.now()??Date.now(); }
    emit(event,extra={}) { this.onEvent({event,...extra}); }
    policy() {
      const n=this.env.navigator||{},c=n.connection||n.mozConnection||n.webkitConnection;
      if(!this.supported)return {limit:0,delay:0,reason:'瀏覽器使用直接播放模式'};
      if(!this.enabled)return {limit:0,delay:0,reason:'已暫停整庫背景載入'};
      if(n.onLine===false)return {limit:0,delay:0,reason:'離線中，等待連線後繼續'};
      if(c?.saveData)return {limit:0,delay:0,reason:'省流量模式，已暫停整庫背景載入'};
      const slow=['slow-2g','2g','3g'].includes(c?.effectiveType)||(c?.downlink>0&&c.downlink<1)||c?.rtt>500;
      const hidden=this.env.document?.visibilityState==='hidden';
      return {limit:slow||hidden||this.playing?1:this.maxConcurrent,delay:slow||hidden?1000:20,reason:slow?'慢速網路，整庫以單一請求持續載入':hidden?'頁面在背景，降低整庫載入速度':''};
    }
    snapshot() {
      const values=[...this.records.values()];
      const confirmed=values.filter(r=>r.status==='cached').length,failed=values.filter(r=>r.status==='failed').length;
      const httpOnly=values.filter(r=>r.status==='http-only').length;
      const active=[...this.jobs.values()].filter(j=>!j.controller.signal.aborted).length;
      const policy=this.policy(),total=values.length;
      let text=!this.initialized?'正在檢查已保存的音檔…':confirmed===total&&total?'全部音檔已完成載入':
        confirmed+httpOnly+failed===total&&total?'整庫處理完成，部分音檔未確認保存':policy.reason||`整庫音檔載入中：${confirmed} / ${total}`;
      if(this.foreground)text=`優先載入你選的聲音；已確認快取 ${confirmed} / ${total}`;
      return {total,confirmed,requested:this.requested.size,active,failed,httpOnly,enabled:this.enabled,
        complete:total>0&&confirmed===total,warning:this.storageWarning,text};
    }
    report() { this.onState(this.snapshot()); }
    async estimate() {
      try {
        const value=await this.env.navigator?.storage?.estimate?.();
        if(Number.isFinite(value?.quota)&&Number.isFinite(value?.usage))this.availableBytes=Math.max(0,value.quota-value.usage-16*1024*1024);
      } catch { /* Estimates are advisory; cache.put is the final authority. */ }
    }
    validEntry(response,record) {
      return response?.ok&&response.status===200&&response.headers.get('x-breeze-sha256')===record.voice.sha256&&
        Number(response.headers.get('x-breeze-bytes'))===record.voice.bytes;
    }
    async setLibrary(voices) {
      if(this.records.size) return this.boot;
      for(const voice of voices) {
        try {
          const url=new URL(voice.audioURL||voice.audio,this.baseURL);
          if(url.origin!==this.baseURL.origin||!url.pathname.startsWith(this.baseURL.pathname+'output/')||!url.pathname.toLowerCase().endsWith('.wav')||url.search||url.hash)continue;
          if(!this.records.has(url.href))this.records.set(url.href,{voice:{...voice,audioURL:url.href},status:'pending',attempts:0,due:0,networkFailure:false});
        } catch { /* An invalid entry cannot escape the site or break other records. */ }
      }
      this.report();
      let ready;this.cacheReady=new Promise(resolve=>{ready=resolve;});
      this.boot=(async()=>{
        try {
          if(!this.env.caches||!this.env.crypto?.subtle)throw new Error('Cache Storage 或 SHA256 不可用');
          this.cache=await this.env.caches.open(this.cacheName);
          ready();
          // Only obsolete entries belonging to this library are removed.
          for(const name of await this.env.caches.keys())if(name.startsWith(this.cachePrefix)&&name!==this.cacheName)await this.env.caches.delete(name);
          const keys=await this.cache.keys();
          for(const key of keys) {
            if(this.jobs.has(key.url))continue;
            const record=this.records.get(key.url),response=record?await this.cache.match(key.url):null;
            if(this.jobs.has(key.url))continue;
            if(record&&this.validEntry(response,record))record.status='cached';
            else if(record)record.revalidate=true;
            else await this.cache.delete(key);
          }
          await this.estimate();
        } catch(error) { this.cache=null;for(const r of this.records.values())if(r.status==='cached')r.status='pending';this.storageWarning='無法使用可確認的持久快取；將繼續 HTTP 載入，但不計為已確認保存。';this.emit('storage-unavailable',{message:error.message}); }
        ready();this.initialized=true;this.report();this.schedule(100);
      })();
      return this.boot;
    }
    setEnabled(enabled) { this.enabled=!!enabled;this.reconcile(); }
    setPlaybackActive(playing) { if(this.playing!==!!playing){this.playing=!!playing;this.reconcile();} }
    reconcile(online=false) {
      if(online)for(const r of this.records.values())if(r.status==='failed'&&r.networkFailure){r.status='pending';r.attempts=0;r.due=0;}
      const limit=this.policy().limit;let kept=0;
      for(const job of this.jobs.values())if(job.kind==='background'&&!job.controller.signal.aborted&&++kept>limit)this.cancel(job,'policy');
      this.clearScheduled();this.schedule(100);this.report();
    }
    cancel(job,reason) { if(!job.controller.signal.aborted){this.emit('abort',{url:job.url,kind:job.kind,reason});job.controller.abort();} }
    clearScheduled() { if(this.timer!==null)this.env.clearTimeout(this.timer);this.timer=null; }
    schedule(delay) {
      if(this.disposed||this.clearing||!this.initialized||this.timer!==null||!this.policy().limit||this.foreground)return;
      this.timer=this.env.setTimeout(()=>{this.timer=null;this.pump();},delay??this.policy().delay);
    }
    pump() {
      if(this.disposed||this.clearing||!this.initialized||this.foreground||!this.policy().limit)return;
      const active=[...this.jobs.values()].filter(j=>!j.controller.signal.aborted).length;
      let slots=Math.max(0,this.policy().limit-active),nextDue=Infinity;
      for(const [url,r] of this.records) {
        if(r.status!=='pending'||this.jobs.has(url))continue;
        if(r.due>this.now()){nextDue=Math.min(nextDue,r.due);continue;}
        if(slots-->0)this.start(url,'background').catch(()=>{});
        else break;
      }
      if(![...this.jobs.values()].some(j=>!j.controller.signal.aborted)&&Number.isFinite(nextDue))this.schedule(Math.max(20,nextDue-this.now()));
      this.report();
    }
    async checkBlob(blob,record) {
      if(!blob.size||blob.size!==record.voice.bytes){record.revalidate=true;throw new Error('WAV 大小與索引不符');}
      if(this.env.crypto?.subtle&&/^[a-f0-9]{64}$/i.test(record.voice.sha256||'')) {
        const digest=await this.env.crypto.subtle.digest('SHA-256',await blob.arrayBuffer());
        const hash=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
        if(hash!==record.voice.sha256){record.revalidate=true;throw new Error('WAV SHA256 與索引不符');}
      }
    }
    async savedBlob(url,record,foreground) {
      if(!this.cache)return null;
      try {
        const response=await this.cache.match(url);
        if(this.validEntry(response,record)) {
          if(!foreground){record.status='cached';return true;}
          const blob=await response.blob();await this.checkBlob(blob,record);record.status='cached';this.emit('persistent-hit',{url});return blob;
        }
        if(response){record.revalidate=true;await this.cache.delete(url);}
        if(record.status==='cached')record.status='pending';
      } catch(error){record.revalidate=true;this.emit('cache-read-error',{url,message:error.message});if(record.status==='cached')record.status='pending';try{await this.cache.delete(url);}catch{/* Unavailable storage falls back to HTTP. */}}
      return null;
    }
    async save(url,blob,record,epoch) {
      if(!this.cache||!this.env.crypto?.subtle||!/^[a-f0-9]{64}$/i.test(record.voice.sha256||''))return false;
      try {
        if(this.availableBytes<blob.size){this.storageWarning='儲存空間不足：其餘仍繼續 HTTP 載入，未保存的不計入已確認快取。';return false;}
        const response=new this.env.Response(blob,{headers:{'Content-Type':'audio/wav','x-breeze-sha256':record.voice.sha256,'x-breeze-bytes':String(blob.size)}});
        await this.cache.put(url,response);
        if(epoch!==this.epoch||this.disposed)return false;
        const saved=await this.cache.match(url);
        if(!this.validEntry(saved,record))throw new Error('寫入後無法確認快取');
        this.availableBytes-=blob.size;
        return true;
      } catch(error) {
        this.storageWarning=error.name==='QuotaExceededError'?'儲存配額不足：保留現有快取，其他音檔仍繼續 HTTP 載入。':'部分音檔無法保存；播放器仍可使用 HTTP 載入。';
        this.emit('cache-write-error',{url,name:error.name,message:error.message});await this.estimate();return false;
      }
    }
    start(url,kind,retry=false) {
      const record=this.records.get(url),controller=new this.env.AbortController();
      const job={url,kind,controller,selection:kind==='foreground'?this.selection:null,epoch:this.epoch,timedOut:false,attempted:false};this.jobs.set(url,job);
      const timeout=this.env.setTimeout(()=>{job.timedOut=true;controller.abort();},this.policy().delay>=1000?180000:45000);
      job.promise=(async()=>{
        try {
          if(!retry) {
            const cached=await this.savedBlob(url,record,job.kind==='foreground');
            if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');
            if(cached) {
              // A background cache lookup may have been promoted while awaiting match.
              if(job.kind==='foreground'&&cached===true)return await this.savedBlob(url,record,true);
              return cached;
            }
          }
          if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');
          record.attempts++;job.attempted=true;this.emit('start',{url,kind:job.kind,attempt:record.attempts});
          const response=await this.env.fetch(url,{signal:controller.signal,cache:retry||record.revalidate?'reload':'default',mode:'same-origin',credentials:'same-origin',priority:job.kind==='foreground'?'high':'low'});
          if(!response.ok||response.status!==200)throw new Error(`音訊回應 HTTP ${response.status}`);
          const blob=await response.blob();await this.checkBlob(blob,record);
          if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');
          this.requested.add(url);
          const saved=await this.save(url,blob,record,job.epoch);
          if(job.epoch!==this.epoch||this.disposed)throw new DOMException('Cancelled','AbortError');
          record.status=saved?'cached':'http-only';record.networkFailure=false;record.revalidate=false;
          this.emit('complete',{url,kind:job.kind,saved,bytes:blob.size});
          return blob;
        } catch(error) {
          if(controller.signal.aborted&&!job.timedOut) {if(job.attempted)record.attempts=Math.max(0,record.attempts-1);}
          else {
            record.networkFailure=job.timedOut||error instanceof TypeError;
            record.status=job.kind==='foreground'||record.attempts>=this.maxAttempts?'failed':'pending';
            record.due=this.now()+Math.min(20000,1000*2**Math.max(0,record.attempts-1));
            this.emit('error',{url,kind:job.kind,attempt:record.attempts,message:job.timedOut?'載入逾時':error.message});
          }
          if(job.timedOut)throw new Error('載入逾時，請重試');
          throw error;
        } finally {
          this.env.clearTimeout(timeout);
          if(this.jobs.get(url)===job)this.jobs.delete(url);
          if(job.kind==='foreground'&&job.selection===this.selection&&this.foreground===url&&!this.jobs.has(url))this.foreground=null;
          this.report();this.schedule();
        }
      })();
      this.report();return job.promise;
    }
    acquire(url,retry=false) {
      if(this.clearing)return this.clearPromise.then(()=>this.acquire(url,retry));
      this.clearScheduled();const selection=++this.selection;this.foreground=url;
      for(const job of this.jobs.values())if(job.url!==url)this.cancel(job,'playback-priority');
      const record=this.records.get(url);
      if(!record||!this.supported){this.foreground=null;this.report();this.schedule();return Promise.resolve(url);}
      const existing=this.jobs.get(url);
      let promise;
      if(existing&&!existing.controller.signal.aborted){existing.kind='foreground';existing.selection=selection;this.emit('promote',{url});promise=existing.promise;}
      else {
        promise=this.cacheReady.then(()=>{
          if(selection!==this.selection)throw new DOMException('Superseded','AbortError');
          record.attempts=0;record.status='pending';record.due=0;
          return this.start(url,'foreground',retry);
        });
      }
      this.report();
      return promise.then(blob=>{
        if(selection!==this.selection)throw new DOMException('Superseded','AbortError');
        this.dropObjectURL();this.objectURL=this.env.URL.createObjectURL(blob);return this.objectURL;
      });
    }
    dropObjectURL() {if(this.objectURL)this.env.URL.revokeObjectURL(this.objectURL);this.objectURL=null;}
    release() {++this.selection;this.foreground=null;for(const job of this.jobs.values())if(job.kind==='foreground')this.cancel(job,'playback-stopped');this.dropObjectURL();this.schedule();this.report();}
    retryFailed() {for(const r of this.records.values())if(r.status==='failed'||r.status==='http-only'){r.status='pending';r.attempts=0;r.due=0;}this.estimate().then(()=>this.reconcile());}
    clearCache() {
      if(this.clearing)return this.clearPromise;
      this.clearing=true;this.clearPromise=this.performClear();return this.clearPromise;
    }
    async performClear() {
      this.enabled=false;this.epoch++;this.clearScheduled();this.release();
      const pending=[...this.jobs.values()].map(j=>{this.cancel(j,'clear-cache');return j.promise;});
      await Promise.allSettled(pending);await this.boot;
      try {if(this.env.caches){await this.env.caches.delete(this.cacheName);this.cache=await this.env.caches.open(this.cacheName);}this.storageWarning='';}
      catch {this.cache=null;this.storageWarning='無法清除或開啟音訊快取。';}
      for(const r of this.records.values()){r.status='pending';r.attempts=0;r.due=0;}
      this.requested.clear();this.clearing=false;await this.estimate();this.report();
    }
    dispose() {this.disposed=true;this.clearScheduled();++this.selection;for(const j of this.jobs.values())this.cancel(j,'page-unload');this.dropObjectURL();}
    resume() {this.disposed=false;this.reconcile();}
  }
  if(typeof module!=='undefined'&&module.exports)module.exports=BreezeAudioLoader;
  else root.BreezeAudioLoader=BreezeAudioLoader;
})(typeof window!=='undefined'?window:globalThis);
