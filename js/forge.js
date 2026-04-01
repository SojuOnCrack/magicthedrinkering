/* CommanderForge â€” forge: App (deck editor), BracketCalc */

const App={
  curId:null,_view:'grid',_filter:'all',_search:'',_sort:'name',_cmcFilter:null,

  async init(){
    Store.load();
    /* One-time migration: move old localStorage card cache â†’ IndexedDB */
    const OLD_CACHE_KEY='cforge_cache4';
    const migFlag='cforge_idb_migrated';
    if(!localStorage.getItem(migFlag)){
      try{
        const raw=localStorage.getItem(OLD_CACHE_KEY);
        if(raw){
          const old=JSON.parse(raw);
          const entries=Object.values(old);
          if(entries.length){await IDB.setBulk(entries);}
          localStorage.removeItem(OLD_CACHE_KEY);
        }
      }catch{}
      localStorage.setItem(migFlag,'1');
    }
    /* Phase-1 boot: load card-name keys only (fast ~20ms) */
    await Store.loadCache();
    /* Update cache count in dashboard */
    IDB.count().then(n=>{const ce=document.getElementById('dash-engine-cache');if(ce)ce.textContent='Cache: '+n.toLocaleString();});
    this.renderSidebar();
    MobileNav?.syncDeckButton?.();
    const last=Store.getCur();
    if(last&&Store.getDeck(last)){
      /* Phase-2 warm: pre-load card data for the active deck before rendering */
      const activeDeck=Store.getDeck(last);
      if(activeDeck){
        const names=[activeDeck.commander,activeDeck.partner,...activeDeck.cards.map(c=>c.name)].filter(Boolean);
        await Store.warmCards(names);
      }
      this.loadDeck(last);
    }else this.showEmpty();
    /* Restore last section + vault page */
    const lastSection=localStorage.getItem(Menu.NAV_KEY)||'forge';
    const lastVPage=localStorage.getItem(VaultNav.VPAGE_KEY)||'dashboard';
    VaultNav.cur=lastVPage; /* set before Menu.go so vault restores correctly */
    registerSW();

    /* UI FIRST â€” render immediately so the screen isn't black */
    Menu.go(lastSection);
    PriceProxy.keysUpdated();
    MyCollection._initBus();
    OfflineQueue.init();

    /* Auth in background â€” _onSignedIn will refresh sections once ready */
    Auth.init().then(()=>{
      ScryfallBulk.autoCheck();
      ReprintAlert.autoCheck();
    }).catch(()=>{
      ScryfallBulk.autoCheck();
      ReprintAlert.autoCheck();
    });
    CardTooltip.init();
    ThemeMgr.init();
    this._showShareBtn=()=>{
      const btn=document.getElementById('share-btn');
      if(btn)btn.style.display=this.curId?'inline-flex':'none';
      const ab=document.getElementById('forge-add-btn');
      if(ab)ab.style.display=this.curId?'inline-flex':'none';
      const eb=document.getElementById('edit-deck-btn');
      if(eb)eb.style.display=this.curId?'inline-flex':'none';
    };
  },

  showEmpty(){
    document.getElementById('empty').style.display='flex';
    document.getElementById('card-grid').classList.remove('show');
    document.getElementById('list-wrap').classList.remove('show');
    this._clearScryfallDragState();
    MobileNav?.syncDeckButton?.();
  },

  newDeck(){
    const deck={id:Store.uid(),name:'New Deck',commander:'',partner:'',cards:[],created:Date.now(),public:true};
    Store.addDeck(deck);this.renderSidebar();this.loadDeck(deck.id);setTimeout(()=>P.editCmdr(),100);
  },

  dupDeck(id){
    const src=Store.getDeck(id);if(!src)return;
    const copy={...src,id:Store.uid(),name:src.name+' (copy)',
                cards:src.cards.map(c=>({...c})),created:Date.now(),public:true};
    Store.addDeck(copy);this.renderSidebar();
    Notify.show('Deck duplicated','ok');
    if(DB._user)DB.schedulePush();
  },

  async delDeck(id,e){
    e.stopPropagation();
    if(!confirm('Delete this deck? This cannot be undone.'))return;
    // Remove from Supabase first if signed in
    if(DB._sb&&DB._user){
      try{
        await DB._sb.from('decks').delete().eq('id',id).eq('user_id',DB._user.id);
      }catch(err){
        Notify.show('Cloud delete failed: '+err.message,'err');
        // Still delete locally
      }
    }
    Store.delDeck(id);
    if(this.curId===id){this.curId=null;this.showEmpty();this._updHeader(null);}
    this.renderSidebar();
    Notify.show('Deck removed','inf');
  },

  loadDeck(id){
    const deck=Store.getDeck(id);if(!deck)return;
    SF.cancelBatch(); /* abort in-flight fetches from previous deck */
    this.curId=id;Store.saveCur(id);this.renderSidebar();this._updHeader(deck);this._showShareBtn&&this._showShareBtn();
    /* Warm IDB cache for this deck before rendering (async, non-blocking) */
    const deckNames=[deck.commander,deck.partner,...deck.cards.map(c=>c.name)].filter(Boolean);
    Store.warmCards(deckNames).then(()=>this.render());
    this._fetchCards(deck);
    // Show share button
    const shareBtn=document.getElementById('share-btn');
    if(shareBtn)shareBtn.style.display='inline-flex';
    // Show synergy button if commander is set
    const synBtn=document.getElementById('synergy-btn');
    if(synBtn)synBtn.style.display=deck.commander?'inline-flex':'none';
    // Auto-sync to Supabase if signed in
    if(DB._user)DB.schedulePush();
    this._clearScryfallDragState();
    MobileNav?.syncDeckButton?.();
  },

  _getScryfallDropTarget(){
    return document.getElementById('card-area');
  },

  _clearScryfallDragState(){
    this._getScryfallDropTarget()?.classList.remove('scryfall-drag');
  },

  _onScryfallDragOver(e){
    if(!this.curId)return;
    e.preventDefault();
    e.dataTransfer.dropEffect='copy';
    this._getScryfallDropTarget()?.classList.add('scryfall-drag');
  },

  _onScryfallDragLeave(e){
    const target=this._getScryfallDropTarget();
    if(!target)return;
    if(!e.currentTarget?.contains?.(e.relatedTarget))target.classList.remove('scryfall-drag');
  },

  async _onScryfallDrop(e){
    e.preventDefault();
    this._clearScryfallDragState();
    if(!this.curId){Notify.show('Open a deck first','err');return;}
    const file=e.dataTransfer?.files?.[0];
    if(!file){Notify.show('Drop a Scryfall card image file','err');return;}
    await this._addDroppedScryfallFile(file);
  },

  _parseScryfallFilename(filename){
    const base=String(filename||'').replace(/\.[^.]+$/,'').toLowerCase().trim();
    const m=base.match(/^([a-z0-9]+)-([a-z0-9]+)-(.+)$/i);
    if(!m)return null;
    const set=m[1].toLowerCase();
    const collector_number=m[2];
    const slug=m[3].replace(/--+/g,'-');
    const nameGuess=slug
      .split('-')
      .filter(Boolean)
      .map(part=>part==='s' ? "'s" : part)
      .join(' ')
      .replace(/\s+'s\b/g,"'s")
      .replace(/\b\w/g,ch=>ch.toUpperCase());
    return {set,collector_number,slug,nameGuess,filename:base};
  },

  async _fetchDroppedScryfallCard(parsed){
    const exactUrl=`/api/scryfall/cards/${encodeURIComponent(parsed.set)}/${encodeURIComponent(parsed.collector_number)}`;
    try{
      const res=await fetch(exactUrl,{headers:{Accept:'application/json'}});
      if(res.ok){
        const data=await res.json();
        return {card:data,match:'exact'};
      }
    }catch{}
    try{
      const byName=await fetch(`/api/scryfall/cards/named?exact=${encodeURIComponent(parsed.nameGuess)}`,{headers:{Accept:'application/json'}});
      if(byName.ok){
        const data=await byName.json();
        return {card:data,match:'name'};
      }
    }catch{}
    return null;
  },

  async _addDroppedScryfallFile(file){
    const parsed=this._parseScryfallFilename(file.name);
    if(!parsed){
      Notify.show('Could not read the Scryfall filename','err');
      return;
    }
    Notify.show(`Matching ${parsed.nameGuess}...`,'inf',1800);
    const result=await this._fetchDroppedScryfallCard(parsed);
    if(!result?.card){
      Notify.show('Could not match dropped Scryfall card','err');
      return;
    }
    const slim=SF._slim?SF._slim(result.card):result.card;
    if(slim?.name){
      Store.setCard(slim.name,slim);
      Store.saveCache?.();
    }
    this._addDroppedCardToDeck({
      name:result.card.name||parsed.nameGuess,
      set:(result.card.set||parsed.set||'').toLowerCase(),
      collector_number:String(result.card.collector_number||parsed.collector_number||'')
    },result.match);
  },

  _addDroppedCardToDeck(cardRef,matchType='exact'){
    const deck=Store.getDeck(this.curId);
    if(!deck)return;
    const existing=deck.cards.find(c=>c.name.toLowerCase()===String(cardRef.name).toLowerCase());
    let updatedPrinting=false;
    if(existing){
      existing.qty=(existing.qty||0)+1;
      if(cardRef.set&&cardRef.collector_number&&(existing.set!==cardRef.set||String(existing.collector_number||'')!==String(cardRef.collector_number))){
        existing.set=cardRef.set;
        existing.collector_number=cardRef.collector_number;
        updatedPrinting=true;
      }else{
        if(!existing.set&&cardRef.set)existing.set=cardRef.set;
        if(!existing.collector_number&&cardRef.collector_number)existing.collector_number=cardRef.collector_number;
      }
    }else{
      deck.cards.push({
        name:cardRef.name,
        qty:1,
        foil:false,
        etched:false,
        set:cardRef.set||'',
        collector_number:cardRef.collector_number||''
      });
    }
    Store.updDeck(deck);
    this._updHeader(deck);
    this.render();
    if(DB._user)DB.schedulePush();
    const matchLabel=matchType==='exact'?'exact printing':'card match';
    if(updatedPrinting)Notify.show(`Added ${cardRef.name} and updated to the dropped ${matchLabel}`,'ok');
    else Notify.show(`Added ${cardRef.name} from Scryfall drop`,'ok');
  },

  _fetchCards(deck){
    const cmdrs=[deck.commander,deck.partner].filter(Boolean);
    const seenNames=new Set();
    const allItems=[];
    for(const name of cmdrs){
      if(!seenNames.has(name)&&!Store.card(name)){seenNames.add(name);allItems.push({name});}
    }
    for(const c of deck.cards){
      if(seenNames.has(c.name))continue;
      seenNames.add(c.name);
      const cached=Store.card(c.name);
      const needsExactPrint=c.set&&cached&&cached.set&&cached.set!==c.set;
      const notCached=!cached;
      if(notCached||needsExactPrint){
        const item={name:c.name};
        if(c.set)item.set=c.set;
        if(c.collector_number)item.collector_number=c.collector_number;
        allItems.push(item);
      }
    }
    if(!allItems.length)return;
    const total=allItems.length;
    const prog=document.getElementById('prog');const ptxt=document.getElementById('prog-txt');
    prog.style.display='block';ptxt.textContent=`Loadingâ€¦ 0/${total}`;
    const deckId=deck.id;
    SF.fetchBatch(allItems,(done,tot)=>{
      ptxt.textContent=`Loadingâ€¦ ${done}/${tot}`;
      if(done>=tot){
        prog.style.display='none';
        P._updateSlotPreview(1);P._updateSlotPreview(2);
        this._updHeader(Store.getDeck(deckId));
        AlertMgr.checkAlerts();
        this.render();
      }
    });
  },

  _patchTile(name,cd,deckId){
    if(!cd)return;
    const tile=document.getElementById('card-grid').querySelector(`[data-name="${CSS.escape(name)}"]`);
    if(!tile)return;
    const skel=tile.querySelector('.ct-skel');const imgWrap=tile.querySelector('.ct-img');
    const tileImg=cd.img?.normal||cd.img?.crop;
    if(tileImg&&!imgWrap.querySelector('img')){
      const img=document.createElement('img');img.className='loading';img.src=tileImg;img.alt=name;
      img.onload=()=>{img.classList.remove('loading');if(skel)skel.style.display='none';};
      img.onerror=()=>{img.style.display='none';};
      imgWrap.insertBefore(img,imgWrap.firstChild);
    }
    const typeEl=tile.querySelector('.ct-type');if(typeEl)typeEl.textContent=shortType(cd.type_line||'');
    const manaEl=tile.querySelector('.ct-mana');if(manaEl)manaEl.innerHTML=fmtMana(cd.mana_cost||'');
    const priceEl=tile.querySelector('.ct-price');if(priceEl)priceEl.textContent=cd.prices?.eur?'€'+cd.prices.eur:'';
    const ovType=tile.querySelector('.ov-type');if(ovType)ovType.textContent=cd.type_line||'';
    const ovText=tile.querySelector('.ov-text');if(ovText)ovText.textContent=cd.oracle_text||'';
  },

  setView(v){
    this._view=v;
    document.getElementById('vt-g').classList.toggle('on',v==='grid');
    document.getElementById('vt-l').classList.toggle('on',v==='list');
    this.render();
  },

  setFilter(btn){
    this._filter=btn.dataset.f;
    this._cmcFilter=null; /* clear CMC filter when switching type */
    document.querySelectorAll('.fb').forEach(b=>b.classList.remove('on'));
    btn.classList.add('on');this.render();
  },

  filter(){this._search=document.getElementById('srch').value.toLowerCase();this.render();},
  resort(){this._sort=document.getElementById('srt').value;this.render();},
  sortBy(k){this._sort=k;document.getElementById('srt').value=k;this.render();},

  chQty(deckId,name,delta){
    const deck=Store.getDeck(deckId);if(!deck)return;
    const c=deck.cards.find(x=>x.name===name);if(!c)return;
    const snapBefore=[...deck.cards.map(x=>({...x}))]; /* snapshot before mutating */
    c.qty=Math.max(0,c.qty+delta);
    const removed=c.qty===0;
    if(removed)deck.cards=deck.cards.filter(x=>x.name!==name);
    Store.updDeck(deck);this.render();
    /* Show undo toast when a card is fully removed */
    if(removed)UndoMgr.record(deckId,name,snapBefore);
  },

  _getCards(deck){
    let cards=[...deck.cards];
    if(this._search)cards=cards.filter(c=>c.name.toLowerCase().includes(this._search));
    /* CMC filter from mana curve click */
    if(this._cmcFilter!==null&&this._cmcFilter!==undefined){
      cards=cards.filter(c=>{
        const cd=Store.card(c.name)||{};
        if((cd.type_line||'').toLowerCase().includes('land'))return false;
        return this._cmcFilter>=7?cd.cmc>=7:Math.floor(cd.cmc||0)===this._cmcFilter;
      });
    }
    if(this._filter!=='all'){
      cards=cards.filter(c=>{
        const cd=Store.card(c.name);const t=(cd?.type_line||'').toLowerCase();
        if(this._filter==='creature')    return t.includes('creature');
        if(this._filter==='instant')     return t.includes('instant');
        if(this._filter==='sorcery')     return t.includes('sorcery');
        if(this._filter==='enchantment') return t.includes('enchantment')&&!t.includes('artifact');
        if(this._filter==='battle')      return t.includes('battle');
        if(this._filter==='land')        return t.includes('land');
        if(this._filter==='artifact')    return t.includes('artifact');
        return true;
      });
    }
    const k=this._sort;
    return cards.sort((a,b)=>{
      const ca=Store.card(a.name)||{},cb=Store.card(b.name)||{};
      if(k==='cmc')return(ca.cmc||0)-(cb.cmc||0);
      if(k==='type')return(ca.type_line||'').localeCompare(cb.type_line||'');
      if(k==='price')return(parseFloat(cb.prices?.eur)||0)-(parseFloat(ca.prices?.eur)||0);
      return a.name.localeCompare(b.name);
    });
  },

  render(){
    const deck=Store.getDeck(this.curId);
    document.getElementById('empty').style.display=deck?'none':'flex';
    this._clearScryfallDragState();
    if(!deck)return;
    this._updHeader(deck);
    if(this._view==='grid')this._renderGrid(deck);else this._renderList(deck);
  },

  _renderGrid(deck){
    const grid=document.getElementById('card-grid');
    document.getElementById('list-wrap').classList.remove('show');
    grid.classList.add('show');
    const cards=this._getCards(deck);grid.innerHTML='';

    // Groups: commander, partner (if any), then detailed card type sections
    const groups=[
      ['Commander','is-cmdr',cards.filter(c=>c.name===deck.commander)],
    ];
    if(deck.partner) groups.push(['Partner','is-partner',cards.filter(c=>c.name===deck.partner)]);
    const sections=Object.fromEntries(DECK_CARD_SECTION_ORDER.map(label=>[label,[]]));
    for(const c of cards){
      if(c.name===deck.commander||c.name===deck.partner)continue;
      const cd=Store.card(c.name);
      sections[getDeckCardSection(cd?.type_line||'')].push(c);
    }
    for(const label of DECK_CARD_SECTION_ORDER)groups.push([label,'',sections[label]]);

    for(const [label,cls,arr] of groups){
      if(!arr.length)continue;
      const hdr=document.createElement('div');hdr.className='sec-hdr'+(cls?' '+cls:'');
      hdr.innerHTML=`${esc(label)} <span class="sc">${arr.reduce((s,c)=>s+c.qty,0)}</span>`;
      grid.appendChild(hdr);
      for(const c of arr)grid.appendChild(this._makeTile(c,deck));
    }
    if(!cards.length&&deck.cards.length){
      const msg=document.createElement('div');msg.className='empty-panel';msg.style.gridColumn='1 / -1';
      msg.innerHTML='<div class="empty-kicker">Deck View</div><div class="empty-ico">DB</div><div class="empty-ttl">No Cards Match Right Now</div><div class="empty-sub">Clear a filter or search term to bring the full deck back into view.</div>';grid.appendChild(msg);
    }
  },

  _collectionSummary(){
    const unique=new Set();
    let totalCopies=0;
    let totalValue=0;
    Store.decks.forEach(deck=>{
      deck.cards.forEach(card=>{
        unique.add(card.name);
        totalCopies+=card.qty||0;
        totalValue+=(parseFloat(Store.card(card.name)?.prices?.eur||0)*(card.qty||0));
      });
    });
    return {unique:unique.size,copies:totalCopies,value:totalValue,decks:Store.decks.length};
  },

  _bulkPoolSummary:{value:0,updated:0},
  async _refreshBulkPoolSummary(force=false){
    const fresh=(Date.now()-this._bulkPoolSummary.updated)<60000;
    if(!force&&fresh)return this._bulkPoolSummary;
    if(!DB?._sb)return this._bulkPoolSummary;
    try{
      const {data,error}=await DB._sb.from('bulk_pool').select('qty,price_usd,card_name');
      if(error)throw error;
      const rows=data||[];
      const names=[...new Set(rows.map(row=>row.card_name).filter(Boolean))];
      if(names.length)await Store.warmCards(names);
      const value=rows.reduce((sum,row)=>{
        const local=parseFloat(Store.card(row.card_name)?.prices?.eur||0);
        const saved=parseFloat(row.price_usd||0);
        const price=local||saved;
        return sum+(price*(row.qty||1));
      },0);
      this._bulkPoolSummary={value,updated:Date.now()};
    }catch{}
    return this._bulkPoolSummary;
  },

  async refreshTopbarStats(force=false){
    const totalLabel=document.getElementById('s-total-label');
    const collectionLabel=document.getElementById('s-collection-label');
    const bulkLabel=document.getElementById('s-bulk-label');
    const totalEl=document.getElementById('s-total');
    const collectionEl=document.getElementById('s-collection');
    const bulkEl=document.getElementById('s-bulk');
    const cmdrName=document.getElementById('cmdr-name-1');
    const ciPips=document.getElementById('ci-pips-1');
    const partnerPlus=document.getElementById('partner-plus');
    if(!totalEl||!collectionEl||!bulkEl)return;

    const sum=this._collectionSummary();
    const bulk=await this._refreshBulkPoolSummary(force);
    const bulkValueEl=document.getElementById('bulk-value');
    const bulkValueText=(bulkValueEl?.textContent||'').trim();
    totalEl.textContent=sum.copies;
    collectionEl.textContent='\u20AC'+sum.value.toFixed(0);
    bulkEl.textContent=bulkValueText||('\u20AC'+(bulk.value||0).toFixed(2));
    if(totalLabel)totalLabel.textContent='Library';
    if(collectionLabel)collectionLabel.textContent='Value';
    if(bulkLabel)bulkLabel.textContent='Bulk Pool';
    if(cmdrName)cmdrName.textContent='Collection Overview';
    if(ciPips)ciPips.innerHTML='';
    if(partnerPlus)partnerPlus.style.display='none';
  },

  _makeTile(c,deck){
    const cd=Store.card(c.name)||{};
    const isCmdr=c.name===deck.commander;
    const isPartner=c.name===deck.partner;
    const hasP=Partner.hasPartner(cd);
    const tile=document.createElement('div');
    tile.className='ct'+(c.foil||c.etched?' foil':'')+(isCmdr?' is-cmdr':'')+(isPartner?' is-partner':'');
    tile.dataset.name=c.name;
    const imgWrap=document.createElement('div');imgWrap.className='ct-img';
    const skel=document.createElement('div');skel.className='ct-skel';imgWrap.appendChild(skel);
    const tileImg=cd.img?.normal||cd.img?.crop;
    if(tileImg){
      const img=document.createElement('img');img.className='loading';img.alt=c.name;
      img.dataset.src=tileImg; /* defer src - set by observer */
      img.onload=()=>{img.classList.remove('loading');skel.style.display='none';};
      img.onerror=()=>{img.style.display='none';};
      imgWrap.appendChild(img);
      /* Lazy-load via IntersectionObserver */
      TileImgObserver.observe(img);
    }
    if(c.qty>1){const qty=document.createElement('div');qty.className='ct-qty';qty.textContent=c.qty+'x';imgWrap.appendChild(qty);}
    if(c.foil||c.etched){const fb=document.createElement('div');fb.className='ct-foil';fb.textContent=(c.foil?'Foil':'')+(c.etched?' Etched':'');imgWrap.appendChild(fb);}
    if(isCmdr){const crown=document.createElement('div');crown.className='ct-cmdr-crown';crown.textContent='CMD';imgWrap.appendChild(crown);}
    if(isPartner){const crown=document.createElement('div');crown.className='ct-cmdr-crown';crown.style.color='var(--purple2)';crown.textContent='PRT';imgWrap.appendChild(crown);}

    const ov=document.createElement('div');ov.className='ct-ov';
    const ovName=document.createElement('div');ovName.className='ov-name';ovName.textContent=c.name;
    const ovType=document.createElement('div');ovType.className='ov-type';ovType.textContent=cd.type_line||'';
    const ovText=document.createElement('div');ovText.className='ov-text';ovText.textContent=cd.oracle_text||'';
    const ovBtns=document.createElement('div');ovBtns.className='ov-btns';
    const addB=document.createElement('button');addB.className='ovb add';addB.textContent='Add Copy';
    addB.addEventListener('click',e=>{e.stopPropagation();App.chQty(deck.id,c.name,1);});
    ovBtns.append(addB);
    if(!isCmdr){const setCB=document.createElement('button');setCB.className='ovb set-cmdr';setCB.textContent='Make Commander';setCB.addEventListener('click',e=>{e.stopPropagation();deck.commander=c.name;Store.updDeck(deck);App._updHeader(deck);App.render();Notify.show(`${c.name} is now your commander`,'ok');});ovBtns.appendChild(setCB);}
    if(hasP&&!isPartner&&!isCmdr){const setPB=document.createElement('button');setPB.className='ovb set-partner';setPB.textContent='Make Partner';setPB.addEventListener('click',e=>{e.stopPropagation();deck.partner=c.name;Store.updDeck(deck);App._updHeader(deck);App.render();Notify.show(`${c.name} is now your partner`,'ok');});ovBtns.appendChild(setPB);}
    const rmB=document.createElement('button');rmB.className='ovb rm';rmB.textContent='Remove';
    rmB.addEventListener('click',e=>{e.stopPropagation();App.chQty(deck.id,c.name,-1);});
    ovBtns.append(rmB);
    ov.append(ovName,ovType,ovText,ovBtns);imgWrap.appendChild(ov);

    const info=document.createElement('div');info.className='ct-info';
    const ctName=document.createElement('div');ctName.className='ct-name';ctName.textContent=c.name;
    const ctType=document.createElement('div');ctType.className='ct-type';ctType.textContent=shortType(cd.type_line||'');
    // Show set/collector badge if card has specific printing
    if(c.set||cd.set){
      const setStr=(c.set||cd.set||'').toUpperCase();
      const cnStr=c.collector_number||cd.collector_number||'';
      const ctSet=document.createElement('div');
      ctSet.style.cssText='font-family:"JetBrains Mono",monospace;font-size:8px;color:var(--text3);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      ctSet.textContent=setStr+(cnStr?' #'+cnStr:'');
      ctSet.title=`Set: ${setStr}${cnStr?' · #'+cnStr:''}`;
      info.appendChild(ctName);info.appendChild(ctType);info.appendChild(ctSet);
    } else {
      info.append(ctName,ctType);
    }
    const ctMana=document.createElement('div');ctMana.className='ct-mana';ctMana.innerHTML=fmtMana(cd.mana_cost||'');
    const ctFoot=document.createElement('div');ctFoot.className='ct-foot';
    const ctPriceWrap=document.createElement('div');ctPriceWrap.style.cssText='display:flex;align-items:center;gap:3px';
    const ctPrice=document.createElement('div');ctPrice.className='ct-price';ctPrice.textContent=cd.prices?.eur?'€'+parseFloat(cd.prices.eur).toFixed(2):'';
    const rarColors={mythic:'#e8703a',rare:'#c8a84b',uncommon:'#9ab0c0',common:'#445566',special:'#b090e0'};
    if(cd.rarity&&rarColors[cd.rarity]){const dot=document.createElement('div');dot.className='ct-rarity-dot';dot.style.background=rarColors[cd.rarity];dot.title=cd.rarity;ctPriceWrap.appendChild(dot);}
    ctPriceWrap.appendChild(ctPrice);
    ctFoot.append(ctMana,ctPriceWrap);info.appendChild(ctFoot);
    tile.append(imgWrap,info);
    attachTapPop(tile);
    attachCardTilt(tile);
    tile.addEventListener('click',()=>M.open(c,deck.id));
    return tile;
  },

  _renderList(deck){
    document.getElementById('card-grid').classList.remove('show');
    document.getElementById('list-wrap').classList.add('show');
    const tbody=document.getElementById('ltbody');
    const cards=this._getCards(deck);tbody.innerHTML='';
    for(const c of cards){
      const cd=Store.card(c.name)||{};
      const isCmdr=c.name===deck.commander,isPartner=c.name===deck.partner;
      const tr=document.createElement('tr');
      if(isCmdr)tr.className='cmdr-row';else if(isPartner)tr.className='partner-row';
      const tag=getTypeTag(cd.type_line||'');
      const td0=document.createElement('td');
      if(cd.img?.crop){const img=document.createElement('img');img.className='lthumb';img.src=cd.img.crop;img.alt=c.name;img.addEventListener('click',()=>M.open(c,deck.id));td0.appendChild(img);}
      else{const ph=document.createElement('div');ph.style.cssText='width:30px;height:42px;background:var(--bg3);border-radius:3px;border:1px solid var(--border)';td0.appendChild(ph);}
      const td1=document.createElement('td');
      const ns=document.createElement('span');ns.className='lname';ns.textContent=c.name;ns.addEventListener('click',()=>M.open(c,deck.id));td1.appendChild(ns);
      if(c.foil||c.etched){const s=document.createElement('span');s.className='tag foil';s.textContent=c.foil?'F':'E';td1.appendChild(s);}
      if(isCmdr){const s=document.createElement('span');s.className='tag cmdr';s.style.marginLeft='4px';s.textContent='CMDR';td1.appendChild(s);}
      if(isPartner){const s=document.createElement('span');s.className='tag partner';s.style.marginLeft='4px';s.textContent='PARTNER';td1.appendChild(s);}
      const td2=document.createElement('td');td2.style.cssText='font-family:JetBrains Mono,monospace;font-size:11px;color:var(--ice2)';td2.innerHTML=fmtMana(cd.mana_cost||'');
      const td3=document.createElement('td');if(tag){const s=document.createElement('span');s.className=`tag ${tag}`;s.textContent=shortType(cd.type_line||'');td3.appendChild(s);}else td3.textContent=shortType(cd.type_line||'');
      const td4=document.createElement('td');td4.style.cssText='font-family:JetBrains Mono,monospace;text-align:center;color:var(--text2)';td4.textContent=cd.cmc||0;
      const td5=document.createElement('td');
      const qc=document.createElement('div');qc.className='qc';
      const qm=document.createElement('button');qm.className='qb';qm.textContent='-';qm.addEventListener('click',()=>App.chQty(deck.id,c.name,-1));
      const qv=document.createElement('span');qv.className='qv';qv.textContent=c.qty;
      const qp=document.createElement('button');qp.className='qb';qp.textContent='+';qp.addEventListener('click',()=>App.chQty(deck.id,c.name,1));
      qc.append(qm,qv,qp);td5.appendChild(qc);
      const td6=document.createElement('td');td6.style.cssText='font-family:JetBrains Mono,monospace;font-size:11px;color:var(--green2)';td6.textContent=cd.prices?.eur?'€'+cd.prices.eur:'';
      const td7=document.createElement('td');
      const xb=document.createElement('button');xb.style.cssText='background:none;border:none;color:var(--text3);font-size:15px;cursor:pointer;padding:0 3px;line-height:1';
      xb.textContent='X';xb.addEventListener('click',()=>App.chQty(deck.id,c.name,-99));td7.appendChild(xb);
      tr.append(td0,td1,td2,td3,td4,td5,td6,td7);tbody.appendChild(tr);
    }
    if(!cards.length&&deck.cards.length){
      const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=8;
      td.style.padding='22px';td.innerHTML='<div class="empty-panel"><div class="empty-kicker">Deck View</div><div class="empty-ico">DB</div><div class="empty-ttl">No Cards Match Right Now</div><div class="empty-sub">Clear a filter or search term to bring the full deck back into view.</div></div>';tr.appendChild(td);tbody.appendChild(tr);
    }
  },

  _updHeader(deck){
    const topbarTagBar=document.getElementById('deck-mechanic-chips');
    if(topbarTagBar)topbarTagBar.innerHTML='';
    this.refreshTopbarStats(!deck);
  },

  renderSidebar(){
    const list=document.getElementById('deck-list');
    const decks=Store.decks;
    if(!decks.length){list.innerHTML='<div class="empty-panel" style="margin:8px"><div class="empty-kicker">Decks</div><div class="empty-ico">DB</div><div class="empty-ttl">No Decks Yet</div><div class="empty-sub">Import your first list or start a new brew to fill this shelf.</div></div>';MobileNav?.syncDeckButton?.();return;}
    list.innerHTML='';
    let dragSrc=null;
    for(const d of decks){
      const item=document.createElement('div');item.className='di'+(d.id===this.curId?' on':'');
      item.draggable=true;item.dataset.id=d.id;
      const count=d.cards.reduce((s,c)=>s+c.qty,0);
      const meta=document.createElement('div');meta.className='di-meta';
      const nameRow=document.createElement('div');nameRow.className='di-name-row';
      const name=document.createElement('div');name.className='di-name';name.textContent=d.name;
      name.title='Double-click to rename';
      name.addEventListener('dblclick',e=>{e.stopPropagation();App.loadDeck(d.id);setTimeout(()=>P.editDeck(),50);});
      nameRow.appendChild(name);
      if(d.localOnly){
        const badge=document.createElement('span');
        badge.className='di-badge local';
        badge.textContent='Local Draft';
        badge.title='Only on this device. Not syncing to cloud.';
        nameRow.appendChild(badge);
      }
      const sub=document.createElement('div');sub.className='di-sub';
      sub.textContent=count+' cards'+(d.commander?' Â· '+d.commander:'')+(d.partner?' + '+d.partner:'');
      // Show mechanics tags if any
      const mechs=(d.mechanics||[]);
      const tags=(d.tags||[]);
      if(mechs.length||tags.length){
        const tagRow=document.createElement('div');
        tagRow.style.cssText='display:flex;flex-wrap:wrap;gap:3px;margin-top:3px';
        [...mechs.slice(0,3),...tags.slice(0,2)].forEach(t=>{
          const chip=document.createElement('span');
          chip.style.cssText='font-family:JetBrains Mono,monospace;font-size:8px;padding:1px 5px;border-radius:3px;background:var(--bg4);border:1px solid var(--border2);color:var(--text3)';
          chip.textContent=t;tagRow.appendChild(chip);
        });
        meta.appendChild(tagRow);
      }
      meta.append(nameRow,sub);
      const del=document.createElement('button');del.className='di-del';del.textContent='X';del.addEventListener('click',e=>App.delDeck(d.id,e));
      /* context menu: duplicate */
      const dup=document.createElement('button');dup.className='di-del';dup.textContent='âŽ˜';
      dup.title='Duplicate deck';dup.style.marginRight='2px';
      dup.addEventListener('click',e=>{e.stopPropagation();App.dupDeck(d.id);});
      item.append(document.createTextNode('âš” '),meta,dup,del);
      item.addEventListener('click',e=>{if(e.target===del||e.target===dup)return;App.loadDeck(d.id);});
      /* drag-drop handlers */
      item.addEventListener('dragstart',e=>{dragSrc=item;item.classList.add('dragging');e.dataTransfer.effectAllowed='move';});
      item.addEventListener('dragend',()=>{item.classList.remove('dragging');list.querySelectorAll('.di').forEach(i=>i.classList.remove('drag-over'));});
      item.addEventListener('dragover',e=>{e.preventDefault();if(item!==dragSrc){list.querySelectorAll('.di').forEach(i=>i.classList.remove('drag-over'));item.classList.add('drag-over');}});
      item.addEventListener('drop',e=>{
        e.preventDefault();item.classList.remove('drag-over');
        if(!dragSrc||dragSrc===item)return;
        const ids=Array.from(list.children).map(el=>el.dataset.id);
        const fromIdx=ids.indexOf(dragSrc.dataset.id),toIdx=ids.indexOf(item.dataset.id);
        if(fromIdx<0||toIdx<0)return;
        const reordered=[...Store.decks];
        const [moved]=reordered.splice(fromIdx,1);reordered.splice(toIdx,0,moved);
        Store.decks=reordered;Store.saveDecks();App.renderSidebar();
      });
      list.appendChild(item);
    }
    MobileNav?.syncDeckButton?.();
  }
};

/* â•â•â• HELPERS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
function shortType(t){return String(t).replace('Legendary ','').replace('Basic ','').split('â€”')[0].trim();}
function getTypeTag(tl){
  const t=(tl||'').toLowerCase();
  if(t.includes('land'))return 'land';if(t.includes('instant'))return 'instant';
  if(t.includes('sorcery'))return 'sorcery';if(t.includes('artifact'))return 'artifact';
  if(t.includes('enchantment'))return 'enchantment';if(t.includes('planeswalker'))return 'planeswalker';
  if(t.includes('creature'))return 'creature';return '';
}

/* â•â•â• KEYBOARD â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){M.close();P.close();}
  if(e.key==='g'&&!e.ctrlKey&&!e.metaKey&&document.activeElement.tagName!=='INPUT')App.setView('grid');
  if(e.key==='l'&&!e.ctrlKey&&!e.metaKey&&document.activeElement.tagName!=='INPUT')App.setView('list');
  if(e.key==='1'&&!e.ctrlKey&&!e.metaKey&&document.activeElement.tagName!=='INPUT')Menu.go('forge');
  if(e.key==='2'&&!e.ctrlKey&&!e.metaKey&&document.activeElement.tagName!=='INPUT')Menu.go('vault');
});


/* â•â•â• BRACKET CALCULATOR â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const BracketCalc={
  _curDeckId:null,

  /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
     OFFICIAL GAME CHANGERS LIST (Wizards of the Coast)
     These cards, when present, push a deck toward Bracket 3+.
     1-3 copies = B3 eligible. Unrestricted use = B4.
     â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
  GAME_CHANGERS:[
    /* Fast Mana */
    "Mana Crypt","Mana Vault","Chrome Mox","Mox Diamond","Lotus Petal",
    "Jeweled Lotus","Grim Monolith","Mox Opal","Mox Amber",
    "Black Lotus","Mox Pearl","Mox Sapphire","Mox Jet","Mox Ruby","Mox Emerald",
    "Lion's Eye Diamond","Treasonous Ogre","Dockside Extortionist",
    /* Power Tutors */
    "Demonic Tutor","Vampiric Tutor","Imperial Seal","Lim-Dul's Vault",
    "Grim Tutor","Tainted Pact","Demonic Consultation",
    /* Game-Warping Draw/Value */
    "Timetwister","Wheel of Fortune","Necropotence","Ad Nauseam",
    "Underworld Breach","Peer into the Abyss",
    /* Hard Stax / Land Denial */
    "Armageddon","Ravages of War","Catastrophe","Jokulhaups","Obliterate",
    "Devastation","Ruination","Price of Glory","Back to Basics","Stasis",
    "Winter Orb","Static Orb","The Abyss","Smokestack",
    /* Extra Turns (chaining/looping) */
    "Time Warp","Temporal Manipulation","Capture of Jingzhou",
    "Walk the Aeons","Time Stretch","Beacon of Tomorrows",
    /* CEDH Win Conditions */
    "Thassa's Oracle","Hermit Druid","Doomsday"
  ],

  /* Two-card infinite combos â€” BOTH must be present */
  COMBO_PAIRS:[
    ["Splinter Twin","Pestermite"],["Splinter Twin","Deceiver Exarch"],
    ["Kiki-Jiki, Mirror Breaker","Pestermite"],
    ["Kiki-Jiki, Mirror Breaker","Zealous Conscripts"],
    ["Kiki-Jiki, Mirror Breaker","Deceiver Exarch"],
    ["Exquisite Blood","Sanguine Bond"],
    ["Heliod, Sun-Crowned","Walking Ballista"],
    ["Devoted Druid","Vizier of Remedies"],
    ["Isochron Scepter","Dramatic Reversal"],
    ["Power Artifact","Grim Monolith"],["Power Artifact","Basalt Monolith"],
    ["Rings of Brighthearth","Basalt Monolith"],
    ["Thassa's Oracle","Tainted Pact"],["Thassa's Oracle","Demonic Consultation"],
    ["Dualcaster Mage","Ghostly Flicker"],["Peregrine Drake","Ghostly Flicker"],
    ["Mikaeus, the Unhallowed","Triskelion"],["Mikaeus, the Unhallowed","Walking Ballista"],
    ["Auriok Salvagers","Lion's Eye Diamond"],["Worldgorger Dragon","Animate Dead"],
    ["Painter's Servant","Grindstone"],["Helm of Obedience","Rest in Peace"],
    ["Sanguine Bond","Exquisite Blood"],["Zur the Enchanter","Necropotence"],
    ["Savage Ventmaw","Aggravated Assault"],["Selvala, Heart of the Wilds","Aggravated Assault"],
    ["Blind Obedience","Exquisite Blood"],["Breath of Fury","Combat Celebrant"]
  ],

  /* Mass land denial â€” instant B4 */
  LAND_DENIAL:[
    "Armageddon","Ravages of War","Catastrophe","Jokulhaups","Obliterate",
    "Devastation","Ruination","Price of Glory","Boom // Bust","Cataclysm",
    "Decree of Annihilation","Wildfire","Balancing Act","Impending Disaster"
  ],

  /* Extra turns â€” sparse ok in B2/B3, chaining/looping = B4 */
  EXTRA_TURNS:[
    "Time Warp","Temporal Manipulation","Capture of Jingzhou","Nexus of Fate",
    "Walk the Aeons","Temporal Mastery","Time Stretch","Beacon of Tomorrows",
    "Alrund's Epiphany","Expropriate","Part the Waterveil","Savor the Moment",
    "Sage of Hours","Teferi, Master of Time"
  ],

  /* Tutors â€” sparse ok in B2/B3, many = B3/B4 */
  TUTORS:[
    "Mystical Tutor","Enlightened Tutor","Worldly Tutor","Personal Tutor",
    "Diabolic Tutor","Beseech the Mirror","Solve the Equation","Spellseeker",
    "Survival of the Fittest","Birthing Pod","Chord of Calling",
    "Green Sun's Zenith","Finale of Devastation","Gamble","Idyllic Tutor",
    "Sterling Grove","Trophy Mage","Trinket Mage","Fabricate","Diabolic Intent",
    "Scheming Symmetry","Dark Petition","Rune-Scarred Demon","Razaketh, the Foulblooded",
    "Tooth and Nail","Natural Order","Pattern of Rebirth"
  ],

  /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
     ANALYSE â€” returns bracket 1-5 using official rules
     â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
  analyse(deck){
    if(!deck)return null;
    const names=new Set(deck.cards.map(c=>c.name.toLowerCase()));

    /* Count Game Changers */
    const gcHits=this.GAME_CHANGERS.filter(gc=>names.has(gc.toLowerCase()));

    /* Detect two-card infinite combos */
    const comboHits=[];
    for(const [a,b] of this.COMBO_PAIRS){
      if(names.has(a.toLowerCase())&&names.has(b.toLowerCase()))
        comboHits.push(a+' + '+b);
    }

    /* Detect mass land denial */
    const landDenialHits=this.LAND_DENIAL.filter(c=>names.has(c.toLowerCase()));
    const hasMassLandDenial=landDenialHits.length>0;

    /* Extra turns */
    const extraTurnHits=this.EXTRA_TURNS.filter(c=>names.has(c.toLowerCase()));
    const extraTurnCount=extraTurnHits.length;

    /* Tutors */
    const tutorHits=this.TUTORS.filter(c=>names.has(c.toLowerCase()));
    const tutorCount=tutorHits.length;

    /* â”€â”€ Official Bracket Rules â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
       B5 = cEDH mindset (auto-flagged when optimised for meta)
       B4 = Game Changers unrestricted + combos + land denial
       B3 = Up to 3 Game Changers, no early combos, sparse extra turns
       B2 = No Game Changers, no combos, sparse tutors/extra turns
       B1 = No Game Changers, no combos, no extra turns, sparse tutors
       â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
    let bracket=1;
    const flags=[];

    /* B4/B5 triggers: any of these = at minimum B4 */
    if(hasMassLandDenial){
      bracket=Math.max(bracket,4);
      flags.push({sev:4,icon:'ðŸ’¥',label:'Mass Land Denial',
        desc:'Destroys all lands â€” forbidden below Bracket 4.',
        cards:landDenialHits});
    }
    if(comboHits.length>0){
      /* B3 allows combos only in "late game" context.
         If the combo can fire before turn 6 (cheap pieces) â†’ B4 */
      const earlyCombo=comboHits.some(pair=>{
        const [a]=pair.split(' + ');
        const cdA=Store.card(a)||{};
        return (cdA.cmc||99)<=3;
      });
      bracket=Math.max(bracket,earlyCombo?4:3);
      flags.push({sev:earlyCombo?4:3,icon:'â™¾',
        label:earlyCombo?'Early Infinite Combo (B4)':'Infinite Combo (B3+)',
        desc:earlyCombo?'Two-card infinite combo with cheap pieces â€” Bracket 4.':'Two-card infinite combo present. Keep to late-game for Bracket 3.',
        cards:comboHits});
    }
    if(gcHits.length>3){
      bracket=Math.max(bracket,4);
      flags.push({sev:4,icon:'âš¡',label:`${gcHits.length} Game Changers (B4)`,
        desc:`More than 3 Game Changers pushes the deck to Bracket 4.`,
        cards:gcHits});
    } else if(gcHits.length>0){
      bracket=Math.max(bracket,3);
      flags.push({sev:3,icon:'âš¡',label:`${gcHits.length}/3 Game Changers (B3)`,
        desc:`Up to 3 Game Changers allowed in Bracket 3. You have ${gcHits.length}.`,
        cards:gcHits});
    }

    /* Extra turns: sparse in B2/B3, chaining/looping = B4 */
    if(extraTurnCount>=3){
      bracket=Math.max(bracket,4);
      flags.push({sev:4,icon:'â°',label:`${extraTurnCount} Extra-Turn Cards (B4)`,
        desc:'Multiple extra-turn cards imply chaining â€” Bracket 4 territory.',
        cards:extraTurnHits});
    } else if(extraTurnCount>0){
      bracket=Math.max(bracket,2);
      flags.push({sev:2,icon:'â°',label:`${extraTurnCount} Extra-Turn Card${extraTurnCount>1?'s':''}`,
        desc:'Sparse extra turns are acceptable in B2/B3 â€” not intended to be chained.',
        cards:extraTurnHits});
    }

    /* Tutors: sparse in B2/B3, many = push toward B3 */
    if(tutorCount>=5){
      bracket=Math.max(bracket,3);
      flags.push({sev:3,icon:'ðŸ“–',label:`${tutorCount} Tutors (B3+)`,
        desc:`${tutorCount} tutors make the deck very consistent â€” Bracket 3.`,
        cards:tutorHits.slice(0,8)});
    } else if(tutorCount>0){
      bracket=Math.max(bracket,2);
      flags.push({sev:2,icon:'ðŸ“–',label:`${tutorCount} Tutor${tutorCount>1?'s':''}`,
        desc:'Sparse tutors are fine in B2/B3.',
        cards:tutorHits});
    }

    /* B5 heuristic: B4 deck that also has 5+ Game Changers AND 3+ tutors AND a combo */
    const isCedh=gcHits.length>=5&&tutorCount>=3&&comboHits.length>0;
    if(isCedh){bracket=5;}

    return{bracket,gcCount:gcHits.length,comboCount:comboHits.length,
           hasMassLandDenial,extraTurnCount,tutorCount,flags,deck};
  },

  _quickScore(cards){
    const names=new Set(cards.map(c=>c.name));
    const gc=this.GAME_CHANGERS.filter(g=>names.has(g)).length;
    const combo=this.COMBO_PAIRS.some(([a,b])=>names.has(a)&&names.has(b));
    const land=this.LAND_DENIAL.some(c=>names.has(c));
    if(land)return 4;
    if(gc>3||combo)return Math.max(gc>3?4:3,combo?3:1);
    if(gc>0)return 3;
    const tutors=this.TUTORS.filter(t=>names.has(t)).length;
    if(tutors>=5)return 3;
    if(tutors>0||this.EXTRA_TURNS.some(e=>names.has(e)))return 2;
    return 1;
  },

  BRACKET_COLORS:{1:"b1",2:"b2",3:"b3",4:"b4",5:"b4"},
  BRACKET_NAMES:{1:"Exhibition",2:"Core",3:"Upgraded",4:"Optimized",5:"cEDH"},
  BRACKET_SUMMARIES:{
    1:"No Game Changers, no combos, no mass land denial, no extra turns. Bracket 1 (Exhibition) â€” precon-level casual, play for fun and story.",
    2:"No Game Changers, no infinite combos. Sparse tutors and/or extra turns are fine. Bracket 2 (Core) â€” average preconstructed deck level.",
    3:"Up to 3 Game Changers present, or 5+ tutors, or late-game infinite combos. Bracket 3 (Upgraded) â€” souped-up, faster than precon. Discuss with your pod.",
    4:"4+ Game Changers, early infinite combos, mass land denial, or chained extra turns. Bracket 4 (Optimized) â€” bring your strongest, fully optimized deck.",
    5:"Full cEDH: optimized for the competitive metagame, combo-driven, maximally consistent. Bracket 5 (cEDH) â€” tournament mindset only."
  },

  render(){
    this._renderDeckList();
    [1,2,3,4,5].forEach(n=>{const c=document.getElementById("bcard-"+n);if(c)c.classList.remove("active");});
    if(this._curDeckId){
      const deck=Store.getDeck(this._curDeckId);
      if(deck)this._showAnalysis(deck);
    }
  },

  _renderDeckList(){
    const el=document.getElementById("bracket-deck-list");if(!el)return;
    if(!Store.decks.length){el.innerHTML='<div class="bracket-no-data">No decks imported yet.</div>';return;}
    el.innerHTML="";
    for(const d of Store.decks){
      const result=this.analyse(d);
      const b=result?.bracket||1;
      const bc=this.BRACKET_COLORS[b];
      const bn=this.BRACKET_NAMES[b];
      const row=document.createElement("div");
      row.className="bad-row"+(d.id===this._curDeckId?" active":"");
      const gcBadge=result?.gcCount>0?`<span style="font-family:'JetBrains Mono',monospace;font-size:9px;background:rgba(200,168,75,.1);color:var(--gold);border:1px solid var(--gold3);border-radius:3px;padding:1px 5px;margin-left:4px">${result.gcCount} GC</span>`:'';
      row.innerHTML=`
        <div class="bc-badge ${bc}">${b}</div>
        <div style="flex:1;min-width:0">
          <div class="bad-name">${esc(d.name)}${gcBadge}</div>
          <div class="bad-cmdr">${esc(d.commander||"No commander")}${d.partner?" + "+esc(d.partner):""}</div>
        </div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--${bc==="b1"?"green2":bc==="b2"?"ice":bc==="b3"?"gold":"crimson2"})">${esc(bn)}</div>
      `;
      row.addEventListener("click",()=>{this._curDeckId=d.id;this.render();});
      el.appendChild(row);
    }
  },

  _showAnalysis(deck){
    const result=this.analyse(deck);if(!result)return;
    const{bracket,flags,gcCount,comboCount,hasMassLandDenial,extraTurnCount,tutorCount}=result;
    const bc=this.BRACKET_COLORS[bracket];
    const bn=this.BRACKET_NAMES[bracket];
    document.getElementById("bracket-no-deck").style.display="none";
    document.getElementById("bracket-analysis").style.display="block";
    document.getElementById("br-deck-name").textContent=deck.name;

    /* Score line â€” show the key numbers */
    const parts=[];
    if(gcCount)parts.push(`${gcCount} Game Changer${gcCount>1?'s':''}`);
    if(comboCount)parts.push(`${comboCount} combo${comboCount>1?'s':''}`);
    if(tutorCount)parts.push(`${tutorCount} tutor${tutorCount>1?'s':''}`);
    if(extraTurnCount)parts.push(`${extraTurnCount} extra turn${extraTurnCount>1?'s':''}`);
    if(hasMassLandDenial)parts.push('mass land denial');
    document.getElementById("br-score").textContent=parts.length?parts.join(' Â· '):'No flags';

    document.getElementById("br-summary").textContent=this.BRACKET_SUMMARIES[bracket];
    const pill=document.getElementById("br-bracket-pill");
    pill.className="br-bracket-pill "+bc;
    pill.innerHTML=`<div class="bc-badge ${bc}" style="width:20px;height:20px;font-size:10px">${bracket}</div><span class="br-bracket-label">${bn}</span>`;
    [1,2,3,4,5].forEach(n=>{const c=document.getElementById("bcard-"+n);if(c)c.classList.toggle("active",n===bracket);});

    /* Flags */
    const flagsEl=document.getElementById("br-flags");flagsEl.innerHTML="";
    if(!flags.length){
      flagsEl.innerHTML='<div style="font-size:12px;color:var(--green2);padding:10px 0">âœ“ Clean deck â€” no flags found. Bracket 1 (Exhibition).</div>';
      return;
    }
    flags.sort((a,b)=>b.sev-a.sev);
    for(const f of flags){
      const colMap={4:'var(--crimson2)',3:'var(--gold)',2:'var(--ice)',1:'var(--text3)'};
      const col=colMap[f.sev]||'var(--text2)';
      const row=document.createElement("div");row.className="bf-row hit";
      row.innerHTML=`
        <div class="bf-icon">${f.icon}</div>
        <div style="flex:1">
          <div class="bf-name" style="color:${col}">${esc(f.label)}</div>
          <div class="bf-desc">${esc(f.desc)}</div>
          ${f.cards?.length?`<div class="bf-cards">${f.cards.map(c=>`<span class="bf-card-chip" style="border-color:${col};color:${col}">${esc(c)}</span>`).join('')}</div>`:''}
        </div>
        <div class="bc-badge ${this.BRACKET_COLORS[f.sev]}" style="flex-shrink:0">${f.sev}</div>
      `;
      flagsEl.appendChild(row);
    }

    /* Official rules reminder */
    const rulesEl=document.createElement('div');
    rulesEl.style.cssText='margin-top:14px;padding:12px;background:var(--bg3);border-radius:8px;border:1px solid var(--border);font-size:11px;color:var(--text3);line-height:1.8';
    rulesEl.innerHTML=`
      <div style="font-family:'Cinzel',serif;font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:var(--text2);margin-bottom:6px">Official Bracket Rules</div>
      <div><span style="color:var(--green2)">B1</span> â€” No Game Changers Â· No combos Â· No extra turns Â· No land denial Â· Sparse tutors</div>
      <div><span style="color:var(--ice)">B2</span> â€” No Game Changers Â· No combos Â· Sparse tutors/extra turns OK</div>
      <div><span style="color:var(--gold)">B3</span> â€” Up to 3 Game Changers Â· No early combos Â· No mass land denial Â· Extra turns not chained</div>
      <div><span style="color:var(--crimson2)">B4</span> â€” 4+ Game Changers Â· Combos Â· Mass land denial Â· Chained extra turns</div>
      <div><span style="color:var(--crimson2)">B5</span> â€” cEDH: competitive metagame mindset, no deck-building restrictions</div>
    `;
    flagsEl.appendChild(rulesEl);
  },

  selectBracket(n){
    [1,2,3,4,5].forEach(i=>{const c=document.getElementById("bcard-"+i);if(c)c.classList.toggle("active",i===n);});
  }
};


/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   CONFIG â€” loaded from localStorage, set via Settings panel
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
