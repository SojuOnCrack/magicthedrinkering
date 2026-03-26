/* CommanderForge: PriceProxy */

const PriceProxy={
  _available:{tcgplayer:false,mkm:false},

  keysUpdated(){
    // Keys are set in env vars on the deployment, so both providers are usable there.
    this._available.tcgplayer=true;
    this._available.mkm=true;
  },

  async fetch(cardName,provider){
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

  async fetchAll(cardName){
    const [tcg,mkm]=await Promise.all([
      this.fetch(cardName,'tcgplayer'),
      this.fetch(cardName,'mkm')
    ]);
    return{tcgplayer:tcg,mkm};
  }
};
