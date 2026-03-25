/* CommanderForge — auth: Config, DB (Supabase), Auth, ShareMgr, SettingsMgr,
   PriceProxy, MobileNav, registerSW */

const SUPABASE_URL='https://pwrpvtzocycnemgnsooz.supabase.co';
const SUPABASE_KEY='sb_publishable_doroVk7_Pblbapi7z9njyQ_zfVTZOmG';
/* Credentials are hardcoded — no manual config needed */

const Config={
  KEY:'cforge_config',
  data:{},
  load(){try{this.data=JSON.parse(localStorage.getItem(this.KEY)||'{}')}catch{this.data={}}},
  save(){try{localStorage.setItem(this.KEY,JSON.stringify(this.data))}catch{}},
  get(k){return this.data[k]||''},
  set(k,v){this.data[k]=v;this.save()}
};

const ProfilePrefs={
  AVATAR_CARD_KEY:'cforge_avatar_card',
  getAvatarCard(){return (localStorage.getItem(this.AVATAR_CARD_KEY)||'').trim();},
  setAvatarCard(name){
    const clean=(name||'').trim();
    if(clean)localStorage.setItem(this.AVATAR_CARD_KEY,clean);
    else localStorage.removeItem(this.AVATAR_CARD_KEY);
  },
  applyAvatar(el,fallbackText='?'){
    if(!el)return;
    const avatarCard=this.getAvatarCard();
    const fallback=(fallbackText||'?').slice(0,1).toUpperCase();
    const cd=avatarCard?Store.card(avatarCard):null;
    const img=cd?.img?.crop||cd?.img?.normal||'';
    if(img){
      el.textContent='';
      el.style.backgroundImage=`url("${img}")`;
      el.style.backgroundSize='cover';
      el.style.backgroundPosition='center';
      el.style.color='transparent';
    }else{
      el.textContent=fallback;
      el.style.backgroundImage='';
      el.style.backgroundSize='';
      el.style.backgroundPosition='';
      el.style.color='';
    }
  }
};

/* ═══════════════════════════════════════════════════════════
   SUPABASE SYNC
   ═══════════════════════════════════════════════════════════ */
const DB={
  _sb:null,_user:null,_syncing:false,_bootHandled:false,

  init(url,key){
    if(!url||!key||typeof supabase==='undefined')return false;
    // Guard: if already initialised with same URL, don't create a second client
    if(this._sb&&this._initUrl===url)return true;
    this._initUrl=url;
    try{
      this._sb=supabase.createClient(url,key,{
        auth:{
          persistSession:true,
          storage:window.localStorage,
          storageKey:'cforge_sb_session',
          autoRefreshToken:true,
          detectSessionInUrl:true
        }
      });
      /* Keep _user in sync — onAuthStateChange fires on every page load
         when a persisted session exists. We use a flag to avoid double-
         calling _onSignedIn (Auth.init also calls getSession).         */
      this._sb.auth.onAuthStateChange((event,session)=>{
        this._user=session?.user||null;
        if(event==='TOKEN_REFRESHED'||event==='SIGNED_IN'){
          /* Always keep _user fresh — _onSignedIn handles UI wiring */
          if(session?.user&&!DB._bootHandled){
            DB._bootHandled=true;
            /* Defer slightly so Auth.init's getSession path runs first */
            setTimeout(()=>{
              if(typeof Auth!=='undefined'&&Auth._onSignedIn)
                Auth._onSignedIn(session.user);
            },0);
          }
        }
        if(event==='SIGNED_OUT'){this._user=null;DB._bootHandled=false;}
      });
      return true;
    }catch{return false;}
  },

  async signIn(email,password){
    if(!this._sb)return{error:'Not configured'};
    const{data,error}=await this._sb.auth.signInWithPassword({email,password});
    if(!error)this._user=data.user;
    return{data,error};
  },

  async signUp(email,password,nickname=''){
    if(!this._sb)return{error:'Not configured'};
    /* emailRedirectTo muss in Supabase Dashboard unter
       Authentication → URL Configuration → Redirect URLs stehen */
    const redirectTo=window.location.origin+'/auth/callback';
    const{data,error}=await this._sb.auth.signUp({
      email,
      password,
      options:{
        emailRedirectTo:redirectTo,
        data:{username:nickname||email.split('@')[0]}
      }
    });
    if(!error)this._user=data.user;
    return{data,error};
  },

  async signInGoogle(){
    if(!this._sb)return{error:'Not configured'};
    return this._sb.auth.signInWithOAuth({
      provider:'google',
      options:{redirectTo:window.location.origin+'/auth/callback'}
    });
  },

  async signOut(){
    if(!this._sb)return;
    await this._sb.auth.signOut();
    this._user=null;
  },

  async getSession(){
    if(!this._sb)return null;
    const{data}=await this._sb.auth.getSession();
    this._user=data?.session?.user||null;
    return data?.session;
  },

  // Upload all decks to Supabase
  _pushTimer:null,
  schedulePush(){
    if(!navigator.onLine){
      /* Queue offline — will drain when connection returns */
      const payload=Store.decks.map(d=>({
        id:d.id,user_id:this._user?.id||'',
        name:d.name,commander:d.commander||'',partner:d.partner||'',
        cards:JSON.stringify(d.cards),public:d.public!==false,
        updated_at:new Date().toISOString()
      }));
      OfflineQueue.push({type:'upsert',table:'decks',payload});
      return;
    }
    clearTimeout(this._pushTimer);
    this._pushTimer=setTimeout(()=>this.pushDecks(),800);
  },
  async pushDecks(){
    if(!this._sb||!this._user)return;
    this._syncing=true;Auth._updSyncDot('syncing');
    try{
      const allRows=Store.decks.map(d=>({
        id:d.id,user_id:this._user.id,
        name:d.name,commander:d.commander||'',partner:d.partner||'',
        cards:JSON.stringify(d.cards),public:d.public!==false,
        created_at:new Date(d.created||Date.now()).toISOString(),
        updated_at:new Date().toISOString()
      }));
      const CHUNK=50;
      for(let i=0;i<allRows.length;i+=CHUNK){
        const chunk=allRows.slice(i,i+CHUNK);
        const{error}=await this._sb.from('decks').upsert(chunk,{onConflict:'id'});
        if(error)throw error;
      }
      Auth._updSyncDot('ok');
      Notify.show('Synced to cloud ☁','ok');
    }catch(e){
      Auth._updSyncDot('err');
      Notify.show('Sync failed: '+e.message,'err');
    }
    this._syncing=false;
  },

  // Download decks from Supabase
  async pullDecks(){
    if(!this._sb||!this._user)return;
    Auth._updSyncDot('syncing');
    try{
      const{data,error}=await this._sb.from('decks')
        .select('*').eq('user_id',this._user.id).order('created_at');
      if(error)throw error;
      if(data?.length){
        Store.decks=data.map(r=>({
          id:r.id,name:r.name,commander:r.commander,partner:r.partner||'',
          cards:JSON.parse(r.cards||'[]'),created:new Date(r.created_at).getTime()
        }));
        Store.saveDecks();
        Bus.emit('decks:changed');if(typeof Dashboard!=='undefined')Dashboard.markDirty();
        App.renderSidebar();
        const last=Store.getCur();
        if(last&&Store.getDeck(last))App.loadDeck(last);
      }
      Auth._updSyncDot('ok');
      Notify.show('Pulled '+( data?.length||0)+' decks from cloud','ok');
    }catch(e){
      Auth._updSyncDot('err');
      Notify.show('Pull failed: '+e.message,'err');
    }
  },

  // Share a deck — store it publicly with a random token
  async shareDeck(deck){
    if(!this._sb){
      // Offline sharing — encode deck in URL
      return ShareMgr._encodeLocal(deck);
    }
    const token=Math.random().toString(36).slice(2,10)+Date.now().toString(36);
    const{error}=await this._sb.from('shared_decks').upsert({
      token,
      deck_name:deck.name,
      commander:deck.commander||'',
      partner:deck.partner||'',
      cards:JSON.stringify(deck.cards),
      created_at:new Date().toISOString()
    });
    if(error)throw error;
    return token;
  },

  async getSharedDeck(token){
    if(!this._sb)return null;
    const{data,error}=await this._sb.from('shared_decks').select('*').eq('token',token).single();
    if(error||!data)return null;
    return{name:data.deck_name,commander:data.commander,partner:data.partner||'',cards:JSON.parse(data.cards||'[]')};
  }
};

/* Auto-init Supabase immediately — no waiting for Auth.init() */
(()=>{
  if(typeof supabase!=='undefined'){
    DB.init(SUPABASE_URL,SUPABASE_KEY);
  } else {
    /* CDN not loaded yet — wait for it */
    const _wait=setInterval(()=>{
      if(typeof supabase!=='undefined'){
        clearInterval(_wait);
        DB.init(SUPABASE_URL,SUPABASE_KEY);
      }
    },50);
  }
})();

/* ═══════════════════════════════════════════════════════════
   AUTH UI
   ═══════════════════════════════════════════════════════════ */
const Auth={
  _mode:'login',

  show(){
    document.getElementById('auth-overlay').classList.add('show');
    // Pre-fill email if remember me was used
    const savedEmail=Config.get('auth_email');
    if(savedEmail){const el=document.getElementById('auth-email');if(el)el.value=savedEmail;}
  },
  hide(){
    document.getElementById('auth-overlay').classList.remove('show');
  },
  skip(){
    this.hide();
    Config.set('auth_dismissed','1');
    Notify.show('Local-only mode — your decks stay on this device.','inf',4000);
  },

  showTab(tab){
    this._mode=tab;
    document.getElementById('auth-tab-login').classList.toggle('on',tab==='login');
    document.getElementById('auth-tab-signup').classList.toggle('on',tab==='signup');
    document.getElementById('auth-submit').textContent=tab==='login'?'Sign In':'Create Account';
    document.getElementById('auth-password2').style.display=tab==='signup'?'block':'none';
    document.getElementById('auth-nickname').style.display=tab==='signup'?'block':'none';
    this._setErr('');
  },

  _setErr(msg){
    const el=document.getElementById('auth-err');
    if(el){el.textContent=msg;el.classList.toggle('show',!!msg);}
  },

  async submit(){
    const email=(document.getElementById('auth-email')?.value||'').trim();
    const nickname=(document.getElementById('auth-nickname')?.value||'').trim();
    const pass=document.getElementById('auth-password')?.value||'';
    const pass2=document.getElementById('auth-password2')?.value||'';
    const remember=document.getElementById('auth-remember')?.checked!==false;
    if(!email||!pass){this._setErr('Enter your email and password');return;}
    if(this._mode==='signup'&&pass!==pass2){this._setErr('Passwords do not match');return;}
    if(pass.length<6){this._setErr('Password must be at least 6 characters');return;}
    if(!DB._sb){this._setErr('Supabase not connected');return;}

    const btn=document.getElementById('auth-submit');
    if(btn)btn.textContent='Signing in…';

    // Remember me — store credentials hint in localStorage
    if(remember)Config.set('auth_email',email);
    else{Config.set('auth_email','');Config.set('auth_dismissed','');}

    const{data,error}=this._mode==='login'
      ? await DB.signIn(email,pass)
      : await DB.signUp(email,pass,nickname);

    if(error){
      /* Supabase 500 → nutzerfreundliche Fehlermeldung */
      const msg = error.status===500
        ? 'Server-Fehler — Supabase-Projekt möglicherweise pausiert oder E-Mail-Limit erreicht. Bitte im Supabase-Dashboard prüfen.'
        : (error.message||'Unbekannter Fehler');
      this._setErr(msg);
      if(btn)btn.textContent=this._mode==='login'?'Sign In':'Create Account';
      return;
    }
    this.hide();
    DB._bootHandled=true; /* prevent onAuthStateChange double-call after manual login */
    const user=data.user||data.session?.user;
    // Save nickname to profile on signup
    if(this._mode==='signup'&&nickname&&user&&DB._sb){
      await DB._sb.from('profiles').upsert({id:user.id,email,username:nickname},{onConflict:'id'});
    }
    this._onSignedIn(user);
    if(this._mode==='signup')Notify.show('Account created! Check your email to confirm.','ok',5000);
  },



  async _onSignedIn(user){
    if(!user)return;
    DB._user=user;
    document.getElementById('auth-signin-btn').style.display='none';
    document.getElementById('auth-user-bar').classList.add('show');
    // Fetch profile for nickname — update topbar and avatar with it
    if(DB._sb){
      DB._sb.from('profiles').select('username,email').eq('id',user.id).single().then(({data:p})=>{
        const display=p?.username||user.email?.split('@')[0]||'User';
        // Update topbar username
        const el=document.getElementById('auth-username');if(el)el.textContent=display;
        // Update avatar with first letter of nickname (not email)
        const av=document.getElementById('auth-avatar');
        ProfilePrefs.applyAvatar(av,display);
        // Cache nickname for use elsewhere
        DB._nickname=display;
      });
    } else {
      const display=user.email?.split('@')[0]||'User';
      const el=document.getElementById('auth-username');if(el)el.textContent=display;
      ProfilePrefs.applyAvatar(document.getElementById('auth-avatar'),display);
      DB._nickname=display;
    }
    const avatarCard=ProfilePrefs.getAvatarCard();
    if(avatarCard&&!Store.card(avatarCard)){
      SF.fetch(avatarCard,()=>ProfilePrefs.applyAvatar(document.getElementById('auth-avatar'),DB._nickname||'U'));
    }
    this._updSyncDot('ok');
    // Pull decks from cloud on sign-in
    await DB.pullDecks();
    App?.refreshTopbarStats?.(true);
    /* Auto-refresh Bulk Pool if it's currently visible */
    if(Menu.cur==='bulk')BulkPool.refresh();
    // Set up auto-sync: push after each save
    Store._onSave=()=>DB.schedulePush();
    // Start realtime subscriptions
    Realtime.init();
    // Refresh standalone sections — always, not just if currently visible
    // so switching to them after sign-in shows data immediately
    WishSection?.render();
    TradeSection?.render();
    CollSection?.render();
    CardSearch2?._populateDeckSel?.();
  },

  _updSyncDot(state){
    const dot=document.getElementById('auth-sync-dot');
    if(!dot)return;
    dot.className='auth-sync-dot';
    if(state==='syncing')dot.classList.add('syncing');
    else if(state==='err'||state==='offline')dot.classList.add('offline');
  },

  showMenu(){
    if(!DB._user){this.show();return;}
    const menu=[
      {label:'Pull from cloud',fn:()=>DB.pullDecks()},
      {label:'Push to cloud',fn:()=>DB.pushDecks()},
      {label:'Sign out',fn:async()=>{await DB.signOut();window.location.reload();}},
    ];
    // Quick inline context menu
    const el=document.getElementById('auth-user-bar');
    const rect=el.getBoundingClientRect();
    const div=document.createElement('div');
    div.style.cssText=`position:fixed;top:${rect.bottom+6}px;right:${window.innerWidth-rect.right}px;background:var(--bg3);border:1px solid var(--border2);border-radius:var(--r);z-index:9999;min-width:160px;box-shadow:var(--shadow)`;
    menu.forEach(m=>{
      const btn=document.createElement('button');
      btn.style.cssText='display:block;width:100%;padding:9px 14px;background:none;border:none;color:var(--text2);font-family:Cinzel,serif;font-size:11px;text-align:left;cursor:pointer;transition:all .12s';
      btn.textContent=m.label;
      btn.onmouseenter=()=>{btn.style.background='var(--bg4)';btn.style.color='var(--gold2)';};
      btn.onmouseleave=()=>{btn.style.background='none';btn.style.color='var(--text2)';};
      btn.onclick=()=>{div.remove();m.fn();};
      div.appendChild(btn);
    });
    document.body.appendChild(div);
    setTimeout(()=>document.addEventListener('click',()=>div.remove(),{once:true}),50);
  },

  async init(){
    Config.load();
    const url=SUPABASE_URL;
    const key=SUPABASE_KEY;

    // Check for shared deck in URL (takes priority over auth)
    const params=new URLSearchParams(window.location.search);
    const shareToken=params.get('share');
    if(shareToken){
      ShareMgr.loadShared(shareToken);
      return;
    }

    // DB bereits durch Auto-Init IIFE initialisiert — kein zweiter createClient
    // DB.init() hat eine Guard-Bedingung, trotzdem onAuthStateChange nur einmal registrieren

    // Check for existing session (returning signed-in user)
    const session=await DB.getSession();
    if(session?.user){
      DB._bootHandled=true; /* prevent onAuthStateChange double-call */
      this._onSignedIn(session.user); /* fire and forget — UI already rendered */
      return;
    }

    // Check for OAuth redirect (Google sign-in callback)
    if(window.location.hash.includes('access_token')){
      const session2=await DB.getSession();
      if(session2?.user){this._onSignedIn(session2.user);return;}
    }

    // Not signed in — show login overlay automatically
    const dismissed=Config.get('auth_dismissed');
    if(!dismissed){
      setTimeout(()=>this.show(),800);
    }
  }
};

/* ═══════════════════════════════════════════════════════════
   SHARE MANAGER
   ═══════════════════════════════════════════════════════════ */
const ShareMgr={
  _deck:null,
  _token:null,

  async open(){
    const deck=Store.getDeck(App.curId);
    if(!deck){Notify.show('No deck loaded','err');return;}
    this._deck=deck;
    document.getElementById('share-deck-name').textContent=deck.name+(deck.commander?' · '+deck.commander:'');
    document.getElementById('share-url-inp').value='Generating link…';
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
        // Fallback: encode deck in URL (works without auth)
        const url=this._encodeLocal(deck);
        document.getElementById('share-url-inp').value=url;
        this._showQR(url);
      }
    }catch(e){
      document.getElementById('share-url-inp').value='Error: '+e.message;
    }
  },

  _encodeLocal(deck){
    const minimal={n:deck.name,c:deck.commander,p:deck.partner||'',
      cards:deck.cards.map(c=>c.qty+'x'+c.name+(c.foil?'*F*':''))};
    const encoded=btoa(unescape(encodeURIComponent(JSON.stringify(minimal)))).replace(/=/g,'');
    return `${window.location.origin}${window.location.pathname}?deck=${encoded}`;
  },

  _showQR(url){
    // Simple QR via free API
    const qrEl=document.getElementById('share-qr');
    if(qrEl){
      qrEl.innerHTML=`<img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(url)}&bgcolor=0c1220&color=c8a84b&format=png" alt="QR Code" style="border-radius:6px;border:1px solid var(--border2)">`;
    }
  },

  copyLink(){
    const val=document.getElementById('share-url-inp')?.value||'';
    navigator.clipboard.writeText(val).then(()=>Notify.show('Link copied!','ok'));
  },

  openLink(){
    const val=document.getElementById('share-url-inp')?.value||'';
    if(val&&val.startsWith('http'))window.open(val,'_blank');
  },

  copyMoxfield(){
    const deck=this._deck;if(!deck)return;
    const txt=Parser.exportTxt(deck,'moxfield');
    navigator.clipboard.writeText(txt).then(()=>Notify.show('Moxfield text copied!','ok'));
  },

  async regenerate(){
    if(this._deck)await this._generate(this._deck);
  },

  async loadShared(token){
    // Try Supabase first, then URL-encoded fallback
    let deck=null;
    if(DB._sb){deck=await DB.getSharedDeck(token);}
    if(!deck){
      // Try URL-encoded deck param
      const params=new URLSearchParams(window.location.search);
      const encoded=params.get('deck');
      if(encoded){
        try{
          const str=decodeURIComponent(escape(atob(encoded)));
          const obj=JSON.parse(str);
          deck={name:obj.n,commander:obj.c,partner:obj.p||'',
            cards:obj.cards.map(s=>{
              const m=s.match(/^(\d+)x(.+?)(\*F\*)?$/);
              return m?{name:m[2],qty:parseInt(m[1]),foil:!!m[3],etched:false}:null;
            }).filter(Boolean)};
        }catch{}
      }
    }
    if(!deck){Notify.show('Shared deck not found','err');return;}
    // Show read-only deck view
    deck.id='shared_'+token;deck.created=Date.now();deck.readOnly=true;
    Store.decks=[deck];Store.saveDecks();
    App.renderSidebar();App.loadDeck(deck.id);
    Notify.show('Viewing shared deck: '+deck.name,'inf',4000);
    // Clean URL
    history.replaceState(null,'',window.location.pathname);
  }
};

/* ═══════════════════════════════════════════════════════════
   SETTINGS MANAGER
   ═══════════════════════════════════════════════════════════ */
const SettingsMgr={
  open(){
    document.getElementById('settings-panel').classList.add('show');
    ScryfallBulk._updateSettingsStatus();
    // Load current values
    document.getElementById('cfg-tcp-pub').value=Config.get('tcp_pub');
    document.getElementById('cfg-tcp-priv').value=Config.get('tcp_priv');
    document.getElementById('cfg-mkm-tok').value=Config.get('mkm_tok');
    document.getElementById('cfg-mkm-sec').value=Config.get('mkm_sec');
    this._checkSWStatus();
  },
  close(){document.getElementById('settings-panel').classList.remove('show');},

  saveSupabase(){/* no-op — credentials are hardcoded */},

  savePriceKeys(){
    Config.set('tcp_pub',document.getElementById('cfg-tcp-pub')?.value||'');
    Config.set('tcp_priv',document.getElementById('cfg-tcp-priv')?.value||'');
    Config.set('mkm_tok',document.getElementById('cfg-mkm-tok')?.value||'');
    Config.set('mkm_sec',document.getElementById('cfg-mkm-sec')?.value||'');
    Notify.show('Price API keys saved','ok');
    // Update price provider status in Price Analysis
    PriceProxy.keysUpdated();
  },

  exportAll(){
    const data={decks:Store.decks,alerts:Store.alerts,config:Config.data,exported:new Date().toISOString()};
    const a=document.createElement('a');
    a.href='data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(data,null,2));
    a.download='magicthedrinkering-backup-'+new Date().toISOString().slice(0,10)+'.json';
    a.click();Notify.show('Backup exported','ok');
  },

  importAll(){document.getElementById('import-file')?.click();},

  _doImport(e){
    const file=e.target.files[0];if(!file)return;
    const reader=new FileReader();
    reader.onload=ev=>{
      try{
        const data=JSON.parse(ev.target.result);
        if(data.decks){Store.decks=data.decks;Store.saveDecks();}
        if(data.alerts){Store.alerts=data.alerts;Store.saveAlerts();}
        if(data.config){Config.data=data.config;Config.save();}
        App.renderSidebar();Notify.show('Backup imported — '+(data.decks?.length||0)+' decks','ok');
      }catch{Notify.show('Invalid backup file','err');}
    };
    reader.readAsText(file);
  },

  clearImageCache(){
    if(navigator.serviceWorker?.controller){
      const ch=new MessageChannel();
      ch.port1.onmessage=e=>{Notify.show(e.data,'ok');};
      navigator.serviceWorker.controller.postMessage('CLEAR_IMAGE_CACHE',[ch.port2]);
    } else {
      Notify.show('Service worker not active','inf');
    }
  },

  _checkSWStatus(){
    const el=document.getElementById('cache-status');if(!el)return;
    if('serviceWorker' in navigator){
      navigator.serviceWorker.getRegistration().then(reg=>{
        el.textContent=reg?'Service worker: active ✓ — images cached offline':'Service worker: not yet registered (open the app online once)';
      });
    } else {
      el.textContent='Service worker: not supported in this browser';
    }
  }
};

/* ═══════════════════════════════════════════════════════════
   PRICE PROXY — wraps Netlify Edge Function
   ═══════════════════════════════════════════════════════════ */
const PriceProxy={
  _available:{tcgplayer:false,mkm:false},

  keysUpdated(){
    // Keys are set in env vars on Netlify — always attempt on a real deployment
    this._available.tcgplayer=true;
    this._available.mkm=true;
  },

  async fetch(cardName,provider){
    // Only works when deployed — on localhost returns simulated
    if(location.hostname==='localhost'||location.protocol==='file:'){
      return this._simulate(provider);
    }
    try{
      const url=`/api/prices?provider=${provider}&name=${encodeURIComponent(cardName)}`;
      const r=await fetch(url);
      if(!r.ok)return null;
      return await r.json();
    }catch{return null;}
  },

  _simulate(provider){
    const base=(Math.random()*15+0.5).toFixed(2);
    if(provider==='tcgplayer')return{provider:'tcgplayer',usd:base,eur_foil:(parseFloat(base)*2.2).toFixed(2),simulated:true};
    if(provider==='mkm')return{provider:'mkm',eur:(parseFloat(base)*0.9).toFixed(2),eur_foil:(parseFloat(base)*1.9).toFixed(2),simulated:true};
    return null;
  },

  // Fetch prices for all providers for a card
  async fetchAll(cardName){
    const [tcg,mkm]=await Promise.all([
      this.fetch(cardName,'tcgplayer'),
      this.fetch(cardName,'mkm')
    ]);
    return{tcgplayer:tcg,mkm};
  }
};

/* ═══════════════════════════════════════════════════════════
   MOBILE NAV
   ═══════════════════════════════════════════════════════════ */
const MobileNav={
  go(section){
    document.querySelectorAll('.mn-btn').forEach(b=>b.classList.remove('on'));
    const btn=document.getElementById('mn-'+section);
    if(btn)btn.classList.add('on');
    Menu.go(section);
    this.closeDecks();
    // When entering vault, make sure a page is visible
    if(section==='vault'){
      VaultNav.go(VaultNav.cur||'dashboard');
    }
  },
  openDecks(){
    // Sync mobile deck list with main deck list
    const src=document.getElementById('deck-list');
    const dest=document.getElementById('mobile-deck-list');
    if(src&&dest)dest.innerHTML=src.innerHTML;
    // Re-wire click events
    dest?.querySelectorAll('.di').forEach((item,i)=>{
      const realItem=src?.querySelectorAll('.di')[i];
      if(realItem)item.onclick=()=>{realItem.click();this.closeDecks();};
    });
    document.getElementById('mobile-deck-drawer').classList.add('open');
  },
  closeDecks(){document.getElementById('mobile-deck-drawer').classList.remove('open');}
};

/* ═══════════════════════════════════════════════════════════
   SERVICE WORKER REGISTRATION
   ═══════════════════════════════════════════════════════════ */
function registerSW(){
  if('serviceWorker' in navigator&&location.protocol!=='file:'){
    // Register external sw.js — caches app shell + Scryfall images
    navigator.serviceWorker.register('/sw.js',{scope:'/'}).then(reg=>{
      console.log('[SW] registered, scope:',reg.scope);
      reg.addEventListener('updatefound',()=>{
        reg.installing?.addEventListener('statechange',e=>{
          if(e.target.state==='installed'&&navigator.serviceWorker.controller)
            Notify.show('App updated — refresh for the latest version','inf',6000);
        });
      });
    }).catch(e=>console.warn('[SW] registration failed:',e));
  }
}



/* ═══════════════════════════════════════════════════════════
   IMPROVED ANALYSIS VIEW
   ═══════════════════════════════════════════════════════════ */
