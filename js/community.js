/* CommanderForge — community: BulkPool, TradeMgr, WishlistMgr, CommunityNav,
   TradeMatch */

function communityDisplayName(username,email){
  return username||email?.split('@')[0]||'User';
}

function communityMetaLabel(){
  return 'Community member';
}

const BulkPool={
  _data:[],_filtered:[],_tab:'single',_pasteLines:[],_page:1,_pageSize:60,

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
      App?.refreshTopbarStats?.(true);
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
    this._page=1;
    this._renderList();
  },

  prevPage(){
    if(this._page<=1)return;
    this._page--;
    this._renderList();
  },

  nextPage(){
    const maxPage=Math.max(1,Math.ceil(this._filtered.length/this._pageSize));
    if(this._page>=maxPage)return;
    this._page++;
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
    const pageCount=Math.max(1,Math.ceil(this._filtered.length/this._pageSize));
    if(this._page>pageCount)this._page=pageCount;
    const pager=document.getElementById('bulk-pagination');
    const pageLabel=document.getElementById('bulk-page-label');
    const prevBtn=document.getElementById('bulk-prev-btn');
    const nextBtn=document.getElementById('bulk-next-btn');
    if(pager)pager.style.display=pageCount>1?'flex':'none';
    if(pageLabel)pageLabel.textContent=`Page ${this._page} / ${pageCount}`;
    if(prevBtn)prevBtn.disabled=this._page<=1;
    if(nextBtn)nextBtn.disabled=this._page>=pageCount;

    const condColor={NM:'var(--green2)',LP:'var(--ice)',MP:'var(--gold)',HP:'var(--crimson2)'};
    const isMine=DB._user?document.getElementById('bulk-filter-owner')?.value==='mine':false;
    const pageRows=this._filtered.slice((this._page-1)*this._pageSize,this._page*this._pageSize);

    // Fetch card data for any cards not yet in cache, then re-render once done
    const missing=pageRows.filter(r=>!Store.card(r.card_name));
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

    for(const r of pageRows){
      const cd=this._cardData(r);
      const img=cd.img?.normal||cd.img?.crop||'';
      const price=r.price_usd?'€'+parseFloat(r.price_usd).toFixed(2):'—';
      const rarity=cd.rarity||'common';
      const rarityClass={common:'cs-rarity-c',uncommon:'cs-rarity-u',rare:'cs-rarity-r',mythic:'cs-rarity-m'}[rarity]||'';
      const owner='community';
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
            <span class="${rarityClass}" style="font-size:9px">${setInfo||'Shared Pool'}</span>
            <span class="cs-card-price">${esc(price)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:3px;font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--text3)">
            <span>${isOwn?'My copy':'Community copy'}</span>
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

  _cardData(row){
    return CommunityNav?._cardData?.(row)||Store.card(row?.card_name)||{};
  },

  async _buildInsertPayload(cardName,extra={}){
    if(!Store.card(cardName)) await new Promise(res=>SF.fetch(cardName,()=>res()));
    return {
      ...DB._listingSnapshot(cardName,extra),
      user_id:DB._user.id,
      user_email:DB._user.email||'',
      qty:extra?.qty??1,
      condition:extra?.condition||'NM',
      note:extra?.note||''
    };
  },

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
    const payload=await this._buildInsertPayload(name,{qty,condition:cond});
    await DB._sb.from('trade_list').insert(payload);
    Notify.show(name+' added to trade list','ok');
    if(nameEl)nameEl.value='';
    TradeAC?.hide?.('trade-add-name');
    this.render();
  },

  async addByName(cardName){
    /* Silent add — used from friend profile, no full page re-render */
    if(!DB._sb||!DB._user){Notify.show('Sign in first','err');return;}
    if(this._data.some(w=>w.card_name.toLowerCase()===cardName.toLowerCase())){
      Notify.show('"'+cardName+'" already on your trade list','inf');return;
    }
    const payload=await this._buildInsertPayload(cardName);
    const{error}=await DB._sb.from('trade_list').insert(payload);
    if(!error){
      this._data.unshift(payload);
      Notify.show('🤝 "'+cardName+'" → Trade list','ok');
    }else{Notify.show('Could not add to trade list','err');}
  },

  async toggleCard(cardName){
    if(!DB._sb||!DB._user){Notify.show('Sign in first','err');return;}
    const existing=this._data.find(t=>t.card_name===cardName);
    if(existing){
      await DB._sb.from('trade_list').delete().eq('id',existing.id);
      Notify.show(cardName+' removed from trade list','inf');
    } else {
      const payload=await this._buildInsertPayload(cardName);
      await DB._sb.from('trade_list').insert(payload);
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
      const cd=this._cardData(r);
      const row=document.createElement('div');row.className='trade-card';
      row.innerHTML=`
        ${(cd.img?.crop||cd.img?.normal)?`<img class="bulk-pool-thumb" src="${esc(cd.img.crop||cd.img.normal)}" loading="lazy">`:'<div class="bulk-pool-thumb card-skeleton"></div>'}
        <div style="flex:1;min-width:0">
          <div class="bulk-pool-name">${esc(r.card_name)}</div>
          <div class="bulk-pool-meta">${r.qty||1}× · ${r.condition||'NM'} · ${cd.prices?.eur?'€'+parseFloat(cd.prices.eur).toFixed(2):'no price data'}</div>
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

  _cardData(row){
    return CommunityNav?._cardData?.(row)||Store.card(row?.card_name)||{};
  },

  async _buildInsertPayload(cardName,note=''){
    if(!Store.card(cardName)) await new Promise(res=>SF.fetch(cardName,()=>res()));
    return {
      ...DB._listingSnapshot(cardName),
      card_name:cardName,
      note,
      user_id:DB._user.id,
      user_email:DB._user.email||''
    };
  },

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
          ? '<b>wishlist table missing.</b> Run <b>supabase_schema.sql</b> in your Supabase SQL Editor to create the required tables.'
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
    const payload=await this._buildInsertPayload(name,note);
    await DB._sb.from('wishlist').insert(payload);
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
    const payload=await this._buildInsertPayload(cardName,'');
    const{error}=await DB._sb.from('wishlist').insert(payload);
    if(!error){
      this._data.unshift(payload);
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
      const payload=await this._buildInsertPayload(cardName,'');
      await DB._sb.from('wishlist').insert(payload);
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
      const cd=this._cardData(r);
      const price=parseFloat(cd.prices?.eur||0);
      const row=document.createElement('div');row.className='trade-card';
      row.style.cursor='pointer';
      row.title='Click to view card details';
      row.innerHTML=`
        ${cd.img?.normal||cd.img?.crop?
          `<img class="bulk-pool-thumb" src="${esc(cd.img.normal||cd.img.crop)}" loading="lazy" style="width:48px;height:67px;object-fit:cover;border-radius:4px;flex-shrink:0">`
          :'<div class="bulk-pool-thumb card-skeleton" style="width:48px;height:67px;flex-shrink:0"></div>'}
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
      if(!cd.img?.crop&&!cd.img?.normal)SF.fetch(r.card_name,()=>{this._renderList();});
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

  _collectCardNames({decks=[],trades=[],wishes=[]}={}){
    return [...new Set([
      ...decks.flatMap(d=>[d.commander,d.partner,...(d.cards||[]).map(c=>c.name)]),
      ...trades.map(t=>t.card_name),
      ...wishes.map(w=>w.card_name)
    ].filter(Boolean))];
  },

  _collectProfilePreviewNames({decks=[],trades=[],wishes=[]}={}){
    return [...new Set(decks.flatMap(d=>[d.commander,d.partner]).filter(Boolean))];
  },

  _profileWarmJobs:new Map(),

  _cardData(cardLike){
    if(!cardLike)return {};
    const name=typeof cardLike==='string'?cardLike:(cardLike.name||cardLike.card_name);
    const cached=name?Store.card(name):null;
    const inline=typeof cardLike==='string'?null:cardLike;
    return {
      ...(inline||{}),
      ...(cached||{}),
      name:name||inline?.name||inline?.card_name||'',
      card_name:inline?.card_name||name||'',
      img:{
        crop:cached?.img?.crop||inline?.img?.crop||'',
        normal:cached?.img?.normal||inline?.img?.normal||''
      },
      prices:{
        eur:cached?.prices?.eur??inline?.prices?.eur??null,
        eur_foil:cached?.prices?.eur_foil??inline?.prices?.eur_foil??null
      },
      type_line:cached?.type_line||inline?.type_line||'',
      cmc:cached?.cmc??inline?.cmc??0,
      set:cached?.set||inline?.set||'',
      set_name:cached?.set_name||inline?.set_name||'',
      collector_number:cached?.collector_number||inline?.collector_number||'',
      scryfall_id:cached?.scryfall_id||inline?.scryfall_id||'',
      rarity:cached?.rarity||inline?.rarity||'',
      color_identity:cached?.color_identity||inline?.color_identity||[]
    };
  },

  _fmtMoney(value,decimals=0){
    const num=parseFloat(value||0);
    if(!Number.isFinite(num)||num<=0)return '€0';
    return `€${num.toFixed(decimals)}`;
  },

  _deckCardData(deck,name){
    const fromDeck=(deck?.cards||[]).find(c=>c.name===name)||null;
    return this._cardData(fromDeck||name);
  },

  async _primeCardData(names,onComplete){
    if(!names?.length)return false;
    await Store.warmCards(names);
    const missing=names.filter(n=>!Store.card(n));
    if(!missing.length)return false;
    SF.fetchBatch(missing,(done,total)=>{
      if(done>=total&&typeof onComplete==='function')onComplete();
    });
    return true;
  },

  _deckFetchItems(deck){
    const cmdrs=[deck.commander,deck.partner].filter(Boolean);
    const seenNames=new Set();
    const items=[];
    for(const name of cmdrs){
      if(!seenNames.has(name)){
        seenNames.add(name);
        const available=this._deckCardData(deck,name);
        const missingImage=!available?.img?.crop&&!available?.img?.normal;
        const missingType=!available?.type_line;
        if(!available?.name||missingImage||missingType)items.push({name});
      }
    }
    for(const c of(deck.cards||[])){
      if(!c?.name||seenNames.has(c.name))continue;
      seenNames.add(c.name);
      const available=this._cardData(c);
      const missingImage=!available?.img?.crop&&!available?.img?.normal;
      const missingType=!available?.type_line;
      const needsExactPrint=c.set&&available?.set&&available.set!==c.set;
      if(!available?.name||missingImage||missingType||needsExactPrint){
        const item={name:c.name};
        if(c.set)item.set=c.set;
        if(c.collector_number)item.collector_number=c.collector_number;
        items.push(item);
      }
    }
    return items;
  },

  async _ensureDeckCardData(deck,onProgress){
    const items=this._deckFetchItems(deck);
    if(!items.length)return false;
    await Store.warmCards(items.map(it=>it.name));
    const missing=this._deckFetchItems(deck);
    if(!missing.length)return false;
    return SF.fetchBatch(missing,onProgress);
  },

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
        const displayName=communityDisplayName(u.username,u.email);
        const hue=(u.id.charCodeAt(0)*17)%360;
        const card=document.createElement('div');card.className='friend-card';card.id='user-card-'+u.id;
        card.innerHTML=`
          <div class="friend-avatar" style="background:hsl(${hue},35%,22%);border-color:hsl(${hue},50%,42%)">${esc(displayName.slice(0,1).toUpperCase())}</div>
          <div style="flex:1;min-width:0">
            <div class="friend-name">${esc(displayName)}</div>
            <div class="friend-meta">${communityMetaLabel()}</div>
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
        <span style="color:var(--text3);font-size:10px">Make sure you ran supabase_schema.sql and that the profiles table exists.</span>
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
        const displayName=communityDisplayName(f.friend_username,f.friend_email);
        const hue=(f.friend_id.charCodeAt(0)*17)%360;
        const card=document.createElement('div');card.className='friend-card';
        card.innerHTML=`
          <div class="friend-avatar" style="background:hsl(${hue},35%,22%);border-color:hsl(${hue},50%,42%)">${esc(displayName.slice(0,1).toUpperCase())}</div>
          <div style="flex:1;min-width:0">
            <div class="friend-name">${esc(displayName)}</div>
            <div class="friend-meta">${communityMetaLabel()}</div>
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
    if(Menu?.cur!=='community')Menu.go('community');
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
          <div class="fp-email">${communityMetaLabel()}</div>
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
      DB._sb.from('trade_list').select('*').eq('user_id',userId),
      DB._sb.from('wishlist').select('*').eq('user_id',userId),
      DB._user?DB._sb.from('friendships').select('id').eq('user_id',DB._user.id).eq('friend_id',userId):Promise.resolve({data:[]})
    ]);

    const decks=(deckRes.value?.data||[]).map(d=>({...d,cards:typeof d.cards==='string'?JSON.parse(d.cards||'[]'):d.cards||[]}));
    const trades=tradeRes.value?.data||[];
    const wishes=wishRes.value?.data||[];
    const isFriend=(friendRes.value?.data||[]).length>0;
    const previewNames=this._collectProfilePreviewNames({decks,trades,wishes});
    const allProfileNames=this._collectCardNames({decks,trades,wishes});
    await Store.warmCards(previewNames);

    // ── Header stats ──────────────────────────────────────────
    const totalCards=decks.reduce((s,d)=>s+d.cards.reduce((a,c)=>a+c.qty,0),0);
    const totalVal=decks.reduce((s,d)=>s+d.cards.reduce((a,c)=>a+(parseFloat(this._cardData(c)?.prices?.eur||0)*c.qty),0),0);
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

      for(const d of decks){
      const cards=d.cards;
      const cmdrData=d.commander?this._deckCardData(d,d.commander):null;
      const totalDeckCards=cards.reduce((s,c)=>s+(c.qty||0),0);
      const totalDeckVal=cards.reduce((s,c)=>s+(parseFloat(this._cardData(c)?.prices?.eur||0)*c.qty),0);

      // Bracket score (quick estimate)
      const bracketScore=BracketCalc?._quickScore?BracketCalc._quickScore(cards):null;
      const bracketLabel=bracketScore?`B${bracketScore}`:'';
      const bracketColor={1:'var(--green2)',2:'var(--ice)',3:'var(--gold)',4:'var(--crimson2)'}[bracketScore]||'var(--text3)';

      const card=document.createElement('div');
      card.className='fp-deck-card';
      card.dataset.deckId=d.id;

      card.innerHTML=`
        <div class="fp-deck-banner">
          ${(cmdrData?.img?.crop||cmdrData?.img?.normal)?`<img class="fp-deck-banner-art" src="${esc(cmdrData.img.crop||cmdrData.img.normal)}" loading="lazy">`:''}
          <div class="fp-deck-banner-overlay"></div>
          <div class="fp-deck-banner-cmdr">${esc(d.commander||'No Commander')}</div>
          ${bracketLabel?`<div class="fp-deck-banner-badge" style="color:${bracketColor};border-color:${bracketColor}">${bracketLabel}</div>`:''}
        </div>
        <div class="fp-deck-info">
          <div class="fp-deck-title">${esc(d.name)}</div>
          <div class="fp-deck-meta">
            <span>${totalDeckCards} cards</span>
            <span>€${totalDeckVal.toFixed(0)}</span>
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
      card.querySelector('[data-action="view-fp-deck"]').addEventListener('click',()=>CommunityNav.openDeckPopup(d));
      card.querySelector('[data-action="import-fp-deck"]').addEventListener('click',()=>CommunityNav._importDeck(d));
      card.querySelector('[data-action="comment-fp-deck"]').addEventListener('click',()=>{
        const v=document.getElementById('fp-viewer-'+d.id);
        if(v){v.classList.toggle('open');if(v.classList.contains('open'))CommunityNav._renderViewerComments(d.id,v);}
      });
      } // end for decks

      const warmKey=`profile:${userId}`;
      if(!this._profileWarmJobs.has(warmKey)){
        const job=this._primeCardData(allProfileNames,()=>{
          this._profileWarmJobs.delete(warmKey);
        }).finally(()=>this._profileWarmJobs.delete(warmKey));
        this._profileWarmJobs.set(warmKey,job);
      }
    } else {
      grid.innerHTML='<div class="fp-empty-state">No public decks yet.</div>';
    }

    // ── Trade list ────────────────────────────────────────────
    const myWishSet=new Set((WishlistMgr._data||[]).map(w=>w.card_name.toLowerCase()));
    const myCardSet=new Set(Store.decks.flatMap(d=>d.cards.map(cc=>cc.name.toLowerCase())));
    const tEl=document.getElementById('fp-trade-list');
    if(tEl){
      if(!trades.length){tEl.innerHTML='<div class="fp-empty-state compact">Nothing listed for trade.</div>';}
      else{
        tEl.innerHTML='';
        const tradeList=document.createElement('div');
        trades.slice(0,12).forEach(t=>{
          const cd=this._cardData(t);
          const alreadyWanted=myWishSet.has(t.card_name.toLowerCase());
          const iHave=myCardSet.has(t.card_name.toLowerCase());
          const row=document.createElement('div');
          row.className='fp-card-row';
          row.style.cssText='padding:5px 0;';
          row.innerHTML=`
            ${(cd.img?.crop||cd.img?.normal)?`<img class="fp-card-thumb" src="${esc(cd.img.crop||cd.img.normal)}" loading="lazy">`:'<div class="fp-card-thumb card-skeleton"></div>'}
            <span class="fp-card-name">${esc(t.card_name)}</span>
            <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text3)">${t.qty}× ${t.condition||'NM'}</span>
            ${iHave?'<span class="fp-have-badge">✓ Have</span>':''}
            ${cd.prices?.eur?`<span class="fp-card-price">&euro;${parseFloat(cd.prices.eur).toFixed(2)}</span>`:''}
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
      if(!wishes.length){wEl.innerHTML='<div class="fp-empty-state compact">Empty wishlist.</div>';}
      else{
        wEl.innerHTML='';
        const wishList=document.createElement('div');
        wishes.slice(0,12).forEach(w=>{
          const cd=this._cardData(w);
          const iHave=myCardSet.has(w.card_name.toLowerCase());
          const alsoWant=myWishSet.has(w.card_name.toLowerCase());
          const row=document.createElement('div');
          row.className='fp-card-row';row.style.cssText='padding:5px 0;';
          row.innerHTML=`
            ${(cd.img?.crop||cd.img?.normal)?`<img class="fp-card-thumb" src="${esc(cd.img.crop||cd.img.normal)}" loading="lazy">`:'<div class="fp-card-thumb card-skeleton"></div>'}
            <span class="fp-card-name">${esc(w.card_name)}</span>
            ${cd.prices?.eur?`<span class="fp-card-price">&euro;${parseFloat(cd.prices.eur).toFixed(2)}</span>`:''}
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

  openDeckPopup(deck){
    const cards=typeof deck.cards==='string'?JSON.parse(deck.cards||'[]'):deck.cards||[];
    const roDeck={...deck,cards};
    P._open(`[Deck] ${deck.name}`,true);
    const foot=document.getElementById('pfoot');
    foot.innerHTML='';
    const close=document.createElement('button');
    close.className='tbtn';
    close.textContent='Close';
    close.onclick=()=>P.close();
    const importBtn=document.createElement('button');
    importBtn.className='tbtn gold';
    importBtn.textContent='Import Copy';
    importBtn.onclick=()=>{P.close();this._importDeck(roDeck);};
    foot.append(close,importBtn);
    this._renderDeckPopupContent(roDeck);
    this._ensureDeckCardData(roDeck).then(fetched=>{
      const title=document.getElementById('ptitle');
      if(fetched&&title?.textContent===`[Deck] ${deck.name}`) this._renderDeckPopupContent(roDeck);
    });
    return;
    const _legacyCardNames=this._collectCardNames({decks:[roDeck]});
    P._open(`[Deck] ${deck.name}`,true);
    const totalVal=cards.reduce((s,c)=>s+(parseFloat(Store.card(c.name)?.prices?.eur||0)*(c.qty||0)),0);
    const totalCards=cards.reduce((s,c)=>s+(c.qty||0),0);
    const avgCmc=(()=>{
      let total=0,count=0;
      cards.forEach(c=>{
        const cd=Store.card(c.name)||{};
        if((cd.type_line||'').toLowerCase().includes('land'))return;
        total+=(cd.cmc||0)*(c.qty||1);
        count+=c.qty||1;
      });
      return count?(total/count).toFixed(1):'--';
    })();
    const cmdrs=[roDeck.commander,roDeck.partner].filter(Boolean);
    const groups=[
      ['Commander',cards.filter(c=>cmdrs.includes(c.name))],
      ['Creatures',cards.filter(c=>!cmdrs.includes(c.name)&&(Store.card(c.name)?.type_line||'').toLowerCase().includes('creature')&&!(Store.card(c.name)?.type_line||'').toLowerCase().includes('land'))],
      ['Spells',cards.filter(c=>!cmdrs.includes(c.name)&&!(Store.card(c.name)?.type_line||'').toLowerCase().includes('land')&&!(Store.card(c.name)?.type_line||'').toLowerCase().includes('creature'))],
      ['Lands',cards.filter(c=>!cmdrs.includes(c.name)&&(Store.card(c.name)?.type_line||'').toLowerCase().includes('land'))]
    ];
    document.getElementById('pbody').innerHTML=`
      <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:16px">
        <div class="kpi gold"><div class="kpi-val">${totalCards}</div><div class="kpi-lbl">Cards</div></div>
        <div class="kpi ice"><div class="kpi-val">&euro;${totalVal.toFixed(0)}</div><div class="kpi-lbl">Value</div></div>
        <div class="kpi green"><div class="kpi-val">${avgCmc}</div><div class="kpi-lbl">Avg CMC</div></div>
        <div class="kpi purple"><div class="kpi-val">${roDeck.commander?esc(roDeck.commander):'--'}</div><div class="kpi-lbl">Commander</div></div>
      </div>
      <div id="readonly-deck-groups"></div>
    `;
    const wrap=document.getElementById('readonly-deck-groups');
    groups.forEach(([title,arr],groupIdx)=>{
      if(!arr.length)return;
      const sec=document.createElement('div');
      sec.innerHTML=`<div class="fp-group-title">${title} (${arr.reduce((s,c)=>s+(c.qty||0),0)})</div><div class="fp-mini-grid" id="readonly-group-${groupIdx}"></div>`;
      wrap.appendChild(sec);
      const grid=sec.querySelector(`#readonly-group-${groupIdx}`);
      arr.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach(card=>{
        const cd=Store.card(card.name)||{};
        const price=parseFloat(cd.prices?.eur||0);
        const tile=document.createElement('div');
        tile.className='fp-mini-card';
        tile.innerHTML=`
          ${(cd.img?.crop||cd.img?.normal)?`<img class="fp-mini-thumb" src="${esc(cd.img.crop||cd.img.normal)}" loading="lazy" alt="${esc(card.name)}">`:'<div class="fp-mini-thumb"></div>'}
          ${card.qty>1?`<div class="fp-mini-badge">${card.qty}x</div>`:''}
          <div class="fp-mini-info">
            <div class="fp-mini-name">${esc(card.name)}</div>
            <div class="fp-mini-meta"><span>${price?'�'+price.toFixed(0):'--'}</span><span>${shortType(cd.type_line||'')}</span></div>
          </div>`;
        tile.addEventListener('click',()=>M.open({name:card.name,qty:card.qty||1},null));
        grid.appendChild(tile);
      });
    });
    const _legacyFoot=document.getElementById('pfoot');
    _legacyFoot.innerHTML='';
    const _legacyClose=document.createElement('button');
    _legacyClose.className='tbtn';
    _legacyClose.textContent='Close';
    _legacyClose.onclick=()=>P.close();
    const _legacyImportBtn=document.createElement('button');
    _legacyImportBtn.className='tbtn gold';
    _legacyImportBtn.textContent='Import Copy';
    _legacyImportBtn.onclick=()=>{P.close();this._importDeck(roDeck);};
    _legacyFoot.append(_legacyClose,_legacyImportBtn);

    this._primeCardData(_legacyCardNames,()=>{
      const title=document.getElementById('ptitle');
      if(title?.textContent===`[Deck] ${deck.name}`) this.openDeckPopup(roDeck);
    });
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
    this._ensureDeckCardData(deck).then(fetched=>{
      if(fetched&&viewerEl.classList.contains('open')) this._buildDeckViewer(deck,viewerEl);
    });
    return;
    const _legacyCardNames=this._collectCardNames({decks:[deck]});
    this._buildDeckViewer(deck,viewerEl);
    this._primeCardData(_legacyCardNames,()=>{
      if(viewerEl.classList.contains('open')) this._buildDeckViewer(deck,viewerEl);
    });
  },

  _buildDeckViewer(deck,el){
    const cards=deck.cards;
    // Sort into groups
    const cmdrs=[deck.commander,deck.partner].filter(Boolean);
    const lands=cards.filter(c=>!cmdrs.includes(c.name)&&(this._cardData(c)?.type_line||'').toLowerCase().includes('land'));
    const creatures=cards.filter(c=>!cmdrs.includes(c.name)&&(this._cardData(c)?.type_line||'').toLowerCase().includes('creature')&&!(this._cardData(c)?.type_line||'').toLowerCase().includes('land'));
    const spells=cards.filter(c=>!cmdrs.includes(c.name)&&!(this._cardData(c)?.type_line||'').toLowerCase().includes('land')&&!(this._cardData(c)?.type_line||'').toLowerCase().includes('creature'));

    // Mana curve
    const curve={};
    cards.forEach(c=>{const cd=this._cardData(c);if(cd&&!(cd.type_line||'').toLowerCase().includes('land')){const cmc=Math.min(cd.cmc||0,7);curve[cmc]=(curve[cmc]||0)+c.qty;}});
    const maxCurve=Math.max(...Object.values(curve),1);
    const curveHTML=Array.from({length:8},(_,i)=>{
      const h=Math.round(((curve[i]||0)/maxCurve)*40);
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:2px">
        <div class="fp-curve-bar" style="height:${h||2}px" title="CMC ${i<7?i:'7+'}: ${curve[i]||0}"></div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:8px;color:var(--text3)">${i<7?i:'7+'}</div>
      </div>`;
    }).join('');

    const totalVal=cards.reduce((s,c)=>s+(parseFloat(this._cardData(c)?.prices?.eur||0)*c.qty),0);
    const avgCmc=(()=>{
      let total=0,count=0;
      cards.forEach(c=>{const cd=this._cardData(c);if(cd&&!(cd.type_line||'').toLowerCase().includes('land')){total+=cd.cmc||0;count++;}});
      return count?( total/count).toFixed(1):'—';
    })();

    const myDeckCards=new Set(Store.decks.flatMap(d=>d.cards.map(c=>c.name.toLowerCase())));
    const myWishCards=new Set((WishlistMgr._data||[]).map(w=>w.card_name.toLowerCase()));
    const renderGroup=(title,arr)=>{
      if(!arr.length)return'';
      const sorted=arr.slice().sort((a,b)=>{
        const pa=parseFloat(this._cardData(a)?.prices?.eur||0);
        const pb=parseFloat(this._cardData(b)?.prices?.eur||0);
        return pb-pa;
      });
      const tiles=sorted.map(card=>{
        const cd=this._cardData(card);
        const price=parseFloat(cd.prices?.eur||0);
        const iOwn=myDeckCards.has(card.name.toLowerCase());
        const iWant=myWishCards.has(card.name.toLowerCase());
        const wantBtn=(!iOwn&&!iWant)
          ?`<button class="fp-want-btn" data-action="wish" data-card="${esc(card.name)}" title="Add to my wishlist"
              onclick="WishlistMgr.addByName('${esc(card.name).replace(/'/g,'\\&#39;')}');this.textContent='⭐';this.classList.add('on');this.disabled=true;">⭐</button>`
          :iWant?'<span class="fp-want-btn on" style="cursor:default;padding:2px 5px">⭐</span>'
          :'<span class="fp-have-badge">✓</span>';
        return `<div class="fp-mini-card" onclick="M.open({name:'${esc(card.name).replace(/'/g,"\\'")}',qty:${card.qty||1}},null)">
          ${(cd.img?.crop||cd.img?.normal)?`<img class="fp-mini-thumb" src="${esc(cd.img.crop||cd.img.normal)}" loading="lazy" alt="${esc(card.name)}">`:'<div class="fp-mini-thumb"></div>'}
          ${card.qty>1?`<div class="fp-mini-badge">${card.qty}×</div>`:''}
          <div class="fp-mini-info">
            <div class="fp-mini-name">${esc(card.name)}</div>
            <div class="fp-mini-meta"><span>${price?'�'+price.toFixed(0):'--'}</span><span>${shortType(cd.type_line||'')}</span></div>
            <div style="margin-top:4px;display:flex;justify-content:flex-end">${wantBtn}</div>
          </div>
        </div>`;
      }).join('');
      return `<div class="fp-group-title">${title} (${arr.reduce((s,c_)=>s+c_.qty,0)})</div><div class="fp-mini-grid">${tiles}</div>`;
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
            <div style="font-family:'JetBrains Mono',monospace;font-size:18px;color:var(--gold2);font-weight:600">€${totalVal.toFixed(0)}</div>
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
        ${cards.slice().sort((a,b)=>(parseFloat(this._cardData(b)?.prices?.eur||0)*b.qty)-(parseFloat(this._cardData(a)?.prices?.eur||0)*a.qty))
          .slice(0,5).map(c=>{const cd=this._cardData(c)||{};const v=(parseFloat(cd.prices?.eur||0)*c.qty);return `
          <div class="fp-card-row">
            ${(cd.img?.crop||cd.img?.normal)?`<img class="fp-card-thumb" src="${esc(cd.img.crop||cd.img.normal)}" loading="lazy">`:'<div class="fp-card-thumb" style="background:var(--bg3)"></div>'}
            <span class="fp-card-name">${esc(c.name)}</span>
            <span class="fp-card-price" style="font-size:11px">€${v.toFixed(2)}</span>
          </div>`;}).join('')}
      </div>

      <div class="fp-dv-pane" id="fp-dv-comments-${deck.id}">
        <div id="fp-comments-inner-${deck.id}"><div style="color:var(--text3);font-size:12px">Loading comments…</div></div>
      </div>`;
  },

  _renderDeckPopupContent(roDeck){
    const cards=roDeck.cards||[];
    const totalVal=cards.reduce((s,c)=>s+(parseFloat(this._cardData(c)?.prices?.eur||0)*(c.qty||0)),0);
    const totalCards=cards.reduce((s,c)=>s+(c.qty||0),0);
    const avgCmc=(()=>{
      let total=0,count=0;
      cards.forEach(c=>{
        const cd=this._cardData(c);
        if((cd.type_line||'').toLowerCase().includes('land'))return;
        total+=(cd.cmc||0)*(c.qty||1);
        count+=c.qty||1;
      });
      return count?(total/count).toFixed(1):'--';
    })();
    const cmdrs=[roDeck.commander,roDeck.partner].filter(Boolean);
    const groups=[
      ['Commander',cards.filter(c=>cmdrs.includes(c.name))],
      ['Creatures',cards.filter(c=>!cmdrs.includes(c.name)&&(this._cardData(c)?.type_line||'').toLowerCase().includes('creature')&&!(this._cardData(c)?.type_line||'').toLowerCase().includes('land'))],
      ['Spells',cards.filter(c=>!cmdrs.includes(c.name)&&!(this._cardData(c)?.type_line||'').toLowerCase().includes('land')&&!(this._cardData(c)?.type_line||'').toLowerCase().includes('creature'))],
      ['Lands',cards.filter(c=>!cmdrs.includes(c.name)&&(this._cardData(c)?.type_line||'').toLowerCase().includes('land'))]
    ];
    document.getElementById('pbody').innerHTML=`
      <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:16px">
        <div class="kpi gold"><div class="kpi-val">${totalCards}</div><div class="kpi-lbl">Cards</div></div>
        <div class="kpi ice"><div class="kpi-val">&euro;${totalVal.toFixed(0)}</div><div class="kpi-lbl">Value</div></div>
        <div class="kpi green"><div class="kpi-val">${avgCmc}</div><div class="kpi-lbl">Avg CMC</div></div>
        <div class="kpi purple"><div class="kpi-val">${roDeck.commander?esc(roDeck.commander):'--'}</div><div class="kpi-lbl">Commander</div></div>
      </div>
      <div id="readonly-deck-groups"></div>
    `;
    const wrap=document.getElementById('readonly-deck-groups');
    groups.forEach(([title,arr],groupIdx)=>{
      if(!arr.length)return;
      const sec=document.createElement('div');
      sec.innerHTML=`<div class="fp-group-title">${title} (${arr.reduce((s,c)=>s+(c.qty||0),0)})</div><div class="fp-mini-grid" id="readonly-group-${groupIdx}"></div>`;
      wrap.appendChild(sec);
      const grid=sec.querySelector(`#readonly-group-${groupIdx}`);
      arr.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach(card=>{
        const cd=this._cardData(card);
        const price=parseFloat(cd.prices?.eur||0);
        const tile=document.createElement('div');
        tile.className='fp-mini-card';
        tile.innerHTML=`
          ${(cd.img?.crop||cd.img?.normal)?`<img class="fp-mini-thumb" src="${esc(cd.img.crop||cd.img.normal)}" loading="lazy" alt="${esc(card.name)}">`:'<div class="fp-mini-thumb"></div>'}
          ${card.qty>1?`<div class="fp-mini-badge">${card.qty}x</div>`:''}
          <div class="fp-mini-info">
            <div class="fp-mini-name">${esc(card.name)}</div>
            <div class="fp-mini-meta"><span>${price?this._fmtMoney(price,0):'--'}</span><span>${shortType(cd.type_line||'')}</span></div>
          </div>`;
        tile.addEventListener('click',()=>M.open({name:card.name,qty:card.qty||1},null));
        grid.appendChild(tile);
      });
    });
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
    const avatarCard=ProfilePrefs?.getAvatarCard?.()||'';

    el.innerHTML=`
      <div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:20px 0 28px;border-bottom:1px solid var(--border);margin-bottom:20px">
        <div class="friend-avatar" id="profile-avatar-preview" style="width:64px;height:64px;font-size:28px;background:hsl(${hue},35%,22%);border-color:hsl(${hue},50%,42%)">${esc(username.slice(0,1).toUpperCase())}</div>
        <div style="text-align:center">
          <div style="font-family:'Cinzel',serif;font-size:20px;color:var(--gold2);font-weight:700">${esc(username)}</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text3);margin-top:4px">Private profile</div>
        </div>
        <div style="display:flex;gap:16px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text3)">
          <span>${Store.decks.length} decks</span>
          <span>${Store.decks.reduce((sum,d)=>sum+d.cards.reduce((acc,c)=>acc+(c.qty||0),0),0)} cards</span>
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

      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:16px">
        <div style="font-family:'Cinzel',serif;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);margin-bottom:12px">
          Profile Picture
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input id="profile-avatar-card-inp" class="auth-field" value="${esc(avatarCard)}"
            placeholder="Favourite card name" style="flex:1;min-width:180px;margin-bottom:0">
          <button class="tbtn gold" onclick="CommunityNav._saveAvatarCard()">Save Avatar</button>
          <button class="tbtn" onclick="CommunityNav._clearAvatarCard()">Reset</button>
        </div>
        <div id="profile-avatar-status" style="margin-top:8px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text3)">
          Optional local avatar using your favourite card art.
        </div>
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
    ProfilePrefs?.applyAvatar?.(document.getElementById('profile-avatar-preview'),username);
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
    ProfilePrefs?.applyAvatar?.(avEl,newName);
    DB._nickname=newName;
    if(status)status.innerHTML='<span style="color:var(--green2)">✓ Nickname updated! Next change in 30 days.</span>';
    Notify.show('Nickname changed to "'+newName+'"','ok');

    // Refresh profile view
    setTimeout(()=>this._renderMyProfile(),1500);
  },

  async _saveAvatarCard(){
    const inp=document.getElementById('profile-avatar-card-inp');
    const status=document.getElementById('profile-avatar-status');
    const name=(inp?.value||'').trim();
    if(!name){
      if(status)status.textContent='Enter a card name or click Reset.';
      return;
    }
    if(!Store.card(name))await new Promise(res=>SF.fetch(name,()=>res()));
    const cd=Store.card(name);
    if(!cd?.img?.crop&&!cd?.img?.normal){
      if(status)status.textContent='Card art could not be loaded.';
      return;
    }
    ProfilePrefs?.setAvatarCard?.(name);
    ProfilePrefs?.applyAvatar?.(document.getElementById('auth-avatar'),DB._nickname||'U');
    ProfilePrefs?.applyAvatar?.(document.getElementById('profile-avatar-preview'),DB._nickname||'U');
    if(status)status.textContent=`Avatar set to ${name}.`;
    Notify.show('Profile picture updated','ok');
  },

  _clearAvatarCard(){
    const status=document.getElementById('profile-avatar-status');
    ProfilePrefs?.setAvatarCard?.('');
    ProfilePrefs?.applyAvatar?.(document.getElementById('auth-avatar'),DB._nickname||'U');
    ProfilePrefs?.applyAvatar?.(document.getElementById('profile-avatar-preview'),DB._nickname||'U');
    if(status)status.textContent='Avatar reset.';
  }
};


/* ═══════════════════════════════════════════════════════════
   TRADE MATCHING
   Cross-references all wishlists vs trade lists automatically
   ═══════════════════════════════════════════════════════════ */
/* TradeMatch moved to js/trade-match.js */

/* DeckHealth moved to js/deck-health.js */

/* ═══════════════════════════════════════════════════════════
   URL IMPORT — Moxfield / Archidekt / TappedOut
   ═══════════════════════════════════════════════════════════ */

