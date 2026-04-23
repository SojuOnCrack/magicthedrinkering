/* MagicTheDrinkering: Commander life tracker */

const CommanderTracker={
  KEY:'mtd_commander_tracker_v1',
  START_LIFE:40,
  MIN_PLAYERS:2,
  MAX_PLAYERS:6,
  HISTORY_LIMIT:24,
  colors:['gold','ice','green','crimson','purple','steel'],
  state:null,
  _clock:null,

  init(){
    this.state=this._load();
    this._startClock();
    this.render();
  },

  _fresh(count=4){
    const now=Date.now();
    const players=Array.from({length:count},(_,i)=>({
      id:'p'+(i+1),
      name:'Player '+(i+1),
      life:this.START_LIFE,
      poison:0,
      monarch:false,
      initiative:false
    }));
    return{
      players,
      damage:{},
      active:players[0].id,
      turnNumber:1,
      startedAt:now,
      history:[{id:'evt-'+now,type:'system',text:'Game started',ts:now}],
      updated:now
    };
  },

  _normalizeState(saved){
    const base=this._fresh(saved?.players?.length||4);
    const state={...base,...saved};
    state.players=Array.isArray(saved?.players)&&saved.players.length>=this.MIN_PLAYERS?saved.players:base.players;
    state.damage=saved?.damage||{};
    state.active=state.players.some(p=>p.id===saved?.active)?saved.active:state.players[0].id;
    state.turnNumber=Number.isFinite(saved?.turnNumber)&&saved.turnNumber>0?saved.turnNumber:1;
    state.startedAt=Number.isFinite(saved?.startedAt)?saved.startedAt:Date.now();
    state.history=Array.isArray(saved?.history)?saved.history.slice(0,this.HISTORY_LIMIT):base.history;
    return state;
  },

  _load(){
    try{
      const saved=JSON.parse(localStorage.getItem(this.KEY)||'null');
      if(saved?.players?.length>=this.MIN_PLAYERS)return this._normalizeState(saved);
    }catch{}
    return this._fresh();
  },

  _save(){
    this.state.updated=Date.now();
    localStorage.setItem(this.KEY,JSON.stringify(this.state));
  },

  _startClock(){
    if(this._clock)clearInterval(this._clock);
    this._clock=setInterval(()=>{
      if(!this.state)return;
      this.renderDashboard();
      this.renderSummary();
    },1000);
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

  _elapsedMs(){
    return Math.max(0,Date.now()-(this.state?.startedAt||Date.now()));
  },

  _formatElapsed(ms){
    const total=Math.floor(ms/1000);
    const hours=Math.floor(total/3600);
    const minutes=Math.floor((total%3600)/60);
    const seconds=total%60;
    if(hours>0)return`${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
    return`${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
  },

  _log(text,type='event'){
    const ts=Date.now();
    this.state.history=[{id:'evt-'+ts+'-'+Math.random().toString(36).slice(2,6),type,text,ts},...(this.state.history||[])].slice(0,this.HISTORY_LIMIT);
  },

  _statusText(player){
    if(this._isOut(player))return'Eliminated';
    if(player.id===this.state.active)return'In turn';
    return'Ready';
  },

  addPlayer(){
    if(this.state.players.length>=this.MAX_PLAYERS){if(typeof Notify!=='undefined')Notify.show('Maximum 6 players','inf');return;}
    const next=this.state.players.length+1;
    const player={
      id:'p'+Date.now().toString(36),
      name:'Player '+next,
      life:this.START_LIFE,
      poison:0,
      monarch:false,
      initiative:false
    };
    this.state.players.push(player);
    this._log(`${player.name} joined the pod`,'join');
    this._save();this.render();
  },

  removePlayer(){
    if(this.state.players.length<=this.MIN_PLAYERS){if(typeof Notify!=='undefined')Notify.show('Minimum 2 players','inf');return;}
    const removed=this.state.players.pop();
    delete this.state.damage[removed.id];
    Object.values(this.state.damage).forEach(row=>delete row[removed.id]);
    if(this.state.active===removed.id)this.state.active=this.state.players[0].id;
    this._log(`${removed.name} was removed from the pod`,'leave');
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
    const p=this._player(id);if(!p||!delta)return;
    const before=p.life;
    p.life=Math.max(-99,Math.min(999,p.life+delta));
    if(before!==p.life){
      this._log(`${p.name} ${delta>0?'gained':'lost'} ${Math.abs(delta)} life (${p.life})`,delta>0?'heal':'damage');
      if(this._isOut(p))this._log(`${p.name} was eliminated`,'out');
    }
    this._save();this.render();
  },

  adjustAll(delta){
    if(!delta)return;
    this.state.players.forEach(p=>{p.life=Math.max(-99,Math.min(999,p.life+delta));});
    this._log(`All players ${delta>0?'gained':'lost'} ${Math.abs(delta)} life`,'global');
    this._save();this.render();
  },

  adjustPoison(id,delta){
    const p=this._player(id);if(!p||!delta)return;
    const before=p.poison;
    p.poison=Math.max(0,Math.min(10,p.poison+delta));
    if(before!==p.poison){
      this._log(`${p.name} ${delta>0?'gained':'lost'} ${Math.abs(delta)} poison (${p.poison})`,delta>0?'poison':'cleanse');
      if(this._isOut(p))this._log(`${p.name} was eliminated by poison`,'out');
    }
    this._save();this.render();
  },

  adjustCommander(targetId,sourceId,delta){
    if(!delta)return;
    const target=this._player(targetId);
    const source=this._player(sourceId);
    if(!target||!source)return;
    const before=this._damage(targetId,sourceId);
    this._setDamage(targetId,sourceId,before+delta);
    const after=this._damage(targetId,sourceId);
    if(before!==after){
      this._log(`${source.name} ${delta>0?'dealt':'reduced'} commander damage ${delta>0?'to':'on'} ${target.name} (${after})`,'commander');
      if(after>=21)this._log(`${target.name} reached 21 commander damage from ${source.name}`,'out');
    }
    this._save();this.render();
  },

  setName(id,value){
    const p=this._player(id);if(!p)return;
    const old=p.name;
    p.name=(value||'').trim().slice(0,24)||'Player';
    if(old!==p.name)this._log(`${old} is now ${p.name}`,'rename');
    this._save();this.render();
  },

  setActive(id){
    const p=this._player(id);if(!p)return;
    this.state.active=id;
    this._log(`${p.name} is now in turn`,'turn');
    this._save();this.render();
  },

  nextTurn(){
    const players=(this.state.players||[]).filter(p=>!this._isOut(p));
    if(!players.length)return;
    const currentIndex=Math.max(0,players.findIndex(p=>p.id===this.state.active));
    const nextIndex=(currentIndex+1)%players.length;
    this.state.active=players[nextIndex].id;
    this.state.turnNumber=(this.state.turnNumber||1)+1;
    this._log(`Turn ${this.state.turnNumber}: ${players[nextIndex].name} is up`,'turn');
    this._save();this.render();
  },

  toggle(id,key){
    const p=this._player(id);if(!p)return;
    if(key==='monarch'){
      const next=!p.monarch;
      this.state.players.forEach(x=>x.monarch=false);
      p.monarch=next;
      this._log(next?`${p.name} became the Monarch`:`${p.name} is no longer the Monarch`,'badge');
    }
    if(key==='initiative'){
      const next=!p.initiative;
      this.state.players.forEach(x=>x.initiative=false);
      p.initiative=next;
      this._log(next?`${p.name} took the Initiative`:`${p.name} no longer has the Initiative`,'badge');
    }
    this._save();this.render();
  },

  clearCommanderDamage(){
    this.state.damage={};
    this._log('Commander damage was cleared','reset');
    this._save();this.render();
  },

  render(){
    if(!document.getElementById('tracker-board'))return;
    if(!this.state)this.state=this._load();
    this.renderDashboard();
    this.renderBoard();
    this.renderDamage();
    this.renderSummary();
    this.renderHistory();
  },

  renderDashboard(){
    const active=this._player(this.state.active);
    const turn=document.getElementById('tracker-turn-chip');
    const player=document.getElementById('tracker-active-chip');
    const elapsed=document.getElementById('tracker-elapsed-chip');
    const pod=document.getElementById('tracker-pod-chip');
    if(turn)turn.textContent='Turn '+(this.state.turnNumber||1);
    if(player)player.textContent=active?active.name:'-';
    if(elapsed)elapsed.textContent=this._formatElapsed(this._elapsedMs());
    if(pod)pod.textContent=this.state.players.length+' Players';
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
      this.state.active===p.id?'<button class="tracker-status-badge active" onclick="CommanderTracker.nextTurn()" title="Pass turn to the next player">Active Turn</button>':'',
      p.monarch?`<button class="tracker-status-badge monarch" onclick="CommanderTracker.toggle('${p.id}','monarch')" title="Remove Monarch">Monarch</button>`:'',
      p.initiative?`<button class="tracker-status-badge initiative" onclick="CommanderTracker.toggle('${p.id}','initiative')" title="Remove Initiative">Initiative</button>`:'',
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
          <button class="tracker-turn ${this.state.active===p.id?'active':''}" onclick="${this.state.active===p.id?'CommanderTracker.nextTurn()':`CommanderTracker.setActive('${p.id}')`}">${this.state.active===p.id?'Pass Turn':'Set Turn'}</button>
        </div>
        <div class="tracker-life-wrap">
          <div class="tracker-life-kicker">${this._statusText(p)}</div>
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
  },

  renderSummary(){
    const body=document.getElementById('tracker-summary-grid');
    if(!body)return;
    const living=this.state.players.filter(p=>!this._isOut(p));
    const leader=[...this.state.players].sort((a,b)=>b.life-a.life)[0];
    const monarch=this.state.players.find(p=>p.monarch);
    const initiative=this.state.players.find(p=>p.initiative);
    const highestDamage=this.state.players.reduce((best,target)=>{
      this.state.players.forEach(source=>{
        if(source.id===target.id)return;
        const value=this._damage(target.id,source.id);
        if(value>best.value)best={value,source,target};
      });
      return best;
    },{value:0,source:null,target:null});
    body.innerHTML=`
      <div class="tracker-summary-stat">
        <span>Players Alive</span>
        <strong>${living.length}</strong>
        <small>${this.state.players.length-living.length} eliminated</small>
      </div>
      <div class="tracker-summary-stat">
        <span>Life Leader</span>
        <strong>${leader?esc(leader.name):'-'}</strong>
        <small>${leader?leader.life+' life':'No data'}</small>
      </div>
      <div class="tracker-summary-stat">
        <span>Monarch</span>
        <strong>${monarch?esc(monarch.name):'Unclaimed'}</strong>
        <small>${initiative?`Initiative: ${esc(initiative.name)}`:'Initiative open'}</small>
      </div>
      <div class="tracker-summary-stat">
        <span>Top Threat</span>
        <strong>${highestDamage.value>0&&highestDamage.source?esc(highestDamage.source.name):'Quiet board'}</strong>
        <small>${highestDamage.value>0&&highestDamage.target?`${highestDamage.value} to ${esc(highestDamage.target.name)}`:'No commander pressure yet'}</small>
      </div>`;
  },

  renderHistory(){
    const list=document.getElementById('tracker-log-list');
    if(!list)return;
    const items=this.state.history||[];
    if(!items.length){
      list.innerHTML='<div class="tracker-log-empty">No events yet. Start the game and the tracker will build a match log.</div>';
      return;
    }
    list.innerHTML=items.map(item=>`
      <div class="tracker-log-item ${item.type||'event'}">
        <div class="tracker-log-time">${new Date(item.ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</div>
        <div class="tracker-log-text">${esc(item.text)}</div>
      </div>`).join('');
  }
};

CommanderTracker.init();
