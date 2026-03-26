/* CommanderForge: ShareMgr */

const ShareMgr={
  _deck:null,
  _token:null,

  async open(){
    const deck=Store.getDeck(App.curId);
    if(!deck){Notify.show('No deck loaded','err');return;}
    this._deck=deck;
    document.getElementById('share-deck-name').textContent=deck.name+(deck.commander?' - '+deck.commander:'');
    document.getElementById('share-url-inp').value='Generating link...';
    document.getElementById('share-modal').classList.add('show');
    await this._generate(deck);
  },

  close(){document.getElementById('share-modal').classList.remove('show');},

  async _generate(deck){
    try{
      if(DB._sb&&DB._user){
        this._token=await DB.shareDeck(deck);
        const url=`${window.location.origin}?share=${this._token}`;
        document.getElementById('share-url-inp').value=url;
        this._showQR(url);
      } else {
        const url=this._encodeLocal(deck);
        document.getElementById('share-url-inp').value=url;
        this._showQR(url);
      }
    }catch(e){
      document.getElementById('share-url-inp').value='Error: '+e.message;
    }
  },

  _encodeLocal(deck){
    const minimal={
      n:deck.name,
      c:deck.commander,
      p:deck.partner||'',
      cards:deck.cards.map(c=>c.qty+'x'+c.name+(c.foil?'*F*':''))
    };
    const encoded=btoa(unescape(encodeURIComponent(JSON.stringify(minimal)))).replace(/=/g,'');
    return `${window.location.origin}${window.location.pathname}?deck=${encoded}`;
  },

  _showQR(url){
    const qrEl=document.getElementById('share-qr');
    if(!qrEl)return;
    qrEl.innerHTML='';
    const img=document.createElement('img');
    img.src=`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(url)}&bgcolor=0c1220&color=c8a84b&format=png`;
    img.alt='QR Code';
    img.style.borderRadius='6px';
    img.style.border='1px solid var(--border2)';
    qrEl.appendChild(img);
  },

  copyLink(){
    const val=document.getElementById('share-url-inp')?.value||'';
    if(!val)return;
    if(!navigator.clipboard?.writeText){Notify.show('Clipboard not available','err');return;}
    navigator.clipboard.writeText(val).then(()=>Notify.show('Link copied!','ok')).catch(()=>Notify.show('Could not copy link','err'));
  },

  openLink(){
    const val=document.getElementById('share-url-inp')?.value||'';
    if(!val||!val.startsWith('http'))return;
    const w=window.open(val,'_blank','noopener,noreferrer');
    if(!w)Notify.show('Popup blocked by browser','err');
  },

  copyMoxfield(){
    const deck=this._deck;
    if(!deck)return;
    const txt=Parser.exportTxt(deck,'moxfield');
    if(!navigator.clipboard?.writeText){Notify.show('Clipboard not available','err');return;}
    navigator.clipboard.writeText(txt).then(()=>Notify.show('Moxfield text copied!','ok')).catch(()=>Notify.show('Could not copy Moxfield text','err'));
  },

  async regenerate(){
    if(this._deck)await this._generate(this._deck);
  },

  async loadShared(token){
    let deck=null;
    if(DB._sb){deck=await DB.getSharedDeck(token);}
    if(!deck){
      const params=new URLSearchParams(window.location.search);
      const encoded=params.get('deck');
      if(encoded){
        try{
          const str=decodeURIComponent(escape(atob(encoded)));
          const obj=JSON.parse(str);
          deck={
            name:obj.n,
            commander:obj.c,
            partner:obj.p||'',
            cards:obj.cards.map(s=>{
              const m=s.match(/^(\d+)x(.+?)(\*F\*)?$/);
              return m?{name:m[2],qty:parseInt(m[1],10),foil:!!m[3],etched:false}:null;
            }).filter(Boolean)
          };
        }catch{}
      }
    }
    if(!deck){Notify.show('Shared deck not found','err');return;}
    deck.id='shared_'+token;
    deck.created=Date.now();
    deck.readOnly=true;
    Store.decks=[deck];
    Store.saveDecks();
    App.renderSidebar();
    App.loadDeck(deck.id);
    Notify.show('Viewing shared deck: '+deck.name,'inf',4000);
    history.replaceState(null,'',window.location.pathname);
  }
};
