/* MagicTheDrinkering: Commander life tracker */

const CommanderTracker={
  KEY:'mtd_commander_tracker_v1',
  START_LIFE:40,
  MIN_PLAYERS:2,
  MAX_PLAYERS:6,
  colors:['gold','ice','green','crimson','purple','steel'],
  state:null,

  init(){
    this.state=this._load();
    this.render();
  },

  _fresh(count=4){
    const players=Array.from({length:count},(_,i)=>({
      id:'p'+(i+1),
      name:'Player '+(i+1),
      life:this.START_LIFE,
      poison:0,
      monarch:false,
      initiative:false
    }));
    return{players,damage:{},active:players[0].id,updated:Date.now()};
  },

  _load(){
    try{
      const saved=JSON.parse(localStorage.getItem(this.KEY)||'null');
      if(saved?.players?.length>=this.MIN_PLAYERS){
        saved.damage=saved.damage||{};
        saved.active=saved.active||saved.players[0].id;
        return saved;
      }
    }catch{}
    return this._fresh();
  },

  _save(){
    this.state.updated=Date.now();
    localStorage.setItem(this.KEY,JSON.stringify(this.state));
  },

  _player(id){
    return this.state.players.find(p=>p.id===id);
  },

  _damage(targetId,sourceId){
    return this.state.damage?.[targetId]?.[sourceId]||0;
  },

  _setDamage(targetId,sourceId,value){
    this.state.damage[targetId]=this.state.damage[targetId]||{};
    this.state.damage[targetId][sourceId]=Math.max(0,Math.min(99,value));
  },

  _isOut(player){
    if(player.life<=0||player.poison>=10)return true;
    return this.state.players.some(src=>src.id!==player.id&&this._damage(player.id,src.id)>=21);
  },

  _lifeState(player){
    if(player.life<=5)return'critical';
    if(player.life<=10)return'low';
    if(player.life<=20)return'warning';
    if(player.life>=50)return'high';
    return'stable';
  },

  _damageState(value){
    if(value>=21)return'danger';
    if(value>=14)return'warning';
    if(value>=7)return'pressure';
    return'value';
  },

  _initials(name){
    return String(name||'Player')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0,2)
      .map(part=>part[0]?.toUpperCase()||'')
      .join('')||'P';
  },

  addPlayer(){
    if(this.state.players.length>=this.MAX_PLAYERS){if(typeof Notify!=='undefined')Notify.show('Maximum 6 players','inf');return;}
    const next=this.state.players.length+1;
    this.state.players.push({
      id:'p'+Date.now().toString(36),
      name:'Player '+next,
      life:this.START_LIFE,
      poison:0,
      monarch:false,
      initiative:false
    });
    this._save();this.render();
  },

  removePlayer(){
    if(this.state.players.length<=this.MIN_PLAYERS){if(typeof Notify!=='undefined')Notify.show('Minimum 2 players','inf');return;}
    const removed=this.state.players.pop();
    delete this.state.damage[removed.id];
    Object.values(this.state.damage).forEach(row=>delete row[removed.id]);
    if(this.state.active===removed.id)this.state.active=this.state.players[0].id;
    this._save();this.render();
  },

  resetGame(){
    const count=this.state?.players?.length||4;
    const names=(this.state?.players||[]).map(p=>p.name);
    this.state=this._fresh(count);
    this.state.players.forEach((p,i)=>{if(names[i])p.name=names[i];});
    this._save();this.render();
    if(typeof Notify!=='undefined')Notify.show('New Commander game ready','ok');
  },

  adjustLife(id,delta){
    const p=this._player(id);if(!p)return;
    p.life=Math.max(-99,Math.min(999,p.life+delta));
    this._save();this.render();
  },

  adjustAll(delta){
    this.state.players.forEach(p=>{p.life=Math.max(-99,Math.min(999,p.life+delta));});
    this._save();this.render();
  },

  adjustPoison(id,delta){
    const p=this._player(id);if(!p)return;
    p.poison=Math.max(0,Math.min(10,p.poison+delta));
    this._save();this.render();
  },

  adjustCommander(targetId,sourceId,delta){
    this._setDamage(targetId,sourceId,this._damage(targetId,sourceId)+delta);
    this._save();this.render();
  },

  setName(id,value){
    const p=this._player(id);if(!p)return;
    p.name=(value||'').trim().slice(0,24)||'Player';
    this._save();this.render();
  },

  setActive(id){
    this.state.active=id;
    this._save();this.renderBoard();
  },

  toggle(id,key){
    const p=this._player(id);if(!p)return;
    if(key==='monarch'){
      this.state.players.forEach(x=>x.monarch=false);
      p.monarch=true;
    }
    if(key==='initiative'){
      this.state.players.forEach(x=>x.initiative=false);
      p.initiative=true;
    }
    this._save();this.renderBoard();
  },

  clearCommanderDamage(){
    this.state.damage={};
    this._save();this.render();
  },

  render(){
    if(!document.getElementById('tracker-board'))return;
    if(!this.state)this.state=this._load();
    this.renderBoard();
    this.renderDamage();
  },

  renderBoard(){
    const board=document.getElementById('tracker-board');if(!board)return;
    const players=this.state.players;
    board.className='tracker-board players-'+players.length;
    board.innerHTML=players.map((p,i)=>this._playerCard(p,i)).join('');
  },

  _playerCard(p,i){
    const out=this._isOut(p);
    const lifeState=this._lifeState(p);
    const maxCmd=Math.max(0,...this.state.players.filter(src=>src.id!==p.id).map(src=>this._damage(p.id,src.id)));
    const badges=[
      this.state.active===p.id?'<span class="tracker-status-badge active">Active Turn</span>':'',
      p.monarch?'<span class="tracker-status-badge monarch">Monarch</span>':'',
      p.initiative?'<span class="tracker-status-badge initiative">Initiative</span>':'',
      out?'<span class="tracker-status-badge out">Knocked Out</span>':''
    ].filter(Boolean).join('');
    const commanderRows=this.state.players
      .filter(src=>src.id!==p.id)
      .map(src=>{
        const value=this._damage(p.id,src.id);
        const state=this._damageState(value);
        return`
          <div class="tracker-inline-cmd ${state}">
            <button class="tracker-inline-btn" onclick="CommanderTracker.adjustCommander('${p.id}','${src.id}',-1)" aria-label="Reduce commander damage from ${esc(src.name)} to ${esc(p.name)}">-</button>
            <button class="tracker-inline-main" onclick="CommanderTracker.adjustCommander('${p.id}','${src.id}',1)" aria-label="Add commander damage from ${esc(src.name)} to ${esc(p.name)}">
              <span>${esc(src.name)}</span>
              <strong>${value}</strong>
            </button>
            <button class="tracker-inline-btn" onclick="CommanderTracker.adjustCommander('${p.id}','${src.id}',1)" aria-label="Add commander damage from ${esc(src.name)} to ${esc(p.name)}">+</button>
          </div>`;
      }).join('');
    return`
      <article class="tracker-card ${this.colors[i%this.colors.length]} ${out?'is-out':''} ${this.state.active===p.id?'is-active':''}">
        <div class="tracker-card-orb">${this._initials(p.name)}</div>
        <div class="tracker-card-status">${badges}</div>
        <div class="tracker-card-top">
          <input class="tracker-name" value="${esc(p.name)}" maxlength="24"
            onchange="CommanderTracker.setName('${p.id}',this.value)"
            onfocus="this.select()" aria-label="Player name">
          <button class="tracker-turn" onclick="CommanderTracker.setActive('${p.id}')">${this.state.active===p.id?'Turn':'Set Turn'}</button>
        </div>
        <div class="tracker-life-wrap">
          <div class="tracker-life-kicker">Life Total</div>
          <div class="tracker-life ${lifeState}">${p.life}</div>
        </div>
        <div class="tracker-life-controls">
          <button onclick="CommanderTracker.adjustLife('${p.id}',-10)">-10</button>
          <button onclick="CommanderTracker.adjustLife('${p.id}',-5)">-5</button>
          <button onclick="CommanderTracker.adjustLife('${p.id}',-1)">-1</button>
          <button onclick="CommanderTracker.adjustLife('${p.id}',1)">+1</button>
          <button onclick="CommanderTracker.adjustLife('${p.id}',5)">+5</button>
          <button onclick="CommanderTracker.adjustLife('${p.id}',10)">+10</button>
        </div>
        <div class="tracker-mini-row">
          <div class="tracker-counter">
            <span>Poison</span>
            <div>
              <button onclick="CommanderTracker.adjustPoison('${p.id}',-1)">-</button>
              <b>${p.poison}</b>
              <button onclick="CommanderTracker.adjustPoison('${p.id}',1)">+</button>
            </div>
          </div>
          <div class="tracker-counter ${this._damageState(maxCmd)}">
            <span>Cmdr max</span>
            <strong class="${this._damageState(maxCmd)}">${maxCmd}</strong>
          </div>
        </div>
        <div class="tracker-inline-section">
          <div class="tracker-inline-title">Commander damage taken</div>
          <div class="tracker-inline-grid">${commanderRows}</div>
        </div>
        <div class="tracker-tags">
          <button class="${p.monarch?'on':''}" onclick="CommanderTracker.toggle('${p.id}','monarch')">Monarch</button>
          <button class="${p.initiative?'on':''}" onclick="CommanderTracker.toggle('${p.id}','initiative')">Initiative</button>
        </div>
        ${out?'<div class="tracker-out">Knocked out</div>':''}
      </article>`;
  },

  renderDamage(){
    const grid=document.getElementById('tracker-damage-grid');if(!grid)return;
    const rows=[];
    for(const target of this.state.players){
      for(const source of this.state.players){
        if(source.id===target.id)continue;
        const value=this._damage(target.id,source.id);
        const state=this._damageState(value);
        rows.push(`
          <div class="tracker-damage-row ${state}">
            <div class="tracker-damage-label">
              <b>${esc(source.name)}</b>
              <span>to ${esc(target.name)}</span>
            </div>
            <div class="tracker-damage-controls">
              <button onclick="CommanderTracker.adjustCommander('${target.id}','${source.id}',-1)">-</button>
              <strong>${value}</strong>
              <button onclick="CommanderTracker.adjustCommander('${target.id}','${source.id}',1)">+</button>
            </div>
          </div>`);
      }
    }
    grid.innerHTML=rows.join('');
  }
};

CommanderTracker.init();
