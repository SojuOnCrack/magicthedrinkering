/* MagicTheDrinkering: Commander life tracker */

const CommanderTracker={
  KEY:'mtd_commander_tracker_v1',
  MATCH_HISTORY_KEY:'mtd_commander_tracker_matches_v1',
  START_LIFE:40,
  MIN_PLAYERS:2,
  MAX_PLAYERS:6,
  HISTORY_LIMIT:18,
  MATCH_HISTORY_LIMIT:10,
  colors:['gold','ice','green','crimson','purple','steel'],
  state:null,
  _clock:null,

  init(){
    this.state=this._load();
    this._startClock();
    this.render();
  },

  _emptyStats(){
    return{kills:0,lifeGain:0,lifeLoss:0,poisonGiven:0,commanderGiven:0};
  },

  _freshPlayers(count){
    return Array.from({length:count},(_,i)=>({
      id:'p'+(i+1),
      name:'Player '+(i+1),
      deck:'',
      life:this.START_LIFE,
      poison:0,
      monarch:false,
      initiative:false
    }));
  },

  _fresh(count=4){
    const now=Date.now();
    const players=this._freshPlayers(count);
    return{
      matchId:'match-'+now,
      players,
      damage:{},
      stats:Object.fromEntries(players.map(p=>[p.id,this._emptyStats()])),
      active:players[0].id,
      turnNumber:1,
      startedAt:now,
      finishedAt:null,
      finishedReason:'',
      winnerId:'',
      archived:false,
      notes:'',
      setupCollapsed:false,
      eliminated:[],
      history:[{id:'evt-'+now,type:'system',text:'Game started',ts:now}],
      updated:now
    };
  },

  _normalizeState(saved){
    const base=this._fresh(saved?.players?.length||4);
    const state={...base,...saved};
    state.players=Array.isArray(saved?.players)&&saved.players.length>=this.MIN_PLAYERS?saved.players.map(p=>({deck:'',...p})):base.players;
    state.stats=saved?.stats&&typeof saved.stats==='object'?saved.stats:{};
    state.players.forEach(p=>{state.stats[p.id]=state.stats[p.id]||this._emptyStats();});
    state.damage=saved?.damage||{};
    state.active=state.players.some(p=>p.id===saved?.active)?saved.active:state.players[0].id;
    state.turnNumber=Number.isFinite(saved?.turnNumber)&&saved.turnNumber>0?saved.turnNumber:1;
    state.startedAt=Number.isFinite(saved?.startedAt)?saved.startedAt:Date.now();
    state.finishedAt=Number.isFinite(saved?.finishedAt)?saved.finishedAt:null;
    state.finishedReason=saved?.finishedReason||'';
    state.winnerId=saved?.winnerId||'';
    state.archived=!!saved?.archived;
    state.notes=typeof saved?.notes==='string'?saved.notes:'';
    state.setupCollapsed=!!saved?.setupCollapsed;
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
    },1000);
  },

  _player(id){
    return this.state.players.find(p=>p.id===id);
  },

  _stats(id){
    this.state.stats[id]=this.state.stats[id]||this._emptyStats();
    return this.state.stats[id];
  },

  _damage(targetId,sourceId){
    return this.state.damage?.[targetId]?.[sourceId]||0;
  },

  _setDamage(targetId,sourceId,value){
    this.state.damage[targetId]=this.state.damage[targetId]||{};
    this.state.damage[targetId][sourceId]=Math.max(0,Math.min(99,value));
  },

  _isEliminated(id){
    return this.state.eliminated.some(entry=>entry.id===id);
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
    return String(name||'Player').trim().split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]?.toUpperCase()||'').join('')||'P';
  },

  _elapsedMs(){
    return Math.max(0,(this.state.finishedAt||Date.now())-(this.state.startedAt||Date.now()));
  },

  _formatElapsed(ms){
    const total=Math.floor(ms/1000);
    const hours=Math.floor(total/3600);
    const minutes=Math.floor((total%3600)/60);
    const seconds=total%60;
    return hours>0
      ? `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`
      : `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
  },

  _log(text,type='event'){
    const ts=Date.now();
    const next={id:'evt-'+ts+'-'+Math.random().toString(36).slice(2,5),type,text,ts};
    const current=this.state.history||[];
    if(current[0]?.text===text&&current[0]?.type===type)return;
    this.state.history=[next,...current].slice(0,this.HISTORY_LIMIT);
  },

  _recordElimination(player,reason,killerId=''){
    if(!player||this._isEliminated(player.id))return;
    const killer=this._player(killerId);
    this.state.eliminated.push({
      id:player.id,
      name:player.name,
      turn:this.state.turnNumber||1,
      ts:Date.now(),
      reason,
      killerId:killer?.id||'',
      killerName:killer?.name||''
    });
    if(killer?.id&&killer.id!==player.id)this._stats(killer.id).kills++;
    this._log(killer?.id&&killer.id!==player.id?`${player.name} was eliminated by ${killer.name}`:`${player.name} was eliminated`,'out');
  },

  _ensureActiveAlive(){
    if(this.state.finishedAt)return;
    const alive=this._alivePlayers();
    if(alive.length&&!alive.some(p=>p.id===this.state.active))this.state.active=alive[0].id;
  },

  _checkGameOver(){
    if(this.state.finishedAt)return;
    const alive=this._alivePlayers();
    if(alive.length===1)return this.finishGame(alive[0].id,'Last player standing');
    if(alive.length===0)return this.finishGame('','All players eliminated');
    this._ensureActiveAlive();
  },

  _matchPayload(){
    const winner=this._player(this.state.winnerId);
    const topKiller=this._topStat('kills');
    return{
      id:this.state.matchId,
      startedAt:this.state.startedAt,
      finishedAt:this.state.finishedAt||Date.now(),
      durationMs:this._elapsedMs(),
      turnNumber:this.state.turnNumber||1,
      winnerName:winner?.name||'',
      finishedReason:this.state.finishedReason||'',
      notes:this.state.notes||'',
      topKillerName:topKiller.player?.name||'',
      topKillerValue:topKiller.value||0,
      eliminated:[...this.state.eliminated]
    };
  },

  _persistFinishedMatch(){
    if(!this.state.finishedAt||this.state.archived)return;
    const next=[this._matchPayload(),...this._loadMatchHistory().filter(item=>item.id!==this.state.matchId)];
    this._saveMatchHistory(next);
    this.state.archived=true;
  },

  _topStat(key){
    return this.state.players.reduce((best,p)=>{
      const value=this._stats(p.id)[key]||0;
      return value>best.value?{player:p,value}:best;
    },{player:null,value:0});
  },

  toggleSetup(){
    this.state.setupCollapsed=!this.state.setupCollapsed;
    this._save();
    this.renderSetup();
  },

  addPlayer(){
    if(this.state.players.length>=this.MAX_PLAYERS||this.state.finishedAt)return;
    const next=this.state.players.length+1;
    const player={id:'p'+Date.now().toString(36),name:'Player '+next,deck:'',life:this.START_LIFE,poison:0,monarch:false,initiative:false};
    this.state.players.push(player);
    this.state.stats[player.id]=this._emptyStats();
    this._log(`${player.name} joined the pod`,'join');
    this._save();this.render();
  },

  removePlayer(){
    if(this.state.players.length<=this.MIN_PLAYERS||this.state.finishedAt)return;
    const removed=this.state.players.pop();
    delete this.state.damage[removed.id];
    Object.values(this.state.damage).forEach(row=>delete row[removed.id]);
    delete this.state.stats[removed.id];
    this.state.eliminated=this.state.eliminated.filter(entry=>entry.id!==removed.id);
    if(this.state.active===removed.id)this.state.active=this.state.players[0].id;
    this._log(`${removed.name} was removed from the pod`,'leave');
    this._save();this.render();
  },

  resetGame(){
    const preserved=this.state.players.map(p=>({name:p.name,deck:p.deck||''}));
    this.state=this._fresh(this.state.players.length||4);
    this.state.players.forEach((p,i)=>{
      p.name=preserved[i]?.name||p.name;
      p.deck=preserved[i]?.deck||'';
    });
    this._save();this.render();
  },

  setPlayerName(id,value){
    const p=this._player(id);if(!p)return;
    const next=(value||'').trim().slice(0,24)||'Player';
    if(p.name!==next){
      this._log(`${p.name} is now ${next}`,'rename');
      p.name=next;
    }
    this._save();this.render();
  },

  setPlayerDeck(id,value){
    const p=this._player(id);if(!p)return;
    p.deck=(value||'').trim().slice(0,40);
    this._save();this.renderSetup();
  },

  setStartingPlayer(id){
    if(this.state.finishedAt||!this._player(id))return;
    this.state.active=id;
    this._save();this.render();
  },

  adjustLife(id,delta){
    const p=this._player(id);if(!p||!delta||this.state.finishedAt||this._isEliminated(id))return;
    const before=p.life;
    p.life=Math.max(-99,Math.min(999,p.life+delta));
    if(before===p.life)return;
    if(delta>0)this._stats(id).lifeGain+=delta; else this._stats(id).lifeLoss+=Math.abs(delta);
    this._log(`${p.name} ${delta>0?'gained':'lost'} ${Math.abs(delta)} life (${p.life})`,delta>0?'heal':'damage');
    if(this._isDefeatedNow(p))this._recordElimination(p,'life',delta<0&&this.state.active!==id?this.state.active:'');
    this._checkGameOver();
    this._save();this.render();
  },

  adjustAll(delta){
    if(!delta||this.state.finishedAt)return;
    this.state.players.forEach(p=>{
      if(this._isEliminated(p.id))return;
      p.life=Math.max(-99,Math.min(999,p.life+delta));
      if(delta>0)this._stats(p.id).lifeGain+=delta; else this._stats(p.id).lifeLoss+=Math.abs(delta);
      if(this._isDefeatedNow(p))this._recordElimination(p,'global');
    });
    this._log(`All active players ${delta>0?'gained':'lost'} ${Math.abs(delta)} life`,'global');
    this._checkGameOver();
    this._save();this.render();
  },

  adjustPoison(id,delta){
    const p=this._player(id);if(!p||!delta||this.state.finishedAt||this._isEliminated(id))return;
    const before=p.poison;
    p.poison=Math.max(0,Math.min(10,p.poison+delta));
    if(before===p.poison)return;
    if(delta>0&&this.state.active&&this.state.active!==id)this._stats(this.state.active).poisonGiven+=delta;
    this._log(`${p.name} ${delta>0?'gained':'lost'} ${Math.abs(delta)} poison (${p.poison})`,delta>0?'poison':'cleanse');
    if(this._isDefeatedNow(p))this._recordElimination(p,'poison',delta>0&&this.state.active!==id?this.state.active:'');
    this._checkGameOver();
    this._save();this.render();
  },

  adjustCommander(targetId,sourceId,delta){
    const target=this._player(targetId),source=this._player(sourceId);
    if(!target||!source||!delta||this.state.finishedAt||this._isEliminated(targetId))return;
    const before=this._damage(targetId,sourceId);
    this._setDamage(targetId,sourceId,before+delta);
    const after=this._damage(targetId,sourceId);
    if(before===after)return;
    if(delta>0)this._stats(sourceId).commanderGiven+=delta;
    this._log(`${source.name} ${delta>0?'dealt':'reduced'} commander damage ${delta>0?'to':'on'} ${target.name} (${after})`,'commander');
    if(after>=21)this._recordElimination(target,'commander',sourceId);
    this._checkGameOver();
    this._save();this.render();
  },

  nextTurn(){
    if(this.state.finishedAt)return;
    const players=this._alivePlayers();
    if(!players.length)return;
    const current=Math.max(0,players.findIndex(p=>p.id===this.state.active));
    this.state.active=players[(current+1)%players.length].id;
    this.state.turnNumber=(this.state.turnNumber||1)+1;
    this._log(`Turn ${this.state.turnNumber}: ${this._player(this.state.active)?.name||'Next player'} is up`,'turn');
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
    this.state.notes=String(value||'').slice(0,1200);
    this._save();
  },

  finishGame(winnerId='',reason='Finished manually'){
    if(this.state.finishedAt)return;
    const alive=this._alivePlayers();
    const winner=winnerId?this._player(winnerId):(alive.length===1?alive[0]:alive[0]||null);
    this.state.finishedAt=Date.now();
    this.state.winnerId=winner?.id||'';
    this.state.finishedReason=reason;
    this._log(winner?`${winner.name} won the game`:'Game finished','finish');
    this._persistFinishedMatch();
    this._save();this.render();
  },

  exportHistory(){
    const blob=new Blob([JSON.stringify(this._loadMatchHistory(),null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download='tracker-match-history.json';
    a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  },

  render(){
    if(!document.getElementById('tracker-board'))return;
    this.renderSetup();
    this.renderDashboard();
    this.renderBoard();
    this.renderDamage();
    this.renderSummary();
    this.renderHistory();
    this.renderMatchHistory();
    const note=document.getElementById('tracker-note-input');
    if(note&&note.value!==this.state.notes)note.value=this.state.notes||'';
  },

  renderSetup(){
    const wrap=document.getElementById('tracker-setup-panel');
    const grid=document.getElementById('tracker-setup-grid');
    const toggle=document.getElementById('tracker-setup-toggle');
    if(!wrap||!grid||!toggle)return;
    wrap.classList.toggle('collapsed',this.state.setupCollapsed);
    toggle.textContent=this.state.setupCollapsed?'Show setup':'Hide setup';
    grid.innerHTML=this.state.players.map((p,index)=>`
      <div class="tracker-setup-card ${this.state.active===p.id?'is-starting':''}">
        <div class="tracker-setup-seat">Seat ${index+1}</div>
        <input class="tracker-setup-input" value="${esc(p.name)}" maxlength="24" onchange="CommanderTracker.setPlayerName('${p.id}',this.value)" placeholder="Player name">
        <input class="tracker-setup-input deck" value="${esc(p.deck||'')}" maxlength="40" onchange="CommanderTracker.setPlayerDeck('${p.id}',this.value)" placeholder="Deck name">
        <button class="tracker-setup-btn ${this.state.active===p.id?'active':''}" onclick="CommanderTracker.setStartingPlayer('${p.id}')">${this.state.active===p.id?'Starting Player':'Set Starter'}</button>
      </div>
    `).join('');
  },

  renderDashboard(){
    const turn=document.getElementById('tracker-turn-chip');
    const active=document.getElementById('tracker-active-chip');
    const elapsed=document.getElementById('tracker-elapsed-chip');
    const pod=document.getElementById('tracker-pod-chip');
    if(turn)turn.textContent=this.state.finishedAt?'Final':'Turn '+this.state.turnNumber;
    if(active)active.textContent=this.state.finishedAt?(this._player(this.state.winnerId)?.name||'No winner'):(this._player(this.state.active)?.name||'-');
    if(elapsed)elapsed.textContent=this._formatElapsed(this._elapsedMs());
    if(pod)pod.textContent=this.state.players.length+' Players';
  },

  renderBoard(){
    const board=document.getElementById('tracker-board');if(!board)return;
    board.className='tracker-board players-'+this.state.players.length;
    board.innerHTML=this.state.players.map((p,i)=>this._playerCard(p,i)).join('');
  },

  _playerCard(p,i){
    const out=this._isOut(p);
    const maxCmd=Math.max(0,...this.state.players.filter(src=>src.id!==p.id).map(src=>this._damage(p.id,src.id)));
    const badges=[
      !this.state.finishedAt&&this.state.active===p.id?'<button class="tracker-status-badge active" onclick="CommanderTracker.nextTurn()">Active Turn</button>':'',
      p.monarch?`<button class="tracker-status-badge monarch" onclick="CommanderTracker.toggle('${p.id}','monarch')">Monarch</button>`:'',
      p.initiative?`<button class="tracker-status-badge initiative" onclick="CommanderTracker.toggle('${p.id}','initiative')">Initiative</button>`:'',
      this.state.finishedAt&&this.state.winnerId===p.id?'<span class="tracker-status-badge winner">Winner</span>':'',
      out?'<span class="tracker-status-badge out">Knocked Out</span>':''
    ].filter(Boolean).join('');
    const commanderRows=this.state.players.filter(src=>src.id!==p.id).map(src=>{
      const value=this._damage(p.id,src.id);
      const state=this._damageState(value);
      return`
        <div class="tracker-inline-cmd ${state}">
          <button class="tracker-inline-btn" onclick="CommanderTracker.adjustCommander('${p.id}','${src.id}',-1)">-</button>
          <button class="tracker-inline-main" onclick="CommanderTracker.adjustCommander('${p.id}','${src.id}',1)">
            <span>${esc(src.name)}</span>
            <strong>${value}</strong>
          </button>
          <button class="tracker-inline-btn" onclick="CommanderTracker.adjustCommander('${p.id}','${src.id}',1)">+</button>
        </div>`;
    }).join('');
    return`
      <article class="tracker-card ${this.colors[i%this.colors.length]} ${out?'is-out':''} ${this.state.active===p.id&&!this.state.finishedAt?'is-active':''}">
        <div class="tracker-card-orb">${this._initials(p.name)}</div>
        <div class="tracker-card-status">${badges}</div>
        <div class="tracker-card-top">
          <div class="tracker-card-heading">
            <input class="tracker-name" value="${esc(p.name)}" maxlength="24" onchange="CommanderTracker.setPlayerName('${p.id}',this.value)" onfocus="this.select()">
            <div class="tracker-deck-name">${esc(p.deck||'No deck set')}</div>
          </div>
          <button class="tracker-turn ${this.state.active===p.id&&!this.state.finishedAt?'active':''}" onclick="${this.state.finishedAt||out?'void(0)':this.state.active===p.id?'CommanderTracker.nextTurn()':`CommanderTracker.setStartingPlayer('${p.id}')`}">${this.state.finishedAt?(this.state.winnerId===p.id?'Won':'Done'):out?'Out':this.state.active===p.id?'Pass Turn':'Set Turn'}</button>
        </div>
        <div class="tracker-life-wrap">
          <div class="tracker-life-kicker">${this._statusText(p)}</div>
          <div class="tracker-life ${this._lifeState(p)}">${p.life}</div>
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
          <div class="tracker-counter"><span>Poison</span><div><button onclick="CommanderTracker.adjustPoison('${p.id}',-1)">-</button><b>${p.poison}</b><button onclick="CommanderTracker.adjustPoison('${p.id}',1)">+</button></div></div>
          <div class="tracker-counter ${this._damageState(maxCmd)}"><span>Cmdr max</span><strong class="${this._damageState(maxCmd)}">${maxCmd}</strong></div>
        </div>
        <div class="tracker-inline-section"><div class="tracker-inline-title">Commander damage taken</div><div class="tracker-inline-grid">${commanderRows}</div></div>
        <div class="tracker-tags">
          <button class="${p.monarch?'on':''}" onclick="CommanderTracker.toggle('${p.id}','monarch')">Monarch</button>
          <button class="${p.initiative?'on':''}" onclick="CommanderTracker.toggle('${p.id}','initiative')">Initiative</button>
        </div>
      </article>`;
  },

  renderDamage(){
    const grid=document.getElementById('tracker-damage-grid');if(!grid)return;
    grid.innerHTML=this.state.players.flatMap(target=>this.state.players.filter(source=>source.id!==target.id).map(source=>{
      const value=this._damage(target.id,source.id);
      return`
        <div class="tracker-damage-row ${this._damageState(value)}">
          <div class="tracker-damage-label"><b>${esc(source.name)}</b><span>to ${esc(target.name)}</span></div>
          <div class="tracker-damage-controls"><button onclick="CommanderTracker.adjustCommander('${target.id}','${source.id}',-1)">-</button><strong>${value}</strong><button onclick="CommanderTracker.adjustCommander('${target.id}','${source.id}',1)">+</button></div>
        </div>`;
    })).join('');
  },

  renderSummary(){
    const body=document.getElementById('tracker-summary-grid');
    const banner=document.getElementById('tracker-summary-banner');
    const chooser=document.getElementById('tracker-winner-chooser');
    if(!body||!banner||!chooser)return;
    const alive=this._alivePlayers();
    const winner=this._player(this.state.winnerId);
    const leader=[...this.state.players].sort((a,b)=>b.life-a.life)[0];
    const topKiller=this._topStat('kills');
    banner.className='tracker-summary-banner'+(this.state.finishedAt?' finished':'');
    banner.innerHTML=this.state.finishedAt?`<strong>${winner?esc(winner.name):'No winner set'}</strong><span>${esc(this.state.finishedReason||'Game finished')}</span>`:`<strong>Game live</strong><span>${alive.length} players still in the game</span>`;
    body.innerHTML=`
      <div class="tracker-summary-stat"><span>Players Alive</span><strong>${alive.length}</strong><small>${this.state.players.length-alive.length} eliminated</small></div>
      <div class="tracker-summary-stat"><span>Life Leader</span><strong>${leader?esc(leader.name):'-'}</strong><small>${leader?leader.life+' life':'No data'}</small></div>
      <div class="tracker-summary-stat"><span>Top Killer</span><strong>${topKiller.player?esc(topKiller.player.name):'Nobody yet'}</strong><small>${topKiller.value} kill${topKiller.value===1?'':'s'}</small></div>
      <div class="tracker-summary-stat"><span>Duration</span><strong>${this._formatElapsed(this._elapsedMs())}</strong><small>Turn ${this.state.turnNumber}</small></div>`;
    chooser.innerHTML=this.state.finishedAt?'':`<div class="tracker-winner-buttons">${alive.map(p=>`<button class="tracker-winner-btn" onclick="CommanderTracker.finishGame('${p.id}','Winner declared manually')">${esc(p.name)}</button>`).join('')}<button class="tracker-winner-btn ghost" onclick="CommanderTracker.finishGame('','Stopped without winner')">No winner</button></div>`;
  },

  renderHistory(){
    const list=document.getElementById('tracker-log-list');if(!list)return;
    list.innerHTML=(this.state.history.length?this.state.history.map(item=>`<div class="tracker-log-item ${item.type||'event'}"><div class="tracker-log-time">${new Date(item.ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</div><div class="tracker-log-text">${esc(item.text)}</div></div>`).join(''):'<div class="tracker-log-empty">No events yet.</div>');
  },

  renderMatchHistory(){
    const list=document.getElementById('tracker-match-history');if(!list)return;
    const items=this._loadMatchHistory();
    list.innerHTML=items.length?items.map(item=>`<div class="tracker-history-item"><div><strong>${esc(item.winnerName||'No winner')}</strong><span>${new Date(item.finishedAt).toLocaleDateString()} · ${item.turnNumber} turns</span></div><small>${this._formatElapsed(item.durationMs||0)}</small></div>`).join(''):'<div class="tracker-log-empty">Finished matches will appear here.</div>';
  }
};

CommanderTracker.init();
