'use strict';
(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const audio = $('#audio-player');
  const PAGE_SIZE = 12, MAX_COMPARE = 4;
  const labels = {
    gender: {masculine:'男性聲線', feminine:'女性聲線', neutral:'中性聲線', not_applicable:'不適用', unspecified:'未指定'},
    pitch: {low:'低音', mid:'中音', high:'高音', dynamic:'多變音高'},
    humanity: {human:'人類', nonhuman:'非人類', synthetic:'合成', ambiguous:'難以歸類'},
    speech_rate: {slow:'慢語速', medium:'中等語速', fast:'快語速', dynamic:'多變語速'},
    age: {child:'孩童', teen:'青少年', young_adult:'年輕成人', adult:'成人', older:'年長', unspecified:'年齡未指定', not_applicable:'年齡不適用'}
  };
  const state = {voices:[], filtered:[], byId:new Map(), page:1, current:null, status:'idle', selected:new Set(), loaded:false, volume:.8};
  let searchTimer, toastTimer, loadVersion = 0;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const time = value => { const s = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0; return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; };
  const number = value => Number(value).toLocaleString('zh-TW');
  const idLabel = v => /^tts-design-\d+$/.test(v.id) ? v.id.slice('tts-design-'.length) : v.id;
  const label = (type, value) => labels[type]?.[value] || '未指定';
  const profile = v => v.voice_profile && typeof v.voice_profile === 'object' ? v.voice_profile : {};
  const statusLabel = () => ({idle:'待播放', loading:'載入中…', playing:'播放中', paused:'已暫停', ended:'播放完畢', error:'播放失敗'})[state.status] || '待播放';
  function notify(message) {
    clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false;
    toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3600);
  }
  function safeAudio(path) {
    if (typeof path !== 'string' || !path.startsWith('output/') || /[?#\\]/.test(path)) return null;
    try {
      const url = new URL(path, document.baseURI), directory = new URL('./output/', document.baseURI);
      return url.origin === location.origin && url.pathname.startsWith(directory.pathname) && url.pathname.toLowerCase().endsWith('.wav') ? url.href : null;
    } catch { return null; }
  }
  function saveSelection() {
    try { localStorage.setItem('breeze-compare-v1', JSON.stringify([...state.selected])); } catch { /* Browsing works without persistent storage. */ }
  }
  function card(v, comparison = false) {
    const p = profile(v), selected = state.selected.has(v.id), current = state.current?.id === v.id;
    const wave = Array.from({length:24}, (_, i) => `<i style="--bar:${[11,19,13,27,16,22,10,29,18,24,12,21][i%12]}px"></i>`).join('');
    const tags = [labels.age[p.age], labels.pitch[p.pitch], labels.speech_rate[p.speech_rate]].filter(Boolean);
    return `<article class="voice-card${current?' is-current':''}${current&&state.status==='playing'?' is-playing':''}" data-id="${escape(v.id)}">
      <div class="card-top"><h3 class="voice-id"><span>#</span>${escape(idLabel(v))}</h3><span class="type-tag">${escape(labels.gender[p.gender] || labels.humanity[p.humanity] || '聲音筆記')}</span></div>
      <p class="card-description${comparison?' expanded':''}">${escape(v.description)}</p>
      <button type="button" class="text-button details-toggle" aria-expanded="false" aria-label="查看 ${escape(v.id)} 完整描述與資料">完整筆記 ＋</button>
      <div class="details-body" hidden><p><strong>原文</strong> ${escape(v.original_description || '未提供原文描述。')}</p><p><strong>口音</strong> ${escape(p.accent_raw || '未指定')} · <strong>類型</strong> ${escape(label('humanity',p.humanity))}</p></div>
      <div class="voice-tags">${tags.map(t=>`<span>${escape(t)}</span>`).join('') || '<span>聲線特徵未指定</span>'}</div>
      <div class="card-player"><div class="player-top"><button type="button" class="play-button play-toggle" aria-label="播放 ${escape(v.id)}"${v.audioURL?'':' disabled'}>▶</button><div class="wave-bars" aria-hidden="true">${wave}</div><span class="audio-status">待播放</span></div>
      <div class="seek-row"><input class="seek" type="range" min="0" max="1000" value="0" aria-label="${escape(v.id)} 播放進度"${current?'':' disabled'}><span class="time-label">0:00 / ${time(v.duration)}</span></div>
      <div class="volume-row"><span aria-hidden="true">音量</span><input class="volume" type="range" min="0" max="1" step="0.05" value="${state.volume}" aria-label="${escape(v.id)} 音量"><span class="duration-note">WAV · ${v.sample_rate ? `${number(v.sample_rate/1000)} kHz` : '取樣率未提供'}</span></div>
      <p class="audio-error" hidden></p><button class="text-button retry-audio" type="button" hidden>重新嘗試播放 ↻</button>
      <span class="filename">${escape(v.filename)}</span><div class="card-actions"><button class="compare-toggle" type="button" aria-pressed="${selected}" aria-label="${selected?'移出':'加入'}比較 ${escape(v.id)}">${selected?'✓ 已加入比較':'＋ 加入比較'}</button>${v.audioURL?`<a class="download-link" href="${escape(v.audio)}" download="${escape(v.filename)}" aria-label="下載 ${escape(v.filename)}">下載 WAV ↓</a>`:'<span class="audio-error">音訊路徑無效</span>'}</div></div>
    </article>`;
  }
  function filterVoices() {
    const q = $('#search').value.trim().toLocaleLowerCase();
    const gender = $('#gender').value, pitch = $('#pitch').value, humanity = $('#humanity').value;
    state.filtered = state.voices.filter(v => (!q || v.search.includes(q)) && (!gender || profile(v).gender === gender) && (!pitch || profile(v).pitch === pitch) && (!humanity || profile(v).humanity === humanity));
    const sort = $('#sort').value;
    state.filtered.sort((a,b) => sort === 'short' ? a.duration-b.duration || a.id.localeCompare(b.id,undefined,{numeric:true}) : sort === 'long' ? b.duration-a.duration || a.id.localeCompare(b.id,undefined,{numeric:true}) : (sort === 'id-desc' ? -1 : 1)*a.id.localeCompare(b.id,undefined,{numeric:true}));
    state.page = 1; renderList();
  }
  function renderList() {
    const total = state.filtered.length, pages = Math.max(1, Math.ceil(total/PAGE_SIZE));
    state.page = Math.min(pages, Math.max(1,state.page));
    const start = (state.page-1)*PAGE_SIZE;
    $('#voice-grid').innerHTML = state.filtered.slice(start,start+PAGE_SIZE).map(v=>card(v)).join('');
    $('#voice-grid').setAttribute('aria-busy','false');
    $('#no-results').hidden = !state.loaded || total !== 0;
    $('#results-count').innerHTML = `找到 <strong>${number(total)}</strong> 個聲音 <span>／ 共 ${number(state.voices.length)} 個</span>`;
    $('#page-note').textContent = total ? `${number(start+1)}–${number(Math.min(start+PAGE_SIZE,total))} · 第 ${state.page} / ${pages} 頁` : '';
    const visible = [...new Set([1,pages,state.page-1,state.page,state.page+1])].filter(n=>n>=1&&n<=pages).sort((a,b)=>a-b);
    let last = 0;
    const buttons = visible.map(n=> {const dots = last && n-last>1 ? '<span class="page-ellipsis">…</span>' : ''; last=n;return `${dots}<button class="page-button" type="button" data-page="${n}" aria-label="第 ${n} 頁"${n===state.page?' aria-current="page"':''}>${n}</button>`;}).join('');
    $('#pagination').innerHTML = total ? `<button class="page-button" type="button" data-page="${state.page-1}" aria-label="上一頁"${state.page===1?' disabled':''}>←</button>${buttons}<button class="page-button" type="button" data-page="${state.page+1}" aria-label="下一頁"${state.page===pages?' disabled':''}>→</button>` : '';
    updatePlayback(); updateSelection();
  }
  function renderComparison() {
    $('#compare-grid').innerHTML = [...state.selected].map(id=>state.byId.get(id)).filter(Boolean).map(v=>card(v,true)).join('');
    $('#compare-empty').hidden = state.selected.size>0; updatePlayback(); updateSelection();
  }
  function updateSelection() {
    $$('.compare-count').forEach(el=>el.textContent=state.selected.size);
    $$('.voice-card').forEach(el=> {const selected=state.selected.has(el.dataset.id), button=$('.compare-toggle',el);button.setAttribute('aria-pressed',selected);button.textContent=selected?'✓ 已加入比較':'＋ 加入比較';button.setAttribute('aria-label',`${selected?'移出':'加入'}比較 ${el.dataset.id}`);});
    $('#compare-tray').hidden = state.selected.size===0;
    $('.bottom-dock').hidden = state.selected.size===0 && !state.current;
  }
  function updatePlayback() {
    const playing = state.status==='playing';
    const elapsed = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const duration = Number.isFinite(audio.duration) && audio.duration>0 ? audio.duration : state.current?.duration || 0;
    const progress = duration>0 ? Math.min(1000,Math.round(elapsed/duration*1000)) : 0;
    $$('.voice-card').forEach(el=> {
      const v = state.byId.get(el.dataset.id); if(!v) return;
      const current=state.current?.id===v.id;
      el.classList.toggle('is-current',current); el.classList.toggle('is-playing',current&&playing);
      const button=$('.play-toggle',el);button.textContent=current&&playing?'Ⅱ':'▶';button.setAttribute('aria-label',`${current&&playing?'暫停':'播放'} ${v.id}`);
      $('.audio-status',el).textContent=current?statusLabel():'待播放';
      $('.time-label',el).textContent=`${time(current?elapsed:0)} / ${time(current?duration:v.duration)}`;
      const seek=$('.seek',el);seek.disabled=!current||!Number.isFinite(audio.duration)||state.status==='error';if(document.activeElement!==seek)seek.value=current?progress:0;
      const error=$('.audio-error',el),retry=$('.retry-audio',el);if(error){error.hidden=!current||state.status!=='error';error.textContent=state.error||'找不到音檔或瀏覽器無法播放，請重新嘗試。';}retry.hidden=!current||state.status!=='error';
    });
    $('#now-playing').hidden=!state.current;
    if(state.current){$('#now-id').textContent=`#${idLabel(state.current)}`;$('#now-status').textContent=statusLabel();$('#now-time').textContent=`${time(elapsed)} / ${time(duration)}`;$('.now-toggle').textContent=playing?'Ⅱ':'▶';$('.now-toggle').setAttribute('aria-label',playing?'暫停目前聲音':'播放目前聲音');$('#now-seek').disabled=!Number.isFinite(audio.duration)||state.status==='error';if(document.activeElement!==$('#now-seek'))$('#now-seek').value=progress;}
    $('.bottom-dock').hidden=state.selected.size===0&&!state.current;
  }
  function failPlayback(message) {state.status='error';state.error=message;updatePlayback();}
  async function playVoice(v, retry=false) {
    if(!v?.audioURL){notify('這個聲音的路徑無效，請選擇其他聲音。');return;}
    if(state.current?.id===v.id && state.status==='playing' && !retry){audio.pause();return;}
    if(state.current?.id!==v.id || retry || state.status==='error'){
      audio.pause();state.current=v;state.status='loading';state.error='';audio.src=v.audioURL;audio.volume=state.volume;audio.load();
    } else if(audio.ended){audio.currentTime=0;}
    state.status='loading';updatePlayback();
    try {await audio.play();}
    catch(error){if(state.current?.id!==v.id||error.name==='AbortError')return;failPlayback(error.name==='NotAllowedError'?'瀏覽器尚未允許播放。請再次按播放按鈕。':'無法載入或播放這個 WAV。請確認網路後重新嘗試。');}
  }
  function stopPlayback() {audio.pause();audio.removeAttribute('src');audio.load();state.current=null;state.status='idle';updatePlayback();updateSelection();}
  function resetFilters() {$('#search').value='';['gender','pitch','humanity'].forEach(id=>$('#'+id).value='');$('#sort').value='id';clearTimeout(searchTimer);filterVoices();}
  async function loadIndex() {
    const version=++loadVersion;
    $('#load-error').hidden=true;$('#voice-grid').setAttribute('aria-busy','true');$('#voice-grid').innerHTML='<p class="loading-note">正在翻開聲音筆記…</p>';
    try {
      const response=await fetch(new URL('./data/voices.json',document.baseURI));
      if(!response.ok)throw new Error(`索引回應 HTTP ${response.status}`);
      const index=await response.json();if(version!==loadVersion)return;
      const rows=Array.isArray(index)?index:index.voices;if(!Array.isArray(rows))throw new Error('索引資料格式不正確');
      const seen=new Set();
      state.voices=rows.filter(v=>v&&typeof v==='object').map((v,i)=>{
        const id=String(v.id||v.filename||`voice-${i+1}`),filename=String(v.filename||'未提供檔名'),description=String(v.description||'尚未提供聲音描述。');
        return {...v,id,filename,description,duration:Number(v.duration)||0,audioURL:safeAudio(v.audio),search:[id,filename,description,v.original_description||'',profile(v).accent_raw||''].join(' ').toLocaleLowerCase()};
      }).filter(v=>{if(seen.has(v.id))return false;seen.add(v.id);return true;});
      if(!state.voices.length)throw new Error('索引中沒有可用聲音');
      state.byId=new Map(state.voices.map(v=>[v.id,v]));state.loaded=true;
      try{const saved=JSON.parse(localStorage.getItem('breeze-compare-v1')||'[]');if(Array.isArray(saved))state.selected=new Set(saved.filter(id=>state.byId.has(id)).slice(0,MAX_COMPARE));}catch{state.selected=new Set();}
      $('#total-count').textContent=number(state.voices.length);$('#available-count').textContent=number(state.voices.filter(v=>v.audioURL&&v.available!==false).length);
      $('#random-play').disabled=false;filterVoices();renderComparison();
    }catch(error){if(version!==loadVersion)return;$('#voice-grid').innerHTML='';$('#voice-grid').setAttribute('aria-busy','false');$('#load-error').hidden=false;$('#load-error-text').textContent=`${error.message}。請確認網路連線，再按重新載入。`;$('#results-count').textContent='聲音索引載入失敗';}
  }
  document.addEventListener('click',event=>{
    const target=event.target.closest('button');if(!target)return;
    const article=target.closest('.voice-card'),v=article?state.byId.get(article.dataset.id):null;
    if(target.matches('.play-toggle,.retry-audio'))playVoice(v,target.matches('.retry-audio'));
    else if(target.matches('.compare-toggle')&&v){
      if(state.selected.has(v.id))state.selected.delete(v.id);
      else if(state.selected.size>=MAX_COMPARE){notify('比較清單最多放 4 個聲音，先移除一個再加入。');return;}
      else state.selected.add(v.id);
      saveSelection();updateSelection();if($('#compare-dialog').open)renderComparison();
    }else if(target.matches('.compare-open')){renderComparison();$('#compare-dialog').showModal();}
    else if(target.matches('.close-dialog'))$('#compare-dialog').close();
    else if(target.matches('.clear-compare')){state.selected.clear();saveSelection();updateSelection();if($('#compare-dialog').open)renderComparison();}
    else if(target.matches('.details-toggle')&&article){const expanded=target.getAttribute('aria-expanded')!=='true';target.setAttribute('aria-expanded',expanded);target.textContent=expanded?'收起筆記 −':'完整筆記 ＋';$('.details-body',article).hidden=!expanded;$('.card-description',article).classList.toggle('expanded',expanded||article.closest('#compare-grid'));}
    else if(target.matches('.page-button')){state.page=Number(target.dataset.page);renderList();$('#library').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});$('#library-title').setAttribute('tabindex','-1');$('#library-title').focus({preventScroll:true});}
    else if(target.matches('.reset-filters'))resetFilters();
    else if(target.matches('.retry-index'))loadIndex();
    else if(target.matches('.now-toggle'))playVoice(state.current,state.status==='error');
    else if(target.matches('.now-stop'))stopPlayback();
  });
  document.addEventListener('input',event=>{
    const el=event.target;
    if(el.matches('.volume')){state.volume=Number(el.value);audio.volume=state.volume;$$('.volume').forEach(v=>{if(v!==el)v.value=el.value;});}
    if(el.matches('.seek,#now-seek')&&Number.isFinite(audio.duration)&&audio.duration>0){audio.currentTime=Number(el.value)/1000*audio.duration;updatePlayback();}
  });
  $('#search-form').addEventListener('submit',event=>{event.preventDefault();clearTimeout(searchTimer);filterVoices();});
  $('#search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(filterVoices,160);});
  ['gender','pitch','humanity','sort'].forEach(id=>$('#'+id).addEventListener('change',filterVoices));
  $('#random-play').addEventListener('click',()=>{if(!state.filtered.length){notify('先清除篩選，就能隨機試聽。');return;}const i=Math.floor(Math.random()*state.filtered.length);state.page=Math.floor(i/PAGE_SIZE)+1;renderList();playVoice(state.filtered[i]);});
  document.addEventListener('keydown',event=>{if(event.key==='/'&&!event.ctrlKey&&!event.metaKey&&!$('#compare-dialog').open&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){event.preventDefault();$('#search').focus();}});
  audio.addEventListener('playing',()=>{if(!state.current)return;state.status='playing';updatePlayback();});
  audio.addEventListener('pause',()=>{if(!state.current||state.status==='error'||audio.ended)return;state.status='paused';updatePlayback();});
  audio.addEventListener('waiting',()=>{if(state.current){state.status='loading';updatePlayback();}});
  audio.addEventListener('ended',()=>{if(state.current){state.status='ended';updatePlayback();}});
  ['timeupdate','durationchange','loadedmetadata','seeked'].forEach(name=>audio.addEventListener(name,updatePlayback));
  audio.addEventListener('error',()=>{if(state.current&&audio.getAttribute('src'))failPlayback('找不到音檔、網路中斷，或瀏覽器無法解碼這個 WAV。請重新嘗試或下載檔案。');});
  loadIndex();
})();
