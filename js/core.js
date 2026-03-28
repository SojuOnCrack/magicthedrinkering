/* CommanderForge — core: esc, Bus, IDB, Store, Partner, Parser, SF, ScryfallBulk */

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}

/* ═══ STORE ════════════════════════════════════════════════ */
/* ═══ EVENT BUS — replaces setTimeout hacks ═══════════════════
   Bus.on('deck:saved', cb)  Bus.emit('deck:saved', payload)
   ═══════════════════════════════════════════════════════════ */
const Bus={
  _listeners:{},
  on(event,cb){(this._listeners[event]||(this._listeners[event]=[])).push(cb);},
  off(event,cb){if(this._listeners[event])this._listeners[event]=this._listeners[event].filter(x=>x!==cb);},
  emit(event,data){(this._listeners[event]||[]).forEach(cb=>{try{cb(data);}catch(e){console.warn('[Bus]',event,e);}});}
};

/* ═══ IDB — IndexedDB wrapper for card cache (handles 20k+ cards) ═══ */
const IDB={
  _db:null,_ready:false,_queue:[],
  DB_NAME:'cforge_idb',DB_VER:1,STORE:'cards',
  open(){
    return new Promise((res,rej)=>{
      if(this._db){res(this._db);return;}
      const req=indexedDB.open(this.DB_NAME,this.DB_VER);
      req.onupgradeneeded=e=>{
        const db=e.target.result;
        if(!db.objectStoreNames.contains(this.STORE))
          db.createObjectStore(this.STORE,{keyPath:'name'});
      };
      req.onsuccess=e=>{this._db=e.target.result;this._ready=true;res(this._db);};
      req.onerror=()=>rej(req.error);
    });
  },
  async get(name){
    try{
      const db=await this.open();
      return new Promise((res,rej)=>{
        const tx=db.transaction(this.STORE,'readonly');
        const req=tx.objectStore(this.STORE).get(name);
        req.onsuccess=()=>res(req.result||null);
        req.onerror=()=>res(null);
      });
    }catch{return null;}
  },
  async set(name,data){
    try{
      const db=await this.open();
      return new Promise((res,rej)=>{
        const tx=db.transaction(this.STORE,'readwrite');
        tx.objectStore(this.STORE).put({name,...data});
        tx.oncomplete=()=>res();
        tx.onerror=()=>res();
      });
    }catch{}
  },
  async setBulk(entries){
    /* entries: array of slim card objects, each must have a .name */
    try{
      const db=await this.open();
      return new Promise((res)=>{
        const tx=db.transaction(this.STORE,'readwrite');
        const store=tx.objectStore(this.STORE);
        for(const e of entries)store.put(e);
        tx.oncomplete=()=>res();
        tx.onerror=()=>res();
      });
    }catch{}
  },
  async getAll(){
    try{
      const db=await this.open();
      return new Promise((res)=>{
        const tx=db.transaction(this.STORE,'readonly');
        const req=tx.objectStore(this.STORE).getAll();
        req.onsuccess=()=>res(req.result||[]);
        req.onerror=()=>res([]);
      });
    }catch{return[];}
  },
  async count(){
    try{
      const db=await this.open();
      return new Promise((res)=>{
        const req=db.transaction(this.STORE,'readonly').objectStore(this.STORE).count();
        req.onsuccess=()=>res(req.result||0);
        req.onerror=()=>res(0);
      });
    }catch{return 0;}
  },

  /* Fast boot: get just the card names (keys only, no data) */
  async getAllKeys(){
    try{
      const db=await this.open();
      return new Promise((res)=>{
        const tx=db.transaction(this.STORE,'readonly');
        const req=tx.objectStore(this.STORE).getAllKeys();
        req.onsuccess=()=>res(req.result||[]);
        req.onerror=()=>res([]);
      });
    }catch{return[];}
  },

  /* Get multiple cards by name in one transaction */
  async getMany(names){
    try{
      const db=await this.open();
      return new Promise((res)=>{
        const results={};
        const tx=db.transaction(this.STORE,'readonly');
        const store=tx.objectStore(this.STORE);
        let pending=names.length;
        if(!pending){res(results);return;}
        for(const name of names){
          const req=store.get(name);
          req.onsuccess=()=>{
            if(req.result)results[req.result.name]=req.result;
            if(--pending===0)res(results);
          };
          req.onerror=()=>{if(--pending===0)res(results);};
        }
      });
    }catch{return{};}
  }
};

const Store={
  DK:'cforge_decks4',CUR:'cforge_cur4',AK:'cforge_alerts4',
  decks:[],cache:{},alerts:[],
  /* cache is in-memory; IDB is the persistent backing store.
     On load we pull ALL card objects from IDB into this.cache
     so synchronous Store.card(name) lookups still work everywhere. */
  /* Lazy boot: populate Store.cachedNames (Set) from IDB keys only.
     Full card objects are loaded on-demand via _ensureCards(names[]).
     This turns a 300-500ms boot-blocker into a ~20ms key scan. */
  _cachedNames:null,
  async loadCache(){
    /* Phase 1 (fast): load all keys into a Set so Store.card() knows
       which names are in IDB without loading any data yet. */
    const keys=await IDB.getAllKeys();
    this._cachedNames=new Set(keys);
    /* Phase 2 (lazy): actual card objects come from IDB on demand.
       Pre-warm with the active deck's cards so first render is instant. */
  },
  /* Load card objects for a list of names from IDB into cache (batch) */
  async warmCards(names){
    const missing=names.filter(n=>n&&!this.cache[n]&&this._cachedNames?.has(n));
    if(!missing.length)return;
    const found=await IDB.getMany(missing);
    Object.assign(this.cache,found);
  },
  card(n){
    /* Synchronous lookup — returns null if not yet warmed.
       Caller should warm first via Store.warmCards([n]) */
    return this.cache[n]||null;
  },
  load(){
    try{this.decks=JSON.parse(localStorage.getItem(this.DK)||'[]')}catch{this.decks=[]}
    try{this.alerts=JSON.parse(localStorage.getItem(this.AK)||'[]')}catch{this.alerts=[]}
  },
  saveDecks(){try{localStorage.setItem(this.DK,JSON.stringify(this.decks))}catch{Notify.show('Storage full!','err')}},
  /* saveCache is now async + debounced — writes to IDB only */
  _saveCacheTimer:null,
  saveCache(){
    clearTimeout(this._saveCacheTimer);
    this._saveCacheTimer=setTimeout(()=>{
      const entries=Object.values(this.cache);
      if(entries.length)IDB.setBulk(entries);
    },500);
  },
  saveCur(id){localStorage.setItem(this.CUR,id||'')},
  getCur(){return localStorage.getItem(this.CUR)||''},
  saveAlerts(){try{localStorage.setItem(this.AK,JSON.stringify(this.alerts))}catch{}},
  getDeck(id){return this.decks.find(d=>d.id===id)||null},
  addDeck(d){
    const deck={...d,updated:d?.updated||Date.now(),cloudUpdatedAt:d?.cloudUpdatedAt||0};
    this.decks.push(deck);this.saveDecks();Bus.emit('decks:changed');if(typeof Dashboard!=='undefined')Dashboard.markDirty();
  },
  updDeck(d){
    const i=this.decks.findIndex(x=>x.id===d.id);
    if(i>=0){
      this.decks[i]={...d,updated:Date.now(),cloudUpdatedAt:d?.cloudUpdatedAt||this.decks[i]?.cloudUpdatedAt||0};
      this.saveDecks();Bus.emit('decks:changed');if(typeof Dashboard!=='undefined')Dashboard.markDirty();
    }
  },
  delDeck(id){this.decks=this.decks.filter(d=>d.id!==id);this.saveDecks();Bus.emit('decks:changed');},
  setCard(n,d){
    this.cache[n]=d;
    if(this._cachedNames)this._cachedNames.add(n);
    if(d?.name&&this._cachedNames)this._cachedNames.add(d.name);
    IDB.set(n,d);
  },
  uid(){return 'd'+Date.now()+Math.random().toString(36).slice(2,6)}
};

/* ═══ PARTNER DETECTION ════════════════════════════════════ */
const Partner={
  // Oracle text keywords that enable a second commander
  PARTNER_KEYS:['partner','choose a background','friends forever'],
  hasPartner(cardData){
    if(!cardData) return false;
    const oracle=(cardData.oracle_text||'').toLowerCase();
    return this.PARTNER_KEYS.some(k=>oracle.includes(k));
  },
  partnerType(cardData){
    if(!cardData) return null;
    const oracle=(cardData.oracle_text||'').toLowerCase();
    if(oracle.includes('choose a background')) return 'background';
    if(oracle.includes('friends forever')) return 'friends';
    if(oracle.includes('partner with')) return 'partner_with';
    if(oracle.includes('partner')) return 'partner';
    return null;
  },
  label(type){
    const map={background:'Background',friends:'Friends Forever',partner_with:'Partner With',partner:'Partner'};
    return map[type]||'Partner';
  }
};

/* ═══ PARSER ═══════════════════════════════════════════════ */
const Parser={
  /* Parse a single card line — returns {name, qty, foil, etched, set, collector_number} */
  parseLine(line){
    if(!line||/^(\/\/|SB:)/i.test(line.trim()))return null;
    const l=line.trim();
    // Format: "1x Card Name (SET) 123 *F*"  or  "1 Card Name (SET) *F*"  or  "1 Card Name"
    const m=l.match(/^(\d+)[x\u00D7]?\s+(.+?)(?:\s+\(([A-Z0-9]{2,6})\)(?:\s+(\S+))?)?(?:\s+\*[EF]\*)*\s*$/i);
    if(!m)return null;
    const qty=parseInt(m[1],10)||1;
    let name=m[2].trim();
    const setCode=(m[3]||'').toLowerCase();
    const collNum=m[4]||'';
    const foil=/\*F\*/i.test(l);
    const etched=/\*E\*/i.test(l);
    // Strip any leftover (SET) from name just in case
    name=name.replace(/\s+\([A-Z0-9]{2,6}\).*/i,'').trim();
    if(!name)return null;
    const entry={name,qty,foil,etched};
    if(setCode){entry.set=setCode;}
    if(collNum){
      let cleanCn=collNum.replace(/\s*[*][EF][*]/gi,'').trim();
      cleanCn=cleanCn.replace(/^#/,'').replace(/[),.;:]$/g,'');
      if(cleanCn.includes('/'))cleanCn=cleanCn.split('/')[0];
      cleanCn=cleanCn.replace(/[^0-9a-z]+/gi,'');
      const digitLead=cleanCn.match(/^\d+[a-z]?/i);
      if(digitLead)cleanCn=digitLead[0];
      if(cleanCn)entry.collector_number=cleanCn;
    }
    return entry;
  },

  parse(text){
    const lines=text.split('\n');
    let commander=null,partner=null,cards=[],name='Imported Deck',isCmd=false,isPartner=false;
    for(const raw of lines){
      const line=raw.trim();
      if(!line) continue;
      if(line.startsWith('//')){
        const h=line.slice(2).trim().toLowerCase();
        if(h==='commander'||h==='commanders') isCmd=true;
        else if(h==='partner'||h==='background'||h==='co-commander'){isPartner=true;isCmd=false;}
        else{isCmd=false;isPartner=false;if(h) name=line.slice(2).trim()||name;}
        continue;
      }
      if(/^SB:/i.test(line)) continue;
      const entry=this.parseLine(line);
      if(!entry) continue;
      if(isCmd&&!commander){commander=entry.name;isCmd=false;}
      else if(isPartner&&!partner){partner=entry.name;isPartner=false;}
      cards.push(entry);
    }
    return{commander,partner,cards,name};
  },

  exportTxt(deck,format='moxfield'){
    const lines=[];
    if(deck.commander){
      lines.push('// COMMANDER');
      lines.push(`1 ${deck.commander}`);
      if(deck.partner) lines.push(`1 ${deck.partner}`);
      lines.push('');
    }
    const cmdrs=[deck.commander,deck.partner].filter(Boolean);
    const others=deck.cards.filter(c=>!cmdrs.includes(c.name));
    const lands=[],spells=[];
    for(const c of others){const cd=Store.card(c.name);if((cd?.type_line||'').toLowerCase().includes('land'))lands.push(c);else spells.push(c);}
    const fmt=arr=>arr.sort((a,b)=>a.name.localeCompare(b.name)).map(c=>{
      if(format==='csv') return `"${c.name}",${c.qty},${c.foil?'foil':''},${parseFloat(Store.card(c.name)?.prices?.eur||0).toFixed(2)}`;
      const flags=[c.foil&&'*F*',c.etched&&'*E*'].filter(Boolean).join(' ');
      const printInfo=c.set
        ?` (${String(c.set).toUpperCase()})${c.collector_number?' '+c.collector_number:''}`
        :'';
      return `${c.qty} ${c.name}${printInfo}${flags?' '+flags:''}`;
    });
    if(format==='csv'){lines.length=0;lines.push('Name,Qty,Foil,Price_EUR');}
    if(lands.length){if(format!=='csv')lines.push('// Lands');lines.push(...fmt(lands),'');}
    if(spells.length){if(format!=='csv')lines.push('// Spells');lines.push(...fmt(spells),'');}
    return lines.join('\n');
  }
};

/* ═══ SCRYFALL ═════════════════════════════════════════════ */
const SF={
  // Cloudflare Pages Edge Proxy — cached am Edge, kein direktes Scryfall-Rate-Limit
  BASE:'/api/scryfall',
  _q:[],_run:false,_delay:80,
  BATCH_SIZE:75,
  BATCH_DELAY:50,      /* reduced from 120ms — between parallel rounds */
  PARALLEL_CHUNKS:3,   /* send 3 chunks simultaneously (270ms wait per round, ~10req/s safe) */
  _abortCtrl:null,  /* cancel in-flight batch when switching decks */

  fetch(name,cb){
    const cached=Store.card(name);if(cached){cb(cached);return;}
    this._q.push({name,cb});if(!this._run)this._go();
  },

  cancelBatch(){
    if(this._abortCtrl){this._abortCtrl.abort();this._abortCtrl=null;}
  },

  async _fetchWithRetry(url,opts,retries=3){
    for(let attempt=0;attempt<retries;attempt++){
      try{
        const r=await fetch(url,opts);
        if(r.status===429){
          const wait=Math.pow(2,attempt)*1000;
          await new Promise(res=>setTimeout(res,wait));
          continue;
        }
        return r;
      }catch(e){
        if(opts.signal?.aborted)return null;
        if(attempt===retries-1)throw e;
        await new Promise(res=>setTimeout(res,500*(attempt+1)));
      }
    }
    return null;
  },

  fetchBatch(names,onProgress){
    /* names can be: string[] OR {name,set?,collector_number?}[]
       Cards with set+collector_number are fetched individually via
       /cards/:set/:number for the exact printing. Others go through
       the /cards/collection bulk endpoint. */
    this.cancelBatch();
    // Normalise to objects
    const items=names.map(n=>typeof n==='string'?{name:n}:n);
    const missing=items.filter(it=>{
      const cached=Store.card(it.name);
      if(!cached)return true;
      // Exact print requests must override a name-only cached printing.
      if(it.set&&it.collector_number){
        return cached.set!==it.set||cached.collector_number!==it.collector_number;
      }
      if(it.set){
        return cached.set!==it.set;
      }
      return false;
    });
    if(!missing.length){onProgress&&onProgress(names.length,names.length);return Promise.resolve();}
    this._abortCtrl=new AbortController();
    const signal=this._abortCtrl.signal;
    return new Promise(resolve=>{
      let done=0;const total=missing.length;
      // Split into exact-print (has set+collnum) vs set-hint lookups vs name-only lookups
      const exactPrints=missing.filter(it=>it.set&&it.collector_number);
      const setHints=missing.filter(it=>it.set&&!it.collector_number);
      const bulkNames=missing.filter(it=>!it.set);
      const newEntries=[];

      const fetchExact=async()=>{
        for(const it of exactPrints){
          if(signal.aborted)return;
          const cached=Store.card(it.name);
          if(cached&&cached.set===it.set&&cached.collector_number===it.collector_number){
            done++;onProgress&&onProgress(done,total);continue;
          }
          try{
            let r=await this._fetchWithRetry(
              `${this.BASE}/cards/${encodeURIComponent(it.set)}/${encodeURIComponent(it.collector_number)}`,
              {signal,headers:{'Accept':'application/json'}}
            );
            let d=null;
            if(r&&r.ok){
              d=await r.json();
            }else if(r&&r.status===404){
              /* Some imports carry collector-number variants that Scryfall
                 rejects on the direct /cards/:set/:number route. Fall back
                 to a set-scoped name lookup so profile/deck views still get
                 usable card data and artwork. */
              const rf=await this._fetchWithRetry(`${this.BASE}/cards/collection`,{
                method:'POST',signal,
                headers:{'Content-Type':'application/json','Accept':'application/json'},
                body:JSON.stringify({identifiers:[{name:it.name,set:it.set}]})
              });
              if(rf&&rf.ok){
                const df=await rf.json();
                d=df?.data?.[0]||null;
              }
            }
            if(d){
              const slim=this._slim(d);
              /* Store under the canonical name AND the import name */
              Store.cache[slim.name]=slim;
              if(it.name!==slim.name)Store.cache[it.name]=slim;
              newEntries.push(slim);
            }
          }catch(e){if(e.name==='AbortError')return;}
          done++;onProgress&&onProgress(done,total);
          await new Promise(r=>setTimeout(r,80));
        }
      };

      const fetchCollectionChunk=async(chunk)=>{
        try{
          const r=await this._fetchWithRetry(`${this.BASE}/cards/collection`,{
            method:'POST',signal,
            headers:{'Content-Type':'application/json','Accept':'application/json'},
            body:JSON.stringify({
              identifiers:chunk.map(it=>it.set?{name:it.name,set:it.set}:{name:it.name})
            })
          });
          if(r&&r.ok){
            const d=await r.json();
            const byName=new Map(chunk.map(it=>[String(it.name||'').toLowerCase(),it]));
            for(const card of(d.data||[])){
              const slim=this._slim(card);
              Store.cache[slim.name]=slim;
              const requested=byName.get(String(card.name||'').toLowerCase());
              if(requested?.name&&requested.name!==slim.name){
                Store.cache[requested.name]=slim;
                if(Store._cachedNames)Store._cachedNames.add(requested.name);
              }
              /* Also mark in _cachedNames so lazy lookup knows it's available */
              if(Store._cachedNames)Store._cachedNames.add(slim.name);
              newEntries.push(slim);
              done++;onProgress&&onProgress(done,total);
            }
            for(const nf of(d.not_found||[])){done++;onProgress&&onProgress(done,total);}
          }
        }catch(e){
          if(e.name==='AbortError')return;
          if(location.protocol==='file:'&&!this._warnShown){this._warnShown=true;this._showFileWarning();}
          done+=chunk.length;onProgress&&onProgress(done,total);
        }
      };

      const chunks=[];
      const collectionItems=[...setHints,...bulkNames];
      for(let i=0;i<collectionItems.length;i+=this.BATCH_SIZE)
        chunks.push(collectionItems.slice(i,i+this.BATCH_SIZE));

      /* Process chunks in parallel rounds — PARALLEL_CHUNKS at a time */
      const runRounds=async()=>{
        const P=this.PARALLEL_CHUNKS;
        for(let round=0;round<chunks.length;round+=P){
          if(signal.aborted)return;
          const roundChunks=chunks.slice(round,round+P);
          /* Fire all chunks in this round simultaneously */
          await Promise.all(roundChunks.map(async(chunk)=>{
            if(signal.aborted)return;
            await fetchCollectionChunk(chunk);
          }));
          /* Short pause between rounds to stay under rate limit */
          if(round+P<chunks.length)
            await new Promise(r=>setTimeout(r,this.BATCH_DELAY));
        }
        if(newEntries.length)IDB.setBulk(newEntries);
        resolve();
      };

      (async()=>{
        await fetchExact();
        if(collectionItems.length)runRounds();
        else{if(newEntries.length)IDB.setBulk(newEntries);resolve();}
      })();
    });
  },

  async _go(){
    this._run=true;
    while(this._q.length){
      const{name,cb}=this._q.shift();
      if(Store.card(name)){cb(Store.card(name));continue;}
      let data=null;
      try{
        const r=await fetch(`${this.BASE}/cards/named?fuzzy=${encodeURIComponent(name)}`,{method:'GET',headers:{'Accept':'application/json'}});
        if(r.ok)data=await r.json();
      }catch(e){
        if(location.protocol==='file:'&&!this._warnShown){this._warnShown=true;this._showFileWarning();}
      }
      const slim=data?this._slim(data):null;
      if(slim)Store.setCard(name,slim);
      cb(slim);
      await new Promise(r=>setTimeout(r,this._delay));
    }
    this._run=false;
  },
  _warnShown:false,
  _showFileWarning(){
    const b=document.createElement('div');
    b.style.cssText='position:fixed;bottom:0;left:0;right:0;z-index:500;background:#1a1a0a;border-top:2px solid #c8a84b;padding:12px 20px;display:flex;align-items:center;gap:16px;font-family:JetBrains Mono,monospace;font-size:11px;color:#c8a84b;';
    b.innerHTML=`<span style="font-size:18px">⚠</span><div style="flex:1"><strong>Card images unavailable (file:// — Chrome restriction)</strong><br><span style="color:#8a9baa">Fix: open in Firefox.</span></div><button onclick="this.parentElement.remove()" style="background:#333;border:1px solid #555;color:#aaa;padding:4px 12px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:11px">✕ OK</button>`;
    document.body.appendChild(b);
  },
  _slim(d){
    /* Lean object — only what the UI actually uses.
       Dropped: flavor_text (~200 chars), full legalities object (~400 chars),
       full prices object - keeping only the price fields the UI actually uses.
       Saves ~60% per card → IDB half the size, loadCache faster. */
    const f=d.card_faces?.[0]||d;
    const p=d.prices||{};
    return{
      name:d.name,
      mana_cost:f.mana_cost||d.mana_cost||'',
      cmc:d.cmc||0,
      type_line:f.type_line||d.type_line||'',
      oracle_text:f.oracle_text||d.oracle_text||'',
      colors:d.colors||f.colors||[],
      color_identity:d.color_identity||[],
      rarity:d.rarity||'',
      set:d.set||'',
      set_name:d.set_name||'',
      collector_number:d.collector_number||'',
      scryfall_id:d.id||'',
      power:f.power,toughness:f.toughness,
      prices:{eur:p.eur||null,eur_foil:p.eur_foil||null,usd:p.usd||null,usd_foil:p.usd_foil||null},
      legal_commander:d.legalities?.commander||'legal',
      img:{
        normal:f.image_uris?.normal||d.image_uris?.normal||'',
        crop:f.image_uris?.art_crop||d.image_uris?.art_crop||''
      }
    };
  },

  async fetchById(scryfallId,name){
    try{
      const r=await fetch(`${this.BASE}/cards/${scryfallId}`,{method:'GET',headers:{'Accept':'application/json'}});
      if(!r.ok)return null;
      const d=await r.json();const slim=this._slim(d);
      Store.setCard(name,slim);Store.saveCache();return slim;
    }catch{return null;}
  },

  async fetchPrintings(name){
    try{
      const q=encodeURIComponent(`!"${name}"`);
      const r=await fetch(`${this.BASE}/cards/search?q=${q}&unique=prints&order=released&dir=desc`,{method:'GET',headers:{'Accept':'application/json'}});
      if(!r.ok)return[];
      const d=await r.json();return d.data||[];
    }catch{return[];}
  }
};


const ScryfallBulk={
  KEY_TS:'cforge_bulk_ts',
  KEY_VER:'cforge_bulk_ver',
  INTERVAL_MS:7*24*60*60*1000,
  _skipped:false,

  async autoCheck(){
    const lastDl=parseInt(localStorage.getItem(this.KEY_TS)||'0',10);
    const idbCount=await IDB.count();
    const needsFull=idbCount<1000;
    const needsRefresh=Date.now()-lastDl>this.INTERVAL_MS;
    if(needsFull)await this.downloadFull();
    else if(needsRefresh)this._silentRefresh();
  },

  skip(){
    this._skipped=true;
    this._hideBanner();
    Notify.show('Using on-demand fetch','inf');
  },

  async downloadFull(){
    if(this._skipped)return;
    this._showBanner('Preparing card database\u2026','Fetching file list from Scryfall\u2026');
    try{
      /* Step 1: get the download URL from Scryfall API */
      const idxRes=await fetch('/api/scryfall/bulk-data/oracle-cards',
        {headers:{'Accept':'application/json'}});
      if(!idxRes.ok)throw new Error('Scryfall API error '+idxRes.status);
      const idx=await idxRes.json();
      const dlUrl=idx.download_uri;
      const remoteVer=idx.updated_at||idx.id||'';

      /* Already up to date? */
      const localVer=localStorage.getItem(this.KEY_VER)||'';
      if(localVer===remoteVer&&(await IDB.count())>25000){
        this._hideBanner();return;
      }

      this._setProgress(5,'Downloading cards\u2026 (~20MB, one-time only)');

      /* Step 2: fetch the actual file */
      const res=await fetch(dlUrl,{headers:{'Accept':'application/json'}});
      if(!res.ok)throw new Error('Download failed '+res.status);

      /* Step 3: read as text (no streaming needed — simpler + more compatible) */
      this._setProgress(20,'Reading file\u2026');
      const text=await res.text();
      this._setProgress(40,'Parsing cards\u2026');

      /* Step 4: parse on next tick so UI stays responsive */
      await new Promise(r=>setTimeout(r,0));
      const cards=JSON.parse(text);
      const slimmed=cards.map(d=>SF._slim(d)).filter(Boolean);
      this._setProgress(55,`Saving ${slimmed.length.toLocaleString()} cards locally\u2026`);

      /* Step 5: write to IDB in one big transaction per 2000-card chunk
         Using requestIdleCallback / setTimeout between chunks so page doesn't freeze */
      const CHUNK=2000;
      let saved=0;
      const writeChunk=(i)=>new Promise(res=>{
        setTimeout(async()=>{
          await IDB.setBulk(slimmed.slice(i,i+CHUNK));
          saved=Math.min(i+CHUNK,slimmed.length);
          const pct=55+Math.round((saved/slimmed.length)*40);
          this._setProgress(pct,`Saving\u2026 ${saved.toLocaleString()} / ${slimmed.length.toLocaleString()}`);
          res();
        },0);
      });
      for(let i=0;i<slimmed.length;i+=CHUNK)await writeChunk(i);

      /* Step 6: reload name index */
      await Store.loadCache();
      localStorage.setItem(this.KEY_TS,String(Date.now()));
      localStorage.setItem(this.KEY_VER,remoteVer);

      this._setProgress(100,'\u2713 '+slimmed.length.toLocaleString()+' cards ready');
      const ce=document.getElementById('dash-engine-cache');
      if(ce)ce.textContent='Cache: '+slimmed.length.toLocaleString();
      await new Promise(r=>setTimeout(r,1400));
      this._hideBanner();
      Notify.show('Card database ready \u2014 '+slimmed.length.toLocaleString()+' cards','ok',4000);
      if(App.curId){const d=Store.getDeck(App.curId);if(d)App.loadDeck(d.id);}
      if(typeof Dashboard!=='undefined')Dashboard.markDirty();
    }catch(e){
      console.error('[ScryfallBulk]',e);
      this._hideBanner();
      /* Show error in banner briefly, then fall back */
      Notify.show('Card DB download failed: '+e.message+' \u2014 using on-demand','inf',6000);
    }
  },

  async _silentRefresh(){
    try{
      const idxRes=await fetch('/api/scryfall/bulk-data/oracle-cards',
        {headers:{'Accept':'application/json'}});
      if(!idxRes.ok)return;
      const idx=await idxRes.json();
      const remoteVer=idx.updated_at||idx.id||'';
      if((localStorage.getItem(this.KEY_VER)||'')=== remoteVer)return;
      const res=await fetch(idx.download_uri,{headers:{'Accept':'application/json'}});
      if(!res.ok)return;
      const cards=JSON.parse(await res.text());
      const slimmed=cards.map(d=>SF._slim(d)).filter(Boolean);
      for(let i=0;i<slimmed.length;i+=2000){
        await IDB.setBulk(slimmed.slice(i,i+2000));
        await new Promise(r=>setTimeout(r,0));
      }
      await Store.loadCache();
      localStorage.setItem(this.KEY_TS,String(Date.now()));
      localStorage.setItem(this.KEY_VER,remoteVer);
      const ce=document.getElementById('dash-engine-cache');
      if(ce)ce.textContent='Cache: '+slimmed.length.toLocaleString();
      console.log('[ScryfallBulk] Silent refresh done \u2014',slimmed.length,'cards');
    }catch(e){console.warn('[ScryfallBulk] Silent refresh failed:',e.message);}
  },

  async forceRefresh(){
    localStorage.removeItem(this.KEY_TS);
    localStorage.removeItem(this.KEY_VER);
    this._skipped=false;
    await this.downloadFull();
  },

  _showBanner(title,sub){
    document.getElementById('bdl-title-text').textContent=title;
    document.getElementById('bdl-sub').textContent=sub;
    document.getElementById('bdl-bar').style.width='0%';
    document.getElementById('bulk-dl-banner').classList.add('show');
  },
  _setBannerSub(s){document.getElementById('bdl-sub').textContent=s;},
  _setProgress(pct,sub){
    document.getElementById('bdl-bar').style.width=pct+'%';
    if(sub)document.getElementById('bdl-sub').textContent=sub;
  },
  _hideBanner(){document.getElementById('bulk-dl-banner').classList.remove('show');},
  async _updateSettingsStatus(){
    const ts=parseInt(localStorage.getItem(this.KEY_TS)||'0',10);
    const count=await IDB.count();
    const el=document.getElementById('settings-bulk-status');
    if(!el)return;
    if(!ts||count<100){
      el.textContent='Not downloaded yet';el.style.color='var(--crimson2)';
    }else{
      const days=Math.floor((Date.now()-ts)/(24*60*60*1000));
      el.textContent=count.toLocaleString()+' cards \u00b7 '+(days===0?'Updated today':days===1?'Yesterday':''+days+' days ago');
      el.style.color='var(--green2)';
    }
  }
};

/* ═══ MENU ══════════════════════════════════════════════════ */

