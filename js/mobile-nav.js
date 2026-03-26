/* CommanderForge: MobileNav */

const MobileNav={
  go(section){
    document.querySelectorAll('.mn-btn').forEach(b=>b.classList.remove('on'));
    const btn=document.getElementById('mn-'+section);
    if(btn)btn.classList.add('on');
    Menu.go(section);
    this.closeDecks();
    if(section==='vault'){
      VaultNav.go(VaultNav.cur||'dashboard');
    }
  },

  openDecks(){
    const src=document.getElementById('deck-list');
    const dest=document.getElementById('mobile-deck-list');
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
