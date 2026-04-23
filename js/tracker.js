/* MagicTheDrinkering: Commander life tracker */

const CommanderTracker={
  KEY:'mtd_commander_tracker_v1',
  MATCH_HISTORY_KEY:'mtd_commander_tracker_matches_v1',
  START_LIFE:40,
  MIN_PLAYERS:2,
  MAX_PLAYERS:6,
  HISTORY_LIMIT:24,
  MATCH_HISTORY_LIMIT:12,
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
      matchId:'match-'+now,
      players,
      damage:{},
      active:players[0].id,
      turnNumber:1,
      startedAt:now,
      finishedAt:null,
      finishedReason:'',
      winnerId:'',
      archived:false,
      notes:'',
      eliminated:[],
      history:[{id:'evt-'+now,type:'system',text:'Game started',ts:now}],
      updated:now
    };
  },

  _normalizeState(saved){
    const base=this._fresh(saved?.players?.length||4);
    const state={...base,...saved};
    state.matchId=saved?.matchId||base.matchId;
    state.players=Array.isArray(saved?.players)&&saved.players.length>=this.MIN_PLAYERS?saved.players:base.players;
    state.damage=saved?.damage||{};
    state.active=state.players.some(p=>p.id===saved?.active)?saved.active:state.players[0].id;
    state.turnNumber=Number.isFinite(saved?.turnNumber)&&saved.turnNumber>0?saved.turnNumber:1;
    state.startedAt=Number.isFinite(saved?.startedAt)?saved.startedAt:Date.now();
    state.finishedAt=Number.isFinite(saved?.finishedAt)?saved.finishedAt:null;
    state.finishedReason=saved?.finishedReason||'';
    state.winnerId=saved?.winnerId||'';
    state.archived=!!saved?.archived;
    state.notes=typeof saved?.notes==='string'?saved.notes:'';
    state.eliminated=Array.isArray(saved?.eliminated)?saved.eliminated:[];
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

  _loadMatchHistory(){
    try{
      const saved=JSON.parse(localStorage.getItem(this.MATCH_HISTORY_KEY)||'[]');
      return Array.isArray(saved)?saved:[];
    }catch{
      return [];
    }
  },

  _saveMatchHistory(items){
    localStorage.setItem(this.MATCH_HISTORY_KEY,JSON.stringify(items.slice(0,this.MATCH_HISTORY_LIMIT)));
  },

  _startClock(){
    if(this._clock)clearInterval(this._clock);
    this._clock=setInterval(()=>{
      if(!this.state)return;
      this.renderDashboard();
      this.renderSummary();
      this.renderMatchHistory();
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

  _isEliminated(playerId){
    return (this.state.eliminated||[]).some(entry=>entry.id===playerId);
  },

  _isDefeatedNow(player){
    if(player.life<=0||player.poison>=10)return true;
    return this.state.players.some(src=>src.id!==player.id&&this._damage(player.id,src.id)>=21);
  },

  _isOut(player){
    return this._isEliminated(player.id)||this._isDefeatedNow(player);
  },

  _alivePlayers(){
    return this.state.players.filter(p=>!this._isOut(p));
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
    const end=this.state?.finishedAt||Date.now();
    return Math.max(0,end-(this.state?.startedAt||Date.now()));
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
    if(this.state.finishedAt&&this.state.winnerId===player.id)return'Winner';
    if(this._isOut(player))return'Eliminated';
    if(player.id===this.state.active)return'In turn';
    return'Ready';
  },

  _syncEliminations(){
    const defeated=this.state.players.filter(p=>this._isDefeatedNow(p)&&!this._isEliminated(p.id));
    defeated.forEach(player=>{
      const entry={id:player.id,name:player.name,turn:this.state.turnNumber||1,ts:Date.now()};
      this.state.eliminated.push(entry);
      this._log(`${player.name} was eliminated on turn ${entry.turn}`,'out');
    });
  },

  _checkGameOver(){
    if(this.state.finishedAt)return;
    const alive=this._alivePlayers();
    if(alive.length===1){
      this.finishGame(alive[0].id,'Last player standing');
    }else if(alive.length===0){
      this.finishGame('', 'All players eliminated');
    }else if(this._player(this.state.active)&&this._isOut(this._player(this.state.active))){
      this.state.active=alive[0].id;
    }
  },

  _matchPayload(){
    const winner=this._player(this.state.winnerId);
    return{
      id:this.state.matchId,
      startedAt:this.state.startedAt,
      finishedAt:this.state.finishedAt||Date.now(),
      durationMs:this._elapsedMs(),
      turnNumber:this.state.turnNumber||1,
      winnerId:this.state.winnerId||'',
      winnerName:winner?.name||'',
      finishedReason:this.state.finishedReason||'',
      notes:this.state.notes||'',
      players:this.state.players.map(p=>({
        id:p.id,
        name:p.name,
        life:p.life,
        poison:p.poison,
        eliminated:this._isEliminated(p.id)
      })),
      eliminated:[...(this.state.eliminated||[])],
      history:(this.state.history||[]).slice(0,12)
    };
  },

  _persistFinishedMatch(){
    if(!this.state.finishedAt||this.state.archived)return;
    const history=this._loadMatchHistory().filter(item=>item.id!==this.state.matchId);
    history.unshift(this._matchPayload());
    this._saveMatchHistory(history);
    this.state.archived=true;
  },

  addPlayer(){
    if(this.state.players.length>=this.MAX_PLAYERS||this.state.finishedAt){if(typeof Notify!=='undefined')Notify.show(this.state.finishedAt?'Game already finished':'Maximum 6 players','inf');return;}
    const next=this.state.players.length+1;
    const player={id:'p'+Date.now().toString(36),name:'Player '+next,life:this.START_LIFE,poison:0,monarch:false,initiative:false};
    this.state.players.push(player);
    this._log(`${player.name} joined the pod`,'join');
    this._save();this.render();
  },

  removePlayer(){
    if(this.state.players.length<=this.MIN_PLAYERS||this.state.finishedAt){if(typeof Notify!=='undefined')Notify.show(this.state.finishedAt?'Game already finished':'Minimum 2 players','inf');return;}
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
    const p=this._player(id);if(!p||!delta||this.state.finishedAt||this._isEliminated(id))return;
    const before=p.life;
    p.life=Math.max(-99,Math.min(999,p.life+delta));
    if(before!==p.life)this._log(`${p.name} ${delta>0?'gained':'lost'} ${Math.abs(delta)} life (${p.life})`,delta>0?'heal':'damage');
    this._syncEliminations();
    this._checkGameOver();
    this._save();this.render();
  },

  adjustAll(delta){
    if(!delta||this.state.finishedAt)return;
    this.state.players.forEach(p=>{if(!this._isEliminated(p.id))p.life=Math.max(-99,Math.min(999,p.life+delta));});
    this._log(`All active players ${delta>0?'gained':'lost'} ${Math.abs(delta)} life`,'global');
    this._syncEliminations();
    this._checkGameOver();
    this._save();this.render();
  },

  adjustPoison(id,delta){
    const p=this._player(id);if(!p||!delta||this.state.finishedAt||this._isEliminated(id))return;
    const before=p.poison;
    p.poison=Math.max(0,Math.min(10,p.poison+delta));
    if(before!==p.poison)this._log(`${p.name} ${delta>0?'gained':'lost'} ${Math.abs(delta)} poison (${p.poison})`,delta>0?'poison':'cleanse');
    this._syncEliminations();
    this._checkGameOver();
    this._save();this.render();
  },

  adjustCommander(targetId,sourceId,delta){
    if(!delta||this.state.finishedAt||this._isEliminated(targetId))return;
    const target=this._player(targetId);
    const source=this._player(sourceId);
    if(!target||!source)return;
    const before=this._damage(targetId,sourceId);
    this._setDamage(targetId,sourceId,before+delta);
    const after=this._damage(targetId,sourceId);
    if(before!==after)this._log(`${source.name} ${delta>0?'dealt':'reduced'} commander damage ${delta>0?'to':'on'} ${target.name} (${after})`,'commander');
    this._syncEliminations();
    this._checkGameOver();
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
    const p=this._player(id);if(!p||this.state.finishedAt||this._isOut(p))return;
    this.state.active=id;
    this._log(`${p.name} is now in turn`,'turn');
    this._save();this.render();
  },

  nextTurn(){
    if(this.state.finishedAt)return;
    const players=this._alivePlayers();
    if(!players.length)return;
    const currentIndex=Math.max(0,players.findIndex(p=>p.id===this.state.active));
    const nextIndex=(currentIndex+1)%players.length;
    this.state.active=players[nextIndex].id;
    this.state.turnNumber=(this.state.turnNumber||1)+1;
    this._log(`Turn ${this.state.turnNumber}: ${players[nextIndex].name} is up`,'turn');
    this._save();this.render();
  },

  toggle(id,key){
    const p=this._player(id);if(!p||this.state.finishedAt||this._isEliminated(id))return;
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

  setNotes(value){
    this.state.notes=String(value||'').slice(0,1500);
    this._save();
  },

  finishGame(winnerId='',reason='Finished manually'){
    if(this.state.finishedAt)return;
    const alive=this._alivePlayers();
    const winner=winnerId?this._player(winnerId):(alive.length===1?alive[0]:alive[0]||null);
    this.state.finishedAt=Date.now();
    this.state.winnerId=winner?.id||'';
    this.state.finishedReason=reason;
    this._log(winner?`${winner.name} won the game`:`Game finished`, 'finish');
    this._persistFinishedMatch();
    this._save();
    this.render();
  },

  exportHistory(){
    const history=this._loadMatchHistory();
    const blob=new Blob([JSON.stringify(history,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download='tracker-match-history.json';
    a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  },

  render(){
    if(!document.getElementById('tracker-board'))return;
    if(!this.state)this.state=this._load();
    this.renderDashboard();
    this.renderBoard();
    this.renderDamage();
    this.renderSummary();
    this.renderHistory();
    this.renderMatchHistory();
    const note=document.getElementById('tracker-note-input');
    if(note&&note.value!==this.state.notes)note.value=this.state.notes||'';
  },

  renderDashboard(){
    const active=this._player(this.state.active);
    const turn=document.getElementById('tracker-turn-chip');
    const player=document.getElementById('tracker-active-chip');
    const elapsed=document.getElementById('tracker-elapsed-chip');
    const pod=document.getElementById('tracker-pod-chip');
    if(turn)turn.textContent=this.state.finishedAt?'Final':'Turn '+(this.state.turnNumber||1);
    if(player)player.textContent=this.state.finishedAt?(this._player(this.state.winnerId)?.name||'No winner'):(active?active.name:'-');
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
      !this.state.finishedAt&&this.state.active===p.id?'<button class="tracker-status-badge active" onclick="CommanderTracker.nextTurn()" title="Pass turn to the next player">Active Turn</button>':'',
      p.monarch?`<button class="tracker-status-badge monarch" onclick="CommanderTracker.toggle('${p.id}','monarch')" title="Remove Monarch">Monarch</button>`:'',
      p.initiative?`<button class="tracker-status-badge initiative" onclick="CommanderTracker.toggle('${p.id}','initiative')" title="Remove Initiative">Initiative</button>`:'',
      this.state.finishedAt&&this.state.winnerId===p.id?'<span class="tracker-status-badge winner">Winner</span>':'',
      out?'<span class="tracker-status-badge out">Knocked Out</span>':''
    ].filter(Boolean).join('');
    const commanderRows=this.state.players.filter(src=>src.id!==p.id).map(src=>{
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
      <article class="tracker-card ${this.colors[i%this.colors.length]} ${out?'is-out':''} ${this.state.active===p.id&&!this.state.finishedAt?'is-active':''}">
        <div class="tracker-card-orb">${this._initials(p.name)}</div>
        <div class="tracker-card-status">${badges}</div>
        <div class="tracker-card-top">
          <input class="tracker-name" value="${esc(p.name)}" maxlength="24" onchange="CommanderTracker.setName('${p.id}',this.value)" onfocus="this.select()" aria-label="Player name">
          <button class="tracker-turn ${this.state.active===p.id&&!this.state.finishedAt?'active':''}" onclick="${this.state.finishedAt||out?'void(0)':this.state.active===p.id?'CommanderTracker.nextTurn()':`CommanderTracker.setActive('${p.id}')`}">${this.state.finishedAt?(this.state.winnerId===p.id?'Won':'Finished'):out?'Out':this.state.active===p.id?'Pass Turn':'Set Turn'}</button>
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
    const banner=document.getElementById('tracker-summary-banner');
    const winnerChooser=document.getElementById('tracker-winner-chooser');
    const order=document.getElementById('tracker-elimination-order');
    if(!body||!banner||!winnerChooser||!order)return;
    const alive=this._alivePlayers();
    const leader=[...this.state.players].sort((a,b)=>b.life-a.life)[0];
    const winner=this._player(this.state.winnerId);
    const monarch=this.state.players.find(p=>p.monarch);
    const initiative=this.state.players.find(p=>p.initiative);
    banner.className='tracker-summary-banner'+(this.state.finishedAt?' finished':'');
    banner.innerHTML=this.state.finishedAt
      ? `<strong>${winner?esc(winner.name):'No winner set'}</strong><span>${esc(this.state.finishedReason||'Game finished')}</span>`
      : `<strong>Game live</strong><span>${alive.length} players still in the game</span>`;
    body.innerHTML=`
      <div class="tracker-summary-stat">
        <span>Players Alive</span>
        <strong>${alive.length}</strong>
        <small>${this.state.players.length-alive.length} eliminated</small>
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
        <span>Duration</span>
        <strong>${this._formatElapsed(this._elapsedMs())}</strong>
        <small>Ended on turn ${this.state.turnNumber||1}</small>
      </div>`;
    winnerChooser.innerHTML=this.state.finishedAt
      ? ''
      : `<div class="tracker-winner-title">Declare winner</div><div class="tracker-winner-buttons">${alive.map(p=>`<button class="tracker-winner-btn" onclick="CommanderTracker.finishGame('${p.id}','Winner declared manually')">${esc(p.name)}</button>`).join('')}<button class="tracker-winner-btn ghost" onclick="CommanderTracker.finishGame('','Stopped without winner')">No winner</button></div>`;
    const eliminated=this.state.eliminated||[];
    order.innerHTML=eliminated.length
      ? eliminated.map((entry,index)=>`<div class="tracker-order-item"><span>#${index+1}</span><strong>${esc(entry.name)}</strong><small>Turn ${entry.turn}</small></div>`).join('')
      : '<div class="tracker-log-empty">No eliminations yet.</div>';
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
  },

  renderMatchHistory(){
    const list=document.getElementById('tracker-match-history');
    if(!list)return;
    const items=this._loadMatchHistory();
    if(!items.length){
      list.innerHTML='<div class="tracker-log-empty">Finished matches will appear here.</div>';
      return;
    }
    list.innerHTML=items.map(item=>`
      <div class="tracker-history-item">
        <div>
          <strong>${esc(item.winnerName||'No winner')}</strong>
          <span>${new Date(item.finishedAt).toLocaleDateString()} · ${item.turnNumber} turns</span>
        </div>
        <small>${this._formatElapsed(item.durationMs||0)}</small>
      </div>`).join('');
  }
};

CommanderTracker.init();
