/* CommanderForge: SettingsMgr */

const SettingsMgr={
  open(){
    document.getElementById('settings-panel').classList.add('show');
    ScryfallBulk._updateSettingsStatus();
    document.getElementById('cfg-tcp-pub').value=Config.get('tcp_pub');
    document.getElementById('cfg-tcp-priv').value=Config.get('tcp_priv');
    document.getElementById('cfg-mkm-tok').value=Config.get('mkm_tok');
    document.getElementById('cfg-mkm-sec').value=Config.get('mkm_sec');
    this._checkSWStatus();
  },

  close(){document.getElementById('settings-panel').classList.remove('show');},

  saveSupabase(){},

  savePriceKeys(){
    Config.set('tcp_pub',document.getElementById('cfg-tcp-pub')?.value||'');
    Config.set('tcp_priv',document.getElementById('cfg-tcp-priv')?.value||'');
    Config.set('mkm_tok',document.getElementById('cfg-mkm-tok')?.value||'');
    Config.set('mkm_sec',document.getElementById('cfg-mkm-sec')?.value||'');
    Notify.show('Price API keys saved','ok');
    PriceProxy.keysUpdated();
  },

  exportAll(){
    const data={decks:Store.decks,alerts:Store.alerts,config:Config.data,exported:new Date().toISOString()};
    const a=document.createElement('a');
    a.href='data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(data,null,2));
    a.download='magicthedrinkering-backup-'+new Date().toISOString().slice(0,10)+'.json';
    a.click();
    Notify.show('Backup exported','ok');
  },

  importAll(){document.getElementById('import-file')?.click();},

  _doImport(e){
    const file=e.target.files[0];
    if(!file)return;
    const reader=new FileReader();
    reader.onload=ev=>{
      try{
        const data=JSON.parse(ev.target.result);
        if(data.decks){Store.decks=data.decks;Store.saveDecks();}
        if(data.alerts){Store.alerts=data.alerts;Store.saveAlerts();}
        if(data.config){Config.data=data.config;Config.save();}
        App.renderSidebar();
        Notify.show('Backup imported - '+(data.decks?.length||0)+' decks','ok');
      }catch{
        Notify.show('Invalid backup file','err');
      }
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
    const el=document.getElementById('cache-status');
    if(!el)return;
    if('serviceWorker' in navigator){
      navigator.serviceWorker.getRegistration().then(reg=>{
        el.textContent=reg?'Service worker: active - images cached offline':'Service worker: not yet registered (open the app online once)';
      });
    } else {
      el.textContent='Service worker: not supported in this browser';
    }
  }
};
