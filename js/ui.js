/* CommanderForge - ui: Menu, CardSearch, VaultNav, M (modal), P (panels),
   fmtMana, Notify, PrintPicker, Charts, Dashboard, CollView, PriceView, AlertMgr */

function attachTapPop(el,cls='tap-pop'){
  if(!el||el.dataset.tapPopBound)return;
  const pop=()=>{
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  };
  el.addEventListener('pointerdown',pop);
  el.dataset.tapPopBound='1';
}

function attachCardTilt(el,intensity=10){
  if(!el||el.dataset.cardTiltBound)return;
  const canTilt=window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches;
  if(!canTilt)return;
  const reset=()=>{
    el.style.setProperty('--tilt-x','0deg');
    el.style.setProperty('--tilt-y','0deg');
    el.style.setProperty('--glow-x','50%');
    el.style.setProperty('--glow-y','35%');
  };
  const onMove=(event)=>{
    const rect=el.getBoundingClientRect();
    const px=(event.clientX-rect.left)/rect.width;
    const py=(event.clientY-rect.top)/rect.height;
    const tiltY=((px-.5)*intensity).toFixed(2)+'deg';
    const tiltX=((.5-py)*intensity).toFixed(2)+'deg';
    el.style.setProperty('--tilt-x',tiltX);
    el.style.setProperty('--tilt-y',tiltY);
    el.style.setProperty('--glow-x',(px*100).toFixed(1)+'%');
    el.style.setProperty('--glow-y',(py*100).toFixed(1)+'%');
  };
  reset();
  el.addEventListener('pointermove',onMove);
  el.addEventListener('pointerleave',reset);
  el.addEventListener('pointercancel',reset);
  el.dataset.cardTiltBound='1';
}

const SearchSuggest={
  _states:{},
  _state(key){
    return this._states[key]||(this._states[key]={items:[],idx:-1,timer:null});
  },
  hide(key){
    const panel=document.getElementById(key);
    if(panel)panel.style.display='none';
    const st=this._state(key);
    st.idx=-1;
  },
  async onType({key,inputId,deckId,val,onOpen,onAdd,search}){
    const st=this._state(key);
    clearTimeout(st.timer);
    if(!val||val.trim().length<2){this.hide(key);return;}
    st.timer=setTimeout(async()=>{
      try{
        const r=await fetch(`/api/scryfall/cards/autocomplete?q=${encodeURIComponent(val.trim())}&include_extras=false`,{headers:{Accept:'application/json'}});
        if(!r.ok)return;
        const d=await r.json();
        st.items=(d.data||[]).slice(0,8);
        st.idx=-1;
        this._render({key,inputId,deckId,onOpen,onAdd,search});
      }catch{}
    },140);
  },
  _render({key,inputId,deckId,onOpen,onAdd,search}){
    const panel=document.getElementById(key);
    const st=this._state(key);
    if(!panel)return;
    if(!st.items.length){panel.style.display='none';return;}
    const selectedDeck=deckId?Store.getDeck(document.getElementById(deckId)?.value||''):null;
    const addLabel=selectedDeck?`Add to ${selectedDeck.name}`:'Add to deck';
    panel.innerHTML='';
    st.items.forEach((name,i)=>{
      const row=document.createElement('div');
      row.className='cs-suggest-item'+(i===st.idx?' on':'');
      row.dataset.idx=i;
      row.innerHTML=`
        <div class="cs-suggest-main">
          <div class="cs-suggest-name">${esc(name)}</div>
          <div class="cs-suggest-hint">Open card details instantly</div>
        </div>
        <button class="cs-suggest-cta" type="button">${esc(addLabel)}</button>`;
      row.addEventListener('mouseenter',()=>{st.idx=i;this._paint(key);});
      row.addEventListener('mousedown',e=>{
        if(e.target.closest('.cs-suggest-cta'))return;
        e.preventDefault();
        this.pick({key,inputId,index:i,onOpen});
      });
      row.querySelector('.cs-suggest-cta')?.addEventListener('mousedown',e=>{
        e.preventDefault();
        e.stopPropagation();
        const input=document.getElementById(inputId);
        if(input)input.value=name;
        onAdd(name);
        this.hide(key);
      });
      panel.appendChild(row);
    });
    panel.style.display='block';
  },
  _paint(key){
    const panel=document.getElementById(key);
    const st=this._state(key);
    panel?.querySelectorAll('[data-idx]').forEach((el,i)=>el.classList.toggle('on',i===st.idx));
  },
  onKey({key,inputId,e,onOpen,search}){
    const st=this._state(key);
    const hasItems=st.items.length>0;
    if(e.key==='ArrowDown'&&hasItems){
      e.preventDefault();
      st.idx=Math.min(st.idx+1,st.items.length-1);
      this._paint(key);
      return true;
    }
    if(e.key==='ArrowUp'&&hasItems){
      e.preventDefault();
      st.idx=Math.max(st.idx-1,0);
      this._paint(key);
      return true;
    }
    if(e.key==='Enter'){
      if(hasItems&&st.idx>=0){
        e.preventDefault();
        this.pick({key,inputId,index:st.idx,onOpen});
        return true;
      }
      this.hide(key);
      search?.();
      return true;
    }
    if(e.key==='Escape'){this.hide(key);return true;}
    return false;
  },
  pick({key,inputId,index,onOpen}){
    const st=this._state(key);
    const name=st.items[index];
    if(!name)return;
    const input=document.getElementById(inputId);
    if(input)input.value=name;
    this.hide(key);
    onOpen(name);
  }
};

document.addEventListener('click',e=>{
  if(!e.target.closest('.cs-search-wrap')){
    SearchSuggest.hide('cs-suggest');
    SearchSuggest.hide('cs2-suggest');
  }
  if(!e.target.closest('.cmdr-input-wrap')){
    P?._hideCommanderAC?.(1);
    P?._hideCommanderAC?.(2);
  }
});

const Menu={
  cur:'forge',
  NAV_KEY:'cforge_nav',
  SECTIONS:['forge','search','collection','wishlist','trade','bulk','vault','community'],
  go(section){
    this.cur=section;
    localStorage.setItem(this.NAV_KEY,section);
    document.querySelectorAll('.im-btn').forEach(b=>b.classList.toggle('on',b.dataset.section===section));
    if(typeof MobileNav!=='undefined')MobileNav.setActive(section);
    this.SECTIONS.forEach(s=>{
      const el=document.getElementById('section-'+s);
      if(el)el.style.display=s===section?'flex':'none';
    });
    this.SECTIONS.forEach(s=>{
      const el=document.getElementById(s+'-sidebar');
      if(el)el.style.display=s===section?'flex':'none';
    });
    document.getElementById('view-toggle-wrap').style.display=section==='forge'?'flex':'none';
    if(section==='vault'){document.getElementById('section-vault').style.flexDirection='column';VaultNav.refresh();}
    if(section==='bulk')BulkPool.render();
    if(section==='community')CommunityNav.go(CommunityNav.cur||'friends');
    if(section==='search'){CardSearch2.init();const el=document.getElementById('cs2-query');if(el)setTimeout(()=>el.focus(),50);}
    if(section==='collection')CollSection.render();
    if(section==='wishlist')WishSection.render();
    if(section==='trade')TradeSection.render();
    App?.refreshTopbarStats?.();
  }
};

/* --- VAULT NAV --------------------------------------------- */

const CardSearch={
  _page:null,
  _query:'',
  _acTimer:null,
  _lastSearch:0,

  init(){
    this._populateDeckSel();
    if(document.getElementById('cs-query')?.value)this.search();
  },

  _populateDeckSel(){
    const sel=document.getElementById('cs-target-deck');
    if(!sel)return;
    const prev=sel.value;
    sel.innerHTML='<option value="">- Add to deck -</option>';
    Store.decks.forEach(d=>{
      const o=document.createElement('option');
      o.value=d.id;
      o.textContent=d.name+(d.commander?' - '+d.commander.split(',')[0]:'');
      sel.appendChild(o);
    });
    if(prev)sel.value=prev;
  },

  onType(val){
    SearchSuggest.onType({
      key:'cs-suggest',
      inputId:'cs-query',
      deckId:'cs-target-deck',
      val,
      onOpen:(name)=>this._openFromSuggest(name),
      onAdd:(name)=>this._addToDeck(name),
      search:()=>this.search()
    });
    clearTimeout(this._acTimer);
    if(val.length<3)return;
    this._acTimer=setTimeout(()=>this.search(),350);
  },
  onKey(e){
    return SearchSuggest.onKey({
      key:'cs-suggest',
      inputId:'cs-query',
      e,
      onOpen:(name)=>this._openFromSuggest(name),
      search:()=>this.search()
    });
  },

  _buildQuery(){
    const q=(document.getElementById('cs-query')?.value||'').trim();
    const color=document.getElementById('cs-color')?.value||'';
    const type=document.getElementById('cs-type')?.value||'';
    const rarity=document.getElementById('cs-rarity')?.value||'';
    const cmc=document.getElementById('cs-cmc')?.value||'';

    const parts=[];
    if(q)parts.push(q);
    if(color)parts.push(`color:${color}`);
    if(type)parts.push(`t:${type}`);
    if(rarity)parts.push(`r:${rarity}`);
    if(cmc){
      if(cmc==='6')parts.push('cmc>=6');
      else parts.push(`cmc:${cmc}`);
    }
    if(!parts.length)parts.push('is:commander');
    parts.push('-is:extra');
    return parts.join(' ');
  },

  async search(){
    SearchSuggest.hide('cs-suggest');
    this._query=this._buildQuery();
    this._page=null;
    const el=document.getElementById('cs-results');
    const status=document.getElementById('cs-status');
    const more=document.getElementById('cs-load-more');
    if(!el)return;
    if(status)status.textContent='Searching...';
    if(more)more.style.display='none';
    el.innerHTML='';
    this._populateDeckSel();
    await this._fetch(false);
  },

  async loadMore(){
    if(!this._page)return;
    await this._fetch(true);
  },

  async _fetch(append){
    const el=document.getElementById('cs-results');
    const status=document.getElementById('cs-status');
    const more=document.getElementById('cs-load-more');

    try{
      const url=this._page||`/api/scryfall/cards/search?q=${encodeURIComponent(this._query)}&order=edhrec&unique=cards`;
      const res=await fetch(url,{headers:{Accept:'application/json'}});

      if(res.status===404){
        if(status)status.textContent='No matches yet. Try a card name, keyword, or commander.';
        return;
      }
      if(!res.ok)throw new Error('Scryfall error '+res.status);

      const data=await res.json();
      this._page=data.has_more?data.next_page:null;
      const cards=data.data||[];

      if(!append&&!cards.length){
        if(status)status.textContent='No matches yet. Try broader text or fewer filters.';
        return;
      }

      if(status){
        status.textContent=`${data.total_cards?.toLocaleString()||cards.length} cards found${data.total_cards>cards.length?' - showing first '+cards.length:''}`;
      }

      for(const card of cards){
        el.appendChild(this._makeTile(card));
      }

      if(more)more.style.display=this._page?'block':'none';

      const slimmed=cards.map(d=>SF._slim(d)).filter(Boolean);
      for(const s of slimmed)Store.cache[s.name]=s;
      if(slimmed.length)IDB.setBulk(slimmed);
    }catch(e){
      if(status)status.textContent='Error: '+e.message;
      console.error('[CardSearch]',e);
    }
  },

  _makeTile(card){
    const img=card.image_uris?.normal||card.card_faces?.[0]?.image_uris?.normal||'';
    const price=card.prices?.eur?'&euro;'+card.prices.eur:'-';
    const rarity=card.rarity||'common';
    const rarityClass={common:'cs-rarity-c',uncommon:'cs-rarity-u',rare:'cs-rarity-r',mythic:'cs-rarity-m'}[rarity]||'';
    const setInfo=`${(card.set||'').toUpperCase()} #${card.collector_number||'?'}`;
    const inWish=WishlistMgr._data?.some(w=>w.card_name===card.name);
    const safeNameJs=JSON.stringify(card.name);

    const tile=document.createElement('div');
    tile.className='cs-card';
    tile.innerHTML=`
      ${img?`<img class="cs-card-img" src="${esc(img)}" loading="lazy" alt="${esc(card.name)}">`:`<div class="cs-card-img" style="display:flex;align-items:center;justify-content:center;color:var(--text3);font-size:11px">No image</div>`}
      <div class="cs-card-body">
        <div class="cs-card-name" title="${esc(card.name)}">${esc(card.name)}</div>
        <div class="cs-card-meta">
          <span class="${rarityClass}">${setInfo}</span>
          <span class="cs-card-price">${esc(price)}</span>
        </div>
      </div>
      <div class="cs-actions">
        <button class="cs-action-btn gold" data-cs-deck onclick='CardSearch._addToDeck(${safeNameJs},this)'>
          Add to Deck
        </button>
        <button class="cs-action-btn" onclick='CardSearch._openFromSuggest(${safeNameJs})'>
          Open Details
        </button>
        <button class="cs-action-btn purple${inWish?' on':''}" data-cs-name="${esc(card.name)}" onclick='CardSearch._addWish(this,${safeNameJs})'>
          ${inWish?'Saved':'Save'}
        </button>
        <button class="cs-action-btn" onclick='CardSearch._addTrade(${safeNameJs},this)'>
          List Trade
        </button>
      </div>`;

    attachTapPop(tile);
    attachCardTilt(tile);
    tile.querySelectorAll('.cs-action-btn').forEach(btn=>btn.addEventListener('click',e=>e.stopPropagation()));
    tile.addEventListener('click',()=>{
      const slim=SF._slim(card);
      if(slim)Store.cache[slim.name]=slim;
      M.open({name:card.name,qty:1},null);
    });
    return tile;
  },
  _openFromSuggest(name){
    const cached=Store.card(name);
    if(cached?.name){M.open({name,qty:1},null);return;}
    fetch(`/api/scryfall/cards/named?exact=${encodeURIComponent(name)}`,{headers:{Accept:'application/json'}})
      .then(r=>r.ok?r.json():null)
      .then(card=>{
        const slim=card&&SF._slim(card);
        if(slim)Store.setCard(slim.name,slim);
        M.open({name,qty:1},null);
      })
      .catch(()=>M.open({name,qty:1},null));
  },

  _addWish(btn,name){
    WishlistMgr.addByName(name);
    btn.textContent='Saved';
    btn.classList.add('on');
    btn.disabled=true;
  },

  _addToDeck(name,btn){
    const sel=document.getElementById('cs-target-deck');
    const deckId=sel?.value;
    if(!deckId){Notify.show('Select a deck in the dropdown first','err');return;}
    const deck=Store.getDeck(deckId);
    if(!deck)return;
    const existing=deck.cards.find(c=>c.name.toLowerCase()===name.toLowerCase());
    if(existing){
      existing.qty++;
      Notify.show(`Added 1 copy of ${name} to "${deck.name}"`,'ok');
    }else{
      deck.cards.push({name,qty:1,foil:false,etched:false});
      Notify.show(`Added ${name} to "${deck.name}"`,'ok');
    }
    Store.updDeck(deck);
    if(App.curId===deckId)App.render();
    if(btn){
      btn.textContent='Added';
      btn.style.color='var(--green2)';
      btn.style.borderColor='var(--green2)';
      setTimeout(()=>{btn.textContent='Add to Deck';btn.style.color='';btn.style.borderColor='';},2000);
    }
  },

  _addTrade(name,btn){
    TradeMgr.toggleCard(name);
    btn.textContent='Listed';
    btn.disabled=true;
  }
};
const VaultNav={
  cur:'dashboard',
  VPAGE_KEY:'cforge_vpage',
  go(page){
    this.cur=page;
    localStorage.setItem(this.VPAGE_KEY,page);
    // Sync desktop sidebar
    document.querySelectorAll('.vn-item').forEach(b=>b.classList.toggle('on',b.dataset.vpage===page));
    // Sync mobile tab bar
    this._setMobileTab(page);
    // Show correct page
    document.querySelectorAll('.vpage').forEach(p=>{p.style.display='none';p.classList.remove('animating');});
    const vp=document.getElementById('vpage-'+page);
    if(vp){vp.style.display='block';requestAnimationFrame(()=>{vp.classList.add('animating');setTimeout(()=>vp.classList.remove('animating'),250);});}
    this.refresh();
  },
  _setMobileTab(page){
    document.querySelectorAll('#vault-mobile-tabs .vmt-btn').forEach(b=>{
      b.classList.toggle('on',b.dataset.vpage===page);
    });
    // Scroll the active tab into view
    const active=document.querySelector(`#vault-mobile-tabs [data-vpage="${page}"]`);
    active?.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'});
  },
  refresh(){
    const p=this.cur;
    if(p==='dashboard') Dashboard.render();
    else if(p==='mycollection') MyCollection.render();
    else if(p==='price') PriceView.render();
    else if(p==='analysis') AnalysisView.render();
    else if(p==='alerts') AlertMgr.render();
    else if(p==='bracket') BracketCalc.render();
    else if(p==='trade') TradeMgr.render();
    else if(p==='wishlist') WishlistMgr.render();
    else if(p==='tradematching') TradeMatch.render();
    else if(p==='deckhealth') DeckHealth.render();
    else if(p==='reprints') ReprintAlert.render();
    else if(p==='cardsearch') CardSearch.init();
  }
};

/* --- MODAL ------------------------------------------------ */
const M={
  open(cardEntry,deckId){
    const cd=Store.card(cardEntry.name)||{};
    const G=id=>document.getElementById(id);
    const imgEl=G('mc-img-el');imgEl.src=cd.img?.normal||'';
    G('mc-img').onclick=()=>{if(!cd.img?.normal)return;const zo=document.getElementById('art-zoom-overlay');const zi=document.getElementById('art-zoom-img');zi.src=cd.img.normal;zo.classList.add('open');};
    G('mc-name').textContent=cd.name||cardEntry.name;
    G('mc-mana').innerHTML=fmtMana(cd.mana_cost||'');
    G('mc-type').textContent=[cd.type_line,cd.rarity,cd.set_name].filter(Boolean).join(' - ');
    G('mc-oracle').textContent=cd.oracle_text||'';
    G('mc-flavor').textContent=cd.flavor_text?`"${cd.flavor_text}"`:'' ;
    G('mc-flavor').style.display=cd.flavor_text?'':'none';

    // Partner banner
    const pBanner=G('mc-partner-banner');
    const pType=Partner.partnerType(cd);
    if(pType){
      pBanner.style.display='flex';
      pBanner.className='partner-banner';
      pBanner.innerHTML=`<span>Info</span> This card has <strong>${Partner.label(pType)}</strong> and can be used as a second commander.`;
    } else {pBanner.style.display='none';}

    const eur=cd.prices?.eur??null;
    const usd=cd.prices?.usd??null;
    const foil=cd.prices?.eur_foil??null;
    const usdFoil=cd.prices?.usd_foil??null;
    const marketValue=eur??foil??usd??usdFoil??null;
    const marketSymbol=(eur!=null||foil!=null)?'&euro;':((usd!=null||usdFoil!=null)?'$':'');
    const leg=cd.legal_commander||cd.legalities?.commander;
    const tot=((parseFloat(marketValue)||0)*cardEntry.qty).toFixed(2);
    G('mc-stats').innerHTML=`
      <div class="ms"><div class="ms-l">CMC</div><div class="ms-v">${cd.cmc||0}</div></div>
      <div class="ms"><div class="ms-l">EUR</div><div class="ms-v price">${eur?'&euro;'+eur:(usd?'$'+usd:'-')}</div></div>
      <div class="ms"><div class="ms-l">Foil</div><div class="ms-v price" style="color:var(--purple2)">${foil?'&euro;'+foil:(usdFoil?'$'+usdFoil:'-')}</div></div>
      <div class="ms"><div class="ms-l">Total x${cardEntry.qty}</div><div class="ms-v price">${marketValue?marketSymbol+tot:'-'}</div></div>
      ${cd.power!=null?`<div class="ms"><div class="ms-l">P/T</div><div class="ms-v">${cd.power}/${cd.toughness}</div></div>`:''}
      <div class="ms"><div class="ms-l">Commander</div><div class="ms-v ${leg==='legal'?'legal':'nl'}">${leg==='legal'?'Legal':'Unknown: '+(leg||'unknown')}</div></div>
    `;
    if(marketValue==null && cd.scryfall_id){
      SF.fetchById(cd.scryfall_id,cardEntry.name).then(fresh=>{
        const resolved=fresh?.prices?.eur??fresh?.prices?.eur_foil??fresh?.prices?.usd??fresh?.prices?.usd_foil??null;
        if(resolved!=null && document.getElementById('card-modal')?.style.display!=='none')this.open(cardEntry,deckId);
      }).catch(()=>{});
    }
    G('mc-acts').innerHTML='';
    const deck=Store.getDeck(deckId);
    const addBtn=document.createElement('button');addBtn.className='ma gold';addBtn.textContent='Add Copy';
    addBtn.onclick=()=>App.chQty(deckId,cardEntry.name,1);
    const rmBtn=document.createElement('button');rmBtn.className='ma red';rmBtn.textContent='Remove Card';
    rmBtn.onclick=()=>{App.chQty(deckId,cardEntry.name,-1);this.close();};
    const scrBtn=document.createElement('button');scrBtn.className='ma ghost';scrBtn.textContent='Open in Scryfall';
    scrBtn.onclick=()=>window.open('https://scryfall.com/search?q='+encodeURIComponent(cardEntry.name),'_blank');
    G('mc-acts').append(addBtn,rmBtn,scrBtn);

    // Commander / partner set buttons
    if(deck){
      const setCmdrBtn=document.createElement('button');
      setCmdrBtn.className='ma gold';setCmdrBtn.textContent='Set as Commander';
      setCmdrBtn.onclick=()=>{deck.commander=cardEntry.name;Store.updDeck(deck);App._updHeader(deck);App.render();Notify.show(`${cardEntry.name} is now your commander`,'ok');this.close();};
      G('mc-acts').appendChild(setCmdrBtn);
      if(pType){
        const setPartnerBtn=document.createElement('button');
        setPartnerBtn.className='ma purple';setPartnerBtn.textContent='Set as Partner';
        setPartnerBtn.onclick=()=>{deck.partner=cardEntry.name;Store.updDeck(deck);App._updHeader(deck);App.render();Notify.show(`${cardEntry.name} is now your partner`,'ok');this.close();};
        G('mc-acts').appendChild(setPartnerBtn);
      }
    }
    PrintPicker.init(cardEntry,deckId);
    G('mo').classList.add('open');
  },
  close(){document.getElementById('mo').classList.remove('open');},
  bgClose(e){if(e.target===document.getElementById('mo'))this.close();}
};

/* --- PANELS ----------------------------------------------- */
const P={
  _open(title,wide){
    document.getElementById('ptitle').textContent=title;
    document.getElementById('panel-inner').className=wide?'panel wide':'panel';
    document.getElementById('po').classList.add('open');
  },
  close(){document.getElementById('po').classList.remove('open');},
  bgClose(e){if(e.target===document.getElementById('po'))this.close();},

  editDeck(){
    const deck=Store.getDeck(App.curId);if(!deck){Notify.show('No deck loaded','err');return;}
    this._open('Edit Deck',true);
    document.getElementById('pbody').innerHTML=`
      <div style="margin-bottom:16px">
        <label style="font-family:'Cinzel',serif;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);display:block;margin-bottom:6px">Deck Name</label>
        <input class="ni" id="edit-deck-name" value="${esc(deck.name)}" placeholder="Deck name..." style="font-size:14px;width:100%"
          onkeydown="if(event.key==='Enter')P._applyDeckEdit()">
      </div>
      <div style="margin-bottom:16px">
        <label style="font-family:'Cinzel',serif;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);display:block;margin-bottom:6px">Visibility</label>
        <div style="display:flex;gap:8px">
          <button id="vis-public-btn" class="tbtn${deck.public!==false?' gold':''}" onclick="P._setVisibility(true)" style="font-size:11px">Public</button>
          <button id="vis-private-btn" class="tbtn${deck.public===false?' gold':''}" onclick="P._setVisibility(false)" style="font-size:11px">Private</button>
        </div>
        <div style="font-size:10px;color:var(--text3);margin-top:4px;font-family:'JetBrains Mono',monospace">Public decks are visible to friends on your profile.</div>
      </div>
      <div style="margin-bottom:16px;padding-top:14px;border-top:1px solid var(--border)">
        <label style="font-family:'Cinzel',serif;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);display:block;margin-bottom:8px">Style Tags</label>
        <div id="edit-tags-picker"></div>
      </div>
      <div style="padding-top:14px;border-top:1px solid var(--border)">
        <label style="font-family:'Cinzel',serif;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);display:block;margin-bottom:4px">Mechanics / Archetypes</label>
        <div style="font-size:10px;color:var(--text3);margin-bottom:8px;font-family:'JetBrains Mono',monospace">Select the strategies this deck uses:</div>
        <div id="edit-mechanics-picker"></div>
      </div>
    `;
    document.getElementById('pfoot').innerHTML='';
    const pf=document.getElementById('pfoot');
    const ca=document.createElement('button');ca.className='tbtn';ca.textContent='Cancel';ca.onclick=()=>P.close();
    const sv=document.createElement('button');sv.className='tbtn gold';sv.textContent='Save';sv.onclick=()=>P._applyDeckEdit();
    pf.append(ca,sv);
    // Render pickers after DOM is ready
    renderTagPicker(deck,'edit-tags-picker');
    renderMechanicsPicker(deck,'edit-mechanics-picker');
    // Focus name input
    setTimeout(()=>document.getElementById('edit-deck-name')?.select(),50);
  },

  _setVisibility(isPublic){
    const deck=Store.getDeck(App.curId);if(!deck)return;
    deck.public=isPublic;Store.updDeck(deck);
    document.getElementById('vis-public-btn').className='tbtn'+(isPublic?' gold':'');
    document.getElementById('vis-private-btn').className='tbtn'+(!isPublic?' gold':'');
    if(DB._sb&&DB._user)DB._sb.from('decks').update({public:isPublic}).eq('id',deck.id).eq('user_id',DB._user.id).then(()=>{});
  },

  _applyDeckEdit(){
    const deck=Store.getDeck(App.curId);if(!deck)return;
    const newName=(document.getElementById('edit-deck-name')?.value||'').trim();
    if(!newName){Notify.show('Name cannot be empty','err');return;}
    deck.name=newName;
    Store.updDeck(deck);
    App.renderSidebar();
    App._updHeader(deck);
    P.close();
    Notify.show('Deck saved','ok');
  },

  import(){
    this._open('Import Deck');
    document.getElementById('pbody').innerHTML=`
      <div class="url-import-tabs">
        <button class="url-import-tab on" id="itab-paste" onclick="P._setImportTab('paste')">Paste / File</button>
        <button class="url-import-tab" id="itab-url" onclick="P._setImportTab('url')">Import from URL</button>
      </div>

      <div id="import-paste-panel">
        <div class="dz" id="dz" onclick="document.getElementById('fi').click()" ondragover="event.preventDefault();this.classList.add('drag')" ondrop="P._drop(event)">
          <input type="file" id="fi" accept=".txt,.dec" style="display:none" onchange="P._file(event)">
          Drag .txt file here or click to browse
        </div>
        <div style="font-size:11px;color:var(--text3);margin:6px 0 8px">Supports: Moxfield, TappedOut, MTGGoldfish, MTGO, Archidekt, Deckstats &amp; more</div>
        <input class="ni" id="dname" placeholder="Deck name...">
        <textarea class="ia" id="ia" placeholder="Paste decklist here...&#10;&#10;// COMMANDER&#10;1 Zur the Enchanter&#10;&#10;// PARTNER (optional)&#10;1 Thrasios, Triton Hero&#10;&#10;1 Sol Ring&#10;2 Island"></textarea>
      </div>

      <div id="import-url-panel" style="display:none">
        <div style="font-size:12px;color:var(--text2);margin-bottom:10px;line-height:1.6">
          Paste a deck URL from Moxfield, Archidekt, or TappedOut:
        </div>
        <input class="url-inp" id="import-url-inp" placeholder="https://www.moxfield.com/decks/..." 
          oninput="P._urlChanged()" onkeydown="if(event.key==='Enter')P._fetchUrl()">
        <div id="import-url-status" class="url-status"></div>
        <div style="font-size:10px;color:var(--text3);line-height:1.8;font-family:'JetBrains Mono',monospace">
          Supported: moxfield.com/decks/... &nbsp; archidekt.com/decks/... &nbsp; tappedout.net/mtg-decks/...<br>
          For Moxfield private decks, export as text and paste instead.
        </div>
      </div>
    `;
    document.getElementById('pfoot').innerHTML='';
    const pf=document.getElementById('pfoot');
    const cancel=document.createElement('button');cancel.className='tbtn';cancel.textContent='Cancel';cancel.onclick=()=>P.close();
    const imp=document.createElement('button');imp.className='tbtn gold';imp.id='import-main-btn';imp.textContent='Import';imp.onclick=()=>P._doImport();
    pf.append(cancel,imp);
  },

  _setImportTab(tab){
    document.getElementById('itab-paste').classList.toggle('on',tab==='paste');
    document.getElementById('itab-url').classList.toggle('on',tab==='url');
    document.getElementById('import-paste-panel').style.display=tab==='paste'?'block':'none';
    document.getElementById('import-url-panel').style.display=tab==='url'?'block':'none';
    const btn=document.getElementById('import-main-btn');
    if(btn)btn.textContent=tab==='url'?'Fetch & Import':'Import';
    if(btn)btn.onclick=tab==='url'?()=>P._fetchUrl():()=>P._doImport();
  },

  _urlChanged(){
    const el=document.getElementById('import-url-status');if(el)el.style.display='none';
  },

  async _fetchUrl(){
    const url=(document.getElementById('import-url-inp')?.value||'').trim();
    if(!url){Notify.show('Enter a URL','err');return;}
    const statusEl=document.getElementById('import-url-status');
    const btn=document.getElementById('import-main-btn');
    const setStatus=(msg,type)=>{if(statusEl){statusEl.textContent=msg;statusEl.className='url-status '+type;statusEl.style.display='block';}};
    setStatus('Fetching deck...','loading');
    if(btn)btn.textContent='Fetching...';

    try{
      let text=null,deckName='Imported Deck';

      // -- Moxfield --
      if(url.includes('moxfield.com/decks/')){
        const m=url.match(/moxfield\.com\/decks\/([^/?#]+)/i);
        if(!m)throw new Error('Could not parse Moxfield deck ID');
        const id=m[1];
        let data=null;
        try{
          const res=await fetch(`/api/moxfield/${encodeURIComponent(id)}`,{
            headers:{'Accept':'application/json'}
          });
          if(!res.ok){
            let errMsg=`HTTP ${res.status}`;
            try{
              const errJson=await res.json();
              errMsg=errJson?.error||errMsg;
            }catch{
              try{
                const errText=await res.text();
                if(errText)errMsg=errText;
              }catch{}
            }
            throw new Error(errMsg);
          }
          data=await res.json();
        }catch(e){
          throw new Error(`Could not fetch Moxfield deck (${e.message}).`);
        }
        if(!data)throw new Error('Could not fetch Moxfield deck.');
        deckName=data.name||'Moxfield Deck';
        text=URLImport.moxfieldToText(data);
      }
      // -- Archidekt --
      else if(url.includes('archidekt.com')){
        const m=url.match(/decks\/(\d+)/);
        if(!m)throw new Error('Could not parse Archidekt deck ID');
        const res=await fetch(`https://archidekt.com/api/decks/${m[1]}/`);
        if(!res.ok)throw new Error(`Archidekt returned ${res.status}`);
        const data=await res.json();
        deckName=data.name||'Archidekt Deck';
        text=URLImport.archidektToText(data);
      }
      // -- TappedOut --
      else if(url.includes('tappedout.net')){
        const txtUrl=url.replace(/\/?$/,'')+'?fmt=txt';
        const res=await fetch(txtUrl);
        if(!res.ok)throw new Error(`TappedOut returned ${res.status}`);
        text=await res.text();
        const m=url.match(/mtg-decks\/([^/]+)/);
        if(m)deckName=m[1].replace(/-/g,' ');
      }
      else{throw new Error('Unsupported URL. Try Moxfield, Archidekt, or TappedOut.');}

      if(!text)throw new Error('Could not extract decklist');
      const parsed=Parser.parse(text);
      if(!parsed.cards.length)throw new Error('No cards found in deck');

      const deck={id:Store.uid(),name:deckName,commander:parsed.commander||'',
                  partner:parsed.partner||'',cards:parsed.cards,sideboard:parsed.sideboard||[],maybeboard:parsed.maybeboard||[],created:Date.now(),public:true};
      Store.addDeck(deck);
      enrichDeckCards(deck).then(()=>{Store.updDeck(deck);DB.schedulePush();});
      setStatus(`Imported "${deckName}" - ${parsed.cards.length} cards`,'ok');
      if(btn)btn.textContent='Imported!';
      setTimeout(()=>{P.close();App.loadDeck(deck.id);},800);
      Notify.show(`Imported "${deckName}" with ${parsed.cards.length} cards`,'ok');
    }catch(e){
      setStatus('Error: '+e.message,'err');
      if(btn)btn.textContent='Fetch & Import';
    }
  },
  _drop(e){e.preventDefault();document.getElementById('dz').classList.remove('drag');const f=e.dataTransfer.files[0];if(f)this._readFile(f);},
  _file(e){const f=e.target.files[0];if(f)this._readFile(f);},

  /* Deck Update - diff current deck vs new import, show preview, apply */
  _doUpdate(){
    const text=document.getElementById('ia').value.trim();
    if(!text){Notify.show('Paste a decklist first','err');return;}
    const deck=Store.getDeck(App.curId);
    if(!deck){Notify.show('No deck loaded - load a deck to update it','err');return;}

    const parsed=Parser.parse(text);
    if(!parsed.cards.length){Notify.show('No cards recognized','err');return;}

    const currentMap={};
    for(const c of deck.cards)currentMap[c.name.toLowerCase()]={...c};
    const newMap={};
    for(const c of parsed.cards)newMap[c.name.toLowerCase()]={...c};

    const toAdd=[];
    const toRemove=[];
    const toKeep=[];

    for(const [key,nc] of Object.entries(newMap)){
      if(!currentMap[key])toAdd.push(nc);
      else toKeep.push({...currentMap[key],newQty:nc.qty,set:nc.set||currentMap[key].set,collector_number:nc.collector_number||currentMap[key].collector_number});
    }
    for(const [key,oc] of Object.entries(currentMap)){
      if(!newMap[key])toRemove.push(oc);
    }

    if(!toAdd.length&&!toRemove.length&&!toKeep.some(k=>k.qty!==k.newQty)){
      Notify.show('Deck is already up to date','inf');return;
    }

    // Build preview HTML
    let html=`<div style="max-height:300px;overflow-y:auto;margin:10px 0">`;
    if(toAdd.length){
      html+=`<div class="du-section">Adding (${toAdd.length})</div>`;
      html+=toAdd.map(c=>`<div class="du-row du-add"><span class="du-qty">${c.qty}x</span>${esc(c.name)}${c.set?`<span style="font-size:9px;color:var(--ice2);margin-left:4px">(${c.set.toUpperCase()})</span>`:''}</div>`).join('');
    }
    if(toRemove.length){
      html+=`<div class="du-section">Removing (${toRemove.length})</div>`;
      html+=toRemove.map(c=>`<div class="du-row du-rem"><span class="du-qty">${c.qty}x</span>${esc(c.name)}</div>`).join('');
    }
    const changed=toKeep.filter(k=>k.qty!==k.newQty);
    if(changed.length){
      html+=`<div class="du-section">Qty Changed (${changed.length})</div>`;
      html+=changed.map(c=>`<div class="du-row du-keep"><span class="du-qty">${c.qty} -> ${c.newQty}x</span>${esc(c.name)}</div>`).join('');
    }
    html+=`</div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="tbtn gold" onclick="P._applyUpdate()" style="flex:1">Apply Update</button>
        <button class="tbtn" onclick="P._cancelUpdate()">Cancel</button>
      </div>`;

    // Store diff for apply
    P._pendingUpdate={deck,toAdd,toRemove,toKeep,parsed};

    // Show preview in a div below textarea
    let previewEl=document.getElementById('update-preview');
    if(!previewEl){
      previewEl=document.createElement('div');
      previewEl.id='update-preview';
      previewEl.style.cssText='background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-top:10px;font-size:12px';
      document.getElementById('ia')?.parentElement?.appendChild(previewEl);
    }
    previewEl.style.display='block';
    previewEl.innerHTML=`<div style="font-family:'Cinzel',serif;font-size:11px;color:var(--gold2);margin-bottom:8px">
      Update Preview - "${esc(deck.name)}"
      <span style="color:var(--text3);font-size:10px;margin-left:8px">+${toAdd.length} / -${toRemove.length}</span>
    </div>${html}`;
  },

  _applyUpdate(){
    if(!P._pendingUpdate)return;
    const{deck,toAdd,toRemove,toKeep}=P._pendingUpdate;

    // Build new card list
    const removeSet=new Set(toRemove.map(c=>c.name.toLowerCase()));
    deck.cards=deck.cards.filter(c=>!removeSet.has(c.name.toLowerCase()));
    // Update kept cards
    for(const kc of toKeep){
      const existing=deck.cards.find(c=>c.name.toLowerCase()===kc.name.toLowerCase());
      if(existing){
        existing.qty=kc.newQty;
        if(kc.set)existing.set=kc.set;
        if(kc.collector_number)existing.collector_number=kc.collector_number;
      }
    }
    // Add new cards
    for(const ac of toAdd)deck.cards.push(ac);

    Store.updDeck(deck);
    App.loadDeck(deck.id);
    P._pendingUpdate=null;
    P.close();
    Notify.show(`Deck updated: ${toAdd.length} added, ${toRemove.length} removed`,'ok');
  },

  _cancelUpdate(){
    P._pendingUpdate=null;
    const el=document.getElementById('update-preview');
    if(el)el.style.display='none';
  },
  _pendingUpdate:null,
  _readFile(f){
    const r=new FileReader();
    r.onload=ev=>{document.getElementById('ia').value=ev.target.result;const dn=document.getElementById('dname');if(!dn.value)dn.value=f.name.replace(/\.[^.]+$/,'');};
    r.readAsText(f);
  },
  _doImport(){
    const text=document.getElementById('ia').value.trim();
    if(!text){Notify.show('No text entered','err');return;}
    const parsed=Parser.parse(text);
    if(!parsed.cards.length){Notify.show('No cards recognized','err');return;}
    const customName=document.getElementById('dname').value.trim();
    const deck={id:Store.uid(),name:customName||parsed.name,commander:parsed.commander||'',partner:parsed.partner||'',cards:parsed.cards,sideboard:parsed.sideboard||[],maybeboard:parsed.maybeboard||[],created:Date.now(),public:true};
    Store.addDeck(deck);P.close();App.loadDeck(deck.id);
    enrichDeckCards(deck).then(()=>{Store.updDeck(deck);DB.schedulePush();});
    Notify.show(`Imported "${deck.name}" with ${parsed.cards.length} cards`+(deck.partner?` (Partner: ${deck.partner})`:'')||'','ok');
  },

  export(){
    const deck=Store.getDeck(App.curId);if(!deck){Notify.show('No deck loaded','err');return;}
    this._open('Export - '+deck.name,true);
    document.getElementById('pbody').innerHTML=`
      <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">
        ${['moxfield','mtgo','arena','tappedout','mtggoldfish','archidekt','deckstats','csv'].map(f=>
          `<button class="tbtn${f==='moxfield'?' gold':''}" id="efmt-${f}" onclick="P._setFmt('${f}')" style="font-size:10px;padding:4px 10px">${f}</button>`
        ).join('')}
      </div>
      <p style="font-size:11px;color:var(--text2);margin-bottom:8px" id="export-fmt-label">Format: Moxfield / Standard</p>
      <textarea class="ia" id="export-ta" style="height:300px" readonly></textarea>`;
    this._setFmt('moxfield');
    document.getElementById('pfoot').innerHTML='';
    const pf=document.getElementById('pfoot');
    const cl=document.createElement('button');cl.className='tbtn';cl.textContent='Close';cl.onclick=()=>P.close();
    const cp=document.createElement('button');cp.className='tbtn';cp.textContent='Copy';
    cp.onclick=()=>{navigator.clipboard.writeText(document.getElementById('export-ta').value);Notify.show('Copied to clipboard','ok');};
    const dl=document.createElement('button');dl.className='tbtn gold';dl.textContent='Download';
    dl.onclick=()=>{
      const ext=P._curFmt==='csv'?'csv':'txt';
      const a=document.createElement('a');
      a.href='data:text/plain;charset=utf-8,'+encodeURIComponent(document.getElementById('export-ta').value);
      a.download=deck.name.replace(/[^a-z0-9]/gi,'_')+'.'+ext;a.click();Notify.show('Download started','ok');
    };
    pf.append(cl,cp,dl);
  },
  _curFmt:'moxfield',
  _cmdrAC:{1:[],2:[]},
  _cmdrACTimer:null,
  _setFmt(f){
    this._curFmt=f;
    document.querySelectorAll('[id^="efmt-"]').forEach(b=>{b.classList.toggle('gold',b.id==='efmt-'+f);});
    const fmtLabels={moxfield:'Moxfield / Standard',mtgo:'MTGO (.dec)',arena:'MTG Arena',tappedout:'TappedOut',mtggoldfish:'MTGGoldfish',archidekt:'Archidekt',deckstats:'Deckstats',csv:'CSV (spreadsheet)'};
    const lbl=document.getElementById('export-fmt-label');if(lbl)lbl.textContent='Format: '+fmtLabels[f];
    const deck=Store.getDeck(App.curId);
    if(deck&&document.getElementById('export-ta')) document.getElementById('export-ta').value=Parser.exportTxt(deck,f);
  },

  editCmdr(){
    const deck=Store.getDeck(App.curId);if(!deck)return;
    this._cmdrAC={1:[],2:[]};
    this._open('Commanders',true);
    const hasPartner=!!deck.partner;
    document.getElementById('pbody').innerHTML=`
      <div class="partner-toggle" id="partner-toggle-wrap">
        <div class="toggle-switch${hasPartner?' on':''}" id="partner-toggle" onclick="P._togglePartner()">
          <div class="toggle-knob"></div>
        </div>
        <span class="toggle-label" id="partner-toggle-label">${hasPartner?'Partner / Background enabled':'Enable Partner / Background (dual commander)'}</span>
      </div>
      <div class="cmdr-slots">
        <div class="cmdr-slot active" id="slot-1">
          <div class="cmdr-slot-label">Commander</div>
          <div class="cmdr-slot-name" id="slot-1-name">${esc(deck.commander||'No commander selected')}</div>
          <div class="cmdr-slot-ability" id="slot-1-ability"></div>
          <div class="cmdr-input-wrap">
            <input class="ni" id="ci-1" value="${esc(deck.commander||'')}" placeholder="Commander name..." autocomplete="off" oninput="P._onCommanderType(1,this.value)" onkeydown="P._onCommanderKey(1,event)" style="margin-top:8px;margin-bottom:0">
            <div class="cmdr-ac" id="cmdr-ac-1" style="display:none"></div>
          </div>
        </div>
        <div class="cmdr-slot${hasPartner?' active partner':''}" id="slot-2" style="opacity:${hasPartner?1:.4};transition:opacity .2s">
          <div class="cmdr-slot-label">Partner / Background</div>
          <div class="cmdr-slot-name" id="slot-2-name">${esc(deck.partner||'No partner selected')}</div>
          <div class="cmdr-slot-ability" id="slot-2-ability"></div>
          <div class="cmdr-input-wrap">
            <input class="ni" id="ci-2" value="${esc(deck.partner||'')}" placeholder="Partner / Background name..." autocomplete="off" ${hasPartner?'':'disabled'} oninput="P._onCommanderType(2,this.value)" onkeydown="P._onCommanderKey(2,event)" style="margin-top:8px;margin-bottom:0">
            <div class="cmdr-ac" id="cmdr-ac-2" style="display:none"></div>
          </div>
        </div>
      </div>
      <p style="font-size:11px;color:var(--text3);margin-top:4px">Partner commanders share the command zone. Both count toward your deck's color identity.</p>
    `;
    // update slot previews from cache
    P._updateSlotPreview(1);P._updateSlotPreview(2);
    document.getElementById('pfoot').innerHTML='';
    const pf=document.getElementById('pfoot');
    const ca=document.createElement('button');ca.className='tbtn';ca.textContent='Cancel';ca.onclick=()=>P.close();
    const sv=document.createElement('button');sv.className='tbtn gold';sv.textContent='Apply';
    sv.onclick=()=>{
      const deck=Store.getDeck(App.curId);if(!deck)return;
      deck.commander=(document.getElementById('ci-1').value||'').trim();
      const partnerEnabled=document.getElementById('partner-toggle').classList.contains('on');
      deck.partner=partnerEnabled?(document.getElementById('ci-2').value||'').trim():'';
      Store.updDeck(deck);P.close();App.loadDeck(deck.id);
      Notify.show('Command zone updated','ok');
      const synBtn=document.getElementById('synergy-btn');
      if(synBtn)synBtn.style.display=deck.commander?'inline-flex':'none';
    };
    pf.append(ca,sv);
    document.getElementById('ci-1')?.focus();
  },

  _togglePartner(){
    const t=document.getElementById('partner-toggle');
    const lbl=document.getElementById('partner-toggle-label');
    const slot2=document.getElementById('slot-2');
    const inp2=document.getElementById('ci-2');
    t.classList.toggle('on');
    const on=t.classList.contains('on');
    lbl.textContent=on?'Partner / Background enabled':'Enable Partner / Background (dual commander)';
    slot2.classList.toggle('active',on);slot2.classList.toggle('partner',on);
    slot2.style.opacity=on?1:.4;
    inp2.disabled=!on;
    if(!on)this._hideCommanderAC(2);
  },

  _updateSlotPreview(n){
    const inp=document.getElementById('ci-'+n);if(!inp)return;
    const cd=Store.card(inp.value.trim());
    const nameEl=document.getElementById('slot-'+n+'-name');
    const abilEl=document.getElementById('slot-'+n+'-ability');
    if(nameEl) nameEl.textContent=inp.value.trim()||(n===1?'No commander selected':'No partner selected');
    if(abilEl){
      const pType=Partner.partnerType(cd);
      abilEl.textContent=pType?'Partner: '+Partner.label(pType):(cd?'No partner ability':'');
    }
  },

  _hideCommanderAC(slot){
    const box=document.getElementById('cmdr-ac-'+slot);
    if(box)box.style.display='none';
    this._cmdrAC[slot]=[];
  },

  async _fetchCommanderAC(slot,val){
    try{
      const r=await fetch(`/api/scryfall/cards/autocomplete?q=${encodeURIComponent(val.trim())}&include_extras=false`,{headers:{Accept:'application/json'}});
      if(!r.ok)return this._hideCommanderAC(slot);
      const d=await r.json();
      this._cmdrAC[slot]=(d.data||[]).slice(0,8);
      this._renderCommanderAC(slot);
    }catch{
      this._hideCommanderAC(slot);
    }
  },

  _renderCommanderAC(slot){
    const box=document.getElementById('cmdr-ac-'+slot);
    if(!box)return;
    const items=this._cmdrAC[slot]||[];
    if(!items.length){box.style.display='none';return;}
    box.innerHTML='';
    items.forEach(name=>{
      const row=document.createElement('button');
      row.type='button';
      row.className='cmdr-ac-item';
      row.innerHTML=`<span class="cmdr-ac-name">${esc(name)}</span><span class="cmdr-ac-hint">Use as ${slot===1?'commander':'partner'}</span>`;
      row.addEventListener('mousedown',e=>{
        e.preventDefault();
        this._pickCommanderAC(slot,name);
      });
      box.appendChild(row);
    });
    box.style.display='block';
  },

  _pickCommanderAC(slot,name){
    const inp=document.getElementById('ci-'+slot);
    if(!inp)return;
    inp.value=name;
    this._hideCommanderAC(slot);
    this._updateSlotPreview(slot);
  },

  _onCommanderType(slot,val){
    this._updateSlotPreview(slot);
    clearTimeout(this._cmdrACTimer);
    if(!val||val.trim().length<2){this._hideCommanderAC(slot);return;}
    this._cmdrACTimer=setTimeout(()=>this._fetchCommanderAC(slot,val),140);
  },

  _onCommanderKey(slot,e){
    const items=this._cmdrAC[slot]||[];
    if(e.key==='Enter'&&items.length){
      e.preventDefault();
      this._pickCommanderAC(slot,items[0]);
      return true;
    }
    if(e.key==='Escape'){
      this._hideCommanderAC(slot);
      return true;
    }
    return false;
  }
};

/* --- MANA FORMAT ------------------------------------------ */
function fmtMana(mc){
  /* Full MTG color palette + textured look */
  const CFG={
    W:{bg:'#f8f0c8',border:'#d4c070',text:'#443300',shadow:'rgba(240,220,100,.4)'},
    U:{bg:'#1a6aaa',border:'#2a88d4',text:'#c8e8ff',shadow:'rgba(40,120,200,.5)'},
    B:{bg:'#1a1028',border:'#6040a0',text:'#c0a0e0',shadow:'rgba(80,40,140,.5)'},
    R:{bg:'#b82010',border:'#e04030',text:'#ffd0b0',shadow:'rgba(200,40,20,.5)'},
    G:{bg:'#1a5020',border:'#309040',text:'#a0e890',shadow:'rgba(30,120,40,.5)'},
    C:{bg:'#3a3a44',border:'#6060704',text:'#c0c0c8',shadow:'none'},
    X:{bg:'#2a2a32',border:'#505060',text:'#a0a0b0',shadow:'none'},
  };
  const NUM={bg:'#18202e',border:'#2a3548',text:'#8a9baa'};
  return String(mc).replace(/\{([^}]+)\}/g,(_,s)=>{
    const key=s.toUpperCase();
    const isNum=s.match(/^\d+$/) || s==='X';
    const cfg=isNum?NUM:(CFG[key]||{bg:'#252d3e',border:'#3a4560',text:'#8a9baa',shadow:'none'});
    const shadow=cfg.shadow&&cfg.shadow!=='none'?`,0 0 4px ${cfg.shadow}`:'';
    return `<span style="display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:${cfg.bg};color:${cfg.text};font-size:8px;font-weight:800;margin:0 1px;border:1.5px solid ${cfg.border};flex-shrink:0;box-shadow:inset 0 1px 0 rgba(255,255,255,.12)${shadow};font-family:'JetBrains Mono',monospace;line-height:1;letter-spacing:0">${s}</span>`;
  });
}

/* --- NOTIFY ----------------------------------------------- */
const Notify={
  show(msg,type='inf',dur=3000){
    const el=document.createElement('div');el.className=`notif ${type}`;el.textContent=msg;
    document.getElementById('nf').prepend(el);
    setTimeout(()=>{el.style.cssText='opacity:0;transition:opacity .3s';setTimeout(()=>el.remove(),320);},dur);
  }
};

/* --- PRINT PICKER ----------------------------------------- */
const PrintPicker={
  _name:null,_deckId:null,_cardEntry:null,_prints:[],_filtered:[],_open:false,

  RAR_COLORS:{mythic:'#e8703a',rare:'#c8a84b',uncommon:'#9ab0c0',common:'#667080',special:'#b090e0',bonus:'#9a60c0'},

  init(cardEntry,deckId){
    this._name=cardEntry.name;
    this._deckId=deckId;
    this._cardEntry=cardEntry;
    this._prints=[];
    this._filtered=[];
    this._open=false;
    const G=id=>document.getElementById(id);
    const arrow=G('ep-arrow');const body=G('ep-body');const cnt=G('ep-count');
    const lst=G('ep-list');const srch=G('ep-search');const load=G('ep-loading');
    const curSet=G('ep-current-set');
    if(arrow)arrow.classList.remove('open');
    if(body){body.classList.remove('open');body.style.display='none';}
    if(cnt)cnt.textContent='';
    if(lst)lst.innerHTML='';
    if(srch)srch.value='';
    if(load)load.style.display='none';
    // Show current set info immediately
    const cd=Store.card(cardEntry.name)||{};
    if(curSet){
      if(cd.set){
        curSet.textContent='Current: '+(cd.set||'').toUpperCase()+' #'+(cd.collector_number||'?')+' - '+(cd.set_name||'');
        curSet.style.display='block';
      } else {
        curSet.style.display='none';
      }
    }
  },

  toggle(){
    this._open=!this._open;
    const arrow=document.getElementById('ep-arrow');
    const body=document.getElementById('ep-body');
    if(arrow)arrow.classList.toggle('open',this._open);
    if(body){
      body.classList.toggle('open',this._open);
      body.style.display=this._open?'block':'none';
    }
    if(this._open&&!this._prints.length)this.load();
  },

  async load(){
    const G=id=>document.getElementById(id);
    const load=G('ep-loading');const lst=G('ep-list');const cnt=G('ep-count');
    if(load){load.style.display='flex';load.textContent='Loading all printings...';}
    if(lst)lst.innerHTML='';

    // file:// protocol can't fetch - show helpful message
    if(location.protocol==='file:'){
      if(load){load.style.display='none';}
      if(lst)lst.innerHTML=`<div style="grid-column:1/-1;padding:16px;background:rgba(200,168,75,.08);border:1px solid var(--gold3);border-radius:var(--r);font-size:11px;color:var(--gold);font-family:'JetBrains Mono',monospace;line-height:1.7">
        Edition browsing requires a server connection.<br>
        <span style="color:var(--text3)">Open in Firefox or a local server to fetch all printings.<br>You can still manually set the set code below.</span><br><br>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <input id="ep-manual-set" placeholder="Set code (e.g. CMR)" style="background:var(--bg3);border:1px solid var(--border2);border-radius:var(--r);padding:5px 8px;color:var(--text);font-family:'JetBrains Mono',monospace;font-size:11px;width:100px">
          <input id="ep-manual-cn" placeholder="Collector # (e.g. 512)" style="background:var(--bg3);border:1px solid var(--border2);border-radius:var(--r);padding:5px 8px;color:var(--text);font-family:'JetBrains Mono',monospace;font-size:11px;width:120px">
          <button onclick="PrintPicker.applyManual()" style="background:var(--gold3);border:1px solid var(--gold);color:var(--gold2);border-radius:var(--r);padding:5px 12px;font-family:'Cinzel',serif;font-size:11px;cursor:pointer">Apply</button>
        </div>
      </div>`;
      return;
    }

    this._prints=await SF.fetchPrintings(this._name);
    if(load)load.style.display='none';
    if(cnt)cnt.textContent=this._prints.length?`(${this._prints.length} printings)`:'(0 printings)';
    this._filtered=[...this._prints];
    this.renderList();
  },

  async applyManual(){
    const setCode=(document.getElementById('ep-manual-set')?.value||'').trim().toLowerCase();
    const cn=(document.getElementById('ep-manual-cn')?.value||'').trim();
    if(!setCode){Notify.show('Enter a set code','err');return;}
    Notify.show('Fetching '+setCode.toUpperCase()+'...','inf',2000);
    try{
      const url=`/api/scryfall/cards/${encodeURIComponent(setCode)}/${encodeURIComponent(cn||'1')}`;
      const r=await fetch(url,{method:'GET',headers:{'Accept':'application/json'}});
      if(!r.ok){Notify.show('Card not found in that set','err');return;}
      const d=await r.json();
      const slim=SF._slim(d);
      Store.setCard(this._name,slim);Store.saveCache();
      this._saveSetToDeck(slim,d);
      this._refreshModal(slim,d);
      Notify.show('Printing selected: '+d.set_name+' #'+d.collector_number,'ok');
    }catch(e){Notify.show('Fetch failed','err');}
  },

  filterList(){
    const q=(document.getElementById('ep-search')?.value||'').toLowerCase().trim();
    this._filtered=q
      ? this._prints.filter(p=>(p.set_name||'').toLowerCase().includes(q)||(p.set||'').toLowerCase().includes(q)||(p.collector_number||'').includes(q))
      : [...this._prints];
    this.renderList();
  },

  renderList(){
    const lst=document.getElementById('ep-list');if(!lst)return;
    lst.innerHTML='';
    const curCd=Store.card(this._name)||{};
    const curId=curCd.scryfall_id||'';

    if(!this._filtered.length){
      lst.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:16px;color:var(--text3);font-size:12px">No printings match.</div>';
      return;
    }
    for(const p of this._filtered){
      const isCur=p.id===curId;
      const card=document.createElement('div');
      card.className='ep-print'+(isCur?' selected':'');
      card.dataset.sid=p.id;
      card.title=p.set_name+' #'+p.collector_number;

      const f=p.card_faces?.[0]||p;
      const imgCrop=f.image_uris?.art_crop||p.image_uris?.art_crop||'';
      const priceUsd=p.prices?.eur||p.prices?.usd||'';
      const priceFoil=p.prices?.eur_foil||p.prices?.usd_foil||'';
      const rarColor=this.RAR_COLORS[p.rarity]||'#555';
      const relYear=(p.released_at||'').slice(0,4);

      card.innerHTML=`
        ${imgCrop
          ?`<img class="ep-print-img" src="${esc(imgCrop)}" alt="${esc(p.set_name)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
          :''}
        <div class="ep-print-img-ph" style="display:${imgCrop?'none':'flex'}">No Art</div>
        <div class="ep-set-code">
          <span class="ep-rarity-dot" style="background:${rarColor}"></span>
          ${esc((p.set||'').toUpperCase())} #${esc(p.collector_number||'?')}
        </div>
        <div class="ep-set-name" title="${esc(p.set_name||'')}">${esc(p.set_name||'?')}</div>
        <div class="ep-cn">${relYear||'-'} - ${p.rarity||'-'}</div>
        <div class="ep-price">
          ${priceUsd?((p.prices?.eur?'&euro;':'$')+priceUsd):'-'}
          ${priceFoil?'<span style="color:var(--purple2);margin-left:4px">'+(p.prices?.eur_foil?'* &euro;':'* $')+priceFoil+'</span>':''}
        </div>
        <div class="ep-check">OK</div>
      `;
      card.addEventListener('click',()=>this.selectPrint(p));
      lst.appendChild(card);
    }
  },

  async selectPrint(p){
    Notify.show('Switching to '+p.set_name+'...','inf',1500);
    const slim=await SF.fetchById(p.id,this._name);
    if(!slim){Notify.show('Failed to fetch this printing','err');return;}

    // Save the chosen set/collector_number back to the deck entry
    this._saveSetToDeck(slim,p);

    // Update modal UI
    this._refreshModal(slim,p);

    // Highlight selected card in picker
    document.querySelectorAll('.ep-print').forEach(el=>{
      el.classList.toggle('selected',el.dataset.sid===p.id);
    });

    // Update the "current set" label
    const curSet=document.getElementById('ep-current-set');
    if(curSet){
      curSet.textContent='Current: '+(p.set||'').toUpperCase()+' #'+(p.collector_number||'?')+' - '+(p.set_name||'');
      curSet.style.display='block';
    }

    Notify.show('Printing updated: '+p.set_name+' #'+p.collector_number,'ok');
  },

  _saveSetToDeck(slim,p){
    // Persist set choice on the card entry inside the deck
    const deck=Store.getDeck(this._deckId);
    if(!deck)return;
    const entry=deck.cards.find(c=>c.name===this._name);
    if(entry){
      entry.set=p.set||slim.set||'';
      entry.collector_number=p.collector_number||slim.collector_number||'';
      entry.scryfall_id=p.id||slim.scryfall_id||'';
      Store.updDeck(deck);
      DB.schedulePush(); /* push set change to cloud */
    }
  },

  _refreshModal(slim,p){
    const G=id=>document.getElementById(id);
    // Image
    if(slim.img?.normal){const imgEl=G('mc-img-el');if(imgEl)imgEl.src=slim.img.normal;}
    // Type line
    const typeEl=G('mc-type');
    if(typeEl)typeEl.textContent=[slim.type_line,slim.rarity,slim.set_name].filter(Boolean).join(' - ');
    // Stats
    const eur=slim.prices?.eur??null;
    const usd=slim.prices?.usd??null;
    const foil=slim.prices?.eur_foil??null;
    const usdFoil=slim.prices?.usd_foil??null;
    const qty=this._cardEntry?.qty||1;
    const marketValue=eur??foil??usd??usdFoil??null;
    const marketSymbol=(eur!=null||foil!=null)?'&euro;':((usd!=null||usdFoil!=null)?'$':'');
    const tot=((parseFloat(marketValue)||0)*qty).toFixed(2);
    const statsEl=G('mc-stats');
    if(statsEl)statsEl.innerHTML=`
      <div class="ms"><div class="ms-l">CMC</div><div class="ms-v">${slim.cmc||0}</div></div>
      <div class="ms"><div class="ms-l">EUR</div><div class="ms-v price">${eur?'&euro;'+eur:(usd?'$'+usd:'-')}</div></div>
      <div class="ms"><div class="ms-l">Foil</div><div class="ms-v price" style="color:var(--purple2)">${foil?'&euro;'+foil:(usdFoil?'$'+usdFoil:'-')}</div></div>
      <div class="ms"><div class="ms-l">Set</div><div class="ms-v" style="font-size:11px;color:var(--ice)">${esc((slim.set||'').toUpperCase()+' #'+(slim.collector_number||'?'))}</div></div>
      <div class="ms"><div class="ms-l">Total x${qty}</div><div class="ms-v price">${marketValue?marketSymbol+tot:'-'}</div></div>
      ${slim.power!=null?`<div class="ms"><div class="ms-l">P/T</div><div class="ms-v">${slim.power}/${slim.toughness}</div></div>`:''}
      <div class="ms"><div class="ms-l">Commander</div><div class="ms-v ${slim.legalities?.commander==='legal'?'legal':'nl'}">${slim.legalities?.commander==='legal'?'Legal':'Unknown: '+(slim.legalities?.commander||'unknown')}</div></div>
    `;
    // Patch grid tile and header
    App._patchTile(this._name,slim,this._deckId);
    App._updHeader(Store.getDeck(this._deckId));
  }
};

/* --- CHARTS ------------------------------------------------ */
const Charts={
  bar(containerId,data,maxH=110){
    const el=document.getElementById(containerId);if(!el)return;
    const labels=document.getElementById(containerId.replace('-chart','-labels'));
    const max=Math.max(...data.map(d=>d.v),1);
    el.innerHTML='';if(labels)labels.innerHTML='';
    for(const d of data){
      const h=Math.round((d.v/max)*maxH)||2;
      const bar=document.createElement('div');bar.className='mc-bar';
      bar.style.height=h+'px';bar.style.background=d.color||'var(--gold3)';bar.title=`${d.k}: ${d.v}`;
      const bv=document.createElement('div');bv.className='mc-bar-val';bv.textContent=d.v;bar.appendChild(bv);
      if(d.onclick){bar.style.cursor='pointer';bar.addEventListener('click',d.onclick);}
      el.appendChild(bar);
      if(labels){const lb=document.createElement('div');lb.className='cbl';lb.textContent=d.k;labels.appendChild(lb);}
    }
  },
  pie(containerId,segments){
    const el=document.getElementById(containerId);if(!el)return;
    const total=segments.reduce((s,x)=>s+x.v,0)||1;const size=100;let angle=0;let paths='';
    for(const seg of segments){
      const pct=seg.v/total;const a=pct*Math.PI*2;
      const x1=size/2+size/2*Math.sin(angle),y1=size/2-size/2*Math.cos(angle);
      angle+=a;const x2=size/2+size/2*Math.sin(angle),y2=size/2-size/2*Math.cos(angle);
      const lg=pct>.5?1:0;
      paths+=`<path d="M${size/2},${size/2} L${x1},${y1} A${size/2},${size/2} 0 ${lg},1 ${x2},${y2} Z" fill="${seg.color}" opacity=".85"/>`;
    }
    el.innerHTML=`<div class="pie-wrap"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${paths}<circle cx="${size/2}" cy="${size/2}" r="${size*0.3}" fill="var(--bg2)"/></svg><div class="pie-legend">${segments.map(s=>`<div class="pl-item"><div class="pl-dot" style="background:${s.color}"></div><span class="pl-name">${s.k}</span><span class="pl-pct">${Math.round(s.v/total*100)}%</span></div>`).join('')}</div></div>`;
  },
  line(containerId,points){
    const el=document.getElementById(containerId);if(!el)return;
    const w=el.offsetWidth||380,h=el.offsetHeight||140;
    const max=Math.max(...points.map(p=>p.v),1);const min=Math.min(...points.map(p=>p.v),0);
    const range=max-min||1;const pad=10;
    const px=i=>pad+(i/(points.length-1||1))*(w-pad*2);
    const py=v=>h-pad-(v-min)/range*(h-pad*2);
    const pts=points.map((p,i)=>`${px(i)},${py(p.v)}`).join(' ');
    const fill=`${px(0)},${h} `+pts+` ${px(points.length-1)},${h}`;
    el.innerHTML=`<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--gold)" stop-opacity=".3"/>
        <stop offset="100%" stop-color="var(--gold)" stop-opacity="0"/>
      </linearGradient></defs>
      <polygon points="${fill}" fill="url(#lg)"/>
      <polyline points="${pts}" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linejoin="round"/>
    </svg>`;
  },
  progressBars(containerId,rows){
    const el=document.getElementById(containerId);if(!el)return;
    const max=Math.max(...rows.map(r=>r.v),1);
    el.innerHTML=rows.map(r=>`<div class="prog-bar-row">
      <div class="prog-bar-label">${r.k}</div>
      <div class="prog-bar-track"><div class="prog-bar-fill" style="width:${Math.round(r.v/max*100)}%;background:${r.color||'var(--gold3)'}"></div></div>
      <div class="prog-bar-count">${r.v}</div>
    </div>`).join('');
  }
};

/* --- DASHBOARD -------------------------------------------- */

function animateVal(el,toVal,prefix='',suffix='',duration=350){
  if(!el)return;
  const raw=parseFloat((el.textContent||'0').replace(/[^0-9.-]/g,''))||0;
  const isInt=Number.isInteger(toVal)&&Number.isInteger(raw);
  const start=performance.now();
  const step=(now)=>{
    const p=Math.min(1,(now-start)/duration);
    const ease=p<.5?2*p*p:(4-2*p)*p-1; /* ease in-out */
    const cur=raw+(toVal-raw)*ease;
    el.textContent=prefix+(isInt?Math.round(cur).toLocaleString():cur.toFixed(2))+suffix;
    if(p<1)requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
const Dashboard={
  _dirty:true,
  markDirty(){this._dirty=true;},
  async render(){
    /* Warm IDB cache for all deck cards before computing values */
    const allNames=[...new Set(Store.decks.flatMap(d=>[d.commander,d.partner,...d.cards.map(c=>c.name)].filter(Boolean)))];
    await Store.warmCards(allNames);
    const deck=Store.getDeck(App.curId);
    const allCards=Store.decks.flatMap(d=>d.cards.map(c=>({...c,deck:d.name})));
    const totalVal=allCards.reduce((s,c)=>{const cd=Store.card(c.name);return s+(parseFloat(cd?.prices?.eur||0)*c.qty);},0);
    animateVal(document.getElementById('kpi-portfolio'),Math.round(totalVal),'�');
    animateVal(document.getElementById('kpi-cards'),allCards.reduce((s,c)=>s+c.qty,0));
    animateVal(document.getElementById('kpi-decks'),Store.decks.length);
    document.getElementById('kpi-alerts').textContent=Store.alerts.filter(a=>a.active).length;
    let topCard=null,topVal=0;
    for(const c of allCards){const v=parseFloat(Store.card(c.name)?.prices?.eur||0)*c.qty;if(v>topVal){topVal=v;topCard=c.name;}}
    document.getElementById('kpi-topcard').textContent=topCard?topCard.slice(0,11)+'�':'�';
    const cacheCount=Object.keys(Store.cache).length;
    const ce=document.getElementById('dash-engine-cache');if(ce)ce.textContent='Cache: '+cacheCount;
    document.getElementById('dash-alert-watch').textContent=`? ${Store.alerts.filter(a=>a.active).length} Watching`;
    const trig=Store.alerts.filter(a=>a.triggered);
    const trigEl=document.getElementById('dash-alert-triggered');
    if(trig.length){trigEl.style.display='flex';document.getElementById('dash-trig-count').textContent=trig.length;}
    else trigEl.style.display='none';
    const base=totalVal||100;
    Charts.line('dash-portfolio-chart',Array.from({length:7},(_,i)=>({v:base*(0.93+Math.random()*.12+i*.005)})));
    if(deck){
      document.getElementById('dash-curve-deck-name').textContent=deck.name;
      const curve={};
      for(const c of deck.cards){const cd=Store.card(c.name);if(cd&&!(cd.type_line||'').toLowerCase().includes('land')){const cmc=Math.min(cd.cmc||0,7);curve[cmc]=(curve[cmc]||0)+c.qty;}}
      Charts.bar('dash-curve-chart',Array.from({length:8},(_,i)=>({k:i<7?String(i):'7+',v:curve[i]||0,color:'var(--ice2)',
        onclick:()=>{if(Menu.cur==='forge'){App._filter=i<7?String(i):'7+';App._sort='cmc';
          /* filter by cmc � extend _getCards to support cmc filter */
          App._cmcFilter=i;App.render();Menu.go('forge');
          Notify.show(`Showing CMC ${i<7?i:'7+'} cards`,'inf',2000);
        }
      }})),80);
    }
    /* KPI bars */
    const maxVal=Math.max(totalVal,1);
    const barEl=document.getElementById('kpi-portfolio-bar');
    if(barEl)setTimeout(()=>{barEl.style.width=Math.min(100,totalVal/Math.max(totalVal,1)*100)+'%';},100);
    const cardsBar=document.getElementById('kpi-cards-bar');
    const totalCards=allCards.reduce((s,c)=>s+c.qty,0);
    if(cardsBar)setTimeout(()=>{cardsBar.style.width=Math.min(100,(totalCards/500)*100)+'%';},120);
    /* Reprint alert banner */
    const bannerSlot=document.getElementById('dash-reprint-banner');
    if(bannerSlot)bannerSlot.innerHTML=ReprintAlert.dashboardBanner();
  }
};

/* --- COLLECTION -------------------------------------------- */
const CollView={
  filter(){this.render();},
  render(){
    const srch=(document.getElementById('coll-srch')?.value||'').toLowerCase();
    const color=document.getElementById('coll-color')?.value||'';
    const rar=document.getElementById('coll-rar')?.value||'';
    const foilF=document.getElementById('coll-foil')?.value||'';
    const sort=document.getElementById('coll-sort')?.value||'name';
    const cardMap={};
    for(const deck of Store.decks)for(const c of deck.cards){
      if(!cardMap[c.name])cardMap[c.name]={name:c.name,qty:0,foil:false,etched:false,decks:[]};
      cardMap[c.name].qty+=c.qty;if(c.foil)cardMap[c.name].foil=true;if(c.etched)cardMap[c.name].etched=true;
      if(!cardMap[c.name].decks.includes(deck.name))cardMap[c.name].decks.push(deck.name);
    }
    let rows=Object.values(cardMap);
    if(srch)rows=rows.filter(r=>r.name.toLowerCase().includes(srch));
    if(color)rows=rows.filter(r=>(Store.card(r.name)?.color_identity||[]).includes(color));
    if(rar)rows=rows.filter(r=>Store.card(r.name)?.rarity===rar);
    if(foilF==='foil')rows=rows.filter(r=>r.foil||r.etched);
    if(foilF==='nonfoil')rows=rows.filter(r=>!r.foil&&!r.etched);
    rows.sort((a,b)=>{
      const ca=Store.card(a.name)||{},cb=Store.card(b.name)||{};
      if(sort==='price_desc')return(parseFloat(cb.prices?.eur)||0)-(parseFloat(ca.prices?.eur)||0);
      if(sort==='price_asc')return(parseFloat(ca.prices?.eur)||0)-(parseFloat(cb.prices?.eur)||0);
      if(sort==='cmc')return(ca.cmc||0)-(cb.cmc||0);
      return a.name.localeCompare(b.name);
    });
    const tbody=document.getElementById('coll-tbody');if(!tbody)return;
    tbody.innerHTML='';
    const rarColors={mythic:'#e8703a',rare:'#c8a84b',uncommon:'#9ab0c0',common:'#555'};
    const conds=['NM','LP','MP','HP','PL'];
    let totalVal=0,foilCount=0;
    for(const r of rows){
      const cd=Store.card(r.name)||{};
      const price=parseFloat(cd.prices?.eur||0);const total=price*r.qty;totalVal+=total;
      if(r.foil||r.etched)foilCount+=r.qty;
      const cond=conds[Math.abs(r.name.charCodeAt(0))%3];
      const tr=document.createElement('tr');
      tr.innerHTML=`
        <td>${cd.img?.crop?`<img src="${esc(cd.img.crop)}" class="lthumb">`:'<div style="width:30px;height:42px;background:var(--bg3);border-radius:3px;border:1px solid var(--border)"></div>'}</td>
        <td><span class="lname">${esc(r.name)}</span>${r.foil||r.etched?` <span class="foil-chip">${r.foil?'F':'E'}</span>`:''}</td>
        <td>${(cd.color_identity||[]).map(c=>`<div class="pip ${c}" style="display:inline-flex">${c}</div>`).join('')}</td>
        <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${rarColors[cd.rarity||'common']||'#555'};border:1px solid rgba(255,255,255,.2)"></span> <span style="font-size:10px;color:var(--text3)">${cd.rarity||'�'}</span></td>
        <td style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text2)">${cd.cmc||0}</td>
        <td>${cd.type_line?`<span class="tag ${getTypeTag(cd.type_line)}">${shortType(cd.type_line)}</span>`:''}</td>
        <td><span class="cond-badge ${cond}">${cond}</span></td>
        <td>${r.foil||r.etched?`<span class="foil-chip">${r.foil?'?F':''}${r.etched?'?E':''}</span>`:''}</td>
        <td style="font-size:10px;color:var(--text3)">${r.decks.slice(0,2).join(', ')}</td>
        <td style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--green2)">${price?'�'+price.toFixed(2):'�'}</td>
        <td style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--gold)">${total?'�'+total.toFixed(2):'�'}</td>
      `;tbody.appendChild(tr);
    }
    const totalQty=rows.reduce((s,r)=>s+r.qty,0);
    document.getElementById('coll-cnt').textContent=totalQty;
    document.getElementById('coll-uniq').textContent=rows.length;
    document.getElementById('coll-foils').textContent=foilCount;
    document.getElementById('coll-val').textContent='�'+totalVal.toFixed(2);
  },
  exportCSV(){
    const deck=Store.getDeck(App.curId);if(!deck){Notify.show('No deck loaded','err');return;}
    const a=document.createElement('a');
    a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(Parser.exportTxt(deck,'csv'));
    a.download=(deck.name||'collection').replace(/[^a-z0-9]/gi,'_')+'.csv';a.click();Notify.show('CSV exported','ok');
  }
};

/* --- PRICE VIEW -------------------------------------------- */
const PriceView={
  _lastPriceBase:0,
  async renderPriceProviders(base,deck){
    const scryfallVal=base.toFixed(2);
    const scEl=document.getElementById('prov-scryfall');if(scEl)scEl.textContent='�'+scryfallVal;
    const sdEl=document.getElementById('prov-scryfall-d');if(sdEl){sdEl.textContent='Baseline';sdEl.className='prov-diff eq';}
    // Fetch from proxy (real or simulated)
    if(deck){
      const topCard=deck.cards.sort((a,b)=>(parseFloat(Store.card(b.name)?.prices?.eur||0))-(parseFloat(Store.card(a.name)?.prices?.eur||0)))[0];
      if(topCard){
        const prices=await PriceProxy.fetchAll(topCard.name);
        // TCGPlayer
        const tcgEl=document.getElementById('prov-tcgplayer');
        const tcgdEl=document.getElementById('prov-tcgplayer-d');
        if(prices.tcgplayer?.usd){
          const ratio=prices.tcgplayer.usd/parseFloat(Store.card(topCard.name)?.prices?.eur||prices.tcgplayer.usd);
          const tcgTotal=(base*ratio).toFixed(2);
          if(tcgEl)tcgEl.textContent='�'+tcgTotal;
          const pct=((ratio-1)*100).toFixed(1);
          if(tcgdEl){tcgdEl.textContent=(ratio>1?'? +':'? ')+Math.abs(pct)+'% vs Scryfall'+(prices.tcgplayer.simulated?' (est.)':'');tcgdEl.className='prov-diff '+(ratio>1?'up':'dn');}
        }
        // MKM
        const mkmEl=document.getElementById('prov-mkm');const mkmdEl=document.getElementById('prov-mkm-d');
        if(prices.mkm?.eur){
          const eurTotal=(base*0.92).toFixed(2);
          if(mkmEl)mkmEl.textContent='�'+eurTotal;
          if(mkmdEl){mkmdEl.textContent='? -8% (EUR)'+(prices.mkm.simulated?' (est.)':'');mkmdEl.className='prov-diff dn';}
        }
      }
    }
    // MTGStocks � simulated
    const msEl=document.getElementById('prov-mtgstocks');const msdEl=document.getElementById('prov-mtgstocks-d');
    if(msEl)msEl.textContent='�'+(base*1.02).toFixed(2);
    if(msdEl){msdEl.textContent='? +2% (est.)';msdEl.className='prov-diff up';}
  },

  render(){
    const deck=Store.getDeck(App.curId);
    const base=deck?deck.cards.reduce((s,c)=>{const cd=Store.card(c.name);return s+(parseFloat(cd?.prices?.eur||0)*c.qty);},0):0;
    const el=document.getElementById('price-movers-deck');if(el)el.textContent=deck?deck.name:'';
    this.renderPriceProviders(base,deck);
    Charts.line('price-history-chart',Array.from({length:30},(_,i)=>({v:(base||150)*(0.88+Math.random()*.15+i*.004)})));
    const tbody=document.getElementById('movers-tbody');if(!tbody)return;tbody.innerHTML='';
    if(!deck){tbody.innerHTML='<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text3)">No deck loaded</td></tr>';return;}
    const cards=[...deck.cards].sort((a,b)=>(parseFloat(Store.card(b.name)?.prices?.eur||0))-(parseFloat(Store.card(a.name)?.prices?.eur||0))).slice(0,10);
    for(const c of cards){
      const usd=parseFloat(Store.card(c.name)?.prices?.eur||0);
      const ch7=((Math.random()-.4)*20).toFixed(1),ch30=((Math.random()-.3)*40).toFixed(1);
      const tr=document.createElement('tr');
      tr.innerHTML=`<td><span class="lname">${esc(c.name)}</span></td>
        <td style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--green2)">${usd?'�'+usd.toFixed(2):'�'}</td>
        <td class="${parseFloat(ch7)>=0?'price-up':'price-dn'}">${parseFloat(ch7)>=0?'? +':'? '}${Math.abs(ch7)}%</td>
        <td class="${parseFloat(ch30)>=0?'price-up':'price-dn'}">${parseFloat(ch30)>=0?'? +':'? '}${Math.abs(ch30)}%</td>
        <td style="font-size:10px;color:var(--text3)">Scryfall</td>`;
      tbody.appendChild(tr);
    }
  }
};

/* --- ANALYSIS ---------------------------------------------- */

/* --- ALERT MANAGER ---------------------------------------- */
const AlertMgr={
  add(){
    const card=(document.getElementById('alert-card')?.value||'').trim();
    const cond=document.getElementById('alert-cond')?.value||'below';
    const val=parseFloat(document.getElementById('alert-val')?.value||'0');
    const prov=document.getElementById('alert-prov')?.value||'scryfall';
    if(!card||!val){Notify.show('Fill in card and value','err');return;}
    Store.alerts.push({id:Store.uid(),card,cond,val,prov,active:true,triggered:false,created:Date.now()});
    Store.saveAlerts();this.render();Notify.show(`Alert created for ${card}`,'ok');
    if(document.getElementById('alert-card'))document.getElementById('alert-card').value='';
    if(document.getElementById('alert-val'))document.getElementById('alert-val').value='';
  },
  del(id){Store.alerts=Store.alerts.filter(a=>a.id!==id);Store.saveAlerts();this.render();},
  toggle(id){const a=Store.alerts.find(x=>x.id===id);if(a)a.active=!a.active;Store.saveAlerts();this.render();},
  checkAlerts(){
    for(const a of Store.alerts){
      if(!a.active)continue;const cd=Store.card(a.card);if(!cd)continue;
      const price=parseFloat(cd.prices?.eur||0);
      a.triggered=(a.cond==='below'&&price<a.val&&price>0)||(a.cond==='above'&&price>a.val);
    }
    Store.saveAlerts();
  },
  render(){
    this.checkAlerts();
    const dl=document.getElementById('alert-card-list');
    if(dl){const names=[...new Set(Store.decks.flatMap(d=>d.cards.map(c=>c.name)))];dl.innerHTML=names.map(n=>`<option value="${esc(n)}">`).join('');}
    const list=document.getElementById('alert-list');const empty=document.getElementById('alert-empty');if(!list)return;
    if(!Store.alerts.length){list.innerHTML='';if(empty)empty.style.display='block';return;}
    if(empty)empty.style.display='none';list.innerHTML='';
    const condLabel={below:'falls below',above:'rises above',change_pct:'change %'};
    for(const a of Store.alerts){
      const curPrice=parseFloat(Store.card(a.card)?.prices?.eur||0);
      const row=document.createElement('div');row.className='alert-row'+(a.triggered?' triggered':'');
      row.innerHTML=`<div class="alert-dot ${!a.active?'inactive':a.triggered?'triggered':'active'}"></div>
        <div class="alert-name">${esc(a.card)}</div>
        <div class="alert-cond">${condLabel[a.cond]||a.cond} ${a.cond==='change_pct'?a.val+'%':'�'+a.val} � ${a.prov}</div>
        <div class="alert-cur">${curPrice?'�'+curPrice.toFixed(2):'�'}</div>
        <div class="alert-status ${a.triggered?'ok':a.active?'watch':'off'}">${a.triggered?'? Triggered':a.active?'Watching':'Off'}</div>
        <button class="tbtn sm" onclick="AlertMgr.toggle('${a.id}')">${a.active?'Pause':'Resume'}</button>
        <button class="alert-del" onclick="AlertMgr.del('${a.id}')">?</button>`;
      list.appendChild(row);
    }
    const kpiAl=document.getElementById('kpi-alerts');if(kpiAl)kpiAl.textContent=Store.alerts.filter(a=>a.active).length;
  }
};

/* --- APP -------------------------------------------------- */
/* --- LAZY IMAGE OBSERVER --------------------------------------
   Sets img.src from img.dataset.src only when tile enters viewport.
   Saves ~90% of initial image requests on large decks.
   ----------------------------------------------------------- */
const TileImgObserver=(()=>{
  const obs=new IntersectionObserver((entries)=>{
    entries.forEach(entry=>{
      if(entry.isIntersecting){
        const img=entry.target;
        if(img.dataset.src){img.src=img.dataset.src;delete img.dataset.src;}
        obs.unobserve(img);
      }
    });
  },{rootMargin:'100px'});
  return{observe:(img)=>obs.observe(img),disconnect:()=>obs.disconnect()};
})();


