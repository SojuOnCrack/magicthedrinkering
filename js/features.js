/* CommanderForge â€” features: URLImport, DeckComments, SynergyScanner, Realtime,
   ReprintAlert, ForgeBulk, ThemeMgr, CardTooltip, UndoMgr, OfflineQueue + App.init */

const URLImport={
  /* Convert Moxfield JSON â†’ text with set/collector_number.
     Moxfield v2/v3 uses different field paths â€” we try all known ones. */
  moxfieldToText(data){
    const fmtCard=(c,qty=null)=>{
      const card=c.card||c;
      const name=card.name||card.oracleCard?.name;if(!name)return null;
      const q=qty??c.quantity??1;
      /* Try all known Moxfield API field paths for set code */
      const set=(card.set||card.setCode||card.set_code||
                 card.edition||card.printing?.set||'').toLowerCase();
      /* Try all known paths for collector number */
      const cn=card.collectorNumber||card.collector_number||
                card.cn||card.number||card.printing?.collectorNumber||'';
      const foil=c.finish==='foil'||c.foil?'*F* ':'';
      return set
        ? `${q} ${name} (${set.toUpperCase()})${cn?` ${cn}`:''}${foil?` ${foil}`:''}`
        : `${q} ${name}`;
    };
    const lines=[];
    const boards=data.boards||{};
    const cmdrs=Object.values(boards.commanders?.cards||{});
    const main=Object.values(boards.mainboard?.cards||{});
    if(cmdrs.length){
      lines.push('// COMMANDER');
      cmdrs.forEach(c=>{const l=fmtCard(c,1);if(l)lines.push(l);});
      lines.push('');
    }
    lines.push('// Deck');
    main.forEach(c=>{const l=fmtCard(c);if(l)lines.push(l);});
    return lines.join('\n');
  },

  archidektToText(data){
    const lines=[];
    const cmdrs=[],main=[];
    (data.cards||[]).forEach(c=>{
      const name=c.card?.oracleCard?.name||c.card?.name;
      if(!name)return;
      const set=(c.card?.edition?.editioncode||c.card?.setCode||'').toLowerCase();
      const cn=c.card?.collectorNumber||'';
      const cats=(c.categories||[]).map(x=>typeof x==='string'?x.toLowerCase():x.name?.toLowerCase()||'');
      const line=set
        ? `${c.quantity||1} ${name} (${set.toUpperCase()})${cn?` ${cn}`:''}`
        : `${c.quantity||1} ${name}`;
      if(cats.some(cat=>cat.includes('commander')))cmdrs.push(name);
      else main.push(line);
    });
    if(cmdrs.length){lines.push('// COMMANDER');cmdrs.forEach(n=>lines.push('1 '+n));lines.push('');}
    lines.push('// Deck');
    main.forEach(l=>lines.push(l));
    return lines.join('\n');
  }
};

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   DECK COMMENTS & REACTIONS
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const DeckComments={
  REACTIONS:['ðŸ‘','ðŸ”¥','ðŸ’€','ðŸŽ‰','ðŸ¤”','âš¡'],

  // Show comment section inside a user's deck view
  async renderForDeck(deckId, containerId){
    const el=document.getElementById(containerId);if(!el)return;

    if(!DB._sb){
      el.innerHTML='<div style="color:var(--text3);font-size:12px;padding:8px">Sign in to see comments.</div>';
      return;
    }

    el.innerHTML='<div class="comments-loading">Loading commentsâ€¦</div>';

    try{
      const[{data:comments},{data:reactions}]=await Promise.all([
        DB._sb.from('deck_comments').select('*').eq('deck_id',deckId).order('created_at'),
        DB._sb.from('deck_reactions').select('*').eq('deck_id',deckId)
      ]);

      // Count reactions
      const reactionCounts={};
      const myReactions=new Set();
      for(const r of reactions||[]){
        reactionCounts[r.emoji]=(reactionCounts[r.emoji]||0)+1;
        if(r.user_id===DB._user?.id)myReactions.add(r.emoji);
      }

      el.innerHTML='';

      // Reaction bar
      const rBar=document.createElement('div');rBar.className='reaction-bar';
      this.REACTIONS.forEach(emoji=>{
        const cnt=reactionCounts[emoji]||0;
        const btn=document.createElement('button');
        btn.className='reaction-btn'+(myReactions.has(emoji)?' reacted':'');
        btn.innerHTML=`${emoji} <span class="reaction-count">${cnt||''}</span>`;
        btn.title='React with '+emoji;
        btn.onclick=()=>this.toggleReaction(deckId,emoji,btn,containerId);
        rBar.appendChild(btn);
      });
      el.appendChild(rBar);

      // Comments list
      const list=document.createElement('div');list.id='comments-list-'+deckId;list.style.cssText='margin-top:10px';

      if(!comments?.length){
        list.innerHTML='<div style="color:var(--text3);font-size:12px;padding:8px 0">No comments yet. Be first!</div>';
      } else {
        // Load profile names
        const userIds=[...new Set(comments.map(c=>c.user_id))];
        const{data:profiles}=await DB._sb.from('profiles').select('id,username,email').in('id',userIds);
        const profileMap={};(profiles||[]).forEach(p=>{profileMap[p.id]=p.username||p.email?.split('@')[0]||'User';});

        comments.forEach(c=>{
          const item=this._buildComment(c,profileMap[c.user_id]||'User',deckId,containerId);
          list.appendChild(item);
        });
      }
      el.appendChild(list);

      // Comment input (only if signed in)
      if(DB._user){
        const inputWrap=document.createElement('div');inputWrap.className='comment-input-wrap';
        inputWrap.innerHTML=`
          <textarea class="comment-input" id="comment-inp-${deckId}"
            placeholder="Leave a commentâ€¦" rows="1"
            onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();DeckComments.post('${deckId}','${containerId}');}">
          </textarea>
          <button class="tbtn sm gold" onclick="DeckComments.post('${deckId}','${containerId}')">Post</button>
        `;
        el.appendChild(inputWrap);
      }

      // Subscribe to realtime updates
      this._subscribe(deckId, containerId);

    }catch(e){
      el.innerHTML=`<div style="color:var(--crimson2);font-size:11px">Error: ${esc(e.message)}<br>
        <span style="color:var(--text3);font-size:10px">Create the deck_comments and deck_reactions tables using supabase_schema.sql.</span>
      </div>`;
    }
  },

  _buildComment(c, authorName, deckId, containerId){
    const item=document.createElement('div');item.className='comment-item';item.id='comment-'+c.id;
    const hue=(c.user_id.charCodeAt(0)*17)%360;
    const timeStr=new Date(c.created_at).toLocaleDateString('en',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    const isOwn=DB._user?.id===c.user_id;
    item.innerHTML=`
      <div class="comment-avatar" style="background:hsl(${hue},35%,22%);border-color:hsl(${hue},50%,42%)">${esc(authorName.slice(0,1).toUpperCase())}</div>
      <div class="comment-body">
        <div>
          <span class="comment-author">${esc(authorName)}</span>
          <span class="comment-time">${timeStr}</span>
          ${isOwn?`<button class="comment-del" onclick="DeckComments.del('${c.id}','${deckId}','${containerId}')">âœ•</button>`:''}
        </div>
        <div class="comment-text">${esc(c.comment_text||'')}</div>
      </div>
    `;
    return item;
  },

  async post(deckId, containerId){
    const inp=document.getElementById('comment-inp-'+deckId);
    const text=(inp?.value||'').trim();
    if(!text||!DB._sb||!DB._user)return;
    if(text.length>500){Notify.show('Comment too long (500 chars max)','err');return;}

    try{
      const{error}=await DB._sb.from('deck_comments').insert({
        deck_id:deckId, user_id:DB._user.id,
        user_email:DB._user.email||'', comment_text:text,
        created_at:new Date().toISOString()
      });
      if(error)throw error;
      if(inp)inp.value='';
      // Realtime will refresh â€” or do it manually
      this.renderForDeck(deckId, containerId);
    }catch(e){Notify.show('Failed to post: '+e.message,'err');}
  },

  async del(commentId, deckId, containerId){
    if(!DB._sb||!DB._user)return;
    await DB._sb.from('deck_comments').delete().eq('id',commentId).eq('user_id',DB._user.id);
    const el=document.getElementById('comment-'+commentId);
    if(el)el.style.opacity='0',setTimeout(()=>el.remove(),200);
  },

  async toggleReaction(deckId, emoji, btn, containerId){
    if(!DB._sb||!DB._user){Notify.show('Sign in to react','err');return;}
    const isReacted=btn.classList.contains('reacted');
    try{
      if(isReacted){
        await DB._sb.from('deck_reactions').delete().eq('deck_id',deckId).eq('user_id',DB._user.id).eq('emoji',emoji);
        btn.classList.remove('reacted');
        const cntEl=btn.querySelector('.reaction-count');
        const cur=parseInt(cntEl.textContent||'0');
        cntEl.textContent=cur>1?cur-1:'';
      } else {
        await DB._sb.from('deck_reactions').insert({deck_id:deckId,user_id:DB._user.id,emoji,created_at:new Date().toISOString()});
        btn.classList.add('reacted');
        const cntEl=btn.querySelector('.reaction-count');
        const cur=parseInt(cntEl.textContent||'0');
        cntEl.textContent=cur+1;
      }
    }catch(e){Notify.show('Failed: '+e.message,'err');}
  },

  _subs:{},
  _subscribe(deckId, containerId){
    if(!DB._sb||this._subs[deckId])return;
    this._subs[deckId]=DB._sb.channel('deck-comments-'+deckId)
      .on('postgres_changes',{event:'*',schema:'public',table:'deck_comments',filter:`deck_id=eq.${deckId}`},
        ()=>this.renderForDeck(deckId, containerId))
      .on('postgres_changes',{event:'*',schema:'public',table:'deck_reactions',filter:`deck_id=eq.${deckId}`},
        ()=>this.renderForDeck(deckId, containerId))
      .subscribe();
  }
};

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   SYNERGY SCANNER
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const SynergyScanner={
  _keywords:{
    'flying':['fly','flying','reach','can block creatures with flying'],
    'deathtouch':['deathtouch','destroy','dies'],
    'lifelink':['lifelink','gain life','you gain'],
    'trample':['trample','excess damage'],
    'haste':['haste','speed','untap'],
    'vigilance':['vigilance','does not untap'],
    'first strike':['first strike','double strike'],
    'infect':['infect','proliferate','poison counter'],
    'sacrifice':['sacrifice','when.*dies','when.*leaves'],
    'token':['create.*token','token','populate'],
    'graveyard':['from your graveyard','flashback','unearth','dredge','from the graveyard'],
    'counter':['counter target','counter spell','counter.*ability'],
    'draw':['draw a card','draw.*card'],
    'discard':['discard','hand size'],
    'ramp':['add.*mana','search.*land','put.*land'],
    'etb':['enters the battlefield','when.*enters','when.*comes into play'],
    'tribal':['each.*creature','all.*creature','creature.*you control'],
  },

  open(){
    const deck=Store.getDeck(App.curId);
    if(!deck?.commander){Notify.show('Set a commander first','err');return;}
    // Open panel immediately with loading state
    P._open('âš¡ Commander Synergy â€” '+deck.commander, true);
    document.getElementById('pbody').innerHTML=`
      <div style="display:flex;align-items:center;gap:10px;padding:16px">
        <div class="spin" style="width:20px;height:20px;border-width:2px"></div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text3)">
          Loading card data for <span style="color:var(--gold2)">${esc(deck.commander)}</span>â€¦
        </div>
      </div>`;
    document.getElementById('pfoot').innerHTML='';
    const pf=document.getElementById('pfoot');
    const cl=document.createElement('button');cl.className='tbtn';cl.textContent='Close';cl.onclick=()=>P.close();
    pf.appendChild(cl);
    // Fetch commander card data first, then scan
    SF.fetch(deck.commander, ()=>{
      // Also fetch all deck cards (needed for synergy scoring)
      const missing=deck.cards.filter(c=>!Store.card(c.name)).map(c=>c.name);
      if(missing.length){
        let done=0;
        missing.forEach(name=>SF.fetch(name,()=>{
          done++;
          if(done>=missing.length)this._scan(deck);
        }));
      } else {
        this._scan(deck);
      }
    });
  },

  _scan(deck){
    const cmdrData=Store.card(deck.commander)||{};
    if(!cmdrData.oracle_text&&!cmdrData.name){
      document.getElementById('pbody').innerHTML=`<div style="padding:16px;color:var(--crimson2);font-family:'JetBrains Mono',monospace;font-size:11px">Could not load card data for "${esc(deck.commander)}". Check the commander name is spelled correctly.</div>`;
      return;
    }
    const cmdrOracle=(cmdrData.oracle_text||'').toLowerCase();
    const cmdrColors=(cmdrData.color_identity||[]);
    const cmdrKeywords=this._extractKeywords(cmdrOracle);
    const cmdrAbilities=this._extractAbilities(cmdrOracle, cmdrData);

    // Categorise each card in the deck
    const combos=[], synergies=[], neutral=[];
    const cardNames=[deck.commander,deck.partner].filter(Boolean);
    for(const c of deck.cards){
      if(cardNames.includes(c.name))continue;
      const cd=Store.card(c.name)||{};
      const oracle=(cd.oracle_text||'').toLowerCase();
      const match=this._matchScore(cmdrOracle, cmdrKeywords, cmdrAbilities, oracle, cd, cmdrColors);
      if(match.score>=3)combos.push({c,cd,match});
      else if(match.score>=1)synergies.push({c,cd,match});
      else neutral.push({c,cd});
    }
    combos.sort((a,b)=>b.match.score-a.match.score);
    synergies.sort((a,b)=>b.match.score-a.match.score);

    // Build HTML
    let html=`
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
        ${cmdrData.img?.crop?`<img src="${esc(cmdrData.img.crop)}" style="width:40px;height:55px;object-fit:cover;border-radius:4px;border:1px solid var(--border2)">`:''}
        <div>
          <div style="font-family:'Cinzel',serif;font-size:14px;color:var(--gold2);font-weight:700">${esc(deck.commander)}</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--text3);margin-top:3px">
            ${cmdrKeywords.slice(0,6).map(k=>`<span style="background:var(--bg3);border:1px solid var(--border);border-radius:3px;padding:1px 5px;margin-right:3px">${k}</span>`).join('')}
          </div>
        </div>
        <div style="margin-left:auto;text-align:right;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text3)">
          <div><span style="color:var(--gold2)">${combos.length}</span> key synergies</div>
          <div><span style="color:var(--ice)">${synergies.length}</span> supporting cards</div>
        </div>
      </div>
    `;

    if(combos.length){
      html+=`<div class="syn-panel">
        <div class="syn-panel-title">âš¡ Key Synergies &amp; Combos (${combos.length})</div>`;
      combos.slice(0,15).forEach(({c,cd,match})=>{
        html+=this._cardRow(c,cd,match,'combo');
      });
      html+='</div>';
    }

    if(synergies.length){
      html+=`<div class="syn-panel">
        <div class="syn-panel-title">ðŸ’š Supporting Cards (${synergies.length})</div>`;
      synergies.slice(0,12).forEach(({c,cd,match})=>{
        html+=this._cardRow(c,cd,match,'synergy');
      });
      html+='</div>';
    }

    // Fetch suggestions from Scryfall based on commander keywords
    html+=`<div class="syn-panel" id="syn-suggestions-panel">
      <div class="syn-panel-title">âœ¨ Suggested Additions</div>
      <div id="syn-suggestions"><div style="color:var(--text3);font-size:12px">Fetching suggestionsâ€¦</div></div>
    </div>`;

    document.getElementById('pbody').innerHTML=html;

    // Fetch Scryfall suggestions async
    this._fetchSuggestions(deck, cmdrData, cmdrKeywords);
  },

  _extractKeywords(oracle){
    const found=[];
    Object.keys(this._keywords).forEach(kw=>{
      if(this._keywords[kw].some(k=>oracle.includes(k)))found.push(kw);
    });
    return found;
  },

  _extractAbilities(oracle, cd){
    const abilities=[];
    if(oracle.includes('+1/+1'))abilities.push('+1/+1 counters');
    if(oracle.includes('-1/-1'))abilities.push('-1/-1 counters');
    if(oracle.includes('artifact'))abilities.push('artifacts');
    if(oracle.includes('enchantment'))abilities.push('enchantments');
    if(oracle.includes('whenever.*attacks')||oracle.includes('when.*attacks'))abilities.push('attack trigger');
    if(oracle.includes('tap'))abilities.push('tap ability');
    const types=(cd.type_line||'').toLowerCase();
    if(types.includes('vampire'))abilities.push('vampires');
    if(types.includes('wizard'))abilities.push('wizards');
    if(types.includes('dragon'))abilities.push('dragons');
    if(types.includes('elf'))abilities.push('elves');
    if(types.includes('zombie'))abilities.push('zombies');
    return abilities;
  },

  _matchScore(cmdrOracle, cmdrKeywords, cmdrAbilities, cardOracle, cd, cmdrColors){
    let score=0; const reasons=[];
    // Keyword overlap
    cmdrKeywords.forEach(kw=>{
      if(this._keywords[kw]?.some(k=>cardOracle.includes(k))){
        score+=2;reasons.push('shares '+kw);
      }
    });
    // Ability synergy
    cmdrAbilities.forEach(ab=>{
      if(cardOracle.includes(ab.split(' ')[0])){score+=2;reasons.push(ab);}
    });
    // Commander name reference
    const type=(cd.type_line||'').toLowerCase();
    if(cmdrOracle.includes('when')&&(cardOracle.includes('whenever')||cardOracle.includes('when'))){score+=1;reasons.push('trigger synergy');}
    // Mana color identity match
    const ci=cd.color_identity||[];
    if(ci.every(c=>cmdrColors.includes(c)))score+=1;
    return{score,reasons:reasons.slice(0,3)};
  },

  _cardRow(c, cd, match, badgeType){
    const img=cd.img?.crop?`<img src="${esc(cd.img.crop)}" class="syn-card-img" loading="lazy">`:'<div class="syn-card-img" style="background:var(--bg3)"></div>';
    const price=cd.prices?.eur?`<span style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--green2)">&euro;${cd.prices.eur}</span>`:'';
    return `<div class="syn-card">
      ${img}
      <div style="flex:1;min-width:0">
        <div class="syn-card-name">${esc(c.name)}</div>
        <div class="syn-card-reason">${match.reasons.join(' Â· ')}</div>
      </div>
      ${price}
      <span class="syn-badge ${badgeType}">${badgeType==='combo'?'âš¡ Combo':'ðŸ’š Synergy'}</span>
    </div>`;
  },

  async _fetchSuggestions(deck, cmdrData, cmdrKeywords){
    const el=document.getElementById('syn-suggestions');if(!el)return;
    const existing=new Set(deck.cards.map(c=>c.name.toLowerCase()));
    existing.add((deck.commander||'').toLowerCase());
    if(deck.partner)existing.add(deck.partner.toLowerCase());

    /* Map our internal keywords to Scryfall oracle text search terms */
    const KW_MAP={
      'flying':'o:flying','deathtouch':'o:deathtouch','lifelink':'o:lifelink',
      'trample':'o:trample','haste':'o:haste','vigilance':'o:vigilance',
      'first strike':'o:"first strike"','token':'o:token','counter':'o:counter',
      'graveyard':'o:graveyard','draw':'o:"draw a card"','sacrifice':'o:sacrifice',
      'etb':'o:"enters the battlefield"','flash':'o:flash','artifact':'t:artifact',
      'enchantment':'t:enchantment','land':'t:land','creature':'t:creature',
      'spell':'o:spell','copy':'o:copy','exile':'o:exile','tutor':'o:"search your library"',
      'ramp':'o:"add "','protection':'o:protection',
    };

    const colors=(cmdrData.color_identity||[]);
    /* identity:<= means "cards playable in this commander's deck" */
    const identityFilter=colors.length
      ? `identity<=${colors.join('')}`
      : 'identity:c';

    /* Build keyword query â€” try multiple fallbacks if Scryfall returns no results */
    const kwTerms=cmdrKeywords
      .map(k=>KW_MAP[k.toLowerCase()])
      .filter(Boolean)
      .slice(0,2);

    const queries=[];
    if(kwTerms.length>=2) queries.push(`(${kwTerms.join(' ')}) ${identityFilter} -t:land -is:extra`);
    if(kwTerms.length>=1) queries.push(`${kwTerms[0]} ${identityFilter} -t:land -is:extra`);
    queries.push(`${identityFilter} -t:land -is:extra`); /* fallback: just by color identity */

    let cards=[];
    for(const query of queries){
      try{
        const url=`/api/scryfall/cards/search?q=${encodeURIComponent(query)}&order=edhrec&unique=cards&page=1`;
        const res=await fetch(url);
        if(!res.ok)continue;
        const data=await res.json();
        cards=(data.data||[]).filter(c=>!existing.has(c.name.toLowerCase())).slice(0,8);
        if(cards.length)break;
      }catch{}
    }

    if(!cards.length){
      el.innerHTML='<div style="color:var(--text3);font-size:12px">No suggestions found for this commander\'s color identity.</div>';
      return;
    }

    el.innerHTML='';
    cards.forEach(card=>{
      const img=card.image_uris?.art_crop||card.card_faces?.[0]?.image_uris?.art_crop||'';
      const price=card.prices?.eur?'â‚¬'+card.prices.eur:'';
      const why=this._matchScore((cmdrData.oracle_text||'').toLowerCase(),cmdrKeywords,[],
        (card.oracle_text||'').toLowerCase(),{type_line:card.type_line,color_identity:card.color_identity},
        cmdrData.color_identity||[]).reasons.join(' Â· ')||'EDHREC recommended';

      const row=document.createElement('div');row.className='syn-suggest-card';
      row.innerHTML=`
        ${img?`<img src="${esc(img)}" class="syn-card-img" loading="lazy">`:'<div class="syn-card-img" style="background:var(--bg3)"></div>'}
        <div style="flex:1;min-width:0">
          <div class="syn-suggest-name">${esc(card.name)}</div>
          <div class="syn-suggest-why">${why}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          ${price?`<div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--green2)">${price}</div>`:''}
          <span class="syn-badge suggest">âœ¨ Add?</span>
        </div>
      `;
      row.onclick=()=>this._addSuggested(card, deck);
      el.appendChild(row);
    });
  },

  _addSuggested(card, deck){
    if(deck.cards.some(c=>c.name.toLowerCase()===card.name.toLowerCase())){
      Notify.show(card.name+' already in deck','inf');return;
    }
    deck.cards.push({name:card.name,qty:1,foil:false,etched:false});
    Store.updDeck(deck);
    // Cache card data
    const cd={name:card.name,cmc:card.cmc,type_line:card.type_line,oracle_text:card.oracle_text,
               color_identity:card.color_identity,rarity:card.rarity,
               prices:{usd:card.prices?.eur||null},
               img:{crop:card.image_uris?.art_crop||card.card_faces?.[0]?.image_uris?.art_crop||null,
                    normal:card.image_uris?.normal||card.card_faces?.[0]?.image_uris?.normal||null}};
    Store.setCard(card.name,cd);Store.saveCache();
    App.render();
    Notify.show(card.name+' added to deck','ok');
  }
};

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   REALTIME â€” Supabase live updates for bulk pool + community
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const Realtime={
  _channels:{},

  init(){
    if(!DB._sb)return;
    this._subscribeBulk();
    this._subscribeProfiles();
  },

  _subscribeBulk(){
    if(this._channels.bulk)return;
    this._channels.bulk=DB._sb.channel('bulk-pool-live')
      .on('postgres_changes',{event:'*',schema:'public',table:'bulk_pool'},payload=>{
        // Only refresh if bulk tab is currently visible
        if(Menu.cur==='bulk'){
          BulkPool.refresh();
          Notify.show('Pool updated by another user','inf',2000);
        }
      })
      .subscribe();
  },

  _subscribeProfiles(){
    if(this._channels.profiles)return;
    this._channels.profiles=DB._sb.channel('profiles-live')
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'profiles'},()=>{
        // If on community page, quietly refresh
        if(Menu.cur==='community'&&CommunityNav.cur==='friends')
          CommunityNav._renderAllUsers();
      })
      .subscribe();
  },

  subscribeTrade(){
    if(this._channels.trade)return;
    if(!DB._sb)return;
    this._channels.trade=DB._sb.channel('trade-live')
      .on('postgres_changes',{event:'*',schema:'public',table:'trade_list'},()=>{
        if(Menu.cur==='vault'&&VaultNav.cur==='trade')TradeMgr.render();
      })
      .subscribe();
  },

  cleanup(){
    Object.values(this._channels).forEach(ch=>{try{DB._sb?.removeChannel(ch);}catch{}});
    this._channels={};
  }
};


/* â•â•â• REPRINT ALERT ENGINE â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   How notifications work:
   1. In-App Dashboard Banner  â€” red strip on Dashboard when reprints found
   2. Vault â†’ Reprint Alerts tab â€” full detail list, price impact, dismiss
   3. Browser Notification API  â€” optional push if user grants permission
   4. Nav badge                 â€” red dot on "Reprint Alerts" sidebar item
   Auto-checks weekly, stores results in localStorage.
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const ReprintAlert={
  KEY:'cforge_reprints',SEEN:'cforge_reprints_seen',LAST:'cforge_reprints_last',
  _results:[],_seen:[],

  load(){
    try{this._results=JSON.parse(localStorage.getItem(this.KEY)||'[]')}catch{this._results=[];}
    try{this._seen=JSON.parse(localStorage.getItem(this.SEEN)||'[]')}catch{this._seen=[];}
  },
  save(){
    try{localStorage.setItem(this.KEY,JSON.stringify(this._results))}catch{}
    try{localStorage.setItem(this.SEEN,JSON.stringify(this._seen))}catch{}
  },

  async scan(){
    this.load();
    const listEl=document.getElementById('reprint-list');
    const lastEl=document.getElementById('reprint-last-check');
    if(listEl)listEl.innerHTML='<div style="padding:20px;text-align:center;color:var(--text3)">ðŸ” Fetching recent sets from Scryfallâ€¦</div>';

    /* Step 1: get sets released in last 90 days */
    let recentSets=[];
    try{
      const r=await fetch('/api/scryfall/sets');
      if(r.ok){
        const d=await r.json();
        const cutoff=new Date(Date.now()-90*24*60*60*1000);
        recentSets=(d.data||[]).filter(s=>{
          if(!['expansion','core','masters','draft_innovation','commander','duel_deck','from_the_vault','spellbook','premium_deck','box','starter','memorabilia'].includes(s.set_type))return false;
          return new Date(s.released_at)>=cutoff && new Date(s.released_at)<=new Date();
        }).slice(0,8);
      }
    }catch{}

    if(!recentSets.length){
      if(listEl)listEl.innerHTML='<div style="padding:20px;text-align:center;color:var(--text3)">Could not fetch set data. Check connection.</div>';
      return;
    }

    /* Step 2: build owned card name set */
    const ownedNames=new Set();
    for(const deck of Store.decks)
      for(const c of deck.cards) ownedNames.add(c.name.toLowerCase());

    /* Step 3: for each recent set fetch card list and cross-reference */
    this._results=[];
    let setsChecked=0;
    for(const set of recentSets){
      if(listEl)listEl.innerHTML=`<div style="padding:20px;text-align:center;color:var(--text3)">Checking ${set.name} (${setsChecked+1}/${recentSets.length})â€¦</div>`;
      try{
        let page=1,hasMore=true;
        while(hasMore){
          const r=await fetch(`/api/scryfall/cards/search?q=set:${set.code}&order=name&page=${page}`);
          if(!r.ok)break;
          const d=await r.json();
          for(const card of(d.data||[])){
            const nameLC=card.name.toLowerCase();
            if(ownedNames.has(nameLC)){
              /* Check if this is actually a reprint (not first printing) */
              const owned=Store.card(card.name);
              const ownedSet=owned?.set||'';
              if(ownedSet && ownedSet.toLowerCase()!==set.code.toLowerCase()){
                const oldPrice=parseFloat(owned?.prices?.eur||0);
                const newPrice=parseFloat(card.prices?.eur||0);
                const impact=oldPrice>0?Math.round((newPrice-oldPrice)/oldPrice*100):0;
                this._results.push({
                  name:card.name,
                  setCode:set.code,setName:set.name,
                  releasedAt:set.released_at,
                  oldSet:ownedSet,oldSetName:owned?.set_name||ownedSet,
                  oldPrice,newPrice,impact,
                  img:card.image_uris?.crop||card.card_faces?.[0]?.image_uris?.crop||'',
                  scryfallId:card.id,
                  ts:Date.now()
                });
              }
            }
          }
          hasMore=d.has_more;page++;
          if(page>4)break; /* safety cap */
          await new Promise(r=>setTimeout(r,120));
        }
      }catch{}
      setsChecked++;
    }

    localStorage.setItem(this.LAST,new Date().toISOString());
    this.save();
    this._updateNavBadge();
    this._maybeNotify();
    this.render();
    /* Update dashboard banner too */
    Dashboard.render();
  },

  _updateNavBadge(){
    const unseen=this._results.filter(r=>!this._seen.includes(r.name+'_'+r.setCode));
    const badge=document.getElementById('reprint-nav-badge');
    if(badge){
      if(unseen.length>0){
        badge.innerHTML=`<span style="background:var(--crimson2);color:#fff;border-radius:10px;padding:1px 7px;font-size:9px;font-family:'JetBrains Mono',monospace">${unseen.length} new</span>`;
      } else {
        badge.textContent='Price impact tracker';
      }
    }
  },

  _maybeNotify(){
    const unseen=this._results.filter(r=>!this._seen.includes(r.name+'_'+r.setCode));
    if(!unseen.length)return;
    /* Browser Push Notification (if permission granted) */
    if('Notification' in window && Notification.permission==='granted'){
      new Notification('MagicTheDrinkering â€” Reprint Alert',{
        body:`${unseen.length} card${unseen.length>1?'s':''} in your collection got reprinted. Check the Vault for price impact.`,
        icon:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">âš”</text></svg>'
      });
    }
  },

  requestNotificationPermission(){
    if(!('Notification' in window)){Notify.show('Browser notifications not supported','err');return;}
    Notification.requestPermission().then(p=>{
      if(p==='granted')Notify.show('Browser notifications enabled âœ“','ok');
      else if(p==='denied')Notify.show('Notifications blocked â€” check browser settings','err');
    });
  },

  dismiss(name,setCode){
    const key=name+'_'+setCode;
    if(!this._seen.includes(key))this._seen.push(key);
    this.save();this._updateNavBadge();this.render();
  },
  clearSeen(){this._seen=[];this.save();this._updateNavBadge();this.render();},

  /* Auto-check weekly on app load */
  autoCheck(){
    this.load();
    this._updateNavBadge();
    const last=localStorage.getItem(this.LAST);
    if(!last)return; /* never scanned â€” don't auto-scan, let user trigger first */
    const age=Date.now()-new Date(last).getTime();
    const WEEK=7*24*60*60*1000;
    if(age>WEEK){setTimeout(()=>this.scan(),5000);} /* delay 5s after boot */
  },

  render(){
    this.load();
    const listEl=document.getElementById('reprint-list');
    const kpisEl=document.getElementById('reprint-kpis');
    const lastEl=document.getElementById('reprint-last-check');
    if(!listEl)return;

    const last=localStorage.getItem(this.LAST);
    if(lastEl)lastEl.textContent=last?'Last checked: '+new Date(last).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'Never checked';

    if(!this._results.length){
      listEl.innerHTML='<div style="padding:40px;text-align:center;color:var(--text3);font-size:13px">'+
        (last?'No reprints found in the last 90 days. Click Scan to refresh.':'Click "Scan for Reprints Now" to check recent sets.')+'</div>';
      if(kpisEl)kpisEl.innerHTML='';
      return;
    }

    const totalImpact=this._results.reduce((s,r)=>{
      const owned=Store.decks.reduce((c,d)=>c+d.cards.filter(x=>x.name===r.name).reduce((a,b)=>a+b.qty,0),0);
      return s+(r.newPrice-r.oldPrice)*owned;
    },0);
    const negative=this._results.filter(r=>r.impact<-10).length;
    const positive=this._results.filter(r=>r.impact>10).length;
    const unseen=this._results.filter(r=>!this._seen.includes(r.name+'_'+r.setCode)).length;

    if(kpisEl)kpisEl.innerHTML=`
      <div class="kpi-card"><div class="kpi-val">${this._results.length}</div><div class="kpi-lbl">Reprints Found</div></div>
      <div class="kpi-card"><div class="kpi-val" style="color:var(--crimson2)">${negative}</div><div class="kpi-lbl">Price Drops &gt;10%</div></div>
      <div class="kpi-card"><div class="kpi-val" style="color:var(--green2)">${positive}</div><div class="kpi-lbl">Price Gains &gt;10%</div></div>
      <div class="kpi-card"><div class="kpi-val" style="color:${totalImpact<0?'var(--crimson2)':'var(--green2)'}">${totalImpact>=0?'+':''}&euro;${Math.abs(totalImpact).toFixed(0)}</div><div class="kpi-lbl">Total Portfolio Impact</div></div>`;

    const notifSupported='Notification' in window;
    const notifGranted=notifSupported && Notification.permission==='granted';

    listEl.innerHTML=`
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:11px;color:var(--text3);flex-wrap:wrap">
        <span>${unseen} unseen</span>
        ${notifSupported&&!notifGranted?`<button class="tbtn sm" onclick="ReprintAlert.requestNotificationPermission()" style="font-size:10px">ðŸ”” Enable Push Notifications</button>`:''}
        ${notifGranted?'<span style="color:var(--green2)">ðŸ”” Push notifications on</span>':''}
      </div>
      ${this._results.map(r=>{
        const isSeen=this._seen.includes(r.name+'_'+r.setCode);
        const qty=Store.decks.reduce((c,d)=>c+d.cards.filter(x=>x.name===r.name).reduce((a,b)=>a+b.qty,0),0);
        const totalImpact=(r.newPrice-r.oldPrice)*qty;
        const impactColor=r.impact<-10?'var(--crimson2)':r.impact>10?'var(--green2)':'var(--text2)';
        return `<div style="display:flex;gap:12px;align-items:center;padding:10px 14px;background:var(--bg2);border:1px solid ${isSeen?'var(--border)':'var(--gold3)'};border-radius:var(--r);opacity:${isSeen?'.6':'1'}">
          ${r.img?`<img src="${r.img}" style="width:44px;height:44px;object-fit:cover;border-radius:4px;flex-shrink:0">`:'<div style="width:44px;height:44px;background:var(--bg3);border-radius:4px;flex-shrink:0"></div>'}
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.name)}</div>
            <div style="font-size:11px;color:var(--text3);margin-top:2px">
              Reprinted in <span style="color:var(--ice2)">${esc(r.setName)}</span>
              (was: ${esc(r.oldSetName||r.oldSet)})
            </div>
            <div style="display:flex;gap:12px;margin-top:4px;flex-wrap:wrap">
              <span style="font-family:'JetBrains Mono',monospace;font-size:11px">
                &euro;${r.oldPrice.toFixed(2)} -> <span style="color:${impactColor};font-weight:600">&euro;${r.newPrice.toFixed(2)}</span>
                <span style="color:${impactColor}">(${r.impact>0?'+':''}${r.impact}%)</span>
              </span>
              ${qty?`<span style="font-size:10px;color:var(--text3)">You own: ${qty}x - Impact: <span style="color:${totalImpact<0?'var(--crimson2)':'var(--green2)'}">${totalImpact>=0?'+':''}&euro;${Math.abs(totalImpact).toFixed(2)}</span></span>`:''}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
            ${!isSeen?`<button class="tbtn sm" data-action="dismiss-reprint" data-card="${esc(r.name)}" data-extra="${r.setCode}" style="font-size:9px">âœ“ Dismiss</button>`:''}
            <span style="font-size:9px;color:var(--text3);font-family:'JetBrains Mono',monospace">${new Date(r.releasedAt).toLocaleDateString('de-DE')}</span>
          </div>
        </div>`;
      }).join('')}`;
  },

  /* Dashboard banner â€” called by Dashboard.render() */
  dashboardBanner(){
    this.load();
    const unseen=this._results.filter(r=>!this._seen.includes(r.name+'_'+r.setCode));
    if(!unseen.length)return '';
    const drops=unseen.filter(r=>r.impact<-10).length;
    return `<div onclick="VaultNav.go('reprints')" style="cursor:pointer;padding:10px 14px;background:var(--crimson);border:1px solid var(--crimson2);border-radius:var(--r);margin-bottom:12px;display:flex;align-items:center;gap:10px">
      <span style="font-size:18px">ðŸ”„</span>
      <div style="flex:1">
        <div style="font-size:12px;font-weight:600;color:var(--text)">Reprint Alert â€” ${unseen.length} card${unseen.length>1?'s':''} reprinted</div>
        <div style="font-size:11px;color:var(--text2)">${drops>0?`${drops} with &gt;10% price drop Â· `:''}Click to see full impact</div>
      </div>
      <span style="font-size:11px;color:var(--text3)">â†’</span>
    </div>`;
  }
};

/* â•â•â• FORGE QUICK PASTE â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const ForgeBulk={
  toggle(){
    const wrap=document.getElementById('forge-bulk-wrap');
    if(!wrap)return;
    const open=wrap.classList.toggle('open');
    const hint=document.getElementById('forge-bulk-hint');
    if(hint)hint.textContent=open?'':'Paste multiple cards at once';
    if(open)document.getElementById('forge-bulk-ta')?.focus();
  },
  close(){
    const wrap=document.getElementById('forge-bulk-wrap');
    if(wrap)wrap.classList.remove('open');
    const ta=document.getElementById('forge-bulk-ta');
    if(ta)ta.value='';
  },
  add(){
    const ta=document.getElementById('forge-bulk-ta');
    const deck=Store.getDeck(App.curId);
    if(!ta||!deck){Notify.show('Select a deck first','err');return;}
    const lines=ta.value.split('\n').map(l=>l.trim()).filter(Boolean);
    let added=0;
    for(const line of lines){
      if(line.startsWith('//'))continue;
      const entry=Parser.parseLine(line);
      if(!entry)continue;
      const existing=deck.cards.find(c=>c.name.toLowerCase()===entry.name.toLowerCase());
      if(existing){
        existing.qty+=entry.qty;
        // Update print info if more specific
        if(entry.set)existing.set=entry.set;
        if(entry.collector_number)existing.collector_number=entry.collector_number;
        added++;
      } else {
        deck.cards.push(entry);added++;
      }
    }
    Store.updDeck(deck);App.render();App._fetchCards(deck);
    enrichDeckCards(deck).then(()=>{Store.updDeck(deck);DB.schedulePush();});
    Notify.show(`Added ${added} card${added!==1?'s':''}`, 'ok');
    this.close();
  }
};

/* â•â•â• THEME MANAGER â€” light/dark toggle â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const ThemeMgr={
  KEY:'cforge_theme',
  init(){
    const saved=localStorage.getItem(this.KEY)||'dark';
    this.apply(saved,false);
  },
  toggle(){
    const cur=document.documentElement.dataset.theme||'dark';
    this.apply(cur==='dark'?'light':'dark',true);
  },
  apply(theme,save=true){
    document.documentElement.dataset.theme=theme;
    const btn=document.getElementById('theme-toggle');
    if(btn)btn.textContent=theme==='dark'?'â˜€':'ðŸŒ™';
    if(save)localStorage.setItem(this.KEY,theme);
  }
};

/* â•â•â• CARD HOVER TOOLTIP â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const CardTooltip={
  _el:null,_img:null,
  init(){
    this._el=document.getElementById('card-tooltip');
    this._img=document.getElementById('card-tooltip-img');
    if(!this._el)return;
    document.addEventListener('mousemove',e=>{
      if(this._el.classList.contains('show')){
        const x=e.clientX+16,y=e.clientY-20;
        const maxX=window.innerWidth-180,maxY=window.innerHeight-240;
        this._el.style.left=Math.min(x,maxX)+'px';
        this._el.style.top=Math.min(y,maxY)+'px';
      }
    });
  },
  show(cardName,el){
    const cd=Store.card(cardName);
    if(!cd?.img?.crop||!this._img)return;
    this._img.src=cd.img.crop;
    this._el.classList.add('show');
  },
  hide(){if(this._el)this._el.classList.remove('show');}
};

/* â•â•â• ANIMATED NUMBER COUNTER â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   animateVal(el, toVal, prefix='', suffix='', duration=350)
   Counts up/down from current displayed value to toVal.
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

/* â•â•â• UNDO MANAGER â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   Gives 5-second undo window after card removal.
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const UndoMgr={
  _snapshot:null,_timer:null,_countdown:null,_remaining:5,
  DURATION:5000,

  record(deckId,cardName,snapshot){
    /* snapshot = array copy of deck.cards before removal */
    clearTimeout(this._timer);clearInterval(this._countdown);
    this._snapshot={deckId,cardName,cards:[...snapshot]};
    this._remaining=5;
    const toast=document.getElementById('undo-toast');
    const msg=document.getElementById('undo-msg');
    const timerEl=document.getElementById('undo-timer');
    if(msg)msg.textContent=`"${cardName.slice(0,18)}" removed`;
    if(toast)toast.classList.add('show');
    if(timerEl)timerEl.textContent='5s';
    this._countdown=setInterval(()=>{
      this._remaining--;
      if(timerEl)timerEl.textContent=this._remaining+'s';
      if(this._remaining<=0)this.dismiss();
    },1000);
    this._timer=setTimeout(()=>this.dismiss(),this.DURATION);
  },

  undo(){
    if(!this._snapshot)return;
    const{deckId,cards}=this._snapshot;
    const deck=Store.getDeck(deckId);
    if(deck){deck.cards=cards;Store.updDeck(deck);App.render();Notify.show('â†© Card restored','ok');}
    this.dismiss();
  },

  dismiss(){
    clearTimeout(this._timer);clearInterval(this._countdown);
    this._snapshot=null;
    const toast=document.getElementById('undo-toast');
    if(toast)toast.classList.remove('show');
  }
};

/* â•â•â• OFFLINE QUEUE â€” queues Supabase writes when offline â•â•â•â•â•â•
   Writes are stored in IDB as pending ops.
   window online-event drains the queue automatically.
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const OfflineQueue={
  STORE:'cforge_pending',
  async push(op){
    /* op: {type:'upsert'|'delete', table, payload} */
    try{
      const db=await IDB.open();
      const tx=db.transaction([IDB.STORE,'cforge_pending'],'readwrite');
      /* re-use IDB connection but to our own store â€” easier: just localStorage queue */
    }catch{}
    const key='ofq_'+Date.now()+'_'+Math.random().toString(36).slice(2,4);
    try{localStorage.setItem(key,JSON.stringify(op));}catch{}
    const indicator=document.getElementById('sync-offline-dot');
    if(indicator){indicator.style.display='flex';indicator.title='Offline â€” '+this.pendingCount()+' changes queued';}
  },
  pendingCount(){
    return Object.keys(localStorage).filter(k=>k.startsWith('ofq_')).length;
  },
  async drain(){
    const keys=Object.keys(localStorage).filter(k=>k.startsWith('ofq_')).sort();
    if(!keys.length)return;
    if(!DB._sb||!DB._user)return;
    let flushed=0;
    for(const key of keys){
      try{
        const op=JSON.parse(localStorage.getItem(key));
        if(op.type==='upsert'){
          const{error}=await DB._sb.from(op.table).upsert(op.payload,{onConflict:'id'});
          if(!error){localStorage.removeItem(key);flushed++;}
        } else if(op.type==='delete'){
          const{error}=await DB._sb.from(op.table).delete().eq('id',op.id).eq('user_id',DB._user.id);
          if(!error){localStorage.removeItem(key);flushed++;}
        }
      }catch{break;} /* stop on first error, retry next time */
    }
    if(flushed>0){
      Notify.show(`â˜ Synced ${flushed} offline change${flushed>1?'s':''}`, 'ok');
      const indicator=document.getElementById('sync-offline-dot');
      if(indicator&&!this.pendingCount())indicator.style.display='none';
    }
  },
  init(){
    window.addEventListener('online',()=>{
      Notify.show('Back online â€” syncingâ€¦','inf',1500);
      setTimeout(()=>this.drain(),800);
    });
    window.addEventListener('offline',()=>Notify.show('Offline â€” changes will sync when reconnected','inf',4000));
    /* Drain on boot if we have pending items */
    if(this.pendingCount()>0)setTimeout(()=>this.drain(),3000);
  }
};


/* â•â•â• DELEGATED CARD ACTION HANDLER â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   All buttons with data-action="trade|wish|dismiss-reprint"
   are handled here instead of inline onclick with raw card names.
   Prevents apostrophe-in-name breakage (Yawgmoth's Will etc.)
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const card = btn.dataset.card;
  const extra = btn.dataset.extra;
  if (action === 'trade' && card) TradeMgr.toggleCard(card);
  else if (action === 'wish' && card) WishlistMgr.toggleCard(card);
  else if (action === 'dismiss-reprint' && card && extra) ReprintAlert.dismiss(card, extra);
  else if (action === 'move-folder' && card) {
    const sel = btn.closest('td')?.querySelector('select');
    if (sel) MyCollection.moveToFolder(card, sel.value);
  }
});


/* â•â•â• FORGE ADD CARD â€” inline search + autocomplete â•â•â•â•â•â•â•â•â•â•â• */
Object.assign(App, {
  _addAcTimer:null, _addAcIdx:-1, _addAcResults:[],

  _showAddRow(){
    const row=document.getElementById('forge-add-row');
    if(row){row.style.display='flex';document.getElementById('forge-add-inp')?.focus();}
  },
  _hideAddRow(){
    const row=document.getElementById('forge-add-row');
    if(row)row.style.display='none';
    const ac=document.getElementById('forge-add-ac');
    if(ac)ac.style.display='none';
    const inp=document.getElementById('forge-add-inp');
    if(inp)inp.value='';
    this._addAcResults=[];this._addAcIdx=-1;
  },
  _addSearch(val){
    clearTimeout(this._addAcTimer);
    const ac=document.getElementById('forge-add-ac');
    if(val.length<2){if(ac)ac.style.display='none';return;}
    this._addAcTimer=setTimeout(async()=>{
      try{
        const r=await fetch(`/api/scryfall/cards/autocomplete?q=${encodeURIComponent(val)}&include_extras=false`);
        if(!r.ok)return;
        const d=await r.json();
        this._addAcResults=d.data||[];
        this._addAcIdx=-1;
        if(!ac)return;
        if(!this._addAcResults.length){ac.style.display='none';return;}
        ac.innerHTML='';
        this._addAcResults.slice(0,8).forEach((name,i)=>{
          const item=document.createElement('div');
          item.style.cssText='padding:7px 12px;cursor:pointer;font-family:Cinzel,serif;font-size:11px;color:var(--text2);border-bottom:1px solid var(--border);transition:background .1s';
          item.textContent=name;
          item.dataset.idx=i;
          item.onmouseenter=()=>{ac.querySelectorAll('[data-idx]').forEach(el=>el.style.background='');item.style.background='var(--bg3)';this._addAcIdx=i;};
          item.onmouseleave=()=>item.style.background='';
          item.onmousedown=(e)=>{e.preventDefault();this._addCardByName(name);};
          ac.appendChild(item);
        });
        ac.style.display='block';
      }catch{}
    },200);
  },
  _addKeydown(e){
    const ac=document.getElementById('forge-add-ac');
    const items=ac?ac.querySelectorAll('[data-idx]'):[];
    if(e.key==='ArrowDown'){e.preventDefault();this._addAcIdx=Math.min(this._addAcIdx+1,items.length-1);items.forEach((el,i)=>el.style.background=i===this._addAcIdx?'var(--bg3)':'');}
    else if(e.key==='ArrowUp'){e.preventDefault();this._addAcIdx=Math.max(this._addAcIdx-1,0);items.forEach((el,i)=>el.style.background=i===this._addAcIdx?'var(--bg3)':'');}
    else if(e.key==='Enter'){e.preventDefault();const name=this._addAcIdx>=0?this._addAcResults[this._addAcIdx]:document.getElementById('forge-add-inp')?.value?.trim();if(name)this._addCardByName(name);}
    else if(e.key==='Escape')this._hideAddRow();
  },
  _addCardCommit(){
    const val=(document.getElementById('forge-add-inp')?.value||'').trim();
    if(val)this._addCardByName(val);
  },
  _addCardByName(name){
    const deck=Store.getDeck(this.curId);
    if(!deck){Notify.show('Select a deck first','err');return;}
    const existing=deck.cards.find(c=>c.name.toLowerCase()===name.toLowerCase());
    if(existing){existing.qty++;Store.updDeck(deck);this.render();Notify.show(name+' qty +1','ok');}
    else{deck.cards.push({name,qty:1,foil:false,etched:false});Store.updDeck(deck);this._fetchCards(deck);Notify.show('Added '+name,'ok');}
    this._hideAddRow();
  }
});


/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   SCRYFALL BULK CACHE
   Downloads oracle_cards (~20MB) from Scryfall on first boot,
   stores all ~30k cards in IDB. Subsequent lookups: 0ms.
   Auto-refresh weekly in background (silent, incremental).
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

/* â•â•â• CARD ENRICHMENT â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   After any import: fill set + collector_number from local IDB
   cache for cards that don't already have them.
   Uses the cached scryfall_id + set + collector_number from _slim().
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
async function enrichDeckCards(deck){
  if(!deck?.cards?.length)return;
  const needsEnrich=deck.cards.filter(c=>
    (c.set&&!c.collector_number)||
    (c.collector_number&&!c.set)||
    (c.scryfall_id&&(!c.set||!c.collector_number))
  );
  if(!needsEnrich.length)return;
  await Store.warmCards(needsEnrich.map(c=>c.name));
  for(const c of needsEnrich){
    const cd=Store.card(c.name);
    if(!cd)continue;
    const sameSet=!c.set||!cd.set||c.set===cd.set;
    const sameCollector=!c.collector_number||!cd.collector_number||c.collector_number===cd.collector_number;
    const sameScryfall=!c.scryfall_id||!cd.scryfall_id||c.scryfall_id===cd.scryfall_id;
    if(!(sameSet&&sameCollector&&sameScryfall))continue;
    if(!c.set&&cd.set) c.set=cd.set;
    if(!c.collector_number&&cd.collector_number) c.collector_number=cd.collector_number;
    if(!c.scryfall_id&&cd.scryfall_id) c.scryfall_id=cd.scryfall_id;
  }
}


/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   CARD SEARCH â€” full Scryfall search with add-to-deck/wish
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
App.init();

/* Service worker registration moved to js/auth.js */

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   CARD SEARCH 2 â€” standalone section (mirrors CardSearch from vault)
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const CardSearch2={
  _page:null,_query:'',_acTimer:null,

  init(){
    this._populateDeckSel();
  },

  _populateDeckSel(){
    const sel=document.getElementById('cs2-target-deck');
    if(!sel)return;
    const prev=sel.value;
    sel.innerHTML='<option value="">â€” Add to deck â€”</option>';
    Store.decks.forEach(d=>{
      const o=document.createElement('option');
      o.value=d.id;o.textContent=d.name+(d.commander?' Â· '+d.commander.split(',')[0]:'');
      sel.appendChild(o);
    });
    if(prev)sel.value=prev;
  },

  onType(val){
    SearchSuggest.onType({
      key:'cs2-suggest',
      inputId:'cs2-query',
      deckId:'cs2-target-deck',
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
      key:'cs2-suggest',
      inputId:'cs2-query',
      e,
      onOpen:(name)=>this._openFromSuggest(name),
      search:()=>this.search()
    });
  },

  _buildQuery(){
    const q=(document.getElementById('cs2-query')?.value||'').trim();
    const color=document.getElementById('cs2-color')?.value||'';
    const type=document.getElementById('cs2-type')?.value||'';
    const rarity=document.getElementById('cs2-rarity')?.value||'';
    const cmc=document.getElementById('cs2-cmc')?.value||'';
    let parts=[];
    if(q)parts.push(q);
    if(color)parts.push('color<='+color);
    if(type)parts.push('type:'+type);
    if(rarity)parts.push('rarity:'+rarity);
    if(cmc)parts.push(cmc==='6'?'cmc>=6':'cmc='+cmc);
    return parts.join(' ')||'commander';
  },

  async search(){
    SearchSuggest.hide('cs2-suggest');
    const query=this._buildQuery();
    if(!query)return;
    this._query=query;this._page=null;
    const status=document.getElementById('cs2-status');
    const grid=document.getElementById('cs2-results');
    const more=document.getElementById('cs2-load-more');
    const sb=document.getElementById('search-sb-count');
    if(status)status.textContent='Searchingâ€¦';
    if(grid)grid.innerHTML='';
    if(more)more.style.display='none';
    try{
      const url=`/api/scryfall/cards/search?q=${encodeURIComponent(query)}&order=edhrec&unique=cards`;
      const r=await fetch(url);
      if(!r.ok){if(status)status.textContent='No results.';return;}
      const d=await r.json();
      this._page=d.has_more?d.next_page:null;
      if(status)status.textContent=`${d.total_cards||d.data.length} results`;
      if(sb)sb.textContent=d.total_cards||d.data.length;
      this._renderCards(d.data||[],grid,false);
      if(more)more.style.display=this._page?'block':'none';
    }catch(e){if(status)status.textContent='Search failed: '+e.message;}
  },

  async loadMore(){
    if(!this._page)return;
    const grid=document.getElementById('cs2-results');
    const more=document.getElementById('cs2-load-more');
    if(more)more.textContent='Loadingâ€¦';
    try{
      const r=await fetch(this._page);
      if(!r.ok)return;
      const d=await r.json();
      this._page=d.has_more?d.next_page:null;
      this._renderCards(d.data||[],grid,true);
      if(more){more.textContent='Load more results';more.style.display=this._page?'block':'none';}
    }catch{}
  },

  _renderCards(cards,grid,append){
    if(!grid)return;
    if(!append)grid.innerHTML='';
    const deckId=document.getElementById('cs2-target-deck')?.value||'';
    cards.forEach(card=>{
      const slim=SF._slim(card);
      if(slim)Store.setCard(slim.name,slim);
      const f=card.card_faces?.[0]||card;
      const imgUrl=f.image_uris?.normal||card.image_uris?.normal||'';
      const price=card.prices?.eur||'';
      const rarityClass={common:'cs-rarity-c',uncommon:'cs-rarity-u',rare:'cs-rarity-r',mythic:'cs-rarity-m'}[card.rarity]||'';
      const el=document.createElement('div');
      el.className='cs-card';
      el.innerHTML=`
        ${imgUrl?`<img class="cs-card-img" src="${esc(imgUrl)}" loading="lazy">`:'<div class="cs-card-img" style="background:var(--bg3);display:flex;align-items:center;justify-content:center;color:var(--text3)">ðŸƒ</div>'}
        <div class="cs-card-body">
          <div class="cs-card-name">${esc(card.name)}</div>
          <div class="cs-card-meta">
            <span class="${rarityClass}">${card.rarity||''}</span>
            ${price?`<span class="cs-card-price">&euro;${price}</span>`:''}
          </div>
        </div>
        <div class="cs-actions">
          <button class="cs-action-btn gold" onclick="CardSearch2._addToDeck('${esc(card.name)}','${deckId}')">Add to Deck</button>
          <button class="cs-action-btn purple" onclick="WishSection.addByName('${esc(card.name)}')">Wishlist</button>
          <button class="cs-action-btn" onclick="TradeSection.addByName('${esc(card.name)}')">Trade Cards</button>
          <button class="cs-action-btn" onclick="M.open({name:'${esc(card.name)}',qty:1},null)">Open</button>
        </div>`;
      attachTapPop(el);
      el.querySelectorAll('.cs-action-btn').forEach(btn=>btn.addEventListener('click',e=>e.stopPropagation()));
      el.addEventListener('click',()=>M.open({name:card.name,qty:1},null));
      grid.appendChild(el);
    });
  },

  _addToDeck(name,deckId){
    const id=deckId||document.getElementById('cs2-target-deck')?.value||'';
    if(!id){Notify.show('Select a deck first','err');return;}
    const deck=Store.getDeck(id);
    if(!deck){Notify.show('Deck not found','err');return;}
    const existing=deck.cards.find(c=>c.name.toLowerCase()===name.toLowerCase());
    if(existing){existing.qty++;Store.updDeck(deck);Notify.show(name+' qty +1','ok');}
    else{deck.cards.push({name,qty:1,foil:false,etched:false});Store.updDeck(deck);Notify.show('Added '+name,'ok');}
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
  }
};


/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   COLL SECTION â€” standalone collection section
   Wraps MyCollection logic with new IDs (coll2-*)
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const CollSection={
  _view:'grid',
  _scope:'all',
  _filtered:[],

  render(){
    MyCollection?.load?.();
    MyCollection?._ensurePersonalBulkPanels?.();
    MyCollection?._ensureScopeFilters?.();
    this._scope=MyCollection?._scope||'all';
    this._updateKPIs();
    this._renderFolders();
    this._populateFolderFilter();
    this.filter();
  },

  _data(){return MyCollection?MyCollection._allCards():[]; /* aggregates from all decks */},

  _updateKPIs(){
    const data=this._data();
    const unique=new Set(data.map(r=>r.name)).size;
    const total=data.reduce((s,r)=>s+(r.qty||1),0);
    const val=data.reduce((s,r)=>s+(parseFloat(MyCollection._cardData(r)?.prices?.eur||0)*(r.qty||1)),0);
    const foils=data.filter(r=>r.foil).length;
    const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
    set('coll2-kpi-unique',unique);set('coll2-kpi-total',total);
    set('coll2-kpi-value','EUR '+val.toFixed(0));set('coll2-kpi-foils',foils);
  },

  _renderFolders(){
    MyCollection?.load?.(); const folders=MyCollection?MyCollection._folders||[]:[];
    const grid=document.getElementById('coll2-folders');
    const sb=document.getElementById('coll-folder-sidebar');
    if(!grid)return;
    if(!folders.length){grid.innerHTML='<div style="color:var(--text3);font-size:12px;padding:8px 0">No folders yet â€” create one to organise your cards.</div>';return;}
    grid.innerHTML='';
    folders.forEach(f=>{
      const count=(this._data()||[]).filter(r=>r.folder===f.id).reduce((sum,r)=>sum+(r.qty||1),0);
      const el=document.createElement('div');
      el.className='folder-card';el.style.cursor='pointer';
      el.innerHTML=`<div class="folder-icon">ðŸ“</div><div class="folder-name">${esc(f.name)}</div><div class="folder-count">${count} cards</div>`;
      el.onclick=()=>{
        document.getElementById('coll2-folder-filter').value=f.id;
        this.filter();
      };
      attachTapPop(el);
      grid.appendChild(el);
    });
    // Update sidebar folder list
    if(sb){
      sb.innerHTML='<div style="font-size:10px;color:var(--text3);padding:4px 8px 8px;text-transform:uppercase;letter-spacing:.08em;font-family:Cinzel,serif">Folders</div>';
      const allBtn=document.createElement('div');
      allBtn.className='vn-item on';allBtn.style.cursor='pointer';
      allBtn.innerHTML='<div class="vn-ico">ðŸ“‹</div><div><div class="vn-label">All Cards</div></div>';
      allBtn.onclick=()=>{document.getElementById('coll2-folder-filter').value='';this.filter();};
      sb.appendChild(allBtn);
      folders.forEach(f=>{
        const count=(this._data()||[]).filter(r=>r.folder===f.id).reduce((sum,r)=>sum+(r.qty||1),0);
        const btn=document.createElement('div');
        btn.className='vn-item';btn.style.cursor='pointer';
        btn.innerHTML=`<div class="vn-ico">ðŸ“</div><div><div class="vn-label">${esc(f.name)}</div><div class="vn-sub">${count} cards</div></div>`;
        btn.onclick=()=>{document.getElementById('coll2-folder-filter').value=f.id;this.filter();};
        sb.appendChild(btn);
      });
    }
  },

  _populateFolderFilter(){
    const sel=document.getElementById('coll2-folder-filter');
    if(!sel)return;
    const prev=sel.value;
    sel.innerHTML='<option value="">All folders</option>';
    (MyCollection?MyCollection._folders||[]:[]).forEach(f=>{
      const o=document.createElement('option');o.value=f.id;o.textContent=f.name;sel.appendChild(o);
    });
    if(prev)sel.value=prev;
  },

  filter(){
    const srch=(document.getElementById('coll2-search')?.value||'').toLowerCase();
    const folder=document.getElementById('coll2-folder-filter')?.value||'';
    const sort=document.getElementById('coll2-sort')?.value||'name';
    const scope=document.getElementById('coll2-scope-filter')?.value||this._scope||'all';
    let data=[...(this._data()||[])];
    if(srch)data=data.filter(r=>(r.name||'').toLowerCase().includes(srch));
    if(folder)data=data.filter(r=>r.folder===folder);
    if(scope==='decks')data=data.filter(r=>(r.deckQty||0)>0);
    else if(scope==='loose')data=data.filter(r=>(r.deckQty||0)===0);
    data.sort((a,b)=>{
      if(sort==='qty')return(b.qty||1)-(a.qty||1);
      if(sort==='price_desc')return(parseFloat(Store.card(b.name)?.prices?.eur||0))-(parseFloat(Store.card(a.name)?.prices?.eur||0));
      if(sort==='rarity'){const order={mythic:0,rare:1,uncommon:2,common:3};return(order[Store.card(a.name)?.rarity]??4)-(order[Store.card(b.name)?.rarity]??4);}
      return(a.name||'').localeCompare(b.name||'');
    });
    this._filtered=data;
    const title=document.getElementById('coll2-folder-title');
    if(title){
      const folderObj=(MyCollection?MyCollection._folders||[]:[]).find(f=>f.id===folder);
      title.textContent=folderObj?folderObj.name:'All Cards';
    }
    const cnt=document.getElementById('coll2-card-count');
    if(cnt)cnt.textContent=data.reduce((sum,r)=>sum+(r.qty||1),0)+' cards';
    this._renderCards();
  },

  setScope(scope){
    this._scope=scope||'all';
    if(typeof MyCollection!=='undefined')MyCollection._scope=this._scope;
    MyCollection?._syncScopeFilters?.();
    this.filter();
  },

  setView(v){
    this._view=v;
    ['grid','list'].forEach(t=>{
      const b=document.getElementById('coll2-vt-'+t);
      if(b)b.classList.toggle('on',t===v);
    });
    this._renderCards();
  },

  _renderCards(){
    const area=document.getElementById('coll2-card-area');
    if(!area)return;
    const data=this._filtered;
    if(!data.length){area.innerHTML='<div style="padding:40px;text-align:center;color:var(--text3)">No cards match.</div>';return;}

    // Fetch missing card data
    const missing=data.filter(r=>!MyCollection._cardData(r)?.name);
    if(missing.length){
      SF.fetchBatch(missing.map(r=>MyCollection._fetchRef(r)),()=>{}).then(()=>this._renderCards());
    }

    if(this._view==='grid'){
      area.innerHTML='';
      const grid=document.createElement('div');
      grid.style.cssText='display:grid;grid-template-columns:repeat(auto-fill,minmax(152px,1fr));gap:12px';
      data.forEach(r=>{
        const cd=MyCollection._cardData(r)||{};
        const img=cd.img?.normal||cd.img?.crop||'';
        const el=document.createElement('div');
        el.className='ct';el.style.cursor='pointer';
        el.title=r.name;
        el.innerHTML=`
          <div class="ct-img">${img?`<img src="${esc(img)}" loading="lazy" alt="${esc(r.name)}">`:'<div style="width:100%;aspect-ratio:2.5/3.5;background:var(--bg3);display:flex;align-items:center;justify-content:center;color:var(--text3);font-size:24px">ðŸƒ</div>'}</div>
          ${(r.qty||1)>1?`<div class="ct-qty">${r.qty}Ã—</div>`:''}
          ${r.foil?'<div class="ct-foil">âœ¦ Foil</div>':''}
          <div class="ct-info"><div class="ct-name">${esc(r.name)}</div>
            <div class="ct-foot"><span class="ct-type" style="font-size:9px">${esc(cd.type_line?.split('â€”')[0]?.trim()||'')}</span>
            ${cd.prices?.eur?`<span class="ct-price">&euro;${cd.prices.eur}</span>`:''}</div>
          </div>`;
        el.onclick=()=>M.open({name:r.name,qty:r.qty||1},null);
        attachTapPop(el);
      grid.appendChild(el);
      });
      area.appendChild(grid);
    } else {
      // List view
      area.innerHTML='';
      const tbl=document.createElement('table');
      tbl.className='';tbl.style.cssText='width:100%;border-collapse:collapse';
      tbl.innerHTML='<thead><tr style="border-bottom:1px solid var(--border)"><th style="width:38px"></th><th style="text-align:left;padding:6px 8px;font-family:Cinzel,serif;font-size:10px;color:var(--text3)">Name</th><th style="text-align:left;padding:6px 8px;font-family:Cinzel,serif;font-size:10px;color:var(--text3)">Type</th><th style="padding:6px 8px;font-family:Cinzel,serif;font-size:10px;color:var(--text3)">Qty</th><th style="padding:6px 8px;font-family:Cinzel,serif;font-size:10px;color:var(--text3)">Price</th><th style="padding:6px 8px;font-family:Cinzel,serif;font-size:10px;color:var(--text3)">Folder</th></tr></thead>';
      const tbody=document.createElement('tbody');
      data.forEach(r=>{
        const cd=MyCollection._cardData(r)||{};
        const img=cd.img?.crop||cd.img?.normal||'';
        const tr=document.createElement('tr');
        tr.style.cssText='border-bottom:1px solid var(--border);cursor:pointer;transition:background .1s';
        tr.onmouseenter=()=>tr.style.background='var(--bg3)';
        tr.onmouseleave=()=>tr.style.background='';
        tr.innerHTML=`
          <td style="padding:6px 8px">${img?`<img src="${esc(img)}" style="width:30px;height:42px;object-fit:cover;border-radius:3px;display:block" loading="lazy">`:'<div style="width:30px;height:42px;background:var(--bg3);border-radius:3px"></div>'}</td>
          <td style="padding:6px 8px;font-family:Cinzel,serif;font-size:11px;color:var(--text)">${esc(r.name)}${r.foil?' <span style="color:var(--purple2);font-size:9px">âœ¦</span>':''}</td>
          <td style="padding:6px 8px;font-size:10px;color:var(--text3)">${esc((cd.type_line||'').split('â€”')[0].trim())}</td>
          <td style="padding:6px 8px;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--gold2);text-align:center">${r.qty||1}</td>
          <td style="padding:6px 8px;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--green2)">${cd.prices?.eur?'&euro;'+cd.prices.eur:'—'}</td>
          <td style="padding:6px 8px;font-size:10px;color:var(--text3)">${esc(r.folder||'')}</td>`;
        tr.onclick=()=>M.open({name:r.name,qty:r.qty||1},null);
        tbody.appendChild(tr);
      });
      tbl.appendChild(tbody);
      area.appendChild(tbl);
    }
  },

  addCard(){
    // Show a quick add-card prompt
    const name=prompt('Card name to add to collection:');
    if(!name?.trim())return;
    // Add to first deck as a collection entry or use MyCollection flow
    if(typeof MyCollection!=='undefined'&&MyCollection.addCard){MyCollection.addCard();}
    else{Notify.show('Use your decks â€” cards there appear here automatically','inf',4000);}
  },

  newFolder(){
    if(typeof MyCollection!=='undefined')MyCollection.newFolder();
    else Notify.show('Collection not loaded','err');
  }
};


/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   WISH SECTION â€” standalone wishlist section
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const WishSection={
  _acTimer:null,_acResults:[],_acIdx:-1,

  render(){
    if(!DB._sb||!DB._user){
      const list=document.getElementById('wish2-list');
      const empty=document.getElementById('wish2-empty');
      if(list)list.innerHTML='<div style="padding:24px;text-align:center;color:var(--text3);font-size:12px;font-family:JetBrains Mono,monospace">Checking sessionâ€¦</div>';
      if(empty)empty.style.display='none';
      clearTimeout(this._authWait);
      this._authWait=setTimeout(()=>{
        if(DB._user)return;
        if(list)list.innerHTML='';
        if(empty)empty.style.display='block';
      },4000);
      return;
    }
    clearTimeout(this._authWait);
    const list=document.getElementById('wish2-list');
    if(list)list.innerHTML='<div style="padding:16px;color:var(--text3);font-size:12px;font-family:JetBrains Mono,monospace">Loadingâ€¦</div>';
    WishlistMgr.render().then(()=>this._renderList());
    this._updateBadge();
  },

  _updateBadge(){
    const count=(WishlistMgr._data||[]).length;
    const badge=document.getElementById('wish-nav-badge');
    const sb=document.getElementById('wish-sb-count');
    if(badge){badge.textContent=count||'';badge.classList.toggle('show',count>0);}
    if(sb)sb.textContent=count;
  },

  _renderList(){
    const list=document.getElementById("wish2-list");
    const empty=document.getElementById("wish2-empty");
    if(!list)return;
    const data=WishlistMgr._data||[];
    this._updateBadge();
    if(!data.length){list.innerHTML="";if(empty)empty.style.display="block";return;}
    if(empty)empty.style.display="none";
    // warmCards loads IDB data; SF.fetch fills missing; render once at end
    const names=data.map(r=>r.card_name).filter(Boolean);
    Store.warmCards(names).then(()=>{
      const missing=data.filter(r=>!Store.card(r.card_name)?.img);
      if(missing.length){
        let done=0;
        missing.forEach(r=>SF.fetch(r.card_name,()=>{
          done++;
          if(done>=missing.length)this._buildWishList(data,list);
        }));
        this._buildWishList(data,list); // immediate render with cached data
      } else {
        this._buildWishList(data,list);
      }
    });
  },

  _buildWishList(data,list){
    if(!list)return;
    list.innerHTML="";
    data.forEach(r=>{
      const cd=Store.card(r.card_name)||{};
      const img=cd.img&&(cd.img.crop||cd.img.normal)||"";
      const price=parseFloat(cd.prices&&cd.prices.eur||0);
      const row=document.createElement("div");
      row.className="trade-card";
      row.style.cursor="pointer";
      const thumb=img
        ? '<img class="bulk-pool-thumb" src="'+esc(img)+'" loading="lazy" style="width:48px;height:67px;object-fit:cover;border-radius:4px;flex-shrink:0">'
        : '<div style="width:48px;height:67px;background:var(--bg3);border-radius:4px;flex-shrink:0;border:1px solid var(--border)"></div>';
      const note=r.note?esc(r.note)+" · ":"";
      const priceStr=price?"€"+price.toFixed(2):"no price data";
      row.innerHTML=thumb
        +'<div style="flex:1;min-width:0">'
        +'<div class="bulk-pool-name" style="font-size:13px">'+esc(r.card_name)+"</div>"
        +'<div class="bulk-pool-meta">'+note+priceStr+"</div>"
        +"</div>"
        +'<span class="trade-badge want">Wanted</span>';
      const delBtn=document.createElement('button');
      delBtn.className='alert-del';
      delBtn.title='Remove';
      delBtn.textContent='X';
      delBtn.addEventListener('click',e=>{e.stopPropagation();WishSection.remove(r.id);});
      row.appendChild(delBtn);
      row.addEventListener("click",e=>{
        if(e.target.closest(".alert-del"))return;
        M.open({name:r.card_name,qty:1},null);
      });
      list.appendChild(row);
    });
  },

  onType(val){
    clearTimeout(this._acTimer);
    const ac=document.getElementById('wish2-autocomplete');
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
          item.onmousedown=e=>{e.preventDefault();document.getElementById('wish2-add-name').value=name;ac.style.display='none';};
          ac.appendChild(item);
        });
        ac.style.display='block';
      }catch{}
    },200);
  },

  onKey(e){
    const ac=document.getElementById('wish2-autocomplete');
    const items=ac?ac.querySelectorAll('[data-idx]'):[];
    if(e.key==='ArrowDown'){e.preventDefault();this._acIdx=Math.min(this._acIdx+1,items.length-1);items.forEach((el,i)=>el.style.background=i===this._acIdx?'var(--bg3)':'');}
    else if(e.key==='ArrowUp'){e.preventDefault();this._acIdx=Math.max(this._acIdx-1,0);items.forEach((el,i)=>el.style.background=i===this._acIdx?'var(--bg3)':'');}
    else if(e.key==='Enter'){e.preventDefault();this.add();}
    else if(e.key==='Escape'){if(ac)ac.style.display='none';}
  },

  async add(){
    const nameEl=document.getElementById('wish2-add-name');
    const noteEl=document.getElementById('wish2-add-note');
    const name=(nameEl?.value||'').trim();
    const note=(noteEl?.value||'').trim();
    if(!name){Notify.show('Enter a card name','err');return;}
    if(!DB._sb||!DB._user){Notify.show('Sign in to use Wishlist','err');return;}
    const {error}=await DB._sb.from('wishlist').insert({card_name:name,note,user_id:DB._user.id,user_email:DB._user.email||''});
    if(error){Notify.show('Could not add to wishlist','err');return;}
    Notify.show(name+' added to wishlist','ok');
    if(nameEl)nameEl.value='';
    if(noteEl)noteEl.value='';
    const ac=document.getElementById('wish2-autocomplete');if(ac)ac.style.display='none';
    await WishlistMgr.render();
    this._renderList();
  },

  addByName(name,note=''){
    return WishlistMgr.addByName?.(name,note);
  },

  async remove(id){
    if(!DB._sb||!DB._user)return;
    await DB._sb.from('wishlist').delete().eq('id',id).eq('user_id',DB._user.id);
    await WishlistMgr.render();
    this._renderList();
  }
};


/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   TRADE SECTION â€” standalone trade section
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const TradeSection={
  render(){
    if(!DB._sb||!DB._user){
      const list=document.getElementById('trade2-list');
      const empty=document.getElementById('trade2-empty');
      if(list)list.innerHTML='<div style="padding:24px;text-align:center;color:var(--text3);font-size:12px;font-family:JetBrains Mono,monospace">Checking session...</div>';
      if(empty)empty.style.display='none';
      clearTimeout(this._authWait);
      this._authWait=setTimeout(()=>{
        if(DB._user)return;
        if(list)list.innerHTML='';
        if(empty)empty.style.display='block';
      },4000);
      return;
    }
    clearTimeout(this._authWait);
    const list=document.getElementById('trade2-list');
    if(list)list.innerHTML='<div style="padding:16px;color:var(--text3);font-size:12px;font-family:JetBrains Mono,monospace">Loading...</div>';
    TradeMgr.render().then(()=>this._renderList());
    this._updateBadge();
  },

  _updateBadge(){
    const count=(TradeMgr._data||[]).length;
    const badge=document.getElementById('trade-nav-badge');
    const sb=document.getElementById('trade-sb-count');
    if(badge){badge.textContent=count||'';badge.classList.toggle('show',count>0);}
    if(sb)sb.textContent=count;
  },

  _renderList(){
    const list=document.getElementById("trade2-list");
    const empty=document.getElementById("trade2-empty");
    if(!list)return;
    const data=TradeMgr._data||[];
    this._updateBadge();
    if(!data.length){list.innerHTML="";if(empty)empty.style.display="block";return;}
    if(empty)empty.style.display="none";
    const names=data.map(r=>r.card_name).filter(Boolean);
    Store.warmCards(names).then(()=>{
      const missing=data.filter(r=>!Store.card(r.card_name)?.img);
      if(missing.length){
        let done=0;
        missing.forEach(r=>SF.fetch(r.card_name,()=>{
          done++;
          if(done>=missing.length)this._buildTradeList(data,list);
        }));
        this._buildTradeList(data,list);
      } else {
        this._buildTradeList(data,list);
      }
    });
  },

  _buildTradeList(data,list){
    if(!list)return;
    list.innerHTML="";
    data.forEach(r=>{
      const cd=Store.card(r.card_name)||{};
      const img=cd.img&&(cd.img.crop||cd.img.normal)||"";
      const price=parseFloat(cd.prices&&cd.prices.eur||0);
      const priceLine=r.price_usd?"€"+parseFloat(r.price_usd).toFixed(2):price?"€"+price.toFixed(2):"";
      const row=document.createElement("div");
      row.className="trade-card";
      row.style.cursor="pointer";
      const thumb=img
        ? '<img class="bulk-pool-thumb" src="'+esc(img)+'" loading="lazy" style="width:48px;height:67px;object-fit:cover;border-radius:4px;flex-shrink:0">'
        : '<div style="width:48px;height:67px;background:var(--bg3);border-radius:4px;flex-shrink:0;border:1px solid var(--border)"></div>';
      row.innerHTML=thumb
        +'<div style="flex:1;min-width:0">'
        +'<div class="bulk-pool-name" style="font-size:13px">'+esc(r.card_name)+"</div>"
        +'<div class="bulk-pool-meta">'+( r.qty||1)+"x "+(r.condition||"NM")+(priceLine?" "+priceLine:"")+"</div>"
        +"</div>"
        +'<span style="background:rgba(58,122,74,.15);color:var(--green2);border:1px solid var(--green);border-radius:3px;padding:2px 7px;font-size:9px;white-space:nowrap;flex-shrink:0">For Trade</span>';
      const delBtn=document.createElement('button');
      delBtn.className='alert-del';
      delBtn.title='Remove';
      delBtn.textContent='X';
      delBtn.addEventListener('click',e=>{e.stopPropagation();TradeSection.remove(r.id);});
      row.appendChild(delBtn);
      row.addEventListener("click",e=>{
        if(e.target.closest(".alert-del"))return;
        M.open({name:r.card_name,qty:r.qty||1},null);
      });
      list.appendChild(row);
    });
  },

  onType(val){
    clearTimeout(this._acTimer);
    const ac=document.getElementById('trade2-autocomplete');
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
          item.onmousedown=e=>{e.preventDefault();document.getElementById('trade2-add-name').value=name;ac.style.display='none';};
          ac.appendChild(item);
        });
        ac.style.display='block';
      }catch{}
    },200);
  },

  onKey(e){
    const ac=document.getElementById('trade2-autocomplete');
    const items=ac?ac.querySelectorAll('[data-idx]'):[];
    if(e.key==='ArrowDown'){e.preventDefault();this._acIdx=Math.min(this._acIdx+1,items.length-1);items.forEach((el,i)=>el.style.background=i===this._acIdx?'var(--bg3)':'');}
    else if(e.key==='ArrowUp'){e.preventDefault();this._acIdx=Math.max(this._acIdx-1,0);items.forEach((el,i)=>el.style.background=i===this._acIdx?'var(--bg3)':'');}
    else if(e.key==='Enter'){e.preventDefault();this.add();}
    else if(e.key==='Escape'){if(ac)ac.style.display='none';}
  },

  async add(){
    const nameEl=document.getElementById('trade2-add-name');
    const priceEl=document.getElementById('trade2-add-price');
    const name=(nameEl?.value||'').trim();
    if(!name){Notify.show('Enter a card name','err');return;}
    if(!DB._sb||!DB._user){Notify.show('Sign in to use Trade Tracker','err');return;}
    const qty=parseInt(document.getElementById('trade2-add-qty')?.value||'1')||1;
    const cond=document.getElementById('trade2-add-cond')?.value||'NM';
    const priceRaw=(priceEl?.value||'').trim();
    const priceNum=priceRaw?parseFloat(priceRaw):null;
    const payload={card_name:name,qty,condition:cond,user_id:DB._user.id,user_email:DB._user.email||''};
    if(Number.isFinite(priceNum))payload.price_usd=priceNum;
    const {error}=await DB._sb.from('trade_list').insert(payload);
    if(error){Notify.show('Could not add to trade list','err');return;}
    Notify.show(name+' listed for trade','ok');
    if(nameEl)nameEl.value='';
    if(priceEl)priceEl.value='';
    TradeAC?.hide?.('trade2-add-name');
    await TradeMgr.render();
    this._renderList();
  },

  addByName(name,note=''){
    const input=document.getElementById('trade2-add-name');
    if(input)input.value=name;
    return this.add();
  },

  async remove(id){
    if(!DB._sb||!DB._user)return;
    await DB._sb.from('trade_list').delete().eq('id',id).eq('user_id',DB._user.id);
    await TradeMgr.render();
    this._renderList();
  }
};

const TradeAC={
  _states:{},
  _previewCache:{},
  _cfg(inputId){
    return inputId==='trade2-add-name'
      ? {input:'trade2-add-name',ac:'trade2-autocomplete',preview:'trade2-preview',submit:()=>TradeSection.add()}
      : {input:'trade-add-name',ac:'trade-autocomplete',preview:'trade-preview',submit:()=>TradeMgr.add()};
  },
  _state(inputId){
    return this._states[inputId]||(this._states[inputId]={timer:null,items:[],idx:-1,previewTimer:null});
  },
  hide(inputId){
    const cfg=this._cfg(inputId); const ac=document.getElementById(cfg.ac); const pv=document.getElementById(cfg.preview);
    if(ac)ac.style.display='none'; if(pv)pv.style.display='none';
    const st=this._state(inputId); st.idx=-1;
  },
  async onType(inputId,val){
    const st=this._state(inputId); const cfg=this._cfg(inputId);
    clearTimeout(st.timer);
    const ac=document.getElementById(cfg.ac);
    if(!val||val.trim().length<2){ if(ac)ac.style.display='none'; this.hide(inputId); return; }
    st.timer=setTimeout(async()=>{
      try{
        const r=await fetch(`/api/scryfall/cards/autocomplete?q=${encodeURIComponent(val.trim())}&include_extras=false`,{headers:{'Accept':'application/json'}});
        if(!r.ok)return;
        const d=await r.json();
        st.items=(d.data||[]).slice(0,12); st.idx=-1;
        if(!ac||!st.items.length){ if(ac)ac.style.display='none'; const pv=document.getElementById(cfg.preview); if(pv)pv.style.display='none'; return; }
        ac.innerHTML='';
        st.items.forEach((name,i)=>{
          const item=document.createElement('div');
          item.dataset.idx=i;
          item.style.cssText='padding:8px 10px;cursor:pointer;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;gap:10px';
          item.innerHTML=`<span>${esc(name)}</span><span style="color:var(--text3);font-size:10px">â†µ add</span>`;
          item.onmouseenter=()=>{ st.idx=i; this._paint(inputId); this._showPreview(inputId,name); };
          item.onmouseleave=()=>{};
          item.onmousedown=(e)=>{ e.preventDefault(); this.select(inputId,i,true); };
          ac.appendChild(item);
        });
        ac.style.display='block';
      }catch{}
    },180);
  },
  _paint(inputId){
    const cfg=this._cfg(inputId); const ac=document.getElementById(cfg.ac); const st=this._state(inputId); if(!ac)return;
    ac.querySelectorAll('[data-idx]').forEach((el,i)=>{ el.style.background=i===st.idx?'var(--bg3)':''; el.style.color=i===st.idx?'var(--gold2)':'var(--text2)'; });
  },
  async _fetchPreviewCard(name){
    if(this._previewCache[name])return this._previewCache[name];
    const cached=Store.card?.(name); if(cached?.img?.normal||cached?.img?.crop){ this._previewCache[name]=cached; return cached; }
    try{
      const r=await fetch(`/api/scryfall/cards/named?exact=${encodeURIComponent(name)}`,{headers:{'Accept':'application/json'}});
      if(!r.ok)return null;
      const d=await r.json();
      const slim=SF._slim?SF._slim(d):d;
      if(Store.setCard && slim?.name)Store.setCard(slim.name,slim);
      this._previewCache[name]=slim;
      return slim;
    }catch{return null;}
  },
  async _showPreview(inputId,name){
    const st=this._state(inputId); const cfg=this._cfg(inputId); const pv=document.getElementById(cfg.preview); if(!pv)return;
    clearTimeout(st.previewTimer);
    st.previewTimer=setTimeout(async()=>{
      pv.style.display='block';
      pv.innerHTML='<div style="font-size:11px;color:var(--text3)">Loading previewâ€¦</div>';
      const cd=await this._fetchPreviewCard(name);
      const img=cd?.img?.normal||cd?.img?.crop||'';
      const setInfo=cd?.set?`${String(cd.set).toUpperCase()}${cd.collector_number?' #'+cd.collector_number:''}`:'Unknown print';
      const type=cd?.type_line||'';
      const price=cd?.prices?.eur?`EUR ${cd.prices.eur}`:'';
      pv.innerHTML=`${img?`<img src="${esc(img)}" alt="${esc(name)}" style="width:100%;border-radius:6px;border:1px solid var(--border);margin-bottom:8px">`:''}<div style="font-family:Cinzel,serif;font-size:12px;color:var(--gold2);margin-bottom:4px">${esc(name)}</div><div style="font-size:10px;color:var(--ice);margin-bottom:3px">${esc(setInfo)}</div><div style="font-size:10px;color:var(--text3);line-height:1.4">${esc(type)}</div>${price?`<div style="font-size:11px;color:var(--green2);margin-top:6px">${esc(price)}</div>`:''}`;
    },120);
  },
  select(inputId,i,autoSubmit=false){
    const st=this._state(inputId); const cfg=this._cfg(inputId); const input=document.getElementById(cfg.input); const name=st.items[i];
    if(!name||!input)return;
    input.value=name;
    input.dispatchEvent(new Event('input'));
    this.hide(inputId);
    if(autoSubmit)cfg.submit();
  },
  onKey(inputId,e){
    const st=this._state(inputId); const cfg=this._cfg(inputId); const ac=document.getElementById(cfg.ac); const items=ac?ac.querySelectorAll('[data-idx]'):[];
    if(e.key==='ArrowDown'){
      e.preventDefault();
      if(!items.length)return;
      st.idx=Math.min(st.idx+1,items.length-1);
      this._paint(inputId);
      const name=st.items[st.idx]; if(name)this._showPreview(inputId,name);
    }else if(e.key==='ArrowUp'){
      e.preventDefault();
      if(!items.length)return;
      st.idx=Math.max(st.idx-1,0);
      this._paint(inputId);
      const name=st.items[st.idx]; if(name)this._showPreview(inputId,name);
    }else if(e.key==='Enter'){
      e.preventDefault();
      if(items.length && st.idx>=0){ this.select(inputId,st.idx,true); }
      else { cfg.submit(); }
    }else if(e.key==='Escape'){
      this.hide(inputId);
    }
  }
};

Bus.on('decks:changed', ()=>{
  if(Menu?.cur==='search') CardSearch2._populateDeckSel?.();
});
