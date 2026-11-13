/* CommanderForge: PriceProxy
 * Only show prices returned by a configured provider. Never invent market data.
 */
const PriceProxy={
  _available:{tcgplayer:false,mkm:false},

  keysUpdated(){
    // The /api/prices Pages Function is optional and is not part of every deployment.
    this._available.tcgplayer=false;
    this._available.mkm=false;
  },

  async fetch(cardName,provider){
    if(!['tcgplayer','mkm'].includes(provider))return null;
    const name=String(cardName||'').trim();
    if(!name||name.length>200)return null;
    if(location.protocol==='file:')return null;
    try{
      const url=`/api/prices?provider=${encodeURIComponent(provider)}&name=${encodeURIComponent(name)}`;
      const response=await fetch(url,{headers:{Accept:'application/json'}});
      if(!response.ok)return null;
      const data=await response.json();
      if(!data||typeof data!=='object'||data.provider!==provider)return null;
      return data;
    }catch{return null;}
  },

  async fetchAll(cardName){
    const [tcg,mkm]=await Promise.all([
      this.fetch(cardName,'tcgplayer'),
      this.fetch(cardName,'mkm')
    ]);
    return{tcgplayer:tcg,mkm};
  }
};
