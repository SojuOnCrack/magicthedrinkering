/* MagicTheDrinkering: standalone tracker */

const TrackerDataBridge={
  SUPABASE_URL:'https://pwrpvtzocycnemgnsooz.supabase.co',
  SUPABASE_KEY:'sb_publishable_doroVk7_Pblbapi7z9njyQ_zfVTZOmG',
  STORE_KEY:'cforge_decks4',
  _client:null,

  localDecks(){
    try{
      const raw=JSON.parse(localStorage.getItem(this.STORE_KEY)||'[]');
      return Array.isArray(raw)?raw:[];
    }catch{
      return [];
    }
  },

  client(){
    if(this._client||typeof supabase==='undefined')return this._client;
    this._client=supabase.createClient(this.SUPABASE_URL,this.SUPABASE_KEY,{
      auth:{
        persistSession:true,
        storage:window.localStorage,
        storageKey:'cforge_sb_session',
        autoRefreshToken:true,
        detectSessionInUrl:false
      }
    });
    return this._client;
  },

  async fetch(){
    const localDecks=this.localDecks();
    const localNames=[...new Set(localDecks.map(deck=>deck.ownerName||'My Collection'))];
    const localOptions=localDecks.map(deck=>({
      id:deck.id||'local-'+(deck.name||'deck'),
      name:deck.name||'Untitled Deck',
      ownerId:'local',
      ownerName:deck.ownerName||'My Collection',
      commander:deck.commander||'',
      partner:deck.partner||'',
      source:'local'
    }));

    const result={
      userName:'',
      profiles:[],
      deckOptions:localOptions,
      nameOptions:localNames,
      status:localOptions.length?`${localOptions.length} local deck${localOptions.length===1?'':'s'} ready`:'No local decks found',
      sourceLabel:localOptions.length?'Local collection':'Manual setup'
    };

    const client=this.client();
    if(!client)return result;

    try{
      const {data:{session}}=await client.auth.getSession();
      const user=session?.user||null;
      if(!user){
        result.status=result.deckOptions.length
          ? `${result.deckOptions.length} local deck${result.deckOptions.length===1?'':'s'} ready`
          : 'Signed out - using manual setup';
        return result;
      }

      const profileReq=client.from('profiles').select('id,username,email').eq('id',user.id).single();
      const friendshipsReq=client.from('friendships').select('friend_id,friend_username').eq('user_id',user.id);
      const ownDecksReq=client.from('decks').select('id,name,commander,partner,user_id,public').eq('user_id',user.id).order('name');

      const [{data:profile},{data:friendships},{data:ownDecks}]=await Promise.all([profileReq,friendshipsReq,ownDecksReq]);
      const ownName=profile?.username||user.user_metadata?.username||user.email?.split('@')[0]||'You';
      result.userName=ownName;
      result.deckOptions=result.deckOptions.map(deck=>deck.ownerName==='My Collection'?{...deck,ownerName:ownName}:deck);
      result.nameOptions=[...new Set([ownName,...result.nameOptions.filter(name=>name&&name!=='My Collection')])];

      const friendIds=[...new Set((friendships||[]).map(row=>row.friend_id).filter(Boolean))];
      let friendProfiles=[];
      let friendDecks=[];

      if(friendIds.length){
        const [{data:profiles},{data:decks}]=await Promise.all([
          client.from('profiles').select('id,username,email').in('id',friendIds),
          client.from('decks').select('id,name,commander,partner,user_id,public').in('user_id',friendIds).eq('public',true).order('name')
        ]);
        friendProfiles=profiles||[];
        friendDecks=decks||[];
      }

      const profileMap={};
      profileMap[user.id]=ownName;
      friendProfiles.forEach(item=>{
        profileMap[item.id]=item.username||item.email?.split('@')[0]||'Player';
      });

      const cloudDecks=[...(ownDecks||[]),...friendDecks].map(deck=>({
        id:deck.id,
        name:deck.name||'Untitled Deck',
        ownerId:deck.user_id||'',
        ownerName:profileMap[deck.user_id]||'Player',
        commander:deck.commander||'',
        partner:deck.partner||'',
        source:deck.user_id===user.id?'cloud-own':'cloud-friend'
      }));

      const mergedDecks=[...result.deckOptions];
      const seen=new Set(mergedDecks.map(deck=>`${deck.ownerName}::${deck.name}`.toLowerCase()));
      cloudDecks.forEach(deck=>{
        const key=`${deck.ownerName}::${deck.name}`.toLowerCase();
        if(seen.has(key))return;
        seen.add(key);
        mergedDecks.push(deck);
      });

      const mergedNames=[...new Set([
        ownName,
        ...(friendships||[]).map(row=>row.friend_username).filter(Boolean),
        ...friendProfiles.map(item=>item.username||item.email?.split('@')[0]||''),
        ...result.nameOptions
      ].filter(Boolean))];

      result.deckOptions=mergedDecks;
      result.nameOptions=mergedNames;
      result.profiles=friendProfiles;
      result.status=`${mergedDecks.length} decks ready from local + cloud`;
      result.sourceLabel=friendIds.length
        ? `Signed in as ${ownName} - using your decks and friends' public decks`
        : `Signed in as ${ownName} - using your decks`;
      return result;
    }catch(error){
      console.warn('[TrackerDataBridge.fetch]',error);
      result.status=result.deckOptions.length
        ? `${result.deckOptions.length} local deck${result.deckOptions.length===1?'':'s'} ready - cloud fallback failed`
        : 'Cloud lookup failed - use manual setup';
      result.sourceLabel='Fallback to local collection';
      return result;
    }
  }
};

const CommanderTracker={
  KEY:'mtd_commander_tracker_v2',
  MATCH_HISTORY_KEY:'mtd_commander_tracker_matches_v1',
  START_LIFE:40,
  MIN_PLAYERS:2,
  MAX_PLAYERS:6,
  HISTORY_LIMIT:24,
  MATCH_HISTORY_LIMIT:12,
  colors:['gold','ice','green','crimson','purple','steel'],
  state:null,
  data:{
    loading:true,
    status:'Loading deck data...',
    sourceLabel:'',
    userName:'',
    deckOptions:[],
    nameOptions:[]
  },
  _clock:null,

  async init(){
    this.state=this._load();
    this._startClock();
    this.render();
    await this.loadData();
  },

  async loadData(){
    this.data.loading=true;
    this.renderSetupStatus();
    const data=await TrackerDataBridge.fetch();
    this.data={loading:false,...data};
    this._hydrateDefaultsFromData();
    this.render();
  },

  _emptyStats(){
    return{
      kills:0,
      lifeGain:0,
      lifeLoss:0,
      poisonGiven:0,
      commanderGiven:0
    };
  },

  _freshPlayers(count){
    return Array.from({length:count},(_,index)=>({
      id:'p'+(index+1),
      name:'Player '+(index+1),
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
      phase:'setup',
      players,
      damage:{},
      stats:Object.fromEntries(players.map(player=>[player.id,this._emptyStats()])),
      active:players[0].id,
      turnNumber:1,
      startedAt:null,
      finishedAt:null,
      finishedReason:'',
      winnerId:'',
      archived:false,
      notes:'',
      setupCollapsed:false,
      eliminated:[],
      history:[{id:'evt-'+now,type:'system',text:'Pod created',ts:now}],
      updated:now
    };
  },

  _normalizeState(saved){
    const base=this._fresh(saved?.players?.length||4);
    const state={...base,...saved};
    state.phase=['setup','live','finished'].includes(saved?.phase)?saved.phase:(saved?.finishedAt?'finished':'setup');
    state.players=Array.isArray(saved?.players)&&saved.players.length>=this.MIN_PLAYERS
      ? saved.players.map((player,index)=>({
          id:player.id||base.players[index]?.id||('p'+(index+1)),
          name:player.name||('Player '+(index+1)),
          deck:player.deck||'',
          life:Number.isFinite(player.life)?player.life:this.START_LIFE,
          poison:Number.isFinite(player.poison)?player.poison:0,
          monarch:!!player.monarch,
          initiative:!!player.initiative
        }))
      : base.players;
    state.damage=saved?.damage&&typeof saved.damage==='object'?saved.damage:{};
    state.stats=saved?.stats&&typeof saved.stats==='object'?saved.stats:{};
    state.players.forEach(player=>{state.stats[player.id]=state.stats[player.id]||this._emptyStats();});
    state.active=state.players.some(player=>player.id===saved?.active)?saved.active:state.players[0].id;
    state.turnNumber=Number.isFinite(saved?.turnNumber)&&saved.turnNumber>0?saved.turnNumber:1;
    state.startedAt=Number.isFinite(saved?.startedAt)?saved.startedAt:null;
    state.finishedAt=Number.isFinite(saved?.finishedAt)?saved.finishedAt:null;
    state.finishedReason=saved?.finishedReason||'';
    state.winnerId=saved?.winnerId||'';
    state.archived=!!saved?.archived;
    state.notes=typeof saved?.notes==='string'?saved.notes:'';
    state.setupCollapsed=!!saved?.setupCollapsed;
    state.eliminated=Array.isArray(saved?.eliminated)?saved.eliminated:[];
    state.history=Array.isArray(saved?.history)&&saved.history.length
      ? saved.history.slice(0,this.HISTORY_LIMIT)
      : base.history;
    return state;
  },

  _load(){
    try{
      const saved=JSON.parse(localStorage.getItem(this.KEY)||'null');
      if(saved?.players?.length>=this.MIN_PLAYERS){
        const state=this._normalizeState(saved);
        if(state.phase==='finished'||state.finishedAt){
          const reset=this._fresh(state.players.length);
          reset.players=reset.players.map((player,index)=>({
            ...player,
            name:state.players[index]?.name||player.name,
            deck:state.players[index]?.deck||''
          }));
          reset.active=state.active&&reset.players.some(player=>player.id===state.active)
            ? state.active
            : reset.players[0].id;
          reset.setupCollapsed=state.setupCollapsed;
          return reset;
        }
        return state;
      }
    }catch{}
    return this._fresh();
  },

  _save(){
    this.state.updated=Date.now();
    localStorage.setItem(this.KEY,JSON.stringify(this.state));
  },

  _loadMatchHistory(){
    try{
      const items=JSON.parse(localStorage.getItem(this.MATCH_HISTORY_KEY)||'[]');
      return Array.isArray(items)?items:[];
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
    return this.state.players.find(player=>player.id===id)||null;
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
    return this.state.players.some(source=>source.id!==player.id&&this._damage(player.id,source.id)>=21);
  },

  _isOut(player){
    return this._isEliminated(player.id)||this._isDefeatedNow(player);
  },

  _alivePlayers(){
    return this.state.players.filter(player=>!this._isOut(player));
  },

  _canPlay(){
    return this.state.phase==='live'&&!this.state.finishedAt;
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
    if(this.state.phase==='setup'||!this.state.startedAt)return 0;
    return Math.max(0,(this.state.finishedAt||Date.now())-this.state.startedAt);
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

  _phaseLabel(){
    if(this.state.phase==='setup')return'Pod Setup';
    if(this.state.phase==='finished')return'Final';
    return'Turn '+this.state.turnNumber;
  },

  _statusText(player){
    if(this.state.phase==='setup')return this.state.active===player.id?'Starting seat':'Waiting for game start';
    if(this.state.phase==='finished'){
      if(this.state.winnerId===player.id)return'Winner';
      if(this._isOut(player))return'Finished pod';
      return'Game over';
    }
    if(this._isOut(player))return'Eliminated';
    if(this.state.active===player.id)return'On the play';
    if(player.monarch&&player.initiative)return'Board control';
    if(player.monarch)return'Monarch';
    if(player.initiative)return'Initiative';
    return'Ready';
  },

  _defaultNameFor(index){
    const player=this.state.players[index];
    const suggestions=this.data.nameOptions||[];
    const taken=new Set(this.state.players.map(entry=>entry.name));
    const available=suggestions.find(name=>name&&!taken.has(name));
    return available||player?.name||('Player '+(index+1));
  },

  _findDeckSuggestion(value){
    const needle=String(value||'').trim().toLowerCase();
    if(!needle)return null;
    return (this.data.deckOptions||[]).find(option=>option.name.toLowerCase()===needle)||null;
  },

  _hydrateDefaultsFromData(){
    if(!this.data.deckOptions.length&&!this.data.nameOptions.length)return;
    let changed=false;
    this.state.players.forEach((player,index)=>{
      const isGeneric=!player.name||/^Player \d+$/i.test(player.name);
      if(isGeneric){
        const nextName=this._defaultNameFor(index);
        if(nextName&&nextName!==player.name){
          player.name=nextName;
          changed=true;
        }
      }
      if(!player.deck&&this.data.deckOptions[index]){
        player.deck=this.data.deckOptions[index].name;
        changed=true;
      }
    });
    if(changed)this._save();
  },

  _log(text,type='event'){
    const ts=Date.now();
    const current=this.state.history||[];
    if(current[0]?.text===text&&current[0]?.type===type)return;
    const next={id:'evt-'+ts+'-'+Math.random().toString(36).slice(2,6),type,text,ts};
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
    if(this.state.phase!=='live')return;
    const alive=this._alivePlayers();
    if(alive.length&&!alive.some(player=>player.id===this.state.active))this.state.active=alive[0].id;
  },

  _checkGameOver(){
    if(this.state.phase!=='live')return;
    const alive=this._alivePlayers();
    if(alive.length===1){
      this.finishGame(alive[0].id,'Last player standing');
      return;
    }
    if(alive.length===0){
      this.finishGame('','All players eliminated');
      return;
    }
    this._ensureActiveAlive();
  },

  _matchPayload(){
    const winner=this._player(this.state.winnerId);
    const topKiller=this._topStat('kills');
    return{
      id:this.state.matchId,
      startedAt:this.state.startedAt||Date.now(),
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
    return this.state.players.reduce((best,player)=>{
      const value=this._stats(player.id)[key]||0;
      return value>best.value?{player,value}:best;
    },{player:null,value:0});
  },

  _prepareNewMatch({keepPlayers=true}={}){
    const count=this.state?.players?.length||4;
    const fresh=this._fresh(count);
    if(keepPlayers&&this.state?.players?.length){
      fresh.players=fresh.players.map((player,index)=>({
        ...player,
        name:this.state.players[index]?.name||player.name,
        deck:this.state.players[index]?.deck||''
      }));
      fresh.active=this.state.active&&fresh.players.some(player=>player.id===this.state.active)
        ? this.state.active
        : fresh.players[0].id;
      fresh.setupCollapsed=this.state.setupCollapsed;
    }
    this.state=fresh;
  },

  toggleSetup(){
    this.state.setupCollapsed=!this.state.setupCollapsed;
    this._save();
    this.renderSetup();
  },

  addPlayer(){
    if(this.state.players.length>=this.MAX_PLAYERS||this.state.phase==='finished')return;
    const nextIndex=this.state.players.length+1;
    const suggestion=this.data.deckOptions[this.state.players.length]||null;
    const player={
      id:'p'+Date.now().toString(36),
      name:suggestion?.ownerName&&suggestion.ownerName!=='My Collection'?suggestion.ownerName:'Player '+nextIndex,
      deck:suggestion?.name||'',
      life:this.START_LIFE,
      poison:0,
      monarch:false,
      initiative:false
    };
    this.state.players.push(player);
    this.state.stats[player.id]=this._emptyStats();
    this._log(`${player.name} joined the pod`,'join');
    this._save();
    this.render();
  },

  removePlayer(){
    if(this.state.players.length<=this.MIN_PLAYERS||this._canPlay())return;
    const removed=this.state.players.pop();
    delete this.state.damage[removed.id];
    Object.values(this.state.damage).forEach(row=>delete row[removed.id]);
    delete this.state.stats[removed.id];
    this.state.eliminated=this.state.eliminated.filter(entry=>entry.id!==removed.id);
    if(this.state.active===removed.id)this.state.active=this.state.players[0].id;
    this._log(`${removed.name} was removed from the pod`,'leave');
    this._save();
    this.render();
  },

  autoFillPod(){
    const options=[...(this.data.deckOptions||[])];
    if(!options.length&&!(this.data.nameOptions||[]).length)return;
    const usedDecks=new Set();
    this.state.players.forEach((player,index)=>{
      const nextDeck=options.find(option=>!usedDecks.has(`${option.ownerName}::${option.name}`.toLowerCase()));
      if(nextDeck){
        usedDecks.add(`${nextDeck.ownerName}::${nextDeck.name}`.toLowerCase());
        player.deck=nextDeck.name;
        if((!player.name||/^Player \d+$/i.test(player.name))&&nextDeck.ownerName&&nextDeck.ownerName!=='My Collection'){
          player.name=nextDeck.ownerName;
        }else if(!player.name||/^Player \d+$/i.test(player.name)){
          player.name=this._defaultNameFor(index);
        }
      }else if(!player.name||/^Player \d+$/i.test(player.name)){
        player.name=this._defaultNameFor(index);
      }
    });
    this._log('Pod was auto-filled from available deck data','setup');
    this._save();
    this.render();
  },

  randomizeStarter(){
    if(!this.state.players.length||this.state.phase==='finished')return;
    const next=this.state.players[Math.floor(Math.random()*this.state.players.length)];
    this.state.active=next.id;
    this._log(`${next.name} was selected as the starting player`,'setup');
    this._save();
    this.render();
  },

  resetGame(){
    this._prepareNewMatch({keepPlayers:true});
    this._log('Pod reset for a new game','reset');
    this._save();
    this.render();
  },

  startGame(){
    if(this.state.phase==='live')return;
    this.state.phase='live';
    this.state.turnNumber=1;
    this.state.startedAt=Date.now();
    this.state.finishedAt=null;
    this.state.finishedReason='';
    this.state.winnerId='';
    this.state.archived=false;
    this.state.eliminated=[];
    this.state.damage={};
    this.state.players.forEach(player=>{
      player.life=this.START_LIFE;
      player.poison=0;
      player.monarch=false;
      player.initiative=false;
      this.state.stats[player.id]=this._emptyStats();
    });
    this.state.history=[{id:'evt-'+Date.now(),type:'system',text:`Game started - ${this._player(this.state.active)?.name||'Player 1'} is on the play`,ts:Date.now()}];
    this._save();
    this.render();
  },

  setPlayerName(id,value){
    const player=this._player(id);
    if(!player)return;
    player.name=(value||'').trim().slice(0,24)||'Player';
    this._save();
    this.renderSetup();
    this.renderBoard();
    this.renderDashboard();
  },

  setPlayerDeck(id,value){
    const player=this._player(id);
    if(!player)return;
    player.deck=(value||'').trim().slice(0,60);
    const match=this._findDeckSuggestion(player.deck);
    if(match&&match.ownerName&&match.ownerName!=='My Collection'&&(!player.name||/^Player \d+$/i.test(player.name)))player.name=match.ownerName;
    this._save();
    this.renderSetup();
    this.renderBoard();
  },

  setPlayerNameChoice(id,value){
    const player=this._player(id);
    if(!player)return;
    if(value==='__custom__'){
      this.setPlayerName(id,player.name);
      return;
    }
    this.setPlayerName(id,value);
  },

  setPlayerDeckChoice(id,value){
    const player=this._player(id);
    if(!player)return;
    if(value==='__custom__'){
      this.setPlayerDeck(id,player.deck);
      return;
    }
    this.setPlayerDeck(id,value);
  },

  setStartingPlayer(id){
    if(this.state.phase==='finished'||!this._player(id))return;
    this.state.active=id;
    this._save();
    this.render();
  },

  removeSpecificPlayer(id){
    if(this.state.players.length<=this.MIN_PLAYERS||this._canPlay())return;
    const index=this.state.players.findIndex(player=>player.id===id);
    if(index<0)return;
    const removed=this.state.players[index];
    this.state.players.splice(index,1);
    delete this.state.damage[removed.id];
    Object.values(this.state.damage).forEach(row=>delete row[removed.id]);
    delete this.state.stats[removed.id];
    this.state.eliminated=this.state.eliminated.filter(entry=>entry.id!==removed.id);
    if(this.state.active===removed.id)this.state.active=this.state.players[0]?.id||'';
    this._log(`${removed.name} was removed from the pod`,'leave');
    this._save();
    this.render();
  },

  adjustLife(id,delta){
    const player=this._player(id);
    if(!player||!delta||!this._canPlay()||this._isEliminated(id))return;
    const before=player.life;
    player.life=Math.max(-99,Math.min(999,player.life+delta));
    if(before===player.life)return;
    if(delta>0)this._stats(id).lifeGain+=delta;
    else this._stats(id).lifeLoss+=Math.abs(delta);
    this._log(`${player.name} ${delta>0?'gained':'lost'} ${Math.abs(delta)} life (${player.life})`,delta>0?'heal':'damage');
    if(this._isDefeatedNow(player))this._recordElimination(player,'life',delta<0&&this.state.active!==id?this.state.active:'');
    this._checkGameOver();
    this._save();
    this.render();
  },

  adjustAll(delta){
    if(!delta||!this._canPlay())return;
    this.state.players.forEach(player=>{
      if(this._isEliminated(player.id))return;
      player.life=Math.max(-99,Math.min(999,player.life+delta));
      if(delta>0)this._stats(player.id).lifeGain+=delta;
      else this._stats(player.id).lifeLoss+=Math.abs(delta);
      if(this._isDefeatedNow(player))this._recordElimination(player,'global');
    });
    this._log(`All active players ${delta>0?'gained':'lost'} ${Math.abs(delta)} life`,'global');
    this._checkGameOver();
    this._save();
    this.render();
  },

  adjustPoison(id,delta){
    const player=this._player(id);
    if(!player||!delta||!this._canPlay()||this._isEliminated(id))return;
    const before=player.poison;
    player.poison=Math.max(0,Math.min(10,player.poison+delta));
    if(before===player.poison)return;
    if(delta>0&&this.state.active&&this.state.active!==id)this._stats(this.state.active).poisonGiven+=delta;
    this._log(`${player.name} ${delta>0?'gained':'lost'} ${Math.abs(delta)} poison (${player.poison})`,delta>0?'poison':'cleanse');
    if(this._isDefeatedNow(player))this._recordElimination(player,'poison',delta>0&&this.state.active!==id?this.state.active:'');
    this._checkGameOver();
    this._save();
    this.render();
  },

  adjustCommander(targetId,sourceId,delta){
    const target=this._player(targetId);
    const source=this._player(sourceId);
    if(!target||!source||!delta||!this._canPlay()||this._isEliminated(targetId))return;
    const before=this._damage(targetId,sourceId);
    this._setDamage(targetId,sourceId,before+delta);
    const after=this._damage(targetId,sourceId);
    if(before===after)return;
    if(delta>0)this._stats(sourceId).commanderGiven+=delta;
    this._log(`${source.name} ${delta>0?'dealt':'reduced'} commander damage ${delta>0?'to':'on'} ${target.name} (${after})`,'commander');
    if(after>=21)this._recordElimination(target,'commander',sourceId);
    this._checkGameOver();
    this._save();
    this.render();
  },

  nextTurn(){
    if(!this._canPlay())return;
    const players=this._alivePlayers();
    if(!players.length)return;
    const current=Math.max(0,players.findIndex(player=>player.id===this.state.active));
    this.state.active=players[(current+1)%players.length].id;
    this.state.turnNumber=(this.state.turnNumber||1)+1;
    this._log(`Turn ${this.state.turnNumber}: ${this._player(this.state.active)?.name||'Next player'} is up`,'turn');
    this._save();
    this.render();
  },

  toggle(id,key){
    const player=this._player(id);
    if(!player||!this._canPlay()||this._isEliminated(id))return;
    if(key==='monarch'){
      const next=!player.monarch;
      this.state.players.forEach(entry=>{entry.monarch=false;});
      player.monarch=next;
      this._log(next?`${player.name} became the Monarch`:`${player.name} is no longer the Monarch`,'badge');
    }
    if(key==='initiative'){
      const next=!player.initiative;
      this.state.players.forEach(entry=>{entry.initiative=false;});
      player.initiative=next;
      this._log(next?`${player.name} took the Initiative`:`${player.name} no longer has the Initiative`,'badge');
    }
    this._save();
    this.render();
  },

  clearCommanderDamage(){
    this.state.damage={};
    this._log('Commander damage was cleared','reset');
    this._save();
    this.render();
  },

  setNotes(value){
    this.state.notes=String(value||'').slice(0,1200);
    this._save();
  },

  finishGame(winnerId='',reason='Finished manually'){
    if(this.state.phase!=='live')return;
    const alive=this._alivePlayers();
    const winner=winnerId?this._player(winnerId):(alive.length===1?alive[0]:alive[0]||null);
    this.state.phase='finished';
    this.state.finishedAt=Date.now();
    this.state.winnerId=winner?.id||'';
    this.state.finishedReason=reason;
    this._log(winner?`${winner.name} won the game`:'Game finished','finish');
    this._persistFinishedMatch();
    this._save();
    this.render();
  },

  exportHistory(){
    const blob=new Blob([JSON.stringify(this._loadMatchHistory(),null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');
    anchor.href=url;
    anchor.download='tracker-match-history.json';
    anchor.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  },

  render(){
    if(!document.getElementById('tracker-board'))return;
    this.renderToolbar();
    this.renderSetupStatus();
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

  renderToolbar(){
    const start=document.getElementById('tracker-start-btn');
    const finish=document.getElementById('tracker-finish-btn');
    const reset=document.getElementById('tracker-reset-btn');
    if(start){
      start.textContent=this.state.phase==='live'?'Game Running':this.state.phase==='finished'?'Ready Next Pod':'Start Game';
      start.disabled=this.state.phase==='live';
      start.classList.toggle('gold',this.state.phase!=='live');
    }
    if(finish)finish.disabled=this.state.phase!=='live';
    if(reset)reset.textContent=this.state.phase==='setup'?'Clear Match':'New Game';
  },

  renderSetupStatus(){
    const pill=document.getElementById('tracker-data-pill');
    if(!pill)return;
    pill.textContent=this.data.loading?'Loading deck data...':this.data.sourceLabel||this.data.status||'Manual setup';
    pill.classList.toggle('loading',!!this.data.loading);
  },

  renderSetup(){
    const wrap=document.getElementById('tracker-setup-panel');
    const grid=document.getElementById('tracker-setup-grid');
    const toggle=document.getElementById('tracker-setup-toggle');
    if(!wrap||!grid||!toggle)return;
    wrap.classList.toggle('collapsed',this.state.setupCollapsed);
    wrap.classList.toggle('locked',this.state.phase==='live');
    toggle.textContent=this.state.setupCollapsed?'Show setup':'Hide setup';

    grid.innerHTML=this.state.players.map((player,index)=>{
      const suggestion=this._findDeckSuggestion(player.deck);
      const nameChoices=[...new Set([player.name,...(this.data.nameOptions||[]).filter(Boolean)])];
      const deckChoices=[
        ...new Map((this.data.deckOptions||[])
          .filter(option=>option?.name)
          .map(option=>[option.name.toLowerCase(),option]))
          .values()
      ];
      const ownerLabel=suggestion?.ownerName
        ? `<div class="tracker-setup-hint">${esc(suggestion.ownerName)}${suggestion.commander?` · ${esc(suggestion.commander)}${suggestion.partner?` + ${esc(suggestion.partner)}`:''}`:''}</div>`
        : `<div class="tracker-setup-hint">${player.deck?'Deck linked manually':'Pick from local/cloud deck data or type freely'}</div>`;
      return`
        <div class="tracker-setup-card ${this.state.active===player.id?'is-starting':''}">
          <div class="tracker-setup-seat-row">
            <div class="tracker-setup-seat">Seat ${index+1}</div>
            <div class="tracker-setup-seat-actions">
              <span class="tracker-setup-chip ${this.state.active===player.id?'active':''}">${this.state.active===player.id?'Starter':'Seat ready'}</span>
              <button class="tracker-seat-remove" onclick="CommanderTracker.removeSpecificPlayer('${player.id}')" ${this.state.players.length<=this.MIN_PLAYERS||this._canPlay()?'disabled':''}>Remove</button>
            </div>
          </div>
          <label class="tracker-field">
            <span>Player</span>
            <select class="tracker-setup-select" onchange="CommanderTracker.setPlayerNameChoice('${player.id}',this.value)">
              ${nameChoices.map(name=>`<option value="${esc(name)}" ${name===player.name?'selected':''}>${esc(name)}</option>`).join('')}
              <option value="__custom__">Current custom name behalten</option>
            </select>
          </label>
          <label class="tracker-field">
            <span>Deck</span>
            <select class="tracker-setup-select deck" onchange="CommanderTracker.setPlayerDeckChoice('${player.id}',this.value)">
              <option value="" ${!player.deck?'selected':''}>No deck selected</option>
              ${deckChoices.map(option=>{
                const label=option.ownerName&&option.ownerName!=='My Collection'
                  ? `${option.name} - ${option.ownerName}`
                  : option.name;
                return `<option value="${esc(option.name)}" ${option.name===player.deck?'selected':''}>${esc(label)}</option>`;
              }).join('')}
              <option value="__custom__">Current custom deck behalten</option>
            </select>
          </label>
          ${ownerLabel}
          <div class="tracker-setup-manual">
            <input class="tracker-setup-input" value="${esc(player.name)}" maxlength="24" onchange="CommanderTracker.setPlayerName('${player.id}',this.value)" placeholder="Custom player name">
            <input class="tracker-setup-input deck" value="${esc(player.deck||'')}" maxlength="60" onchange="CommanderTracker.setPlayerDeck('${player.id}',this.value)" placeholder="Custom deck name">
          </div>
          <button class="tracker-setup-btn ${this.state.active===player.id?'active':''}" onclick="CommanderTracker.setStartingPlayer('${player.id}')">${this.state.active===player.id?'Starting Player':'Set Starter'}</button>
        </div>`;
    }).join('');
  },

  renderDashboard(){
    const turn=document.getElementById('tracker-turn-chip');
    const active=document.getElementById('tracker-active-chip');
    const elapsed=document.getElementById('tracker-elapsed-chip');
    const pod=document.getElementById('tracker-pod-chip');
    if(turn)turn.textContent=this._phaseLabel();
    if(active)active.textContent=this.state.phase==='finished'?(this._player(this.state.winnerId)?.name||'No winner'):(this._player(this.state.active)?.name||'-');
    if(elapsed)elapsed.textContent=this._formatElapsed(this._elapsedMs());
    if(pod)pod.textContent=this.state.players.length+' Players';
  },

  renderBoard(){
    const board=document.getElementById('tracker-board');
    if(!board)return;
    board.className='tracker-board players-'+this.state.players.length;
    board.innerHTML=this.state.players.map((player,index)=>this._playerCard(player,index)).join('');
  },

  _playerCard(player,index){
    const out=this._isOut(player);
    const locked=this.state.phase==='setup';
    const maxCommander=Math.max(0,...this.state.players.filter(source=>source.id!==player.id).map(source=>this._damage(player.id,source.id)));
    const badges=[
      this._canPlay()&&this.state.active===player.id?'<button class="tracker-status-badge active" onclick="CommanderTracker.nextTurn()">Active Turn</button>':'',
      player.monarch?`<button class="tracker-status-badge monarch" onclick="CommanderTracker.toggle('${player.id}','monarch')">Monarch</button>`:'',
      player.initiative?`<button class="tracker-status-badge initiative" onclick="CommanderTracker.toggle('${player.id}','initiative')">Initiative</button>`:'',
      this.state.phase==='finished'&&this.state.winnerId===player.id?'<span class="tracker-status-badge winner">Winner</span>':'',
      out?'<span class="tracker-status-badge out">Knocked Out</span>':''
    ].filter(Boolean).join('');

    const commanderRows=this.state.players.filter(source=>source.id!==player.id).map(source=>{
      const value=this._damage(player.id,source.id);
      const state=this._damageState(value);
      return`
        <div class="tracker-inline-cmd ${state}">
          <button class="tracker-inline-btn" onclick="CommanderTracker.adjustCommander('${player.id}','${source.id}',-1)">-</button>
          <button class="tracker-inline-main" onclick="CommanderTracker.adjustCommander('${player.id}','${source.id}',1)">
            <span>${esc(source.name)}</span>
            <strong>${value}</strong>
          </button>
          <button class="tracker-inline-btn" onclick="CommanderTracker.adjustCommander('${player.id}','${source.id}',1)">+</button>
        </div>`;
    }).join('');

    return`
      <article class="tracker-card ${this.colors[index%this.colors.length]} ${out?'is-out':''} ${this.state.active===player.id&&this._canPlay()?'is-active':''} ${locked?'is-setup':''}">
        <div class="tracker-card-topline">
          <div class="tracker-card-orb">${this._initials(player.name)}</div>
          <div class="tracker-card-status">${badges}</div>
        </div>
        <div class="tracker-card-top">
          <div class="tracker-card-heading">
            <input class="tracker-name" value="${esc(player.name)}" maxlength="24" onchange="CommanderTracker.setPlayerName('${player.id}',this.value)" onfocus="this.select()">
            <div class="tracker-deck-name">${esc(player.deck||'No deck selected')}</div>
          </div>
          <button class="tracker-turn ${this.state.active===player.id&&this._canPlay()?'active':''}" onclick="${this.state.phase==='finished'||out?'void(0)':this._canPlay()&&this.state.active===player.id?'CommanderTracker.nextTurn()':`CommanderTracker.setStartingPlayer('${player.id}')`}">${this.state.phase==='finished'?(this.state.winnerId===player.id?'Won':'Done'):out?'Out':this._canPlay()&&this.state.active===player.id?'Pass Turn':locked&&this.state.active===player.id?'Starter':'Set Turn'}</button>
        </div>
        <div class="tracker-life-wrap">
          <div class="tracker-life-kicker">${this._statusText(player)}</div>
          <div class="tracker-life ${this._lifeState(player)}">${player.life}</div>
        </div>
        <div class="tracker-life-controls">
          <button onclick="CommanderTracker.adjustLife('${player.id}',-10)">-10</button>
          <button onclick="CommanderTracker.adjustLife('${player.id}',-5)">-5</button>
          <button onclick="CommanderTracker.adjustLife('${player.id}',-1)">-1</button>
          <button onclick="CommanderTracker.adjustLife('${player.id}',1)">+1</button>
          <button onclick="CommanderTracker.adjustLife('${player.id}',5)">+5</button>
          <button onclick="CommanderTracker.adjustLife('${player.id}',10)">+10</button>
        </div>
        <div class="tracker-mini-row">
          <div class="tracker-counter"><span>Poison</span><div><button onclick="CommanderTracker.adjustPoison('${player.id}',-1)">-</button><b>${player.poison}</b><button onclick="CommanderTracker.adjustPoison('${player.id}',1)">+</button></div></div>
          <div class="tracker-counter ${this._damageState(maxCommander)}"><span>Cmdr max</span><strong class="${this._damageState(maxCommander)}">${maxCommander}</strong></div>
        </div>
        <div class="tracker-inline-section"><div class="tracker-inline-title">Commander damage taken</div><div class="tracker-inline-grid">${commanderRows}</div></div>
        <div class="tracker-tags">
          <button class="${player.monarch?'on':''}" onclick="CommanderTracker.toggle('${player.id}','monarch')">Monarch</button>
          <button class="${player.initiative?'on':''}" onclick="CommanderTracker.toggle('${player.id}','initiative')">Initiative</button>
        </div>
      </article>`;
  },

  renderDamage(){
    const grid=document.getElementById('tracker-damage-grid');
    if(!grid)return;
    if(this.state.phase==='setup'){
      grid.innerHTML='<div class="tracker-log-empty tracker-empty-wide">Commander damage tracking unlocks after the game starts.</div>';
      return;
    }
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
    const mostPressure=this._topStat('commanderGiven');

    banner.className='tracker-summary-banner'+(this.state.phase==='finished'?' finished':'');

    if(this.state.phase==='setup'){
      banner.innerHTML=`<strong>Setup Mode</strong><span>${esc(this.data.sourceLabel||'Choose seats, names and decks before starting')}</span>`;
      body.innerHTML=`
        <div class="tracker-summary-stat"><span>Deck Source</span><strong>${(this.data.deckOptions||[]).length}</strong><small>${esc(this.data.status||'Manual setup')}</small></div>
        <div class="tracker-summary-stat"><span>Suggested Names</span><strong>${(this.data.nameOptions||[]).length}</strong><small>From local and cloud profiles</small></div>
        <div class="tracker-summary-stat"><span>Starting Seat</span><strong>${esc(this._player(this.state.active)?.name||'Seat 1')}</strong><small>Ready for turn 1</small></div>
        <div class="tracker-summary-stat"><span>Phase</span><strong>Pregame</strong><small>Timer begins when you start</small></div>`;
      chooser.innerHTML='<div class="tracker-winner-buttons"><button class="tracker-winner-btn" onclick="CommanderTracker.startGame()">Start Game</button></div>';
      return;
    }

    banner.innerHTML=this.state.phase==='finished'
      ? `<strong>${winner?esc(winner.name):'No winner set'}</strong><span>${esc(this.state.finishedReason||'Game finished')}</span>`
      : `<strong>Game live</strong><span>${alive.length} players still in the game</span>`;

    body.innerHTML=`
      <div class="tracker-summary-stat"><span>Players Alive</span><strong>${alive.length}</strong><small>${this.state.players.length-alive.length} eliminated</small></div>
      <div class="tracker-summary-stat"><span>Life Leader</span><strong>${leader?esc(leader.name):'-'}</strong><small>${leader?leader.life+' life':'No data'}</small></div>
      <div class="tracker-summary-stat"><span>Top Killer</span><strong>${topKiller.player?esc(topKiller.player.name):'Nobody yet'}</strong><small>${topKiller.value} kill${topKiller.value===1?'':'s'}</small></div>
      <div class="tracker-summary-stat"><span>Pressure</span><strong>${mostPressure.player?esc(mostPressure.player.name):'Nobody yet'}</strong><small>${mostPressure.value} commander damage dealt</small></div>`;

    chooser.innerHTML=this.state.phase==='finished'
      ? ''
      : `<div class="tracker-winner-buttons">${alive.map(player=>`<button class="tracker-winner-btn" onclick="CommanderTracker.finishGame('${player.id}','Winner declared manually')">${esc(player.name)}</button>`).join('')}<button class="tracker-winner-btn ghost" onclick="CommanderTracker.finishGame('','Stopped without winner')">No winner</button></div>`;
  },

  renderHistory(){
    const list=document.getElementById('tracker-log-list');
    if(!list)return;
    list.innerHTML=this.state.history.length
      ? this.state.history.map(item=>`<div class="tracker-log-item ${item.type||'event'}"><div class="tracker-log-time">${new Date(item.ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</div><div class="tracker-log-text">${esc(item.text)}</div></div>`).join('')
      : '<div class="tracker-log-empty">No events yet.</div>';
  },

  renderMatchHistory(){
    const list=document.getElementById('tracker-match-history');
    if(!list)return;
    const items=this._loadMatchHistory();
    list.innerHTML=items.length
      ? items.map(item=>`<div class="tracker-history-item"><div><strong>${esc(item.winnerName||'No winner')}</strong><span>${new Date(item.finishedAt).toLocaleDateString()} · ${item.turnNumber} turns</span></div><small>${this._formatElapsed(item.durationMs||0)}</small></div>`).join('')
      : '<div class="tracker-log-empty">Finished matches will appear here.</div>';
  }
};

CommanderTracker.init();
