/* CommanderForge: MobileNav */

const MobileNav={
  PRIMARY_SECTIONS:['forge','search','vault','collection'],
  SECONDARY_SECTIONS:['wishlist','trade','bulk','tracker','community','settings'],

  syncDeckButton(){
    const label=document.getElementById('mobile-decks-label');
    if(!label)return;
    const deck=typeof App!=='undefined'&&App.curId?Store.getDeck(App.curId):null;
    label.textContent=deck?.name||'Decks';
    label.title=deck?.name||'Open my decks';
  },
  setActive(section){
    document.querySelectorAll('.mn-btn').forEach(b=>b.classList.remove('on'));
    const isPrimary=this.PRIMARY_SECTIONS.includes(section);
    const activeId=isPrimary?'mn-'+section:'mn-more';
    document.getElementById(activeId)?.classList.add('on');
  },
  go(section){
    this.setActive(section);
    Menu.go(section);
    this.closeDecks();
    this.closeMore();
    if(section==='vault'){
      VaultNav.go(VaultNav.cur||'dashboard');
    }
  },
  toggleMore(){
    const drawer=document.getElementById('mobile-more-drawer');
    if(!drawer)return;
    drawer.classList.toggle('open');
    const isOpen=drawer.classList.contains('open');
    if(isOpen)this.closeDecks();
  },
  closeMore(){
    document.getElementById('mobile-more-drawer')?.classList.remove('open');
  },
  openSettings(){
    this.closeMore();
    this.closeDecks();
    this.setActive('settings');
    SettingsMgr.open();
  },

  openDecks(){
    const src=document.getElementById('deck-list');
    const dest=document.getElementById('mobile-deck-list');
    this.syncDeckButton();
    this.closeMore();
    if(src&&dest)dest.innerHTML=src.innerHTML;
    dest?.querySelectorAll('.di').forEach((item,i)=>{
      const realItem=src?.querySelectorAll('.di')[i];
      if(realItem)item.onclick=()=>{realItem.click();this.closeDecks();};
    });
    document.getElementById('mobile-deck-drawer').classList.add('open');
  },

  closeDecks(){
    document.getElementById('mobile-deck-drawer').classList.remove('open');
  }
};
