/* CommanderForge — community: BulkPool, TradeMgr, WishlistMgr, CommunityNav,
   TradeMatch, DeckHealth */

const BulkPool={
  _data:[],_filtered:[],_tab:'single',_pasteLines:[],

  render(){
    // Show loading state immediately so user doesn't see blank page
    const list=document.getElementById('bulk-list');
    if(list&&!this._data.length){
      list.innerHTML='<div style="padding:30px;text-align:center;color:var(--text3);font-size:12px">Loading pool…</div>';
    }
    this.refresh();
  },
  _acTimer:null,_acResults:[],_acIdx:-1,
  _acType(val){
    clearTimeout(this._acTimer);
    const ac=document.getElementById('bulk-add-ac');
    if(val.length<2){if(ac)ac.style.display='none';return;}
    this._acTimer=setTimeout(async()=>{
      try{
        const r=await fetch(`/api/scryfall/cards/autocomplete?q=${encodeURIComponent(val)}&include_extras=false`);
        if(!r.ok)return;
        const d=await r.json();
        this._acResults=d.data||[];this._acIdx=-1;
        if(!ac||!this._acResults.length){if(ac)ac.style.display='none';return;}
        ac.innerHTML='';
        this._acResults.slice(0,8).forEach((name,i)=>{
          const item=document.createElement('div');
          item.style.cssText='padding:7px 12px;cursor:pointer;font-family:Cinzel,serif;font-size:11px;color:var(--text2);border-bottom:1px solid var(--border);transition:background .1s';
          item.textContent=name;item.dataset.idx=i;
          item.onmouseenter=()=>{ac.querySelectorAll('[data-idx]').forEach(el=>el.style.background='');item.style.background='var(--bg3)';this._acIdx=i;};
          item.onmouseleave=()=>item.style.background='';
          item.onmousedown=e=>{e.preventDefault();document.getElementById('bulk-add-name').value=name;ac.style.display='none';};
          ac.appendChild(item);
        });
        ac.style.display='block';
      }catch{}
    },200);
  },
  _acKey(e){
    const ac=document.getElementById('bulk-add-ac');
    const items=ac?ac.querySelectorAll('[data-idx]'):[];
    if(e.key==='ArrowDown'){e.preventDefault();this._acIdx=Math.min(this._acIdx+1,items.length-1);items.forEach((el,i)=>el.style.background=i===this._acIdx?'var(--bg3)':'');}
    else if(e.key==='ArrowUp'){e.preventDefault();this._acIdx=Math.max(this._acIdx-1,0);items.forEach((el,i)=>el.style.background=i===this._acIdx?'var(--bg3)':'');}
    else if(e.key==='Enter'){if(this._acIdx>=0&&this._acResults[this._acIdx]){document.getElementById('bulk-add-name').value=this._acResults[this._acIdx];if(ac)ac.style.display='none';}else this.add();}
    else if(e.key==='Escape'){if(ac)ac.style.display='none';}
  },

  setTab(t){
    this._tab=t;
    document.getElementById('bulk-add-single').style.display=t==='single'?'block':'none';
    document.getElementById('bulk-add-paste').style.display=t==='paste'?'block':'none';
    document.getElementById('bulk-tab-single').classList.toggle('on',t==='single');
    document.getElementById('bulk-tab-paste').classList.toggle('on',t==='paste');
  },

  async refresh(){
    const el=document.getElementById('bulk-list');
    if(!DB._sb||!DB._user){
      if(el)el.innerHTML=`<div style="padding:30px;text-align:center">
        <div style="font-size:32px;margin-bottom:10px;opacity:.3">📦</div>
        <div style="font-family:'Cinzel',serif;font-size:13px;color:var(--text2);margin-bottom:8px">Sign in to access the shared pool</div>
        <button class="tbtn gold" onclick="Auth.show()" style="font-size:11px">Sign In</button>
      </div>`;
      return;
    }
    if(el)el.innerHTML='<div style="padding:16px;color:var(--text3);font-size:12px;text-align:center">Loading pool…</div>';
    try{
      const{data,error}=await DB._sb.from('bulk_pool').select('*').order('created_at',{ascending:false});
      if(error)throw error;
      this._data=data||[];this._filtered=[...this._data];
      this._updateStats();this.filter();
      /* Warm card cache then backfill any price_usd=0 rows */
      const names=[...new Set((data||[]).map(r=>r.card_name))];
      Store.warmCards(names).then(()=>{
        this._updateStats(); /* recalc with warmed prices */
        this._backfillPrices(data||[]);
      });
    }catch(e){
      const msg=e.message||JSON.stringify(e);
      const isMissing=msg.includes('does not exist')||msg.includes('relation');
      const sqlHint='CREATE TABLE IF NOT EXISTS bulk_pool (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, card_name text, qty int DEFAULT 1, condition text DEFAULT \'NM\', user_id uuid, user_email text, price_usd numeric DEFAULT 0, created_at timestamptz DEFAULT now()); ALTER TABLE bulk_pool ENABLE ROW LEVEL SECURITY; CREATE POLICY "all" ON bulk_pool FOR ALL USING(true) WITH CHECK(auth.uid()=user_id);';
      if(el)el.innerHTML=`<div style="padding:20px;color:var(--crimson2);font-size:12px">${isMissing?
        '<b>bulk_pool table missing.</b> Run in Supabase → SQL Editor:<br><code style="display:block;margin-top:6px;padding:8px;background:var(--bg3);border-radius:4px;font-size:10px;white-space:normal;word-break:break-all">'+esc(sqlHint)+'</code>':
        esc(msg)}</div>`;
    }
  },

  async add(){
    const name=(document.getElementById('bulk-add-name')?.value||'').trim();
    const qty=parseInt(document.getElementById('bulk-add-qty')?.value||'1')||1;
    const cond=document.getElementById('bulk-add-cond')?.value||'NM';
    if(!name){Notify.show('Enter a card name','err');return;}
    if(!DB._sb||!DB._user){Notify.show('Sign in to add to pool','err');return;}
    const btn=document.getElementById('bulk-add-btn');
    if(btn){btn.disabled=true;btn.textContent='Adding…';}
    try{
      /* Fetch card data to get accurate price */
      if(!Store.card(name)?.prices?.eur){
        await new Promise(res=>SF.fetch(name,res));
      }
      const cd=Store.card(name)||{};
      const price=parseFloat(cd?.prices?.eur||0);
      const{error}=await DB._sb.from('bulk_pool').insert({
        card_name:name,qty,condition:cond,
        user_id:DB._user.id,user_email:DB._user.email||'',
        price_usd:price,created_at:new Date().toISOString()
      });
      if(error)throw error;
      Notify.show(`Added ${qty}× ${name}`,'ok');
      document.getElementById('bulk-add-name').value='';
      document.getElementById('bulk-add-qty').value='1';
      // Pre-fetch card data so image shows in the pool list
      SF.fetch(name,()=>{});
      this.refresh();
    }catch(e){
      Notify.show('Failed: '+(e.message||JSON.stringify(e)),'err');
      console.error('[BulkPool.add]',e);
    }finally{
      if(btn){btn.disabled=false;btn.textContent='＋ Add';}
    }
  },

  previewPaste(){
    const text=document.getElementById('bulk-paste-text')?.value||'';
    const lines=text.split('\n').filter(l=>l.trim());
    this._pasteLines=[];
    const preview=document.getElementById('bulk-paste-preview');
    if(!preview)return;preview.style.display='block';preview.innerHTML='';
    for(const line of lines){
      if(line.trim().startsWith('//'))continue;
      const entry=Parser.parseLine(line.trim());
      if(!entry)continue;
      this._pasteLines.push(entry);
      const setInfo=entry.set?` <span style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--ice2)">(${entry.set.toUpperCase()}${entry.collector_number?' #'+entry.collector_number:''})</span>`:'';
      const foilInfo=entry.foil?'<span style="font-family:monospace;font-size:9px;color:var(--purple2)">✦F</span> ':'';
      const row=document.createElement('div');row.className='bulk-preview-row';
      row.innerHTML=`<span class="bulk-preview-ok">✓</span> ${foilInfo}<span style="color:var(--gold2)">${entry.qty}×</span> ${esc(entry.name)}${setInfo}`;
      preview.appendChild(row);
    }
    document.getElementById('bulk-paste-submit').style.display=this._pasteLines.length?'inline-flex':'none';
  },

  async submitPaste(){
    if(!DB._sb||!DB._user){Notify.show('Sign in first','err');return;}
    if(!this._pasteLines.length)return;
    const cond=document.getElementById('bulk-paste-cond')?.value||'NM';
    const btn=document.getElementById('bulk-paste-submit');
    if(btn)btn.textContent='Adding…';
    let added=0,failed=0;
    for(const line of this._pasteLines){
      try{
        /* Ensure card data is cached so price_usd is accurate */
        if(!Store.card(line.name)?.prices?.eur){
          await new Promise(res=>SF.fetch(line.name,res));
        }
        const cd=Store.card(line.name);
        const{error}=await DB._sb.from('bulk_pool').insert({
          card_name:line.name,
          qty:line.qty,
          condition:cond,
          user_id:DB._user.id,
          user_email:DB._user.email||'',
          price_usd:parseFloat(cd?.prices?.eur||0),
          created_at:new Date().toISOString()
        });
        if(error)throw error;
        added++;
      }catch(e){failed++;console.warn('bulk insert failed:',line.name,e?.message||e);}
    }
    if(added>0)Notify.show(`Added ${added} card${added!==1?'s':''} to pool`+(failed>0?` (${failed} failed)`:''),'ok');
    else Notify.show(`All inserts failed — check Supabase permissions`,'err');
    // Pre-fetch card images for all added cards
    this._pasteLines.forEach(line=>SF.fetch(line.name,()=>{}));
    if(document.getElementById('bulk-paste-text'))document.getElementById('bulk-paste-text').value='';
    if(document.getElementById('bulk-paste-preview'))document.getElementById('bulk-paste-preview').style.display='none';
    if(btn)btn.style.display='none';
    this._pasteLines=[];
    this.refresh();
  },

  _updateStats(){
    const total=this._data.reduce((s,r)=>s+(r.qty||0),0);
    const unique=new Set(this._data.map(r=>r.card_name)).size;
    /* Use DB price_usd if set, otherwise fall back to local card cache */
    const val=this._data.reduce((s,r)=>{
      const p=r.price_usd||parseFloat(Store.card(r.card_name)?.prices?.eur||0);
      return s+p*(r.qty||1);
    },0);
    const contrib=new Set(this._data.map(r=>r.user_id)).size;
    ['bulk-total-cards','bulk-unique','bulk-value','bulk-contributors'].forEach((id,i)=>{
      const el=document.getElementById(id);
      if(el)el.textContent=[total,unique,'€'+val.toFixed(2),contrib][i];
    });
    // Update sidebar stats too
    const sbc=document.getElementById('bulk-sb-cards');if(sbc)sbc.textContent=total;
    const sbcon=document.getElementById('bulk-sb-contrib');if(sbcon)sbcon.textContent=contrib;
  },

  /* Silently update rows where price_usd=0 with the current Scryfall price */
  async _backfillPrices(rows){
    if(!DB._sb||!DB._user)return;
    const missing=rows.filter(r=>!(r.price_usd>0));
    if(!missing.length)return;
    /* Fetch any still-missing card data from Scryfall */
    let fetched=0;
    const total=missing.length;
    const tryUpdate=async()=>{
      for(const r of missing){
        const cd=Store.card(r.card_name);
        const price=parseFloat(cd?.prices?.eur||0);
        if(!price)continue;
        try{
          await DB._sb.from('bulk_pool')
            .update({price_usd:price})
            .eq('id',r.id)
            .eq('user_id',r.user_id);
          r.price_usd=price; /* update local copy too */
          fetched++;
        }catch{}
      }
      if(fetched>0){
        this._updateStats();
        this._renderList();
      }
    };
    /* Warm Scryfall for missing cards, then update */
    const needFetch=missing.filter(r=>!Store.card(r.card_name)?.prices?.eur);
    if(needFetch.length){
      let done=0;
      needFetch.forEach(r=>SF.fetch(r.card_name,()=>{
        done++;
        if(done>=needFetch.length)tryUpdate();
      }));
    } else {
      tryUpdate();
    }
  },

  filter(){
    const srch=(document.getElementById('bulk-search')?.value||'').toLowerCase();
    const sort=document.getElementById('bulk-sort')?.value||'name';
    const owner=document.getElementById('bulk-filter-owner')?.value||'';
    this._filtered=this._data.filter(r=>{
      if(srch&&!(r.card_name||'').toLowerCase().includes(srch))return false;
      if(owner==='mine'&&DB._user&&r.user_id!==DB._user.id)return false;
      return true;
    });
    this._filtered.sort((a,b)=>{
      if(sort==='qty')return(b.qty||0)-(a.qty||0);
      if(sort==='price')return(b.price_usd||0)-(a.price_usd||0);
      if(sort==='added')return new Date(b.created_at)-new Date(a.created_at);
      return(a.card_name||'').localeCompare(b.card_name||'');
    });
    this._renderList();
  },

  togglePaste(){
    const w=document.getElementById('bulk-paste-wrap');
    if(w)w.style.display=w.style.display==='none'?'block':'none';
  },

  _renderList(){
    const list=document.getElementById('bulk-list');
    const empty=document.getElementById('bulk-empty');
    const status=document.getElementById('bulk-status');
    if(!list)return;
    if(!this._filtered.length){
      list.innerHTML='';
      if(empty)empty.style.display='block';
      if(status)status.textContent='';
      return;
    }
    if(empty)empty.style.display='none';
    list.innerHTML='';
    const total=this._filtered.reduce((s,r)=>s+(r.qty||1),0);
    if(status)status.textContent=`${this._filtered.length} unique cards · ${total} total copies`;

    const condColor={NM:'var(--green2)',LP:'var(--ice)',MP:'var(--gold)',HP:'var(--crimson2)'};
    const isMine=DB._user?document.getElementById('bulk-filter-owner')?.value==='mine':false;

    // Fetch card data for any cards not yet in cache, then re-render once done
    const missing=this._filtered.filter(r=>!Store.card(r.card_name));
    if(missing.length){
      let fetched=0;
      missing.forEach(r=>{
        SF.fetch(r.card_name,()=>{
          fetched++;
          // Re-render once ALL missing cards are loaded
          if(fetched>=missing.length)this._renderList();
        });
      });
    }

    for(const r of this._filtered){
      const cd=Store.card(r.card_name)||{};
      const img=cd.img?.normal||cd.img?.crop||'';
      const price=r.price_usd?'€'+parseFloat(r.price_usd).toFixed(2):'—';
      const rarity=cd.rarity||'common';
      const rarityClass={common:'cs-rarity-c',uncommon:'cs-rarity-u',rare:'cs-rarity-r',mythic:'cs-rarity-m'}[rarity]||'';
      const owner=r.user_email?.split('@')[0]||'unknown';
      const isOwn=DB._user&&DB._user.id===r.user_id;
      const setInfo=cd.set?(cd.set.toUpperCase()+(cd.collector_number?' #'+cd.collector_number:'')):'';

      const tile=document.createElement('div');
      tile.className='cs-card';
      tile.innerHTML=`
        ${img?`<img class="cs-card-img" src="${esc(img)}" loading="lazy" alt="${esc(r.card_name)}">`
             :`<div class="cs-card-img" style="display:flex;align-items:center;justify-content:center;
               font-family:'Cinzel',serif;font-size:10px;color:var(--text3);padding:8px;text-align:center">
               ${esc(r.card_name)}</div>`}
        <div class="cs-card-body">
          <div class="cs-card-name" title="${esc(r.card_name)}">${esc(r.card_name)}</div>
          <div class="cs-card-meta">
            <span class="${rarityClass}" style="font-size:9px">${setInfo||esc(owner)}</span>
            <span class="cs-card-price">${esc(price)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:3px;font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--text3)">
            <span>by ${esc(owner)}</span>
            <span style="color:${condColor[r.condition]||'var(--text3)'}">
              ${esc(r.condition||'NM')} · ${r.qty||1}×
            </span>
          </div>
        </div>
        <div class="cs-actions">
          <button class="cs-action-btn purple" onclick="WishlistMgr.addByName('${esc(r.card_name).replace(/'/g,"\'")}')">⭐ Wish</button>
          <button class="cs-action-btn gold" onclick="BulkPool._addToDeck('${esc(r.card_name).replace(/'/g,"\'")}')">+ Deck</button>
          ${isOwn?`<button class="cs-action-btn" style="color:var(--crimson2);border-color:var(--crimson)" onclick="BulkPool.remove('${r.id}')">✕ Remove</button>`:''}
        </div>`;

      /* Click tile = open card modal; fetch data first if not cached */
      const imgEl=tile.querySelector('.cs-card-img');
      if(imgEl)imgEl.style.cursor='pointer';
      tile.addEventListener('click',e=>{
        if(e.target.closest('.cs-actions'))return; // don't open modal when clicking action buttons
        if(cd.name||cd.oracle_text){M.open({name:r.card_name,qty:1},null);}
        else{SF.fetch(r.card_name,data=>{if(data)M.open({name:r.card_name,qty:1},null);});}
      });
      // Lazy-fetch card image if missing
      if(!cd.img){SF.fetch(r.card_name,()=>{
        // Only re-render if still on bulk page
        if(Menu.cur==='bulk')this._renderList();
      });}
      list.appendChild(tile);
    }
  },

  _addToDeck(name){
    /* Use the active deck in Forge, or prompt if none */
    const deckId=App.curId;
    if(!deckId){Notify.show('Load a deck in the Forge first','err');return;}
    const deck=Store.getDeck(deckId);if(!deck)return;
    const existing=deck.cards.find(c=>c.name.toLowerCase()===name.toLowerCase());
    if(existing){existing.qty++;Notify.show(name+' qty +1','ok');}
    else{deck.cards.push({name,qty:1,foil:false,etched:false});Notify.show(name+' added to deck','ok');}
    Store.updDeck(deck);
    if(App.curId===deckId)App.render();
  },

  async remove(id){
    if(!DB._sb||!DB._user)return;
    await DB._sb.from('bulk_pool').delete().eq('id',id).eq('user_id',DB._user.id);
    this.refresh();
  }
};

/* ═══════════════════════════════════════════════════════════
   TRADE MANAGER
   ═══════════════════════════════════════════════════════════ */
const TradeMgr={
  _data:[],

  async render(){
    const listEl=document.getElementById('trade-list');
    if(!DB._sb||!DB._user){
      if(listEl)listEl.innerHTML='<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">Sign in to use Trade Tracker.</div>';
      return;
    }
    const{data,error}=await DB._sb.from('trade_list').select('*').eq('user_id',DB._user.id).order('created_at',{ascending:false});
    if(error){
      const isMissing=error.message?.includes('does not exist')||error.message?.includes('relation');
      if(listEl)listEl.innerHTML=`<div style="padding:16px;color:var(--crimson2);font-size:12px">
        ${isMissing
          ? '<b>trade_list table missing.</b> Run <code>supabase_schema.sql</code> in your Supabase SQL Editor.'
          : esc(error.message)}
      </div>`;
      return;
    }
    this._data=data||[];this._renderList();
  },

  async add(){
    const nameEl=document.getElementById('trade-add-name');
    const name=(nameEl?.value||'').trim();
    const qty=parseInt(document.getElementById('trade-add-qty')?.value||'1');
    const cond=document.getElementById('trade-add-cond')?.value||'NM';
    if(!name){Notify.show('Enter a card name','err');return;}
    if(!DB._sb||!DB._user)return;
    await DB._sb.from('trade_list').insert({card_name:name,qty,condition:cond,user_id:DB._user.id,user_email:DB._user.email||''});
    Notify.show(name+' added to trade list','ok');
    if(nameEl)nameEl.value='';
    TradeAC?.hide?.('trade-add-name');
    this.render();
  },

  async addByName(cardName){
    /* Silent add — used from friend profile, no full page re-render */
    if(!DB._sb||!DB._user){Notify.show('Sign in first','err');return;}
    if(this._data.some(w=>w.card_name.toLowerCase()===cardName.toLowerCase())){
      Notify.show('"'+cardName+'" already on your wishlist','inf');return;
    }
    const{error}=await DB._sb.from('wishlist').insert({
      card_name:cardName,user_id:DB._user.id,user_email:DB._user.email||''
    });
    if(!error){
      this._data.push({card_name:cardName,user_id:DB._user.id});
      Notify.show('⭐ "'+cardName+'" → Wishlist','ok');
    }else{Notify.show('Could not add to wishlist','err');}
  },

  async toggleCard(cardName){
    if(!DB._sb||!DB._user){Notify.show('Sign in first','err');return;}
    const existing=this._data.find(t=>t.card_name===cardName);
    if(existing){
      await DB._sb.from('trade_list').delete().eq('id',existing.id);
      Notify.show(cardName+' removed from trade list','inf');
    } else {
      const cd=Store.card(cardName)||{};
      await DB._sb.from('trade_list').insert({card_name:cardName,qty:1,condition:'NM',user_id:DB._user.id,user_email:DB._user.email||''});
      Notify.show(cardName+' listed for trade','ok');
    }
    await this.render();
    MyCollection._renderCards();
  },

  _renderList(){
    const list=document.getElementById('trade-list');const empty=document.getElementById('trade-empty');
    if(!list)return;
    if(!this._data.length){list.innerHTML='';if(empty)empty.style.display='block';return;}
    if(empty)empty.style.display='none';list.innerHTML='';
    for(const r of this._data){
      const cd=Store.card(r.card_name)||{};
      const row=document.createElement('div');row.className='trade-card';
      row.innerHTML=`
        ${cd.img?.crop?`<img class="bulk-pool-thumb" src="${esc(cd.img.crop)}" loading="lazy">`:'<div class="bulk-pool-thumb" style="background:var(--bg3)"></div>'}
        <div style="flex:1;min-width:0">
          <div class="bulk-pool-name">${esc(r.card_name)}</div>
          <div class="bulk-pool-meta">${r.qty}× · ${r.condition||'NM'} · ${cd.prices?.eur?'€'+cd.prices.eur:''}</div>
        </div>
        <span class="trade-badge have">🤝 For Trade</span>
        <button class="alert-del" onclick="TradeMgr.remove('${r.id}')">✕</button>
      `;
      list.appendChild(row);
    }
  },

  async remove(id){
    if(!DB._sb||!DB._user)return;
    await DB._sb.from('trade_list').delete().eq('id',id);this.render();
  }
};

/* ═══════════════════════════════════════════════════════════
   WISHLIST MANAGER
   ═══════════════════════════════════════════════════════════ */
const WishlistMgr={
  _data:[],
  _acTimer:null,
  _acResults:[],
  _acIdx:-1,

  async render(){
    const listEl=document.getElementById('wish-list');
    if(!DB._sb||!DB._user){
      if(listEl)listEl.innerHTML='<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">Sign in to use Wishlist.</div>';
      return;
    }
    const{data,error}=await DB._sb.from('wishlist').select('*').eq('user_id',DB._user.id).order('created_at',{ascending:false});
    if(error){
      const isMissing=error.message?.includes('does not exist')||error.message?.includes('relation');
      if(listEl)listEl.innerHTML='<div style="padding:16px;color:var(--crimson2);font-size:12px">'
        +(isMissing
          ? '<b>wishlist table missing.</b> Run <b>supabase_schema.sql</b> in your Supabase SQL Editor to create all required tables.'
          : esc(error.message))
        +'</div>';
      return;
    }
    this._data=data||[];this._renderList();
  },

  // ── Scryfall autocomplete ────────────────────────────────
  onType(val){
    clearTimeout(this._acTimer);
    if(val.length<2){this._hideAC();return;}
    this._acTimer=setTimeout(()=>this._fetchAC(val),220);
  },

  async _fetchAC(q){
    try{
      const res=await fetch(`/api/scryfall/cards/autocomplete?q=${encodeURIComponent(q)}&include_extras=false`);
      if(!res.ok)return;
      const data=await res.json();
      this._acResults=data.data||[];
      this._acIdx=-1;
      this._showAC();
    }catch{}
  },

  _showAC(){
    const box=document.getElementById('wish-autocomplete');
    if(!box)return;
    if(!this._acResults.length){this._hideAC();return;}
    box.innerHTML='';
    this._acResults.slice(0,10).forEach((name,i)=>{
      const item=document.createElement('div');
      item.style.cssText="padding:8px 12px;cursor:pointer;font-family:Cinzel,serif;font-size:11px;color:var(--text2);border-bottom:1px solid var(--border);transition:background .1s";
      item.textContent=name;
      item.dataset.idx=i;
      item.onmouseenter=()=>{
        box.querySelectorAll('[data-idx]').forEach(el=>el.style.background='');
        item.style.background='var(--bg3)';
        this._acIdx=i;
      };
      item.onmouseleave=()=>item.style.background='';
      item.onmousedown=(e)=>{
        e.preventDefault(); // prevent blur before click
        this._selectAC(name);
      };
      box.appendChild(item);
    });
    box.style.display='block';
  },

  _hideAC(){
    const box=document.getElementById('wish-autocomplete');
    if(box){box.style.display='none';box.innerHTML='';}
    this._acResults=[];this._acIdx=-1;
  },

  _selectAC(name){
    const inp=document.getElementById('wish-add-name');
    if(inp){inp.value=name;inp.focus();}
    this._hideAC();
    // Pre-fetch card data so image shows immediately in the list
    SF.fetch(name,()=>{});
  },

  onKey(e){
    const box=document.getElementById('wish-autocomplete');
    if(!box||box.style.display==='none'){
      if(e.key==='Enter')this.add();
      return;
    }
    const items=box.querySelectorAll('[data-idx]');
    if(e.key==='ArrowDown'){
      e.preventDefault();
      this._acIdx=Math.min(this._acIdx+1,items.length-1);
      items.forEach((el,i)=>el.style.background=i===this._acIdx?'var(--bg3)':'');
    } else if(e.key==='ArrowUp'){
      e.preventDefault();
      this._acIdx=Math.max(this._acIdx-1,0);
      items.forEach((el,i)=>el.style.background=i===this._acIdx?'var(--bg3)':'');
    } else if(e.key==='Enter'){
      e.preventDefault();
      if(this._acIdx>=0&&this._acResults[this._acIdx]){
        this._selectAC(this._acResults[this._acIdx]);
      } else {
        this._hideAC();this.add();
      }
    } else if(e.key==='Escape'){
      this._hideAC();
    }
  },

  async add(){
    const name=(document.getElementById('wish-add-name')?.value||'').trim();
    const note=(document.getElementById('wish-add-note')?.value||'').trim();
    this._hideAC();
    if(!name){Notify.show('Enter a card name','err');return;}
    if(!DB._sb||!DB._user){Notify.show('Sign in to use Wishlist','err');return;}
    // Check duplicate
    if(this._data.some(w=>w.card_name.toLowerCase()===name.toLowerCase())){
      Notify.show(name+' is already on your wishlist','inf');return;
    }
    await DB._sb.from('wishlist').insert({card_name:name,note,user_id:DB._user.id,user_email:DB._user.email||''});
    Notify.show(name+' added to wishlist','ok');
    document.getElementById('wish-add-name').value='';
    if(document.getElementById('wish-add-note'))document.getElementById('wish-add-note').value='';
    this.render();
  },

  async addByName(cardName){
    /* Silent add — used from friend profile, no full page re-render */
    if(!DB._sb||!DB._user){Notify.show('Sign in first','err');return;}
    if(this._data.some(w=>w.card_name.toLowerCase()===cardName.toLowerCase())){
      Notify.show('"'+cardName+'" already on your wishlist','inf');return;
    }
    const{error}=await DB._sb.from('wishlist').insert({
      card_name:cardName,user_id:DB._user.id,user_email:DB._user.email||''
    });
    if(!error){
      this._data.push({card_name:cardName,user_id:DB._user.id});
      Notify.show('⭐ "'+cardName+'" → Wishlist','ok');
    }else{Notify.show('Could not add to wishlist','err');}
  },

  async toggleCard(cardName){
    if(!DB._sb||!DB._user){Notify.show('Sign in first','err');return;}
    const existing=this._data.find(w=>w.card_name===cardName);
    if(existing){
      await DB._sb.from('wishlist').delete().eq('id',existing.id);
      Notify.show(cardName+' removed from wishlist','inf');
    } else {
      await DB._sb.from('wishlist').insert({card_name:cardName,user_id:DB._user.id,user_email:DB._user.email||''});
      Notify.show(cardName+' added to wishlist','ok');
    }
    await this.render();
    MyCollection._renderCards();
  },

  _renderList(){
    const list=document.getElementById('wish-list');const empty=document.getElementById('wish-empty');
    if(!list)return;
    if(!this._data.length){list.innerHTML='';if(empty)empty.style.display='block';return;}
    if(empty)empty.style.display='none';list.innerHTML='';
    for(const r of this._data){
      const cd=Store.card(r.card_name)||{};
      const price=parseFloat(cd.prices?.eur||0);
      const row=document.createElement('div');row.className='trade-card';
      row.style.cursor='pointer';
      row.title='Click to view card details';
      row.innerHTML=`
        ${cd.img?.normal||cd.img?.crop?
          `<img class="bulk-pool-thumb" src="${esc(cd.img.normal||cd.img.crop)}" loading="lazy" style="width:48px;height:67px;object-fit:cover;border-radius:4px;flex-shrink:0">`
          :'<div style="width:48px;height:67px;background:var(--bg3);border-radius:4px;flex-shrink:0;border:1px solid var(--border)"></div>'}
        <div style="flex:1;min-width:0">
          <div class="bulk-pool-name" style="font-size:13px">${esc(r.card_name)}</div>
          <div class="bulk-pool-meta">${r.note?esc(r.note)+' · ':''} ${price?'€'+price.toFixed(2):'no price data'}</div>
        </div>
        <span class="trade-badge want">⭐ Wanted</span>
        <button class="alert-del" title="Remove from wishlist" onclick="event.stopPropagation();WishlistMgr.remove('${r.id}')">✕</button>
      `;
      // Click row → open card modal with full info
      row.addEventListener('click',e=>{
        if(e.target.closest('.alert-del'))return; // don't open modal when clicking remove
        const cached=Store.card(r.card_name);
        if(cached&&cached.name){
          M.open({name:r.card_name,qty:1},null);
        } else {
          Notify.show('Loading card data…','inf',1500);
          SF.fetch(r.card_name,()=>{M.open({name:r.card_name,qty:1},null);});
        }
      });
      // Lazy-fetch card data if not cached yet
      if(!cd.img)SF.fetch(r.card_name,()=>{this._renderList();});
      list.appendChild(row);
    }
  },

  async remove(id){
    if(!DB._sb||!DB._user)return;
    await DB._sb.from('wishlist').delete().eq('id',id);this.render();
  }
};

/* ═══════════════════════════════════════════════════════════
   COMMUNITY NAV — All Users + My Friends
   ═══════════════════════════════════════════════════════════ */
const CommunityNav={
  cur:'friends',
  _viewingUser:null,

  go(page){
    this.cur=page;
    this._viewingUser=null;
    document.querySelectorAll('#community-tabs .vtb').forEach(b=>b.classList.remove('on'));
    const btn=document.getElementById('ct-'+page);if(btn)btn.classList.add('on');
    document.querySelectorAll('#community-nav .vn-item').forEach(b=>b.classList.toggle('on',b.dataset.cpage===page));
    if(page==='friends')this._renderAllUsers();
    else if(page==='myfriends')this._renderMyFriends();
    else if(page==='profile')this._renderMyProfile();
  },

  // ── All Users list ──────────────────────────────────────
  async _renderAllUsers(){
    const el=document.getElementById('community-content');if(!el)return;
    if(!DB._sb||!DB._user){
      el.innerHTML='<div style="padding:20px;text-align:center;color:var(--text3)">Sign in to see users.</div>';return;
    }
    el.innerHTML='<div style="color:var(--text3);font-size:12px;padding:8px">Loading users…</div>';
    try{
      // Upsert own profile so current user appears to others
      // Use cached nickname if available, else fallback to email prefix
      const _myName=DB._nickname||DB._user.user_metadata?.username||DB._user.email?.split('@')[0]||'User';
      await DB._sb.from('profiles').upsert({
        id:DB._user.id,
        email:DB._user.email||'',
        username:_myName
      },{onConflict:'id',ignoreDuplicates:true});

      const{data,error}=await DB._sb.from('profiles').select('id,email,username')
        .neq('id',DB._user.id).order('username',{nullsFirst:false}).limit(200);
      if(error)throw error;

      if(!data?.length){
        el.innerHTML=`<div style="padding:16px;background:var(--bg3);border:1px solid var(--border);border-radius:var(--r);font-size:12px;line-height:1.8">
          <div style="font-family:'Cinzel',serif;color:var(--gold2);margin-bottom:8px">No other users found yet</div>
          <div style="color:var(--text2)">Other users need to open the app once to auto-create their profile.</div>
          <div style="color:var(--text3);margin-top:10px">Or run this SQL in your Supabase SQL Editor to backfill everyone:</div>
          <pre style="background:var(--bg);border:1px solid var(--border2);border-radius:var(--r);padding:10px;margin-top:8px;font-size:10px;color:var(--ice);overflow-x:auto">INSERT INTO profiles (id, email, username)
SELECT id, email, split_part(email,'@',1)
FROM auth.users ON CONFLICT (id) DO NOTHING;</pre>
        </div>`;
        return;
      }

      const{data:friends}=await DB._sb.from('friendships').select('friend_id').eq('user_id',DB._user.id);
      const friendIds=new Set((friends||[]).map(f=>f.friend_id));

      el.innerHTML=`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div style="font-family:'Cinzel',serif;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--text3)">${data.length} users</div>
        <button class="tbtn sm" onclick="CommunityNav._renderAllUsers()" style="font-size:9px">🔄 Refresh</button>
      </div>`;

      for(const u of data){
        const isFriend=friendIds.has(u.id);
        const displayName=u.username||u.email?.split('@')[0]||'User';
        const hue=(u.id.charCodeAt(0)*17)%360;
        const card=document.createElement('div');card.className='friend-card';card.id='user-card-'+u.id;
        card.innerHTML=`
          <div class="friend-avatar" style="background:hsl(${hue},35%,22%);border-color:hsl(${hue},50%,42%)">${esc(displayName.slice(0,1).toUpperCase())}</div>
          <div style="flex:1;min-width:0">
            <div class="friend-name">${esc(displayName)}</div>
            <div class="friend-meta">${esc(u.email||'')}</div>
          </div>
          <button class="tbtn sm ${isFriend?'':'gold'}" id="friend-btn-${u.id}"
            onclick="CommunityNav.${isFriend?'removeFriend':'addFriend'}('${u.id}','${esc(u.email||'')}','${esc(displayName)}')">
            ${isFriend?'✓ Following':'+ Follow'}
          </button>
          <button class="tbtn sm" onclick="CommunityNav.viewUser('${u.id}','${esc(u.email||'')}','${esc(displayName)}')">View →</button>
        `;
        el.appendChild(card);
      }
    }catch(e){
      el.innerHTML=`<div style="color:var(--crimson2);padding:12px;font-family:'JetBrains Mono',monospace;font-size:11px">
        Error: ${esc(e.message)}<br>
        <span style="color:var(--text3);font-size:10px">Make sure you ran supabase_schema.sql and the profiles table exists.</span>
      </div>`;
    }
  },

  // ── My Friends list ──────────────────────────────────────
  async _renderMyFriends(){
    const el=document.getElementById('community-content');if(!el)return;
    if(!DB._sb||!DB._user){
      el.innerHTML='<div style="padding:20px;text-align:center;color:var(--text3)">Sign in to see friends.</div>';return;
    }
    el.innerHTML='<div style="color:var(--text3);font-size:12px;padding:8px">Loading…</div>';
    try{
      const{data}=await DB._sb.from('friendships')
        .select('friend_id,friend_email,friend_username').eq('user_id',DB._user.id);
      if(!data?.length){
        el.innerHTML='<div style="padding:20px;text-align:center;color:var(--text3)">Not following anyone yet.<br>Go to All Users to follow people.</div>';return;
      }
      el.innerHTML=`<div style="font-family:'Cinzel',serif;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);margin-bottom:12px">${data.length} following</div>`;
      for(const f of data){
        const displayName=f.friend_username||f.friend_email?.split('@')[0]||'User';
        const hue=(f.friend_id.charCodeAt(0)*17)%360;
        const card=document.createElement('div');card.className='friend-card';
        card.innerHTML=`
          <div class="friend-avatar" style="background:hsl(${hue},35%,22%);border-color:hsl(${hue},50%,42%)">${esc(displayName.slice(0,1).toUpperCase())}</div>
          <div style="flex:1;min-width:0">
            <div class="friend-name">${esc(displayName)}</div>
            <div class="friend-meta">${esc(f.friend_email||'')}</div>
          </div>
          <button class="tbtn sm" onclick="CommunityNav.viewUser('${f.friend_id}','${esc(f.friend_email||'')}','${esc(displayName)}')">View →</button>
          <button class="alert-del" onclick="CommunityNav.removeFriend('${f.friend_id}')">✕</button>
        `;
        el.appendChild(card);
      }
    }catch(e){el.innerHTML=`<div style="color:var(--crimson2);padding:12px">Error: ${esc(e.message)}</div>`;}
  },

  // ── Follow / Unfollow ────────────────────────────────────
  async addFriend(friendId,email,username){
    if(!DB._sb||!DB._user)return;
    try{
      await DB._sb.from('friendships').insert({
        user_id:DB._user.id,friend_id:friendId,friend_email:email,friend_username:username
      });
      const btn=document.getElementById('friend-btn-'+friendId);
      if(btn){btn.textContent='✓ Following';btn.classList.remove('gold');}
      Notify.show('Following '+username,'ok');
    }catch(e){Notify.show('Failed: '+e.message,'err');}
  },

  async removeFriend(friendId){
    if(!DB._sb||!DB._user)return;
    await DB._sb.from('friendships').delete().eq('user_id',DB._user.id).eq('friend_id',friendId);
    Notify.show('Unfollowed','inf');
    this.go(this.cur);
  },

  // ── View a user's profile ────────────────────────────────
  async viewUser(userId, email, displayName){
    const el=document.getElementById('community-content');if(!el)return;
    this._viewingUser=userId;
    const name=displayName||email?.split('@')[0]||'User';
    const hue=(userId.charCodeAt(0)*17)%360;
    const initial=name.slice(0,1).toUpperCase();

    // Skeleton placeholder while loading
    el.innerHTML=`
      <div class="fp-header">
        <button onclick="CommunityNav.go(CommunityNav.cur||'friends')"
          style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:22px;padding:0 4px 0 0;line-height:1;flex-shrink:0">←</button>
        <div class="fp-avatar" style="background:hsl(${hue},30%,18%);border-color:hsl(${hue},45%,38%);color:hsl(${hue},60%,70%)">${esc(initial)}</div>
        <div style="flex:1;min-width:0">
          <div class="fp-name">${esc(name)}</div>
          <div class="fp-email">${esc(email||'')}</div>
          <div class="fp-stats">
            <div class="fp-stat">Decks: <span id="fp-deck-count">…</span></div>
            <div class="fp-stat">Cards: <span id="fp-card-count">…</span></div>
            <div class="fp-stat">Value: <span id="fp-total-val">…</span></div>
          </div>
        </div>
        <div class="fp-actions">
          <div id="fp-friend-btn"></div>
        </div>
      </div>
      <div style="font-family:'Cinzel',serif;font-size:10px;letter-spacing:.12em;text-transform:uppercase;
                  color:var(--text3);margin-bottom:12px;display:flex;align-items:center;gap:10px">
        Public Decks
        <span id="fp-bracket-legend" style="margin-left:auto;display:flex;gap:6px;font-size:9px;font-family:'JetBrains Mono',monospace;text-transform:none;letter-spacing:0"></span>
      </div>
      <div id="fp-decks-grid" class="fp-deck-grid">
        ${[1,2,3].map(()=>`<div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;height:140px;animation:shim 1.6s ease-in-out infinite;background:linear-gradient(90deg,var(--bg2),var(--bg3),var(--bg2));background-size:300%"></div>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:4px">
        <div>
          <div style="font-family:'Cinzel',serif;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--border)">🤝 Trade List</div>
          <div id="fp-trade-list"><div style="color:var(--text3);font-size:12px">Loading…</div></div>
        </div>
        <div>
          <div style="font-family:'Cinzel',serif;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--border)">⭐ Wishlist</div>
          <div id="fp-wish-list"><div style="color:var(--text3);font-size:12px">Loading…</div></div>
        </div>
      </div>`;

    if(!DB._sb)return;

    // ── Load all data in parallel ──────────────────────────────
    const[deckRes,tradeRes,wishRes,friendRes]=await Promise.allSettled([
      DB._sb.from('decks').select('id,name,commander,partner,cards,public').eq('user_id',userId).eq('public',true),
      DB._sb.from('trade_list').select('card_name,qty,condition').eq('user_id',userId),
      DB._sb.from('wishlist').select('card_name,note').eq('user_id',userId),
      DB._user?DB._sb.from('friendships').select('id').eq('user_id',DB._user.id).eq('friend_id',userId):Promise.resolve({data:[]})
    ]);

    const decks=(deckRes.value?.data||[]).map(d=>({...d,cards:typeof d.cards==='string'?JSON.parse(d.cards||'[]'):d.cards||[]}));
    const trades=tradeRes.value?.data||[];
    const wishes=wishRes.value?.data||[];
    const isFriend=(friendRes.value?.data||[]).length>0;

    // ── Header stats ──────────────────────────────────────────
    const totalCards=decks.reduce((s,d)=>s+d.cards.reduce((a,c)=>a+c.qty,0),0);
    const totalVal=decks.reduce((s,d)=>s+d.cards.reduce((a,c)=>a+(parseFloat(Store.card(c.name)?.prices?.eur||0)*c.qty),0),0);
    const dc=document.getElementById('fp-deck-count');if(dc)dc.textContent=decks.length;
    const cc=document.getElementById('fp-card-count');if(cc)cc.textContent=totalCards.toLocaleString();
    const vc=document.getElementById('fp-total-val');if(vc)vc.textContent='€'+totalVal.toFixed(0);

    // ── Friend button ─────────────────────────────────────────
    const fbEl=document.getElementById('fp-friend-btn');
    if(fbEl&&DB._user&&DB._user.id!==userId){
      const btn=document.createElement('button');
      btn.className='tbtn'+(isFriend?' sm':' sm gold');
      btn.textContent=isFriend?'✓ Friends':'+ Follow';
      btn.onclick=()=>isFriend?CommunityNav.removeFriend(userId):CommunityNav.addFriend(userId,email,name);
      fbEl.appendChild(btn);
    }

    // ── Deck Cards ────────────────────────────────────────────
    const grid=document.getElementById('fp-decks-grid');
    if(!grid)return;
    if(decks.length){
      grid.innerHTML='';

      // Preload commander art for all decks
      decks.forEach(d=>{if(d.commander&&!Store.card(d.commander))SF.fetch(d.commander,()=>{});});

      for(const d of decks){
      const cards=d.cards;
      const cmdrData=d.commander?Store.card(d.commander):null;
      const totalDeckVal=cards.reduce((s,c)=>s+(parseFloat(Store.card(c.name)?.prices?.eur||0)*c.qty),0);

      // Bracket score (quick estimate)
      const bracketScore=BracketCalc?._quickScore?BracketCalc._quickScore(cards):null;
      const bracketLabel=bracketScore?`B${bracketScore}`:'';
      const bracketColor={1:'var(--green2)',2:'var(--ice)',3:'var(--gold)',4:'var(--crimson2)'}[bracketScore]||'var(--text3)';

      const card=document.createElement('div');
      card.className='fp-deck-card';
      card.dataset.deckId=d.id;

      card.innerHTML=`
        <div class="fp-deck-banner">
          ${cmdrData?.img?.crop?`<img class="fp-deck-banner-art" src="${esc(cmdrData.img.crop)}" loading="lazy">`:''}
          <div class="fp-deck-banner-overlay"></div>
          <div class="fp-deck-banner-cmdr">${esc(d.commander||'No Commander')}</div>
          ${bracketLabel?`<div class="fp-deck-banner-badge" style="color:${bracketColor};border-color:${bracketColor}">${bracketLabel}</div>`:''}
        </div>
        <div class="fp-deck-info">
          <div class="fp-deck-title">${esc(d.name)}</div>
          <div class="fp-deck-meta">
            <span>${cards.length} cards</span>
            <span>$${totalDeckVal.toFixed(0)}</span>
            ${d.partner?`<span>${esc(d.partner)}</span>`:''}
          </div>
        </div>
        <div class="fp-deck-footer">
          <button class="tbtn sm" style="font-size:10px" data-action="view-fp-deck" data-deck-id="${d.id}">👁 View Deck</button>
          <button class="tbtn sm gold" style="font-size:10px" data-action="import-fp-deck" data-deck-id="${d.id}">⬇ Import</button>
          <button class="tbtn sm" style="font-size:10px;margin-left:auto" data-action="comment-fp-deck" data-deck-id="${d.id}">💬</button>
        </div>
        <div class="fp-deck-viewer" id="fp-viewer-${d.id}"></div>`;

      grid.appendChild(card);

      // Wire buttons
      card.querySelector('[data-action="view-fp-deck"]').addEventListener('click',()=>CommunityNav._toggleDeckViewer(d,card));
      card.querySelector('[data-action="import-fp-deck"]').addEventListener('click',()=>CommunityNav._importDeck(d));
      card.querySelector('[data-action="comment-fp-deck"]').addEventListener('click',()=>{
        const v=document.getElementById('fp-viewer-'+d.id);
        if(v){v.classList.toggle('open');if(v.classList.contains('open'))CommunityNav._renderViewerComments(d.id,v);}
      });
      } // end for decks
    } else {
      grid.innerHTML='<div style="color:var(--text3);font-size:12px;padding:16px">No public decks.</div>';
    }

    // ── Trade list ────────────────────────────────────────────
    const myWishSet=new Set((WishlistMgr._data||[]).map(w=>w.card_name.toLowerCase()));
    const myCardSet=new Set(Store.decks.flatMap(d=>d.cards.map(cc=>cc.name.toLowerCase())));
    const tEl=document.getElementById('fp-trade-list');
    if(tEl){
      if(!trades.length){tEl.innerHTML='<div style="color:var(--text3);font-size:12px">Nothing for trade.</div>';}
      else{
        tEl.innerHTML='';
        const tradeList=document.createElement('div');
        trades.slice(0,12).forEach(t=>{
          const cd=Store.card(t.card_name)||{};
          const alreadyWanted=myWishSet.has(t.card_name.toLowerCase());
          const iHave=myCardSet.has(t.card_name.toLowerCase());
          const row=document.createElement('div');
          row.className='fp-card-row';
          row.style.cssText='padding:5px 0;';
          row.innerHTML=`
            ${cd.img?.crop?`<img class="fp-card-thumb" src="${esc(cd.img.crop)}" loading="lazy">`:'<div class="fp-card-thumb" style="background:var(--bg3)"></div>'}
            <span class="fp-card-name">${esc(t.card_name)}</span>
            <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text3)">${t.qty}× ${t.condition||'NM'}</span>
            ${iHave?'<span class="fp-have-badge">✓ Have</span>':''}
            ${cd.prices?.eur?`<span class="fp-card-price">$${parseFloat(cd.prices.eur).toFixed(2)}</span>`:''}
          `;
          if(!alreadyWanted){
            const wantBtn=document.createElement('button');
            wantBtn.className='fp-want-btn';
            wantBtn.textContent='⭐ Want';
            wantBtn.title='Add to my wishlist';
            wantBtn.onclick=()=>{
              WishlistMgr.addByName(t.card_name);
              wantBtn.textContent='⭐ Added';wantBtn.classList.add('on');wantBtn.disabled=true;
            };
            row.appendChild(wantBtn);
          } else {
            const badge=document.createElement('span');
            badge.className='fp-want-btn on';badge.textContent='⭐ On list';badge.style.cursor='default';
            row.appendChild(badge);
          }
          tradeList.appendChild(row);
        });
        if(trades.length>12)tradeList.insertAdjacentHTML('beforeend',`<div style="font-size:11px;color:var(--text3);padding:6px 0">+${trades.length-12} more</div>`);
        tEl.appendChild(tradeList);
      }
    }

    // ── Wishlist ──────────────────────────────────────────────
    const wEl=document.getElementById('fp-wish-list');
    if(wEl){
      if(!wishes.length){wEl.innerHTML='<div style="color:var(--text3);font-size:12px">Empty wishlist.</div>';}
      else{
        wEl.innerHTML='';
        const wishList=document.createElement('div');
        wishes.slice(0,12).forEach(w=>{
          const cd=Store.card(w.card_name)||{};
          const iHave=myCardSet.has(w.card_name.toLowerCase());
          const alsoWant=myWishSet.has(w.card_name.toLowerCase());
          const row=document.createElement('div');
          row.className='fp-card-row';row.style.cssText='padding:5px 0;';
          row.innerHTML=`
            ${cd.img?.crop?`<img class="fp-card-thumb" src="${esc(cd.img.crop)}" loading="lazy">`:'<div class="fp-card-thumb" style="background:var(--bg3)"></div>'}
            <span class="fp-card-name">${esc(w.card_name)}</span>
            ${cd.prices?.eur?`<span class="fp-card-price">$${parseFloat(cd.prices.eur).toFixed(2)}</span>`:''}
          `;
          if(iHave){
            /* I own this card they want — offer it */
            const offerBtn=document.createElement('button');
            offerBtn.className='fp-trade-badge';offerBtn.style.cursor='pointer';
            offerBtn.textContent='🤝 Offer';offerBtn.title='Add to your trade list so they can see it';
            offerBtn.onclick=()=>{
              TradeMgr.toggleCard(w.card_name);
              offerBtn.textContent='🤝 Listed';offerBtn.style.cursor='default';offerBtn.disabled=true;
            };
            row.appendChild(offerBtn);
          } else if(!alsoWant){
            /* I don't have it — I can also want it */
            const alsoBtn=document.createElement('button');
            alsoBtn.className='fp-want-btn';alsoBtn.textContent='⭐ Also want';alsoBtn.title='Add to my wishlist too';
            alsoBtn.onclick=()=>{
              WishlistMgr.addByName(w.card_name);
              alsoBtn.textContent='⭐ Added';alsoBtn.classList.add('on');alsoBtn.disabled=true;
            };
            row.appendChild(alsoBtn);
          } else {
            const b=document.createElement('span');b.className='fp-want-btn on';b.textContent='⭐ On list';b.style.cursor='default';row.appendChild(b);
          }
          wishList.appendChild(row);
        });
        if(wishes.length>12)wishList.insertAdjacentHTML('beforeend',`<div style="font-size:11px;color:var(--text3);padding:6px 0">+${wishes.length-12} more</div>`);
        wEl.appendChild(wishList);
      }
    }
  },

  _toggleDeckViewer(deck,cardEl){
    const viewerEl=document.getElementById('fp-viewer-'+deck.id);if(!viewerEl)return;
    const isOpen=viewerEl.classList.contains('open');
    // Close all others
    document.querySelectorAll('.fp-deck-viewer.open').forEach(v=>{v.classList.remove('open');v.closest('.fp-deck-card')?.classList.remove('expanded');});
    if(isOpen)return;
    viewerEl.classList.add('open');
    cardEl.classList.add('expanded');
    cardEl.scrollIntoView({behavior:'smooth',block:'nearest'});
    this._buildDeckViewer(deck,viewerEl);
  },

  _buildDeckViewer(deck,el){
    const cards=deck.cards;
    // Sort into groups
    const cmdrs=[deck.commander,deck.partner].filter(Boolean);
    const lands=cards.filter(c=>!cmdrs.includes(c.name)&&(Store.card(c.name)?.type_line||'').toLowerCase().includes('land'));
    const creatures=cards.filter(c=>!cmdrs.includes(c.name)&&(Store.card(c.name)?.type_line||'').toLowerCase().includes('creature')&&!(Store.card(c.name)?.type_line||'').toLowerCase().includes('land'));
    const spells=cards.filter(c=>!cmdrs.includes(c.name)&&!(Store.card(c.name)?.type_line||'').toLowerCase().includes('land')&&!(Store.card(c.name)?.type_line||'').toLowerCase().includes('creature'));

    // Mana curve
    const curve={};
    cards.forEach(c=>{const cd=Store.card(c.name);if(cd&&!(cd.type_line||'').toLowerCase().includes('land')){const cmc=Math.min(cd.cmc||0,7);curve[cmc]=(curve[cmc]||0)+c.qty;}});
    const maxCurve=Math.max(...Object.values(curve),1);
    const curveHTML=Array.from({length:8},(_,i)=>{
      const h=Math.round(((curve[i]||0)/maxCurve)*40);
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:2px">
        <div class="fp-curve-bar" style="height:${h||2}px" title="CMC ${i<7?i:'7+'}: ${curve[i]||0}"></div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:8px;color:var(--text3)">${i<7?i:'7+'}</div>
      </div>`;
    }).join('');

    const totalVal=cards.reduce((s,c)=>s+(parseFloat(Store.card(c.name)?.prices?.eur||0)*c.qty),0);
    const avgCmc=(()=>{
      let total=0,count=0;
      cards.forEach(c=>{const cd=Store.card(c.name);if(cd&&!(cd.type_line||'').toLowerCase().includes('land')){total+=cd.cmc||0;count++;}});
      return count?( total/count).toFixed(1):'—';
    })();

    const myDeckCards=new Set(Store.decks.flatMap(d=>d.cards.map(c=>c.name.toLowerCase())));
    const myWishCards=new Set((WishlistMgr._data||[]).map(w=>w.card_name.toLowerCase()));
    const renderGroup=(title,arr)=>{
      if(!arr.length)return'';
      const sorted=arr.slice().sort((a,b)=>{
        const pa=parseFloat(Store.card(a.name)?.prices?.eur||0);
        const pb=parseFloat(Store.card(b.name)?.prices?.eur||0);
        return pb-pa;
      });
      const rows=sorted.map(card=>{
        const cd=Store.card(card.name)||{};
        const price=parseFloat(cd.prices?.eur||0);
        const iOwn=myDeckCards.has(card.name.toLowerCase());
        const iWant=myWishCards.has(card.name.toLowerCase());
        const wantBtn=(!iOwn&&!iWant)
          ?`<button class="fp-want-btn" data-action="wish" data-card="${esc(card.name)}" title="Add to my wishlist"
              onclick="WishlistMgr.addByName('${esc(card.name).replace(/'/g,'\\&#39;')}');this.textContent='⭐';this.classList.add('on');this.disabled=true;">⭐</button>`
          :iWant?'<span class="fp-want-btn on" style="cursor:default;padding:2px 5px">⭐</span>'
          :'<span class="fp-have-badge">✓</span>';
        return `<div class="fp-card-row" style="${price>20?'background:rgba(200,168,75,.04);':''}">
          ${cd.img?.crop?`<img class="fp-card-thumb" src="${esc(cd.img.crop)}" loading="lazy">`:'<div class="fp-card-thumb" style="background:var(--bg3)"></div>'}
          <span class="fp-card-name">${esc(card.name)}</span>
          <span class="fp-card-qty" style="color:var(--text2)">${card.qty>1?card.qty+'×':''}</span>
          <span class="fp-card-mana">${fmtMana(cd.mana_cost||'')}</span>
          <span class="fp-card-price">${price?'€'+price.toFixed(2):''}</span>
          ${wantBtn}
        </div>`;
      }).join('');
      return `<div style="font-family:'Cinzel',serif;font-size:9px;letter-spacing:.1em;text-transform:uppercase;
                  color:var(--text3);margin:10px 0 6px;padding-top:6px;border-top:1px solid var(--border)">${title} (${arr.reduce((s,c_)=>s+c_.qty,0)})</div>${rows}`;
    };

    el.innerHTML=`
      <div class="fp-dv-tabs">
        <div class="fp-dv-tab on" onclick="CommunityNav._fpTab(this,'fp-dv-list-${deck.id}')">📋 Cards</div>
        <div class="fp-dv-tab" onclick="CommunityNav._fpTab(this,'fp-dv-stats-${deck.id}')">📊 Stats</div>
        <div class="fp-dv-tab" onclick="CommunityNav._fpTab(this,'fp-dv-comments-${deck.id}')">💬 Comments</div>
        <button style="margin-left:auto;background:none;border:none;color:var(--text3);cursor:pointer;padding:4px 10px;font-size:16px"
          onclick="document.getElementById('fp-viewer-${deck.id}').classList.remove('open');document.querySelector('[data-deck-id=\'${deck.id}\']')?.closest('.fp-deck-card')?.classList.remove('expanded')">✕</button>
      </div>

      <div class="fp-dv-pane on" id="fp-dv-list-${deck.id}" style="max-height:320px;overflow-y:auto">
        ${renderGroup('Commander',cards.filter(c=>[deck.commander,deck.partner].includes(c.name)))}
        ${renderGroup('Creatures',creatures)}
        ${renderGroup('Spells',spells)}
        ${renderGroup('Lands',lands)}
      </div>

      <div class="fp-dv-pane" id="fp-dv-stats-${deck.id}">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px">
          <div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:10px;text-align:center">
            <div style="font-family:'JetBrains Mono',monospace;font-size:18px;color:var(--gold2);font-weight:600">$${totalVal.toFixed(0)}</div>
            <div style="font-size:9px;color:var(--text3);font-family:'Cinzel',serif;text-transform:uppercase;letter-spacing:.08em">Value</div>
          </div>
          <div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:10px;text-align:center">
            <div style="font-family:'JetBrains Mono',monospace;font-size:18px;color:var(--ice);font-weight:600">${avgCmc}</div>
            <div style="font-size:9px;color:var(--text3);font-family:'Cinzel',serif;text-transform:uppercase;letter-spacing:.08em">Avg CMC</div>
          </div>
          <div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:10px;text-align:center">
            <div style="font-family:'JetBrains Mono',monospace;font-size:18px;color:var(--green2);font-weight:600">${cards.reduce((s,c)=>s+c.qty,0)}</div>
            <div style="font-size:9px;color:var(--text3);font-family:'Cinzel',serif;text-transform:uppercase;letter-spacing:.08em">Cards</div>
          </div>
        </div>
        <div style="font-family:'Cinzel',serif;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:6px">Mana Curve</div>
        <div style="display:flex;gap:4px;align-items:flex-end;height:52px;margin-bottom:12px">${curveHTML}</div>
        <div style="font-family:'Cinzel',serif;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:8px">Top 5 by Value</div>
        ${cards.slice().sort((a,b)=>(parseFloat(Store.card(b.name)?.prices?.eur||0)*b.qty)-(parseFloat(Store.card(a.name)?.prices?.eur||0)*a.qty))
          .slice(0,5).map(c=>{const cd=Store.card(c.name)||{};const v=(parseFloat(cd.prices?.eur||0)*c.qty);return `
          <div class="fp-card-row">
            ${cd.img?.crop?`<img class="fp-card-thumb" src="${esc(cd.img.crop)}" loading="lazy">`:'<div class="fp-card-thumb" style="background:var(--bg3)"></div>'}
            <span class="fp-card-name">${esc(c.name)}</span>
            <span class="fp-card-price" style="font-size:11px">$${v.toFixed(2)}</span>
          </div>`;}).join('')}
      </div>

      <div class="fp-dv-pane" id="fp-dv-comments-${deck.id}">
        <div id="fp-comments-inner-${deck.id}"><div style="color:var(--text3);font-size:12px">Loading comments…</div></div>
      </div>`;

    // Prefetch missing card data for the viewer
    const missingNames=[...new Set(cards.map(c=>c.name).filter(n=>!Store.card(n)))];
    if(missingNames.length)SF.fetchBatch(missingNames,()=>{});
  },

  _fpTab(btn,paneId){
    const viewer=btn.closest('.fp-deck-viewer');if(!viewer)return;
    viewer.querySelectorAll('.fp-dv-tab').forEach(t=>t.classList.remove('on'));
    viewer.querySelectorAll('.fp-dv-pane').forEach(p=>p.classList.remove('on'));
    btn.classList.add('on');
    const pane=document.getElementById(paneId);if(pane)pane.classList.add('on');
    // Lazy load comments
    if(paneId.includes('comments')){
      const deckId=paneId.replace('fp-dv-comments-','');
      const inner=document.getElementById('fp-comments-inner-'+deckId);
      if(inner&&inner.querySelector('[style*="Loading"]'))
        this._renderViewerComments(deckId,inner);
    }
  },

  _renderViewerComments(deckId,container){
    DeckComments.renderForDeck(deckId,container.id||'');
    if(!container.id){container.id='fpc-'+deckId;}
    DeckComments.renderForDeck(deckId,container.id);
  },

  _importDeck(d){
    const deck=d;const cards=typeof deck.cards==='string'?JSON.parse(deck.cards):deck.cards||[];
    const newDeck={id:Store.uid(),name:'[Copy] '+deck.name,commander:deck.commander||'',
                   partner:deck.partner||'',cards,created:Date.now(),public:true};
    Store.addDeck(newDeck);App.renderSidebar();App.loadDeck(newDeck.id);
    Menu.go('forge');
    Notify.show('Deck imported: '+newDeck.name,'ok');
  },

  // ── My Profile + Nickname change ────────────────────────
  async _renderMyProfile(){
    const el=document.getElementById('community-content');if(!el)return;
    if(!DB._sb||!DB._user){
      el.innerHTML='<div style="padding:20px;text-align:center;color:var(--text3)">Sign in to view your profile.</div>';return;
    }

    // Fetch profile
    const{data:profile}=await DB._sb.from('profiles').select('*').eq('id',DB._user.id).single();
    const username=profile?.username||DB._user.email?.split('@')[0]||'User';
    const lastChange=profile?.username_changed_at?new Date(profile.username_changed_at):null;
    const daysSince=lastChange?Math.floor((Date.now()-lastChange)/(1000*60*60*24)):999;
    const canChange=daysSince>=30;
    const daysLeft=Math.max(0,30-daysSince);

    const hue=(DB._user.id.charCodeAt(0)*17)%360;

    el.innerHTML=`
      <div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:20px 0 28px;border-bottom:1px solid var(--border);margin-bottom:20px">
        <div class="friend-avatar" style="width:64px;height:64px;font-size:28px;background:hsl(${hue},35%,22%);border-color:hsl(${hue},50%,42%)">${esc(username.slice(0,1).toUpperCase())}</div>
        <div style="text-align:center">
          <div style="font-family:'Cinzel',serif;font-size:20px;color:var(--gold2);font-weight:700">${esc(username)}</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text3);margin-top:4px">${esc(DB._user.email||'')}</div>
        </div>
        <div style="display:flex;gap:16px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text3)">
          <span>${Store.decks.length} decks</span>
          <span>${Store.decks.flatMap(d=>d.cards).length} cards</span>
        </div>
      </div>

      <!-- Nickname change -->
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:16px">
        <div style="font-family:'Cinzel',serif;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);margin-bottom:12px">
          Change Nickname
        </div>
        ${canChange ? `
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <input id="profile-nickname-inp" class="auth-field" value="${esc(username)}"
              placeholder="New nickname…" style="flex:1;min-width:140px;margin-bottom:0"
              maxlength="30">
            <button class="tbtn gold" onclick="CommunityNav._saveNickname()">Save Nickname</button>
          </div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text3);margin-top:8px">
            You can change your nickname once every 30 days.
          </div>
        ` : `
          <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text2);margin-bottom:10px">
            Current: <span style="color:var(--gold2)">${esc(username)}</span>
          </div>
          <div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--r);padding:10px 14px;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text3)">
            ⏳ Next change available in <strong style="color:var(--gold)">${daysLeft} day${daysLeft===1?'':'s'}</strong>
            ${lastChange?`(last changed ${lastChange.toLocaleDateString()})`:''} 
          </div>
        `}
        <div id="profile-nickname-status" style="margin-top:8px;font-family:'JetBrains Mono',monospace;font-size:10px"></div>
      </div>

      <!-- My public decks toggle -->
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:18px">
        <div style="font-family:'Cinzel',serif;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);margin-bottom:12px">
          My Decks — Visibility
        </div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:10px">Toggle which decks friends can see when they view your profile:</div>
        <div id="profile-deck-visibility"></div>
      </div>
    `;

    // Render deck visibility toggles
    this._renderDeckVisibility();
  },

  async _renderDeckVisibility(){
    const el=document.getElementById('profile-deck-visibility');if(!el)return;
    el.innerHTML='';
    for(const deck of Store.decks){
      const isPublic=deck.public!==false; // default public
      const row=document.createElement('div');
      row.style.cssText='display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)';
      row.innerHTML=`
        <div style="flex:1;min-width:0">
          <div style="font-family:'Cinzel',serif;font-size:11px;color:var(--text)">${esc(deck.name)}</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--text3)">${esc(deck.commander||'No commander')}</div>
        </div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:${isPublic?'var(--green2)':'var(--text3)'}">
          ${isPublic?'👁 Visible':'🔒 Private'}
        </div>
        <div class="toggle-switch ${isPublic?'on':''}" onclick="CommunityNav._toggleDeckPublic('${deck.id}',this)" style="flex-shrink:0">
          <div class="toggle-knob"></div>
        </div>
      `;
      el.appendChild(row);
    }
    if(!Store.decks.length){el.innerHTML='<div style="color:var(--text3);font-size:12px">No decks yet.</div>';}
  },

  _toggleDeckPublic(deckId, toggleEl){
    const deck=Store.getDeck(deckId);if(!deck)return;
    deck.public=!deck.public;
    Store.updDeck(deck);
    toggleEl.classList.toggle('on',deck.public);
    const label=toggleEl.previousElementSibling;
    if(label){label.style.color=deck.public?'var(--green2)':'var(--text3)';label.textContent=deck.public?'👁 Visible':'🔒 Private';}
    if(DB._sb&&DB._user){
      DB._sb.from('decks').update({public:deck.public}).eq('id',deckId).eq('user_id',DB._user.id).then(({error})=>{
        if(!error)Notify.show(deck.name+(deck.public?' now visible to friends':' now private'),'ok');
      });
    }
  },

  async _saveNickname(){
    const inp=document.getElementById('profile-nickname-inp');
    const status=document.getElementById('profile-nickname-status');
    const newName=(inp?.value||'').trim();
    if(!newName){if(status)status.innerHTML='<span style="color:var(--crimson2)">Enter a nickname</span>';return;}
    if(newName.length<2||newName.length>30){if(status)status.innerHTML='<span style="color:var(--crimson2)">Must be 2–30 characters</span>';return;}
    if(!DB._sb||!DB._user)return;

    // Double-check the 30-day cooldown server-side
    const{data:profile}=await DB._sb.from('profiles').select('username_changed_at').eq('id',DB._user.id).single();
    const lastChange=profile?.username_changed_at?new Date(profile.username_changed_at):null;
    const daysSince=lastChange?Math.floor((Date.now()-lastChange)/(1000*60*60*24)):999;
    if(daysSince<30){
      const daysLeft=30-daysSince;
      if(status)status.innerHTML=`<span style="color:var(--crimson2)">⏳ ${daysLeft} days left before next change</span>`;
      return;
    }

    const{error}=await DB._sb.from('profiles').update({
      username:newName,
      username_changed_at:new Date().toISOString()
    }).eq('id',DB._user.id);

    if(error){if(status)status.innerHTML=`<span style="color:var(--crimson2)">Error: ${esc(error.message)}</span>`;return;}

    // Update topbar display
    // Update topbar + avatar immediately
    const usernameEl=document.getElementById('auth-username');
    if(usernameEl)usernameEl.textContent=newName;
    const avEl=document.getElementById('auth-avatar');
    if(avEl)avEl.textContent=newName.slice(0,1).toUpperCase();
    DB._nickname=newName;
    if(status)status.innerHTML='<span style="color:var(--green2)">✓ Nickname updated! Next change in 30 days.</span>';
    Notify.show('Nickname changed to "'+newName+'"','ok');

    // Refresh profile view
    setTimeout(()=>this._renderMyProfile(),1500);
  }
};


/* ═══════════════════════════════════════════════════════════
   TRADE MATCHING
   Cross-references all wishlists vs trade lists automatically
   ═══════════════════════════════════════════════════════════ */
const TradeMatch={
  _running:false,

  render(){
    // Populate nothing on load — user clicks Find Matches
    const sel=document.getElementById('health-deck-select');
  },

  async run(){
    if(this._running)return;
    if(!DB._sb||!DB._user){Notify.show('Sign in to use Trade Matching','err');return;}
    this._running=true;
    const statusEl=document.getElementById('trade-match-status');
    const btn=document.getElementById('trade-match-refresh');
    if(btn)btn.textContent='🔄 Scanning…';
    if(statusEl)statusEl.textContent='Loading trade lists and wishlists…';
    this._hide(['tm-empty','tm-sec-want','tm-sec-have','tm-sec-mutual']);
    ['tm-want-list','tm-have-list','tm-mutual-list'].forEach(id=>{
      const el=document.getElementById(id);if(el)el.innerHTML='';
    });

    try{
      // Load ALL trade lists and wishlists from all users
      const[{data:allTrades,error:te},{data:allWishes,error:we}]=await Promise.all([
        DB._sb.from('trade_list').select('user_id,user_email,card_name,qty,condition'),
        DB._sb.from('wishlist').select('user_id,user_email,card_name,note')
      ]);
      if(te)throw te;if(we)throw we;

      // Load profile names
      const userIds=new Set([...(allTrades||[]).map(t=>t.user_id),...(allWishes||[]).map(w=>w.user_id)]);
      const{data:profiles}=await DB._sb.from('profiles').select('id,username,email').in('id',[...userIds]);
      const profileMap={};(profiles||[]).forEach(p=>{profileMap[p.id]={username:p.username||p.email?.split('@')[0]||'User',email:p.email||''};});

      const myId=DB._user.id;
      const myWishCards=new Set((allWishes||[]).filter(w=>w.user_id===myId).map(w=>w.card_name.toLowerCase()));
      const myTradeCards=new Set((allTrades||[]).filter(t=>t.user_id===myId).map(t=>t.card_name.toLowerCase()));
      // Also include all cards across my decks as "cards I have"
      const myDeckCards=new Set(Store.decks.flatMap(d=>d.cards.map(c=>c.name.toLowerCase())));

      // ── They have what I want ──
      // Group other users' trade lists, find overlap with my wishlist
      const theyHaveMap={};
      for(const t of (allTrades||[])){
        if(t.user_id===myId)continue;
        if(!myWishCards.has(t.card_name.toLowerCase()))continue;
        if(!theyHaveMap[t.user_id])theyHaveMap[t.user_id]=[];
        theyHaveMap[t.user_id].push(t);
      }

      // ── They want what I have ──
      const theyWantMap={};
      for(const w of (allWishes||[])){
        if(w.user_id===myId)continue;
        const cardLow=w.card_name.toLowerCase();
        if(!myTradeCards.has(cardLow)&&!myDeckCards.has(cardLow))continue;
        if(!theyWantMap[w.user_id])theyWantMap[w.user_id]=[];
        theyWantMap[w.user_id].push(w);
      }

      // ── Mutual matches (both directions) ──
      const mutualIds=new Set([...Object.keys(theyHaveMap)].filter(id=>theyWantMap[id]));

      const wantEntries=Object.entries(theyHaveMap).sort((a,b)=>b[1].length-a[1].length);
      const haveEntries=Object.entries(theyWantMap).sort((a,b)=>b[1].length-a[1].length);

      // Render "they have what you want"
      if(wantEntries.length){
        this._show('tm-sec-want');
        const cntEl=document.getElementById('tm-want-count');
        if(cntEl)cntEl.textContent=`(${wantEntries.length} user${wantEntries.length>1?'s':''})`;
        const listEl=document.getElementById('tm-want-list');
        for(const[uid,cards] of wantEntries){
          const prof=profileMap[uid]||{username:'Unknown',email:''};
          const hue=(uid.charCodeAt(0)*17)%360;
          const card=document.createElement('div');card.className='match-card';
          card.innerHTML=`
            <div class="match-hdr">
              <div class="match-avatar" style="background:hsl(${hue},35%,22%);border:2px solid hsl(${hue},50%,42%)">${esc(prof.username.slice(0,1).toUpperCase())}</div>
              <div style="flex:1;min-width:0">
                <div class="match-username">${esc(prof.username)}</div>
                <div class="match-sub">${esc(prof.email)} · has ${cards.length} card${cards.length>1?'s':''} you want</div>
              </div>
              <div class="match-score">${cards.length} match${cards.length>1?'es':''}</div>
            </div>
            <div class="match-pills">
              ${cards.map(t=>{
                const cd=Store.card(t.card_name)||{};
                return `<span class="match-pill they-have">
                  <span class="match-pill-label">HAVE</span>${esc(t.card_name)}${cd.prices?.eur?' · $'+cd.prices.eur:''}
                </span>`;
              }).join('')}
            </div>
            <div style="margin-top:10px;display:flex;gap:8px">
              <button class="tbtn sm gold" onclick="CommunityNav.viewUser('${uid}','${esc(prof.email)}','${esc(prof.username)}')">View Profile →</button>
              ${mutualIds.has(uid)?'<span class="trade-badge have" style="align-self:center">⚡ Mutual match</span>':''}
            </div>
          `;
          listEl.appendChild(card);
        }
      }

      // Render "they want what you have"
      if(haveEntries.length){
        this._show('tm-sec-have');
        const cntEl=document.getElementById('tm-have-count');
        if(cntEl)cntEl.textContent=`(${haveEntries.length} user${haveEntries.length>1?'s':''})`;
        const listEl=document.getElementById('tm-have-list');
        for(const[uid,wishes] of haveEntries){
          if(mutualIds.has(uid))continue; // shown in mutual section instead
          const prof=profileMap[uid]||{username:'Unknown',email:''};
          const hue=(uid.charCodeAt(0)*17)%360;
          const card=document.createElement('div');card.className='match-card';
          card.innerHTML=`
            <div class="match-hdr">
              <div class="match-avatar" style="background:hsl(${hue},35%,22%);border:2px solid hsl(${hue},50%,42%)">${esc(prof.username.slice(0,1).toUpperCase())}</div>
              <div style="flex:1;min-width:0">
                <div class="match-username">${esc(prof.username)}</div>
                <div class="match-sub">${esc(prof.email)} · wants ${wishes.length} card${wishes.length>1?'s':''} you have</div>
              </div>
              <div class="match-score">${wishes.length} match${wishes.length>1?'es':''}</div>
            </div>
            <div class="match-pills">
              ${wishes.map(w=>{
                const cd=Store.card(w.card_name)||{};
                const inTrade=myTradeCards.has(w.card_name.toLowerCase());
                return `<span class="match-pill you-have">
                  <span class="match-pill-label">${inTrade?'TRADE':'HAVE'}</span>${esc(w.card_name)}${cd.prices?.eur?' · $'+cd.prices.eur:''}
                </span>`;
              }).join('')}
            </div>
            <button class="tbtn sm" style="margin-top:10px" onclick="CommunityNav.viewUser('${uid}','${esc(prof.email)}','${esc(prof.username)}')">View Profile →</button>
          `;
          listEl.appendChild(card);
        }
      }

      // Render mutual matches
      if(mutualIds.size){
        this._show('tm-sec-mutual');
        const cntEl=document.getElementById('tm-mutual-count');
        if(cntEl)cntEl.textContent=`(${mutualIds.size} user${mutualIds.size>1?'s':''})`;
        const listEl=document.getElementById('tm-mutual-list');
        for(const uid of mutualIds){
          const prof=profileMap[uid]||{username:'Unknown',email:''};
          const theyHave=theyHaveMap[uid]||[];
          const theyWant=theyWantMap[uid]||[];
          const hue=(uid.charCodeAt(0)*17)%360;
          const card=document.createElement('div');
          card.className='match-card';
          card.style.border='1px solid var(--green2)';
          card.style.background='rgba(58,122,74,.06)';
          card.innerHTML=`
            <div class="match-hdr">
              <div class="match-avatar" style="background:hsl(${hue},35%,22%);border:2px solid hsl(${hue},50%,42%)">${esc(prof.username.slice(0,1).toUpperCase())}</div>
              <div style="flex:1;min-width:0">
                <div class="match-username">${esc(prof.username)}</div>
                <div class="match-sub">${esc(prof.email)}</div>
              </div>
              <span class="trade-badge have" style="font-size:11px">⚡ Mutual — ${theyHave.length+theyWant.length} cards</span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px">
              <div>
                <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--green2);margin-bottom:5px;text-transform:uppercase">They have → you want</div>
                <div class="match-pills">${theyHave.map(t=>`<span class="match-pill they-have">${esc(t.card_name)}</span>`).join('')}</div>
              </div>
              <div>
                <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--gold2);margin-bottom:5px;text-transform:uppercase">They want → you have</div>
                <div class="match-pills">${theyWant.map(w=>`<span class="match-pill you-have">${esc(w.card_name)}</span>`).join('')}</div>
              </div>
            </div>
            <button class="tbtn sm gold" style="margin-top:10px" onclick="CommunityNav.viewUser('${uid}','${esc(prof.email)}','${esc(prof.username)}')">View Profile &amp; Initiate Trade →</button>
          `;
          listEl.appendChild(card);
        }
      }

      const total=wantEntries.length+haveEntries.length;
      if(!total){
        this._show('tm-empty');
        const emptyEl=document.getElementById('tm-empty');
        if(emptyEl)emptyEl.innerHTML=`<div class="match-empty">
          No matches found yet.<br>
          <span style="font-size:11px;color:var(--text3)">
            Add cards to your <strong style="color:var(--text2)">Wishlist</strong> (cards you want) and
            <strong style="color:var(--text2)">Trade Tracker</strong> (cards you have), then ask friends to do the same.
          </span>
        </div>`;
      }else{
        const emptyEl=document.getElementById('tm-empty');
        if(emptyEl)emptyEl.style.display='none';
      }

      if(statusEl)statusEl.textContent=`Found ${total} potential trade partner${total>1?'s':''} · ${mutualIds.size} mutual`;
    }catch(e){
      if(statusEl)statusEl.innerHTML=`<span style="color:var(--crimson2)">Error: ${esc(e.message)}</span>`;
    }

    if(btn)btn.textContent='🔍 Find Matches';
    this._running=false;
  },

  _show(id){const el=document.getElementById(id);if(el)el.style.display='block';},
  _hide(ids){ids.forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});}
};

/* ═══════════════════════════════════════════════════════════
   DECK HEALTH SCORE
   Scores decks 0-100 across 8 categories with suggestions
   ═══════════════════════════════════════════════════════════ */
const DeckHealth={

  /* ── Archetype detection ─────────────────────────────────────
     Analyses commander oracle + deck composition to label strategy.
     Returns one of: aggro | control | combo | voltron | tribal |
                     artifacts | enchantress | lands | goodstuff
     ─────────────────────────────────────────────────────────── */
  _detectArchetype(deck){
    const cmdr=Store.card(deck.commander)||{};
    const oracle=(cmdr.oracle_text||'').toLowerCase();
    const type=(cmdr.type_line||'').toLowerCase();
    const allOracle=deck.cards.map(c=>(Store.card(c.name)||{}).oracle_text||'').join(' ').toLowerCase();
    const allTypes=deck.cards.map(c=>(Store.card(c.name)||{}).type_line||'').join(' ').toLowerCase();

    const counts={
      creatures:deck.cards.filter(c=>allTypes.includes('creature')).length,
      artifacts:deck.cards.filter(c=>(Store.card(c.name)||{}).type_line?.toLowerCase().includes('artifact')).length,
      enchants:deck.cards.filter(c=>(Store.card(c.name)||{}).type_line?.toLowerCase().includes('enchantment')).length,
      instants:deck.cards.filter(c=>(Store.card(c.name)||{}).type_line?.toLowerCase().includes('instant')).length,
      sorceries:deck.cards.filter(c=>(Store.card(c.name)||{}).type_line?.toLowerCase().includes('sorcery')).length
    };

    /* Voltron: commander has keywords for combat power, or deck has lots of equipment/auras */
    const equipCount=deck.cards.filter(c=>(Store.card(c.name)||{}).type_line?.toLowerCase().includes('equipment')).length;
    const auraCount=deck.cards.filter(c=>(Store.card(c.name)||{}).type_line?.toLowerCase().includes('aura')).length;
    if(equipCount>=8||auraCount>=8) return'voltron';
    if(oracle.includes('equipment')||oracle.includes('equipped')||oracle.includes('aura')) return'voltron';

    /* Tribal: commander cares about a creature type */
    if(/whenever (a|another) \w+ (you control|enters)/.test(oracle)) return'tribal';
    if(/\w+ (creatures|spells) (you control|you cast) (get|cost|have)/.test(oracle)) return'tribal';

    /* Artifacts: commander cares about artifacts */
    if(counts.artifacts>=20||(oracle.includes('artifact')&&type.includes('artifact'))) return'artifacts';

    /* Enchantress: commander cares about enchantments */
    if(counts.enchants>=15||oracle.includes('enchantment')&&oracle.includes('draw')) return'enchantress';

    /* Lands: commander cares about lands */
    if(oracle.includes('land')&&(oracle.includes('landfall')||oracle.includes('put a land'))) return'lands';

    /* Combo: tutors or specific win-cons in deck */
    const tutorCount=deck.cards.filter(c=>{const o=(Store.card(c.name)||{}).oracle_text||'';return /search your library/i.test(o);}).length;
    if(tutorCount>=5) return'combo';

    /* Control: high counterspell + draw */
    const counterCount=deck.cards.filter(c=>{const o=(Store.card(c.name)||{}).oracle_text||'';return /counter target spell/i.test(o);}).length;
    if(counterCount>=6) return'control';

    /* Aggro: low avg CMC, many creatures */
    const nonLand=deck.cards.filter(c=>!(Store.card(c.name)||{}).type_line?.toLowerCase().includes('land'));
    const avgCmc=nonLand.length?nonLand.reduce((s,c)=>s+(Store.card(c.name)||{}).cmc*c.qty,0)/nonLand.reduce((s,c)=>s+c.qty,0):0;
    if(avgCmc<2.5&&counts.creatures>=25) return'aggro';

    return'goodstuff';
  },

  /* Archetype labels for display */
  ARCHETYPE_LABELS:{
    aggro:'⚔ Aggro',control:'🛡 Control',combo:'♾ Combo',voltron:'⚡ Voltron',
    tribal:'🐉 Tribal',artifacts:'⚙ Artifacts',enchantress:'✨ Enchantress',
    lands:'🌍 Lands',goodstuff:'🌟 Goodstuff'
  },

  /* Archetype-specific targets — {ramp, draw, removal, interaction, lands_base, lands_range} */
  TARGETS:{
    aggro:    {ramp:7, draw:8,  removal:8,  interaction:2,  lands_base:33, desc:"Low curve, lots of threats"},
    control:  {ramp:8, draw:14, removal:10, interaction:10, lands_base:37, desc:"Draw, counter, control"},
    combo:    {ramp:10,draw:10, removal:6,  interaction:6,  lands_base:35, desc:"Tutor, assemble, win"},
    voltron:  {ramp:9, draw:8,  removal:5,  interaction:3,  lands_base:36, desc:"Suit up commander, attack"},
    tribal:   {ramp:9, draw:9,  removal:8,  interaction:4,  lands_base:36, desc:"Synergy through creature type"},
    artifacts:{ramp:10,draw:9,  removal:8,  interaction:5,  lands_base:34, desc:"Artifact synergies"},
    enchantress:{ramp:8,draw:10,removal:7,  interaction:4,  lands_base:36, desc:"Enchantment synergies"},
    lands:    {ramp:12,draw:8,  removal:7,  interaction:3,  lands_base:40, desc:"Play extra lands, landfall"},
    goodstuff:{ramp:10,draw:10, removal:10, interaction:5,  lands_base:36, desc:"Efficient cards in all categories"}
  },

  /* Card keywords for classification */
  RAMP_KEYS:['add {','produces mana','search your library for a','basic land','land card','land put',
             'sol ring','arcane signet',"commander's sphere",'cultivate',"kodama's reach",
             'rampant growth','farseek','three visits',"nature's lore",'skyshroud claim',
             'explosive vegetation','mana crypt','mana vault','dark ritual','cabal ritual',
             'worn powerstone','gilded lotus','thran dynamo','basalt monolith'],

  DRAW_KEYS:['draw a card','draw two','draw three','draw cards','draws a card','draw {',
             'wheel of fortune','rhystic study','mystic remora','phyrexian arena','necropotence',
             'sylvan library',"sensei's divining top",'skullclamp','mentor of the meek',
             'consecrated sphinx','fact or fiction','night\'s whisper','read the bones',
             'sign in blood','ancient craving','ambition\'s cost','painful truths',
             'urban evolution','growth spiral','brainstorm','ponder','preordain'],

  REMOVAL_KEYS:['destroy target','exile target','return target','counter target',
                'deal damage to any target','swords to plowshares','path to exile',
                'beast within','generous gift','chaos warp','cyclonic rift',
                'toxic deluge','damnation','wrath of god','blasphemous act',
                'vandalblast','austere command','farewell','damn','balefire dragon',
                'decree of pain','dark impostor'],

  COUNTER_KEYS:['counter target spell','counter that spell','counter target activated',
                'counter target triggered','negate','counterspell','force of will',
                'mana drain','pact of negation','swan song','flusterstorm',
                'an offer you can\'t refuse','fierce guardianship'],

  PROTECTION_KEYS:['hexproof','shroud','indestructible','ward','protection from',
                   "champion's helm","swiftfoot boots","lightning greaves",
                   "darksteel plate",'regenerate','totem armor'],

  WIN_CON_KEYS:['win the game','deal combat damage to a player','infect',
                'poison counter','you win the game','each opponent loses',
                "alt win",'thassa\'s oracle','laboratory maniac',
                'jace, wielder of mysteries'],

  /* Basic land names for fallback when card data not yet cached */
  BASIC_LAND_NAMES:new Set(['plains','island','swamp','mountain','forest',
    'snow-covered plains','snow-covered island','snow-covered swamp',
    'snow-covered mountain','snow-covered forest','wastes']),

  _classify(deck){
    const res={ramp:[],draw:[],removal:[],interaction:[],lands:[],
               protection:[],win_cons:[],basics:0,nonbasics:0};
    for(const c of deck.cards){
      const cd=Store.card(c.name)||{};
      const oracle=(cd.oracle_text||'').toLowerCase();
      const type=(cd.type_line||'').toLowerCase();
      const name=c.name.toLowerCase();
      const isLand=type.includes('land')||
        (!type&&(this.BASIC_LAND_NAMES.has(name)||
          /(plains|island|swamp|mountain|forest)/.test(name)||
          oracle.includes('{t}: add ')));
      if(isLand){
        res.lands.push(c.name);
        const isBasic=type.includes('basic')||this.BASIC_LAND_NAMES.has(name);
        if(isBasic)res.basics+=c.qty;
        else res.nonbasics+=c.qty;
        continue;
      }
      if(this.RAMP_KEYS.some(k=>oracle.includes(k)||name.includes(k)))   res.ramp.push(c.name);
      if(this.DRAW_KEYS.some(k=>oracle.includes(k)||name.includes(k)))   res.draw.push(c.name);
      if(this.REMOVAL_KEYS.some(k=>oracle.includes(k)||name.includes(k)))res.removal.push(c.name);
      if(this.COUNTER_KEYS.some(k=>oracle.includes(k)))                  res.interaction.push(c.name);
      if(this.PROTECTION_KEYS.some(k=>oracle.includes(k)||name.includes(k)))res.protection.push(c.name);
      if(this.WIN_CON_KEYS.some(k=>oracle.includes(k)||name.includes(k)))res.win_cons.push(c.name);
    }
    return res;
  },

  async _analyse(deck){
    /* Warm card data before classify — ensures type_line available for land detection */
    const names=[deck.commander,deck.partner,...deck.cards.map(c=>c.name)].filter(Boolean);
    await Store.warmCards(names);
    const archetype=this._detectArchetype(deck);
    const targets=this.TARGETS[archetype];
    const cls=this._classify(deck);
    const allCards=deck.cards;
    const totalNonLand=allCards.filter(c=>!(Store.card(c.name)||{}).type_line?.toLowerCase().includes('land'));
    const avgCmc=totalNonLand.length?
      totalNonLand.reduce((s,c)=>s+((Store.card(c.name)||{}).cmc||0)*c.qty,0)/
      totalNonLand.reduce((s,c)=>s+c.qty,0):0;

    const totalCards=allCards.reduce((s,c)=>s+c.qty,0);
    /* Count total land copies (cls.lands stores one entry per unique name,
       so we need to sum actual qty from deck.cards)                    */
    const landCount=deck.cards.reduce((s,c)=>{
      const cd=Store.card(c.name)||{};
      const type=(cd.type_line||'').toLowerCase();
      const name=c.name.toLowerCase();
      const isLand=type.includes('land')||
        (!type&&(DeckHealth.BASIC_LAND_NAMES.has(name)||
          /(plains|island|swamp|mountain|forest)/.test(name)||
          (cd.oracle_text||'').toLowerCase().includes('{t}: add ')));
      return s+(isLand?c.qty:0);
    },0);
    const cmdrs=[deck.commander,deck.partner].filter(Boolean);
    const cmdrCount=cmdrs.length;

    /* Ideal lands: archetype base + CMC adjustment */
    const cmcAdj=Math.round((avgCmc-3)*2);
    const idealLands=Math.max(30,Math.min(42,targets.lands_base+cmcAdj));

    /* Mana-fixing: how many non-basics are dual/fetch/utility lands */
    const colorCount=(Store.card(deck.commander)||{}).color_identity?.length||1;
    const fixingTarget=Math.max(0,(colorCount-1)*5);

    /* Check: commander has protection in deck? */
    const cmdrProtected=cls.protection.length>=2;

    /* Check: deck has a win condition? */
    const hasWinCon=cls.win_cons.length>=1||
      deck.cards.some(c=>c.name===deck.commander&&
        (Store.card(c.name)||{}).oracle_text?.toLowerCase().includes('damage'));

    const checks=[
      {
        id:'ramp',label:'Ramp & Mana',ico:'⚡',weight:15,
        count:cls.ramp.length,target:targets.ramp,
        desc:`${cls.ramp.length} ramp pieces (target for ${archetype}: ${targets.ramp}+)`,
        fix:cls.ramp.length<targets.ramp?`Add ${targets.ramp-cls.ramp.length} more ramp. Prioritise: Sol Ring, Arcane Signet, Cultivate, Kodama's Reach.`:null,
        examples:['Sol Ring','Arcane Signet','Cultivate',"Kodama's Reach",'Rampant Growth']
      },
      {
        id:'draw',label:'Card Draw & Advantage',ico:'🃏',weight:15,
        count:cls.draw.length,target:targets.draw,
        desc:`${cls.draw.length} draw effects (target for ${archetype}: ${targets.draw}+)`,
        fix:cls.draw.length<targets.draw?`Add ${targets.draw-cls.draw.length} more draw. Try: Rhystic Study, Sylvan Library, Phyrexian Arena, Skullclamp.`:null,
        examples:['Rhystic Study','Sylvan Library','Skullclamp','Phyrexian Arena']
      },
      {
        id:'removal',label:'Targeted Removal',ico:'⚔',weight:12,
        count:cls.removal.length,target:targets.removal,
        desc:`${cls.removal.length} removal spells (target for ${archetype}: ${targets.removal}+)`,
        fix:cls.removal.length<targets.removal?`Add ${targets.removal-cls.removal.length} more removal. Prioritise: Swords to Plowshares, Beast Within, Generous Gift.`:null,
        examples:['Swords to Plowshares','Beast Within','Generous Gift','Chaos Warp']
      },
      {
        id:'interaction',label:`Counterspells & Protection`,ico:'🛡',weight:10,
        count:cls.interaction.length,target:targets.interaction,
        desc:`${cls.interaction.length} interaction spells (target for ${archetype}: ${targets.interaction}+)`,
        fix:cls.interaction.length<targets.interaction&&targets.interaction>2?
          `Add ${targets.interaction-cls.interaction.length} more counterspells or responses.`:null,
        examples:['Counterspell','Negate','Swan Song','Force of Will']
      },
      {
        id:'lands',label:'Land Count',ico:'🌍',weight:18,
        count:landCount,target:idealLands,
        desc:`${landCount} lands (target: ~${idealLands} for ${archetype} with avg CMC ${avgCmc.toFixed(1)})`,
        fix:landCount<idealLands-1?`Add ${idealLands-landCount} more lands. Your avg CMC is ${avgCmc.toFixed(1)}.`:
            landCount>idealLands+2?`Consider cutting ${landCount-idealLands} lands — add more ramp instead.`:null,
        examples:['Command Tower','Exotic Orchard','Arcane Sanctum']
      },
      {
        id:'fixing',label:'Mana Fixing',ico:'🎨',weight:8,
        count:cls.nonbasics,target:fixingTarget,
        desc:`${colorCount}-color deck: ${cls.nonbasics} non-basics (target: ${fixingTarget}+ dual/fetch/utility lands)`,
        fix:colorCount>=3&&cls.nonbasics<fixingTarget?`Add ${fixingTarget-cls.nonbasics} more dual or fetch lands for ${colorCount}-color consistency.`:null,
        examples:['Command Tower','Exotic Orchard','Evolving Wilds','Terramorphic Expanse']
      },
      {
        id:'protection',label:'Commander Protection',ico:'🔰',weight:8,
        pass:cmdrProtected,
        desc:cmdrProtected?`✓ ${cls.protection.length} protection effects for your commander`:`Only ${cls.protection.length} protection effects — commander is vulnerable`,
        fix:!cmdrProtected?`Add Lightning Greaves, Swiftfoot Boots, or hexproof/indestructible equipment to protect your commander.`:null,
        examples:["Lightning Greaves","Swiftfoot Boots","Darksteel Plate","Champion's Helm"]
      },
      {
        id:'wincon',label:'Win Condition',ico:'🏆',weight:8,
        pass:hasWinCon,
        desc:hasWinCon?`✓ Win condition detected`:`No clear win condition found`,
        fix:!hasWinCon?`Identify how you plan to win. Add a finisher, combo, or damage outlet.`:null,
        examples:[]
      },
      {
        id:'cardcount',label:'Deck Size',ico:'📦',weight:8,
        count:totalCards,target:100,
        desc:`${totalCards} cards total (must be exactly 100 including commander${deck.partner?'s':''})`,
        fix:totalCards!==100?`Your deck has ${totalCards} cards. Adjust by ${totalCards>100?'removing':'adding'} ${Math.abs(totalCards-100)} card${Math.abs(totalCards-100)!==1?'s':''}.`:null,
        examples:[]
      },
      {
        id:'curve',label:'Mana Curve Balance',ico:'📊',weight:8,
        _avgCmc:avgCmc,
        desc:`Avg CMC: ${avgCmc.toFixed(2)} — ${archetype==='aggro'?'target: 2.0-2.8':archetype==='control'?'target: 2.5-3.5':'target: 2.5-3.5'}`,
        fix:avgCmc>3.8?`High curve (${avgCmc.toFixed(1)}) for ${archetype}. Cut expensive cards or add ramp.`:
            archetype==='aggro'&&avgCmc>2.8?`Aggro decks want avg CMC under 2.8 (currently ${avgCmc.toFixed(1)}).`:null,
        examples:[]
      },
      {
        id:'singleton',label:'Singleton Rule',ico:'✦',weight:8,
        _check:()=>{
          const violations=allCards.filter(c=>{
            const cd=Store.card(c.name)||{};
            const isBasic=(cd.type_line||'').toLowerCase().includes('basic');
            return c.qty>1&&!isBasic;
          });
          return violations.length===0?
            {ok:true,desc:'✓ All non-basic cards are singleton'}:
            {ok:false,desc:`${violations.length} card${violations.length>1?'s':''} with qty>1: ${violations.slice(0,3).map(c=>c.name).join(', ')}${violations.length>3?'…':''}`,
             fix:`Remove duplicates: ${violations.map(c=>c.name).join(', ')}`};
        }
      }
    ];

    /* ── Score calculation ── */
    let totalScore=0,totalWeight=0;
    const processedChecks=checks.map(chk=>{
      let pct=0,statusClass='fail',pass=false,desc=chk.desc,fix=chk.fix;

      if(chk.id==='singleton'){
        const res=chk._check();
        pass=res.ok;pct=pass?100:0;statusClass=pass?'pass':'fail';
        desc=res.desc;fix=res.fix||null;
      } else if(chk.id==='protection'||chk.id==='wincon'){
        pass=chk.pass||false;pct=pass?100:0;statusClass=pass?'pass':'warn';
      } else if(chk.id==='curve'){
        const cv=chk._avgCmc;
        const tgt=archetype==='aggro'?{lo:1.8,hi:2.8}:{lo:2.3,hi:3.6};
        if(cv>=tgt.lo&&cv<=tgt.hi){pct=100;statusClass='pass';pass=true;}
        else if(cv>=tgt.lo-0.4&&cv<=tgt.hi+0.5){pct=65;statusClass='warn';}
        else{pct=30;statusClass='fail';}
      } else if(chk.id==='cardcount'){
        pass=chk.count===100;pct=pass?100:Math.max(0,100-Math.abs(chk.count-100)*5);
        statusClass=pass?'pass':Math.abs(chk.count-100)<=2?'warn':'fail';
      } else if(chk.id==='fixing'){
        if(colorCount<=1){pass=true;pct=100;statusClass='pass';desc='Mono-color: no fixing needed';}
        else{
          pct=chk.target>0?Math.min(100,(chk.count/chk.target)*100):100;
          pass=chk.count>=chk.target;
          statusClass=pass?'pass':pct>=60?'warn':'fail';
        }
      } else {
        const ratio=chk.count/chk.target;
        pct=Math.min(100,ratio*100);
        pass=chk.count>=chk.target;
        statusClass=pass?'pass':pct>=65?'warn':'fail';
      }

      totalWeight+=chk.weight;
      totalScore+=Math.round((pct/100)*chk.weight);
      return{...chk,pct,statusClass,pass,desc,fix};
    });

    const score=Math.round((totalScore/totalWeight)*100);

    /* ── Grade ── */
    let grade,gradeColor;
    if(score>=90){grade='S — Optimal';gradeColor='var(--green2)';}
    else if(score>=80){grade='A — Excellent';gradeColor='var(--green2)';}
    else if(score>=70){grade='B — Good';gradeColor='var(--ice)';}
    else if(score>=60){grade='C — Decent';gradeColor='var(--gold)';}
    else if(score>=45){grade='D — Needs Work';gradeColor='var(--gold3)';}
    else{grade='F — Critical Issues';gradeColor='var(--crimson2)';}

    /* ── Render score ring ── */
    const numEl=document.getElementById('health-score-num');
    const gradeEl=document.getElementById('health-score-grade');
    if(numEl){numEl.textContent=score;numEl.style.fill=gradeColor;}
    if(gradeEl){gradeEl.textContent=grade.split(' ')[0];gradeEl.setAttribute('fill',gradeColor);}
    const arc=document.getElementById('health-ring-arc');
    if(arc){
      const circ=2*Math.PI*66;
      setTimeout(()=>{
        arc.style.strokeDashoffset=circ*(1-score/100);
        arc.style.stroke=score>=80?'#5aaa6a':score>=60?'#c8a84b':score>=40?'#e8703a':'#c22b3e';
      },80);
    }

    /* ── Archetype badge ── */
    const archetypeBadge=document.getElementById('health-archetype-badge');
    if(archetypeBadge){
      archetypeBadge.textContent=this.ARCHETYPE_LABELS[archetype]||archetype;
      archetypeBadge.style.display='inline-block';
    }

    /* ── Render checklist ── */
    const checksEl=document.getElementById('health-checks');
    if(checksEl){
      checksEl.innerHTML='';
      for(const chk of processedChecks){
        const barColor=chk.statusClass==='pass'?'var(--green2)':chk.statusClass==='warn'?'var(--gold)':'var(--crimson2)';
        const row=document.createElement('div');row.className='health-check';
        row.innerHTML=`
          <div class="health-check-ico">${chk.ico}</div>
          <div class="health-check-info">
            <div class="health-check-label">${chk.label}</div>
            <div class="health-check-detail">${chk.desc}</div>
            <div class="health-bar-wrap" style="margin-top:4px">
              <div class="health-bar" style="width:${chk.pct}%;background:${barColor};transition:width .6s"></div>
            </div>
          </div>
          <div class="health-check-score ${chk.statusClass}">${chk.statusClass==='pass'?'✓':chk.pct+'%'}</div>`;
        checksEl.appendChild(row);
      }
    }

    /* ── Suggestions ── */
    const fixes=processedChecks.filter(c=>c.fix&&!c.pass);
    const sugEl=document.getElementById('health-suggestions');
    if(sugEl){
      if(!fixes.length){sugEl.style.display='none';return;}
      sugEl.style.display='block';
      const sugList=document.getElementById('health-sug-list');
      if(sugList){
        sugList.innerHTML='';
        fixes.sort((a,b)=>(b.weight||0)-(a.weight||0)).forEach(chk=>{
          const item=document.createElement('div');item.className='health-sug-item';
          item.innerHTML=`
            <div class="health-sug-ico">${chk.ico}</div>
            <div class="health-sug-text">${chk.fix}${chk.examples?.length?
              '<br><span style="color:var(--text3);font-size:10px">e.g. '+chk.examples.slice(0,3).join(', ')+'</span>':''}
            </div>`;
          sugList.appendChild(item);
        });
      }
    }
  },

  render(){
    const sel=document.getElementById('health-deck-select');
    if(!sel)return;
    const prev=sel.value;
    sel.innerHTML='<option value="">— Select a deck to analyse —</option>';
    Store.decks.forEach(d=>{
      const opt=document.createElement('option');
      opt.value=d.id;
      opt.textContent=d.name+(d.commander?' · '+d.commander:'');
      sel.appendChild(opt);
    });
    const best=prev||App.curId||'';
    if(best){sel.value=best;if(sel.value)this.select(sel.value);}
    else{document.getElementById('health-content').style.display='none';document.getElementById('health-empty').style.display='block';}
  },

  select(id){
    const deck=Store.getDeck(id);
    const content=document.getElementById('health-content');
    const empty=document.getElementById('health-empty');
    if(!deck){if(content)content.style.display='none';if(empty)empty.style.display='block';return;}
    if(content)content.style.display='block';
    if(empty)empty.style.display='none';
    this._analyse(deck).catch(()=>{});
  }
};



/* ═══════════════════════════════════════════════════════════
   URL IMPORT — Moxfield / Archidekt / TappedOut
   ═══════════════════════════════════════════════════════════ */
