/* CommanderForge: TradeMatch */

const TradeMatch={
  _running:false,

  render(){
    // Populate nothing on load. User clicks "Find Matches".
    const sel=document.getElementById('health-deck-select');
    void sel;
  },

  async run(){
    if(this._running)return;
    if(!DB._sb||!DB._user){Notify.show('Sign in to use Trade Matching','err');return;}
    this._running=true;

    const statusEl=document.getElementById('trade-match-status');
    const btn=document.getElementById('trade-match-refresh');
    if(btn)btn.textContent='Scanning Community...';
    if(statusEl)statusEl.textContent='Loading trade lists, wishlists, and profile data...';

    this._hide(['tm-empty','tm-sec-want','tm-sec-have','tm-sec-mutual']);
    ['tm-want-list','tm-have-list','tm-mutual-list'].forEach(id=>{
      const el=document.getElementById(id);
      if(el)el.innerHTML='';
    });

    try{
      const [{data:allTrades,error:te},{data:allWishes,error:we}]=await Promise.all([
        DB._sb.from('trade_list').select('user_id,user_email,card_name,qty,condition'),
        DB._sb.from('wishlist').select('user_id,user_email,card_name,note')
      ]);
      if(te)throw te;
      if(we)throw we;

      const userIds=new Set([...(allTrades||[]).map(t=>t.user_id),...(allWishes||[]).map(w=>w.user_id)]);
      const {data:profiles}=await DB._sb.from('profiles').select('id,username,email').in('id',[...userIds]);
      const profileMap={};
      (profiles||[]).forEach(p=>{
        profileMap[p.id]={username:communityDisplayName(p.username,p.email),email:p.email||''};
      });

      const myId=DB._user.id;
      const myWishCards=new Set((allWishes||[]).filter(w=>w.user_id===myId).map(w=>w.card_name.toLowerCase()));
      const myTradeCards=new Set((allTrades||[]).filter(t=>t.user_id===myId).map(t=>t.card_name.toLowerCase()));
      const myDeckCards=new Set(Store.decks.flatMap(d=>d.cards.map(c=>c.name.toLowerCase())));

      const theyHaveMap={};
      for(const t of (allTrades||[])){
        if(t.user_id===myId)continue;
        if(!myWishCards.has(t.card_name.toLowerCase()))continue;
        if(!theyHaveMap[t.user_id])theyHaveMap[t.user_id]=[];
        theyHaveMap[t.user_id].push(t);
      }

      const theyWantMap={};
      for(const w of (allWishes||[])){
        if(w.user_id===myId)continue;
        const cardLow=w.card_name.toLowerCase();
        if(!myTradeCards.has(cardLow)&&!myDeckCards.has(cardLow))continue;
        if(!theyWantMap[w.user_id])theyWantMap[w.user_id]=[];
        theyWantMap[w.user_id].push(w);
      }

      const mutualIds=new Set([...Object.keys(theyHaveMap)].filter(id=>theyWantMap[id]));
      const wantEntries=Object.entries(theyHaveMap).sort((a,b)=>b[1].length-a[1].length);
      const haveEntries=Object.entries(theyWantMap).sort((a,b)=>b[1].length-a[1].length);

      if(wantEntries.length){
        this._show('tm-sec-want');
        const cntEl=document.getElementById('tm-want-count');
        if(cntEl)cntEl.textContent=`(${wantEntries.length} user${wantEntries.length>1?'s':''})`;
        const listEl=document.getElementById('tm-want-list');
        for(const [uid,cards] of wantEntries){
          const prof=profileMap[uid]||{username:'Unknown',email:''};
          const hue=(uid.charCodeAt(0)*17)%360;
          const card=document.createElement('div');
          card.className='match-card';
          card.innerHTML=`
            <div class="match-hdr">
              <div class="match-avatar" style="background:hsl(${hue},35%,22%);border:2px solid hsl(${hue},50%,42%)">${esc(prof.username.slice(0,1).toUpperCase())}</div>
              <div style="flex:1;min-width:0">
                <div class="match-username">${esc(prof.username)}</div>
                <div class="match-sub">Has ${cards.length} card${cards.length>1?'s':''} from your wishlist</div>
              </div>
              <div class="match-score">${cards.length} match${cards.length>1?'es':''}</div>
            </div>
            <div class="match-pills">
              ${cards.map(t=>{
                const cd=Store.card(t.card_name)||{};
                return `<span class="match-pill they-have"><span class="match-pill-label">HAVE</span>${esc(t.card_name)}${cd.prices?.eur?' - &euro;'+cd.prices.eur:''}</span>`;
              }).join('')}
            </div>
            <div class="match-actions">
              <button class="tbtn sm gold" onclick="CommunityNav.viewUser('${uid}','${esc(prof.email)}','${esc(prof.username)}')">Open Profile</button>
              ${mutualIds.has(uid)?'<span class="trade-badge have" style="align-self:center">Mutual Trade Fit</span>':''}
            </div>
          `;
          listEl.appendChild(card);
        }
      }

      if(haveEntries.length){
        this._show('tm-sec-have');
        const cntEl=document.getElementById('tm-have-count');
        if(cntEl)cntEl.textContent=`(${haveEntries.length} user${haveEntries.length>1?'s':''})`;
        const listEl=document.getElementById('tm-have-list');
        for(const [uid,wishes] of haveEntries){
          if(mutualIds.has(uid))continue;
          const prof=profileMap[uid]||{username:'Unknown',email:''};
          const hue=(uid.charCodeAt(0)*17)%360;
          const card=document.createElement('div');
          card.className='match-card';
          card.innerHTML=`
            <div class="match-hdr">
              <div class="match-avatar" style="background:hsl(${hue},35%,22%);border:2px solid hsl(${hue},50%,42%)">${esc(prof.username.slice(0,1).toUpperCase())}</div>
              <div style="flex:1;min-width:0">
                <div class="match-username">${esc(prof.username)}</div>
                <div class="match-sub">Wants ${wishes.length} card${wishes.length>1?'s':''} you already own</div>
              </div>
              <div class="match-score">${wishes.length} match${wishes.length>1?'es':''}</div>
            </div>
            <div class="match-pills">
              ${wishes.map(w=>{
                const cd=Store.card(w.card_name)||{};
                const inTrade=myTradeCards.has(w.card_name.toLowerCase());
                return `<span class="match-pill you-have"><span class="match-pill-label">${inTrade?'TRADE':'HAVE'}</span>${esc(w.card_name)}${cd.prices?.eur?' - &euro;'+cd.prices.eur:''}</span>`;
              }).join('')}
            </div>
            <div class="match-actions">
              <button class="tbtn sm" onclick="CommunityNav.viewUser('${uid}','${esc(prof.email)}','${esc(prof.username)}')">Open Profile</button>
            </div>
          `;
          listEl.appendChild(card);
        }
      }

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
          card.className='match-card mutual';
          card.innerHTML=`
            <div class="match-hdr">
              <div class="match-avatar" style="background:hsl(${hue},35%,22%);border:2px solid hsl(${hue},50%,42%)">${esc(prof.username.slice(0,1).toUpperCase())}</div>
              <div style="flex:1;min-width:0">
                <div class="match-username">${esc(prof.username)}</div>
                <div class="match-sub">Strong two-way trade opportunity</div>
              </div>
              <span class="trade-badge have" style="font-size:11px">Mutual - ${theyHave.length+theyWant.length} cards</span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px">
              <div>
                <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--green2);margin-bottom:5px;text-transform:uppercase">They have - you want</div>
                <div class="match-pills">${theyHave.map(t=>`<span class="match-pill they-have">${esc(t.card_name)}</span>`).join('')}</div>
              </div>
              <div>
                <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--gold2);margin-bottom:5px;text-transform:uppercase">They want - you have</div>
                <div class="match-pills">${theyWant.map(w=>`<span class="match-pill you-have">${esc(w.card_name)}</span>`).join('')}</div>
              </div>
            </div>
            <div class="match-actions">
              <button class="tbtn sm gold" onclick="CommunityNav.viewUser('${uid}','${esc(prof.email)}','${esc(prof.username)}')">Review Trade Partner</button>
            </div>
          `;
          listEl.appendChild(card);
        }
      }

      const total=wantEntries.length+haveEntries.length;
      if(!total){
        this._show('tm-empty');
        const emptyEl=document.getElementById('tm-empty');
        if(emptyEl)emptyEl.innerHTML=`<div class="match-empty-panel">
          <div style="font-family:'Cinzel',serif;font-size:14px;color:var(--text);margin-bottom:8px">No Trade Matches Yet</div>
          <div style="font-size:11px;color:var(--text3);line-height:1.7">
            Add cards to your <strong>Wishlist</strong> and <strong>Trade Tracker</strong>, then invite friends to do the same.
          </div>
        </div>`;
      }else{
        const emptyEl=document.getElementById('tm-empty');
        if(emptyEl)emptyEl.style.display='none';
      }

      if(statusEl)statusEl.textContent=`Found ${total} trade lead${total>1?'s':''} with ${mutualIds.size} mutual match${mutualIds.size===1?'':'es'}`;
    }catch(e){
      if(statusEl)statusEl.innerHTML=`<span style="color:var(--crimson2)">Error: ${esc(e.message)}</span>`;
    }

    if(btn)btn.textContent='Find Matches';
    this._running=false;
  },

  _show(id){
    const el=document.getElementById(id);
    if(el)el.style.display='block';
  },

  _hide(ids){
    ids.forEach(id=>{
      const el=document.getElementById(id);
      if(el)el.style.display='none';
    });
  }
};
