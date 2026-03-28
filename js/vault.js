/* CommanderForge — vault: AnalysisView, DeckTags, MyCollection */

const AnalysisView={
  _deckId:null,

  render(){
    // Populate deck selector
    const sel=document.getElementById('ana-deck-select');
    if(!sel)return;
    const prev=sel.value;
    sel.innerHTML='<option value="">— Select a deck —</option>';
    Store.decks.forEach(d=>{
      const opt=document.createElement('option');
      opt.value=d.id;
      opt.textContent=d.name+(d.commander?' · '+d.commander:'');
      sel.appendChild(opt);
    });
    // Restore or auto-select current deck
    const toSelect=prev||App.curId||'';
    if(toSelect)sel.value=toSelect;
    if(sel.value)this.selectDeck(sel.value);
    else{
      document.getElementById('ana-content').style.display='none';
      document.getElementById('ana-empty-msg').style.display='block';
    }
  },

  selectDeck(id){
    this._deckId=id;
    const deck=Store.getDeck(id);
    const content=document.getElementById('ana-content');
    const empty=document.getElementById('ana-empty-msg');
    if(!deck){if(content)content.style.display='none';if(empty)empty.style.display='block';return;}
    if(content)content.style.display='block';
    if(empty)empty.style.display='none';
    const cmdrEl=document.getElementById('ana-selected-cmdr');
    if(cmdrEl)cmdrEl.textContent=deck.commander||'';
    this._renderAll(deck);
  },

  _renderAll(deck){
    const cards=deck.cards;
    const allCd=cards.map(c=>({entry:c,data:Store.card(c.name)||{}}));

    // Quick stats
    const totalQty=cards.reduce((s,c)=>s+c.qty,0);
    const lands=allCd.filter(({data:cd})=>(cd.type_line||'').toLowerCase().includes('land'));
    const landQty=lands.reduce((s,{entry:c})=>s+c.qty,0);
    const nonLands=allCd.filter(({data:cd})=>!(cd.type_line||'').toLowerCase().includes('land'));
    const avgCmc=nonLands.length?
      (nonLands.reduce((s,{entry:c,data:cd})=>s+(cd.cmc||0)*c.qty,0)/
       nonLands.reduce((s,{entry:c})=>s+c.qty,0)).toFixed(2):0;
    const colorsUsed=new Set(allCd.flatMap(({data:cd})=>cd.color_identity||[])).size;
    const totalVal=allCd.reduce((s,{entry:c,data:cd})=>s+(parseFloat(cd.prices?.eur||0)*c.qty),0);

    const G=id=>document.getElementById(id);
    if(G('ana-s-cards'))G('ana-s-cards').textContent=totalQty;
    if(G('ana-s-lands'))G('ana-s-lands').textContent=landQty;
    if(G('ana-s-avgcmc'))G('ana-s-avgcmc').textContent=avgCmc;
    if(G('ana-s-colors'))G('ana-s-colors').textContent=colorsUsed;
    if(G('ana-s-value'))G('ana-s-value').textContent='€'+totalVal.toFixed(0);
    if(G('ana-s-unique'))G('ana-s-unique').textContent=cards.length;

    // Mana curve (non-lands)
    const curve={};
    for(const{entry:c,data:cd}of allCd){
      if((cd.type_line||'').toLowerCase().includes('land'))continue;
      const cmc=Math.min(Math.round(cd.cmc||0),7);
      curve[cmc]=(curve[cmc]||0)+c.qty;
    }
    Charts.bar('ana-curve-chart',Array.from({length:8},(_,i)=>({k:i<7?String(i):'7+',v:curve[i]||0,color:`hsl(${200+i*15},60%,${55-i*3}%)`})));

    // Color distribution
    const colors={W:0,U:0,B:0,R:0,G:0,C:0};
    const colorNames={W:'White',U:'Blue',B:'Black',R:'Red',G:'Green',C:'Colorless'};
    const colorHex={W:'#f0dfa0',U:'#4a9fd4',B:'#8a6ab4',R:'#d44a2a',G:'#3a9a4a',C:'#888'};
    for(const{entry:c,data:cd}of allCd){
      const ci=cd.color_identity||[];
      if(!ci.length)colors.C+=c.qty;
      else ci.forEach(col=>{if(col in colors)colors[col]+=c.qty;});
    }
    Charts.pie('ana-color-pie',Object.entries(colors).filter(([,v])=>v>0)
      .map(([k,v])=>({k:colorNames[k],v,color:colorHex[k]})));

    // Card types
    const types={Creature:0,Instant:0,Sorcery:0,Enchantment:0,Artifact:0,Planeswalker:0,Battle:0,Land:0};
    const typeColors={Creature:'#d46040',Instant:'#4a9fd4',Sorcery:'#9a60c0',Enchantment:'#c8a84b',Artifact:'#888',Planeswalker:'#e6cc78',Battle:'#e080a0',Land:'#5aaa6a'};
    for(const{entry:c,data:cd}of allCd){
      const t=(cd.type_line||'').toLowerCase();
      for(const type of Object.keys(types))if(t.includes(type.toLowerCase())){types[type]+=c.qty;break;}
    }
    Charts.progressBars('ana-type-bars',Object.entries(types).filter(([,v])=>v>0)
      .map(([k,v])=>({k,v,color:typeColors[k]||'var(--gold3)'})));

    // Avg CMC by type
    const cmcByType={Creature:[],Instant:[],Sorcery:[],Enchantment:[],Artifact:[]};
    for(const{entry:c,data:cd}of allCd){
      const t=(cd.type_line||'').toLowerCase();
      for(const type of Object.keys(cmcByType))if(t.includes(type.toLowerCase())){cmcByType[type].push(cd.cmc||0);break;}
    }
    Charts.bar('ana-cmc-type-chart',Object.entries(cmcByType).filter(([,arr])=>arr.length>0)
      .map(([k,arr])=>({k:k.slice(0,4),v:parseFloat((arr.reduce((s,v)=>s+v,0)/arr.length).toFixed(1)),color:'var(--ice2)'})));

    // Rarity
    const rar={mythic:0,rare:0,uncommon:0,common:0};
    const rarColors={mythic:'#e8703a',rare:'#c8a84b',uncommon:'#9ab0c0',common:'#556060'};
    for(const{entry:c,data:cd}of allCd)if(cd.rarity&&rar[cd.rarity]!==undefined)rar[cd.rarity]+=c.qty;
    Charts.progressBars('ana-rarity-bars',Object.entries(rar).filter(([,v])=>v>0)
      .map(([k,v])=>({k:k.charAt(0).toUpperCase()+k.slice(1),v,color:rarColors[k]})));

    // Top 10 cards by value
    const tbody=document.getElementById('ana-top-tbody');
    if(tbody){
      const sorted=[...allCd].sort((a,b)=>(parseFloat(b.data.prices?.eur||0)*b.entry.qty)-(parseFloat(a.data.prices?.eur||0)*a.entry.qty)).slice(0,10);
      tbody.innerHTML='';
      for(const{entry:c,data:cd}of sorted){
        const usd=parseFloat(cd.prices?.eur||0);
        const tr=document.createElement('tr');
        tr.innerHTML=`<td><span class="lname" style="cursor:default">${esc(c.name)}</span></td>
          <td style="font-size:10px;color:var(--text3)">${shortType(cd.type_line||'')}</td>
          <td style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text2);text-align:center">${cd.cmc||0}</td>
          <td style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--green2)">${usd?'€'+usd.toFixed(2):'—'}</td>
          <td style="font-family:'JetBrains Mono',monospace;font-size:11px;text-align:center;color:var(--text2)">${c.qty}</td>
          <td style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--gold)">${usd?'€'+(usd*c.qty).toFixed(2):'—'}</td>`;
        tbody.appendChild(tr);
      }
    }
  }
};

/* ═══════════════════════════════════════════════════════════
   MY COLLECTION — folders + full card library
   ═══════════════════════════════════════════════════════════ */




/* ═══════════════════════════════════════════════════════════
   DECK TAGS
   ═══════════════════════════════════════════════════════════ */
const DECK_TAGS=['aggro','control','stax','combo','budget','cedh','casual','tribal','midrange','ramp'];

/* ── DECK MECHANICS — sourced from MTG archetype glossary ─────────── */
const DECK_MECHANICS=['Aggro','Control','Combo','Midrange','Affinity','Aristocrats','Auras',
  'Blink','Bogles','Burn','Company','Counters','Death and Taxes','Devotion','Discard','Dredge',
  'Enchantress','Hammer Time','Landfall','Lifegain','Madness','Mill','Ponza','Prison','Prowess',
  'RDW','Ramp','Reanimator','Sacrifice','Self-Mill','Soul-Sisters','Stax','Stompy','Storm',
  'Superfriends','Tempo','Tokens','Tribal','Turbo-Fog','Turns','Vehicles','Voltron',
  'White Weenie','Zoo'];
const TAG_COLORS={aggro:'aggro',control:'control',stax:'stax',combo:'combo',
                   budget:'budget',cedh:'cedh',casual:'casual',tribal:'tribal'};

function getDeckTags(deck){return deck.tags||[];}
function setDeckTags(deck,tags){deck.tags=tags;Store.updDeck(deck);}

function getDeckMechanics(deck){return deck.mechanics||[];}
function setDeckMechanics(deck,mechs){deck.mechanics=mechs;Store.updDeck(deck);}

function renderMechanicsPicker(deck,containerId){
  const el=document.getElementById(containerId);if(!el)return;
  const current=getDeckMechanics(deck);
  el.innerHTML='<div class="tag-picker">'+DECK_MECHANICS.map(m=>
    `<span class="deck-tag ${current.includes(m)?'on':''}"
      onclick="toggleDeckMechanic('${deck.id}','${CSS.escape(m)}','${containerId}')">${m}</span>`
  ).join('')+'</div>';
}

function toggleDeckMechanic(deckId,mechanic,containerId){
  const deck=Store.getDeck(deckId);if(!deck)return;
  const mechs=getDeckMechanics(deck);
  const idx=mechs.indexOf(mechanic);
  if(idx>=0)mechs.splice(idx,1);else mechs.push(mechanic);
  setDeckMechanics(deck,mechs);
  renderMechanicsPicker(deck,containerId);
}

function renderTagPicker(deck,containerId,onChange){
  const el=document.getElementById(containerId);if(!el)return;
  const current=getDeckTags(deck);
  el.innerHTML='<div class="tag-picker">'+DECK_TAGS.map(t=>
    `<span class="deck-tag ${TAG_COLORS[t]||''} ${current.includes(t)?'on':''}"
      onclick="toggleDeckTag('${deck.id}','${t}','${containerId}',${onChange||'null'})">${t}</span>`
  ).join('')+'</div>';
}

function toggleDeckTag(deckId,tag,containerId,cb){
  const deck=Store.getDeck(deckId);if(!deck)return;
  const tags=getDeckTags(deck);
  const idx=tags.indexOf(tag);
  if(idx>=0)tags.splice(idx,1);else tags.push(tag);
  setDeckTags(deck,tags);
  renderTagPicker(deck,containerId,cb);
  if(cb)cb();
}

/* ═══════════════════════════════════════════════════════════
   IMPROVED MY COLLECTION — stats + grid/list + qty
   ═══════════════════════════════════════════════════════════ */
const MyCollection={
  _folders:[],_activeFolder:null,_view:'list',_sort:'name',_filter:'',_scope:'all',
  FK:'cforge_folders',PBK:'cforge_personal_bulk',
  /* Memoized card list — invalidated by Bus event */
  _cardCache:null,
  _personalBulk:[],
  _initBus(){Bus.on('decks:changed',()=>{this._invalidateCache();});},

  load(){
    try{this._folders=JSON.parse(localStorage.getItem(this.FK)||'[]')}catch{this._folders=[];}
    try{this._personalBulk=JSON.parse(localStorage.getItem(this.PBK)||'[]')}catch{this._personalBulk=[];}
  },
  save(){
    try{localStorage.setItem(this.FK,JSON.stringify(this._folders))}catch{}
    try{localStorage.setItem(this.PBK,JSON.stringify(this._personalBulk||[]))}catch{}
  },
  _invalidateCache(){
    this._cardCache=null;
    this._rowCache=null;
    this._rowCacheKey='';
  },
  _cardKey(card){
    return `${encodeURIComponent(String(card?.name||'').toLowerCase())}|${card?.set||''}|${card?.collector_number||''}`;
  },
  _cardData(row){
    const exactKey=`${row?.name||''}::${row?.set||''}::${row?.collector_number||''}`;
    return Store.cache?.[exactKey]||Store.card(row?.name)||{};
  },
  _fetchRef(row){
    if(row?.set)return {name:row.name,set:row.set,collector_number:row.collector_number||undefined};
    return {name:row?.name};
  },
  _folderLabel(folderId){
    return this._folders.find(f=>f.id===folderId)?.name||'';
  },
  _personalBulkCount(){
    return (this._personalBulk||[]).reduce((sum,row)=>sum+(row.qty||0),0);
  },
  _personalBulkUnique(){
    return new Set((this._personalBulk||[]).map(row=>row.name)).size;
  },
  _ensurePersonalBulkPanels(){
    [
      {prefix:'mycoll', anchorId:'mycoll-card-area'},
      {prefix:'coll2', anchorId:'coll2-card-area'}
    ].forEach(cfg=>{
      const anchor=document.getElementById(cfg.anchorId);
      if(!anchor||document.getElementById(`${cfg.prefix}-pb-wrap`))return;
      const wrap=document.createElement('div');
      wrap.id=`${cfg.prefix}-pb-wrap`;
      wrap.style.cssText='margin:0 0 14px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:14px';
      wrap.innerHTML=`
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:10px">
          <div>
            <div style="font-family:'Cinzel',serif;font-size:13px;color:var(--gold2)">📦 Personal Bulk</div>
            <div style="font-size:11px;color:var(--text3);margin-top:4px">Private collection-only cards. Great for trade stock, spare copies and everything that is not in decks or the shared bulk pool.</div>
          </div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text3)" id="${cfg.prefix}-pb-meta"></div>
        </div>
        <textarea id="${cfg.prefix}-pb-text" class="bulk-paste-area" placeholder="4 Sol Ring&#10;2 Arcane Signet (SNC) 201&#10;12 Island" style="height:120px"></textarea>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px">
          <select id="${cfg.prefix}-pb-folder" class="coll-sel" style="min-width:180px">
            <option value="">No folder</option>
          </select>
          <button class="tbtn gold" onclick="MyCollection.importPersonalBulk('${cfg.prefix}')">Import to Personal Bulk</button>
          <button class="tbtn" onclick="MyCollection.clearPersonalBulkInput('${cfg.prefix}')">Clear</button>
          <div id="${cfg.prefix}-pb-status" style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text3)"></div>
        </div>`;
      anchor.parentNode.insertBefore(wrap,anchor);
    });
    this._syncPersonalBulkPanels();
  },
  _ensureScopeFilters(){
    [
      {
        prefix:'mycoll',
        hostId:'mycoll-sort',
        onChange:"MyCollection.setScope(this.value)"
      },
      {
        prefix:'coll2',
        hostId:'coll2-sort',
        onChange:"CollSection.setScope(this.value)"
      }
    ].forEach(cfg=>{
      const host=document.getElementById(cfg.hostId);
      if(!host||document.getElementById(`${cfg.prefix}-scope-filter`))return;
      const sel=document.createElement('select');
      sel.id=`${cfg.prefix}-scope-filter`;
      sel.className=host.className||'coll-sel';
      sel.setAttribute('onchange',cfg.onChange);
      sel.innerHTML='' +
        '<option value="all">All Cards</option>' +
        '<option value="decks">In Decks</option>' +
        '<option value="loose">No Decks</option>';
      host.insertAdjacentElement('afterend',sel);
    });
    this._syncScopeFilters();
  },
  _syncScopeFilters(){
    const val=this._scope||'all';
    ['mycoll','coll2'].forEach(prefix=>{
      const sel=document.getElementById(`${prefix}-scope-filter`);
      if(sel)sel.value=val;
    });
  },
  setScope(scope){
    this._scope=scope||'all';
    this._syncScopeFilters();
    this._renderCards();
    if(Menu.cur==='collection')CollSection?.filter?.();
  },
  _syncPersonalBulkPanels(){
    ['mycoll','coll2'].forEach(prefix=>{
      const sel=document.getElementById(`${prefix}-pb-folder`);
      if(sel){
        const prev=sel.value;
        sel.innerHTML='<option value="">No folder</option>';
        this._folders.forEach(f=>{
          const opt=document.createElement('option');
          opt.value=f.id;
          opt.textContent=`${f.icon||'📁'} ${f.name}`;
          sel.appendChild(opt);
        });
        if(prev)sel.value=prev;
      }
      const meta=document.getElementById(`${prefix}-pb-meta`);
      if(meta)meta.textContent=`${this._personalBulkUnique()} unique · ${this._personalBulkCount()} copies`;
      const status=document.getElementById(`${prefix}-pb-status`);
      if(status&&!status.dataset.locked)status.textContent='Paste any card list and import it into your private collection bulk.';
    });
  },
  clearPersonalBulkInput(prefix){
    const ta=document.getElementById(`${prefix}-pb-text`);
    const status=document.getElementById(`${prefix}-pb-status`);
    if(ta)ta.value='';
    if(status){
      status.textContent='Input cleared.';
      status.dataset.locked='1';
      setTimeout(()=>{delete status.dataset.locked;this._syncPersonalBulkPanels();},1600);
    }
  },
  _refreshCollectionViews(){
    this._invalidateCache();
    this._syncPersonalBulkPanels();
    if(Menu.cur==='vault'&&VaultNav.cur==='mycollection')this.render();
    if(Menu.cur==='collection')CollSection?.render?.();
  },
  importPersonalBulk(prefix){
    const ta=document.getElementById(`${prefix}-pb-text`);
    const folderSel=document.getElementById(`${prefix}-pb-folder`);
    const status=document.getElementById(`${prefix}-pb-status`);
    const text=(ta?.value||'').trim();
    const folderId=folderSel?.value||'';
    if(!text){Notify.show('Paste a card list first','err');return;}
    const lines=text.split(/\r?\n/);
    let added=0,skipped=0;
    for(const rawLine of lines){
      const line=rawLine.trim();
      if(!line)continue;
      const parsed=Parser.parseLine(line);
      if(!parsed){skipped++;continue;}
      const key=[parsed.name.toLowerCase(),parsed.set||'',parsed.collector_number||'',folderId,parsed.foil?'1':'0',parsed.etched?'1':'0'].join('|');
      const existing=(this._personalBulk||[]).find(row=>[
        String(row.name||'').toLowerCase(),
        row.set||'',
        row.collector_number||'',
        row.folder||'',
        row.foil?'1':'0',
        row.etched?'1':'0'
      ].join('|')===key);
      if(existing){
        existing.qty=(existing.qty||0)+(parsed.qty||1);
      }else{
        (this._personalBulk||(this._personalBulk=[])).push({
          id:'pb'+Date.now()+Math.random().toString(36).slice(2,6),
          name:parsed.name,
          qty:parsed.qty||1,
          folder:folderId||null,
          foil:!!parsed.foil,
          etched:!!parsed.etched,
          set:parsed.set||null,
          collector_number:parsed.collector_number||null,
          created:Date.now()
        });
      }
      added+=(parsed.qty||1);
    }
    if(!added){Notify.show('No cards recognized','err');return;}
    this.save();
    const names=[...new Set((this._personalBulk||[]).map(row=>row.name).filter(Boolean))];
    Store.warmCards(names).then(()=>{
      const missing=names.filter(name=>!Store.card(name));
      if(missing.length)SF.fetchBatch(missing,()=>{});
    });
    this._refreshCollectionViews();
    if(ta)ta.value='';
    if(status){
      status.textContent=`Imported ${added} card${added!==1?'s':''}${skipped?` · skipped ${skipped} line${skipped!==1?'s':''}`:''}.`;
      status.dataset.locked='1';
      setTimeout(()=>{delete status.dataset.locked;this._syncPersonalBulkPanels();},2400);
    }
    Notify.show(`Imported ${added} card${added!==1?'s':''} to Personal Bulk`+(skipped?` (${skipped} skipped)`:''),'ok');
  },

  render(){
    this.load();
    this._ensurePersonalBulkPanels();
    this._ensureScopeFilters();
    this._renderKPIs();
    this._renderFolders();
    this._renderCards();
    // Set view toggle state
    const vg=document.getElementById('mycoll-vt-grid');
    const vl=document.getElementById('mycoll-vt-list');
    if(vg)vg.classList.toggle('on',this._view==='grid');
    if(vl)vl.classList.toggle('on',this._view==='list');
  },

  _allCards(){
    if(this._cardCache)return this._cardCache;
    const map={};
    for(const deck of Store.decks){
      for(const c of deck.cards){
        const key=this._cardKey(c);
        if(!map[key])map[key]={key,name:c.name,qty:0,folder:c.folder||null,decks:[],foil:false,etched:false,set:c.set||null,collector_number:c.collector_number||null,deckQty:0,personalBulkQty:0};
        map[key].qty+=c.qty;
        map[key].deckQty+=(c.qty||0);
        if(c.foil)map[key].foil=true;
        if(c.etched)map[key].etched=true;
        /* Keep most specific print info */
        if(c.set&&!map[key].set){map[key].set=c.set;map[key].collector_number=c.collector_number||null;}
        if(!map[key].decks.includes(deck.name))map[key].decks.push(deck.name);
      }
    }
    for(const row of(this._personalBulk||[])){
      const key=this._cardKey(row);
      if(!map[key])map[key]={key,name:row.name,qty:0,folder:row.folder||null,decks:[],foil:false,etched:false,set:row.set||null,collector_number:row.collector_number||null,deckQty:0,personalBulkQty:0};
      map[key].qty+=(row.qty||0);
      map[key].personalBulkQty+=(row.qty||0);
      if(row.foil)map[key].foil=true;
      if(row.etched)map[key].etched=true;
      if(row.folder&&!map[key].folder)map[key].folder=row.folder;
      if(row.set&&!map[key].set){map[key].set=row.set;map[key].collector_number=row.collector_number||null;}
      if(!map[key].decks.includes('Personal Bulk'))map[key].decks.push('Personal Bulk');
    }
    this._cardCache=Object.values(map);
    return this._cardCache;
  },
  /* Cached sorted+filtered rows for virtual scroller */
  _rowCache:null,_rowCacheKey:'',

  _renderKPIs(){
    const cards=this._allCards();
    const totalQty=cards.reduce((s,c)=>s+c.qty,0);
    const totalVal=cards.reduce((s,c)=>{const cd=this._cardData(c);return s+(parseFloat(cd.prices?.eur||0)*c.qty);},0);
    const rarities={mythic:0,rare:0,uncommon:0,common:0};
    cards.forEach(c=>{const cd=this._cardData(c);if(cd.rarity&&rarities[cd.rarity]!==undefined)rarities[cd.rarity]++;});
    const foils=cards.filter(c=>c.foil||c.etched).length;
    const G=id=>document.getElementById(id);
    if(G('mycoll-kpi-unique'))G('mycoll-kpi-unique').textContent=cards.length;
    if(G('mycoll-kpi-total'))G('mycoll-kpi-total').textContent=totalQty;
    if(G('mycoll-kpi-value'))G('mycoll-kpi-value').textContent='€'+totalVal.toFixed(0);
    if(G('mycoll-kpi-foils'))G('mycoll-kpi-foils').textContent=foils;
    if(G('mycoll-kpi-mythic'))G('mycoll-kpi-mythic').textContent=rarities.mythic;
    if(G('mycoll-kpi-rare'))G('mycoll-kpi-rare').textContent=rarities.rare;
  },

  _renderFolders(){
    const grid=document.getElementById('mycoll-folders');if(!grid)return;
    const sel=document.getElementById('mycoll-folder-filter');
    if(sel){
      const prev=sel.value;
      sel.innerHTML='<option value="">All folders</option>';
      this._folders.forEach(f=>{const o=document.createElement('option');o.value=f.id;o.textContent=f.icon+' '+f.name;sel.appendChild(o);});
      sel.value=prev;
    }
    grid.innerHTML='';
    const allCard=document.createElement('div');
    allCard.className='folder-card'+(this._activeFolder===null?' on':'');
    allCard.innerHTML=`<div class="folder-ico">🗂</div><div class="folder-name">All Cards</div><div class="folder-count">${this._allCards().length} unique</div>`;
    allCard.addEventListener('click',()=>{this._activeFolder=null;this.render();});
    grid.appendChild(allCard);
    for(const f of this._folders){
      const cnt=this._allCards().filter(c=>c.folder===f.id).length;
      const card=document.createElement('div');
      card.className='folder-card'+(this._activeFolder===f.id?' on':'');
      card.innerHTML=`<div class="folder-ico">${f.icon||'📁'}</div><div class="folder-name">${esc(f.name)}</div><div class="folder-count">${cnt}</div>
        <button class="folder-del" onclick="event.stopPropagation();MyCollection.delFolder('${f.id}')">✕</button>`;
      card.addEventListener('click',()=>{this._activeFolder=f.id;this.render();});
      grid.appendChild(card);
    }
    const addCard=document.createElement('div');
    addCard.className='folder-card folder-add';
    addCard.innerHTML='<div class="folder-ico">➕</div><div class="folder-name" style="color:var(--text3)">New Folder</div>';
    addCard.addEventListener('click',()=>this.newFolder());
    grid.appendChild(addCard);
  },

  newFolder(){
    const name=prompt('Folder name:','New Folder');if(!name)return;
    const icons=['📁','⚔','🌊','🔥','🌿','💀','✨','🛡','🐉','💎'];
    this._folders.push({id:'f'+Date.now(),name:name.trim(),icon:icons[Math.floor(Math.random()*icons.length)],created:Date.now()});
    this.save();this.render();CollSection?.render?.();
  },
  delFolder(id){
    if(!confirm('Delete folder?'))return;
    this._folders=this._folders.filter(f=>f.id!==id);this.save();
    if(this._activeFolder===id)this._activeFolder=null;this.render();CollSection?.render?.();
  },

  setView(v){this._view=v;this._renderCards();
    document.getElementById('mycoll-vt-grid')?.classList.toggle('on',v==='grid');
    document.getElementById('mycoll-vt-list')?.classList.toggle('on',v==='list');
  },
  _filterTimer:null,
  filter(){
    clearTimeout(this._filterTimer);
    this._filterTimer=setTimeout(()=>{
      this._filter=document.getElementById('mycoll-search')?.value||'';
      this._sort=document.getElementById('mycoll-sort')?.value||'name';
      this._renderCards();
    },250);
  },
  /* Virtual scroll state */
  _vsRows:[],_vsRowH:52,_vsBuffer:5,_vsContainer:null,_vsScroller:null,

  _renderCards(){
    const folderFilter=document.getElementById('mycoll-folder-filter')?.value||this._activeFolder||'';
    let rows=this._allCards();
    if(folderFilter)rows=rows.filter(r=>r.folder===folderFilter);
    if(this._scope==='decks')rows=rows.filter(r=>(r.deckQty||0)>0);
    else if(this._scope==='loose')rows=rows.filter(r=>(r.deckQty||0)===0);
    const f=this._filter.toLowerCase();
    if(f)rows=rows.filter(r=>r.name.toLowerCase().includes(f));
    rows.sort((a,b)=>{
      const ca=Store.card(a.name)||{},cb=Store.card(b.name)||{};
      if(this._sort==='price_desc')return(parseFloat(cb.prices?.eur)||0)-(parseFloat(ca.prices?.eur)||0);
      if(this._sort==='cmc')return(ca.cmc||0)-(cb.cmc||0);
      if(this._sort==='rarity'){const ro={mythic:0,rare:1,uncommon:2,common:3};return(ro[ca.rarity||'']||4)-(ro[cb.rarity||'']||4);}
      if(this._sort==='qty')return b.qty-a.qty;
      return a.name.localeCompare(b.name);
    });

    const wrap=document.getElementById('mycoll-card-area');if(!wrap)return;
    const titleEl=document.getElementById('mycoll-folder-title');
    if(titleEl){const folder=this._folders.find(x=>x.id===(folderFilter||this._activeFolder));titleEl.textContent=folder?(folder.icon+' '+folder.name):'🗂 All Cards';}
    const cntEl=document.getElementById('mycoll-card-count');if(cntEl)cntEl.textContent=rows.length.toLocaleString()+' cards';

    // Totals (computed once, not inside loop)
    const totalVal=rows.reduce((s,r)=>{const cd=this._cardData(r);return s+(parseFloat(cd.prices?.eur||0)*r.qty);},0);
    const totalQty=rows.reduce((s,r)=>s+r.qty,0);
    if(document.getElementById('mycoll-uniq'))document.getElementById('mycoll-uniq').textContent=rows.length.toLocaleString();
    if(document.getElementById('mycoll-total'))document.getElementById('mycoll-total').textContent=totalQty.toLocaleString();
    if(document.getElementById('mycoll-val'))document.getElementById('mycoll-val').textContent='€'+totalVal.toFixed(2);

    if(this._view==='grid'){
      /* Grid view: batch render in chunks using requestAnimationFrame to avoid blocking */
      wrap.innerHTML='<div class="mycoll-grid" id="mycoll-grid-inner"></div>';
      const grid=document.getElementById('mycoll-grid-inner');
      const CHUNK=100;let idx=0;
      const renderChunk=()=>{
        const frag=document.createDocumentFragment();
        const end=Math.min(idx+CHUNK,rows.length);
        for(let i=idx;i<end;i++){
          const r=rows[i];const cd=this._cardData(r);
          const price=parseFloat(cd.prices?.eur||0);
          const tile=document.createElement('div');tile.className='mycoll-tile';
          const _uid=DB._user?.id;
          const isTrading=TradeMgr._data?.some(t=>t.card_name===r.name&&t.user_id===_uid)||false;
          const isWanted=WishlistMgr._data?.some(w=>w.card_name===r.name)||false;
          tile.innerHTML=`<div class="mycoll-tile-img">
            ${cd.img?.crop?`<img src="${esc(cd.img.crop)}" loading="lazy">`:'<div style="height:100%;background:var(--bg3)"></div>'}
            <div class="mycoll-qty-badge">${r.qty}×</div>
            ${isTrading?'<div class="trade-chip have">🤝</div>':''}
            ${isWanted?'<div class="trade-chip want">⭐</div>':''}
          </div>
          <div class="mycoll-tile-info">
            <div class="mycoll-tile-name">${esc(r.name)}</div>
            <div class="mycoll-tile-meta">
              <span class="mycoll-tile-qty">${r.qty}×</span>
              <span class="mycoll-tile-price">${price?'€'+price.toFixed(2):''}</span>
            </div>
          </div>`;
          frag.appendChild(tile);
        }
        grid.appendChild(frag);
        idx=end;
        if(idx<rows.length)requestAnimationFrame(renderChunk);
      };
      requestAnimationFrame(renderChunk);
      return;
    }

    /* ── LIST VIEW: Virtual Scrolling ──────────────────────────────
       Only renders the rows visible in the viewport + a buffer.
       Handles 20k+ rows with no lag. */
    const ROW_H=52;   // px per row
    const BUFFER=8;   // extra rows above+below visible area
    const THEAD=`<table class="coll-tbl" style="table-layout:fixed;width:100%">
      <colgroup><col style="width:36px"><col><col style="width:40px"><col style="width:60px">
      <col style="width:90px"><col style="width:36px"><col style="width:100px">
      <col style="width:80px"><col style="width:60px"><col style="width:60px"><col style="width:60px"></colgroup>
      <thead><tr>
        <th></th><th>Name</th><th>Qty</th><th>Colors</th>
        <th>Type</th><th>CMC</th><th>Folder</th><th>Decks</th><th>Price</th><th>Total</th><th></th>
      </tr></thead></table>`;
    /* Build scroller shell: fixed header + scrollable body */
    wrap.innerHTML=`
      <div id="vs-header">${THEAD}</div>
      <div id="vs-scroll" style="overflow-y:auto;flex:1;min-height:0;position:relative">
        <div id="vs-spacer" style="position:relative;width:100%">
          <table class="coll-tbl" style="table-layout:fixed;width:100%;position:absolute;top:0;left:0">
            <colgroup><col style="width:36px"><col><col style="width:40px"><col style="width:60px">
            <col style="width:90px"><col style="width:36px"><col style="width:100px">
            <col style="width:80px"><col style="width:60px"><col style="width:60px"><col style="width:60px"></colgroup>
            <tbody id="vs-tbody"></tbody>
          </table>
        </div>
      </div>`;

    const scroller=document.getElementById('vs-scroll');
    const spacer=document.getElementById('vs-spacer');
    const tbody=document.getElementById('vs-tbody');
    const totalH=rows.length*ROW_H;
    spacer.style.height=totalH+'px';

    /* Store rows for re-use on scroll */
    this._vsRows=rows;

    /* Build Sets once before render loop — O(n) not O(n²) */
    const uid=DB._user?.id;
    const tradingSet=new Set((TradeMgr._data||[]).filter(t=>t.user_id===uid).map(t=>t.card_name));
    const wantedSet=new Set((WishlistMgr._data||[]).map(w=>w.card_name));
    const renderVisible=()=>{
      if(!scroller)return;
      const scrollTop=scroller.scrollTop;
      const viewH=scroller.clientHeight||600;
      const firstIdx=Math.max(0,Math.floor(scrollTop/ROW_H)-BUFFER);
      const lastIdx=Math.min(rows.length-1,Math.ceil((scrollTop+viewH)/ROW_H)+BUFFER);
      tbody.style.transform=`translateY(${firstIdx*ROW_H}px)`;
      const frag=document.createDocumentFragment();
      for(let i=firstIdx;i<=lastIdx;i++){
      const r=rows[i];const cd=this._cardData(r);
        const price=parseFloat(cd.prices?.eur||0);
        const isTrading=tradingSet.has(r.name);
        const isWanted=wantedSet.has(r.name);
        const tr=document.createElement('tr');
        tr.style.height=ROW_H+'px';
        if(price>50)tr.classList.add('cv-tier-1');
        else if(price>20)tr.classList.add('cv-tier-2');
        tr.innerHTML=`
          <td>${cd.img?.crop?`<img src="${esc(cd.img.crop)}" class="lthumb" loading="lazy">`:'<div style="width:30px;height:42px;background:var(--bg3);border-radius:3px"></div>'}</td>
          <td><span class="lname" style="cursor:default" onmouseenter="CardTooltip.show('${esc(r.name).replace(/'/g,'&#39;')}',this)" onmouseleave="CardTooltip.hide()">${esc(r.name)}</span>${r.set?`<span style="font-family:'JetBrains Mono',monospace;font-size:8px;color:var(--text3);margin-left:4px;border:1px solid var(--border);border-radius:3px;padding:0 4px">${r.set.toUpperCase()}${r.collector_number?' #'+r.collector_number:''}</span>`:''} ${price>50?'<span class="cv-value-badge top">TOP</span>':price>20?'<span class="cv-value-badge high">HIGH</span>':''}
            ${isTrading?'<span class="trade-badge have" style="margin-left:4px">🤝</span>':''}
            ${isWanted?'<span class="trade-badge want" style="margin-left:4px">⭐</span>':''}
          </td>
          <td style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--gold2);text-align:center;font-weight:600">${r.qty}</td>
          <td>${(cd.color_identity||[]).map(c=>`<div class="pip ${c}" style="display:inline-flex">${c}</div>`).join('')}</td>
          <td>${cd.type_line?`<span class="tag ${getTypeTag(cd.type_line)}">${shortType(cd.type_line)}</span>`:''}</td>
          <td style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text2);text-align:center">${cd.cmc||0}</td>
          <td><select class="coll-sel" style="font-size:9px;padding:2px 4px" onchange="MyCollection.moveToFolder('${r.key}',this.value)">
            <option value="">No folder</option>
            ${this._folders.map(fl=>`<option value="${fl.id}"${r.folder===fl.id?' selected':''}>${fl.icon} ${esc(fl.name)}</option>`).join('')}
          </select></td>
          <td style="font-size:10px;color:var(--text3)">${r.decks.slice(0,2).join(', ')}</td>
          <td style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--green2)">${price?'€'+price.toFixed(2):'—'}</td>
          <td style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--gold)">${price?'€'+(price*r.qty).toFixed(2):'—'}</td>
          <td style="white-space:nowrap">
            <button class="tbtn sm" style="font-size:9px;padding:2px 6px" data-action="trade" data-card="${esc(r.name)}" title="Toggle trade">🤝</button>
            <button class="tbtn sm" style="font-size:9px;padding:2px 6px" data-action="wish" data-card="${esc(r.name)}" title="Toggle wishlist">${isWanted?'⭐':'☆'}</button>
          </td>`;
        frag.appendChild(tr);
      }
      tbody.innerHTML='';
      tbody.appendChild(frag);
    };

    renderVisible();
    /* Throttled scroll handler — max 1 render per animation frame */
    let _ticking=false;
    scroller.onscroll=()=>{
      if(!_ticking){
        requestAnimationFrame(()=>{renderVisible();_ticking=false;});
        _ticking=true;
      }
    };
  },

  moveToFolder(cardKey,folderId){
    let moved=false;
    for(const deck of Store.decks){
      const card=deck.cards.find(c=>this._cardKey(c)===cardKey);
      if(card){card.folder=folderId||null;Store.updDeck(deck);moved=true;}
    }
    for(const row of(this._personalBulk||[])){
      if(this._cardKey(row)===cardKey){row.folder=folderId||null;moved=true;}
    }
    if(moved){
      this.save();
      this._refreshCollectionViews();
    }
  }
};

/* ═══════════════════════════════════════════════════════════
   BULK POOL — with paste import
   ═══════════════════════════════════════════════════════════ */
