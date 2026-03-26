/* CommanderForge: DeckHealth */

const DeckHealth={

  _detectArchetype(deck){
    const cmdr=Store.card(deck.commander)||{};
    const oracle=(cmdr.oracle_text||'').toLowerCase();
    const type=(cmdr.type_line||'').toLowerCase();

    const counts={
      creatures:deck.cards.filter(c=>(Store.card(c.name)||{}).type_line?.toLowerCase().includes('creature')).length,
      artifacts:deck.cards.filter(c=>(Store.card(c.name)||{}).type_line?.toLowerCase().includes('artifact')).length,
      enchants:deck.cards.filter(c=>(Store.card(c.name)||{}).type_line?.toLowerCase().includes('enchantment')).length
    };

    const equipCount=deck.cards.filter(c=>(Store.card(c.name)||{}).type_line?.toLowerCase().includes('equipment')).length;
    const auraCount=deck.cards.filter(c=>(Store.card(c.name)||{}).type_line?.toLowerCase().includes('aura')).length;
    if(equipCount>=8||auraCount>=8)return'voltron';
    if(oracle.includes('equipment')||oracle.includes('equipped')||oracle.includes('aura'))return'voltron';
    if(/whenever (a|another) \w+ (you control|enters)/.test(oracle))return'tribal';
    if(/\w+ (creatures|spells) (you control|you cast) (get|cost|have)/.test(oracle))return'tribal';
    if(counts.artifacts>=20||(oracle.includes('artifact')&&type.includes('artifact')))return'artifacts';
    if(counts.enchants>=15||(oracle.includes('enchantment')&&oracle.includes('draw')))return'enchantress';
    if(oracle.includes('land')&&(oracle.includes('landfall')||oracle.includes('put a land')))return'lands';

    const tutorCount=deck.cards.filter(c=>/search your library/i.test((Store.card(c.name)||{}).oracle_text||'')).length;
    if(tutorCount>=5)return'combo';

    const counterCount=deck.cards.filter(c=>/counter target spell/i.test((Store.card(c.name)||{}).oracle_text||'')).length;
    if(counterCount>=6)return'control';

    const nonLand=deck.cards.filter(c=>!(Store.card(c.name)||{}).type_line?.toLowerCase().includes('land'));
    const totalNonLand=nonLand.reduce((s,c)=>s+(c.qty||0),0);
    const avgCmc=totalNonLand?nonLand.reduce((s,c)=>s+(((Store.card(c.name)||{}).cmc||0)*(c.qty||0)),0)/totalNonLand:0;
    if(avgCmc<2.5&&counts.creatures>=25)return'aggro';

    return'goodstuff';
  },

  ARCHETYPE_LABELS:{
    aggro:'Aggro',
    control:'Control',
    combo:'Combo',
    voltron:'Voltron',
    tribal:'Tribal',
    artifacts:'Artifacts',
    enchantress:'Enchantress',
    lands:'Lands',
    goodstuff:'Goodstuff'
  },

  TARGETS:{
    aggro:{ramp:7,draw:8,removal:8,interaction:2,lands_base:33},
    control:{ramp:8,draw:14,removal:10,interaction:10,lands_base:37},
    combo:{ramp:10,draw:10,removal:6,interaction:6,lands_base:35},
    voltron:{ramp:9,draw:8,removal:5,interaction:3,lands_base:36},
    tribal:{ramp:9,draw:9,removal:8,interaction:4,lands_base:36},
    artifacts:{ramp:10,draw:9,removal:8,interaction:5,lands_base:34},
    enchantress:{ramp:8,draw:10,removal:7,interaction:4,lands_base:36},
    lands:{ramp:12,draw:8,removal:7,interaction:3,lands_base:40},
    goodstuff:{ramp:10,draw:10,removal:10,interaction:5,lands_base:36}
  },

  RAMP_KEYS:['add {','produces mana','search your library for a','basic land','land card','land put',
    'sol ring','arcane signet',"commander's sphere",'cultivate',"kodama's reach",
    'rampant growth','farseek','three visits',"nature's lore",'skyshroud claim',
    'explosive vegetation','mana crypt','mana vault','dark ritual','cabal ritual',
    'worn powerstone','gilded lotus','thran dynamo','basalt monolith'],

  DRAW_KEYS:['draw a card','draw two','draw three','draw cards','draws a card','draw {',
    'wheel of fortune','rhystic study','mystic remora','phyrexian arena','necropotence',
    'sylvan library',"sensei's divining top",'skullclamp','mentor of the meek',
    'consecrated sphinx','fact or fiction',"night's whisper",'read the bones',
    'sign in blood','ancient craving',"ambition's cost",'painful truths',
    'urban evolution','growth spiral','brainstorm','ponder','preordain'],

  REMOVAL_KEYS:['destroy target','exile target','return target','counter target',
    'deal damage to any target','swords to plowshares','path to exile',
    'beast within','generous gift','chaos warp','cyclonic rift',
    'toxic deluge','damnation','wrath of god','blasphemous act',
    'vandalblast','austere command','farewell','damn','balefire dragon',
    'decree of pain','dark impostor'],

  COUNTER_KEYS:['counter target spell','counter that spell','counter target activated',
    'counter target triggered','negate','counterspell','force of will',
    'mana drain','pact of negation','swan song','flusterstorm',
    "an offer you can't refuse",'fierce guardianship'],

  PROTECTION_KEYS:['hexproof','shroud','indestructible','ward','protection from',
    "champion's helm",'swiftfoot boots','lightning greaves',
    'darksteel plate','regenerate','totem armor'],

  WIN_CON_KEYS:['win the game','deal combat damage to a player','infect',
    'poison counter','you win the game','each opponent loses',
    'alt win',"thassa's oracle",'laboratory maniac',
    'jace, wielder of mysteries'],

  BASIC_LAND_NAMES:new Set(['plains','island','swamp','mountain','forest',
    'snow-covered plains','snow-covered island','snow-covered swamp',
    'snow-covered mountain','snow-covered forest','wastes']),

  _classify(deck){
    const res={ramp:[],draw:[],removal:[],interaction:[],lands:[],protection:[],win_cons:[],basics:0,nonbasics:0};
    for(const c of deck.cards){
      const cd=Store.card(c.name)||{};
      const oracle=(cd.oracle_text||'').toLowerCase();
      const type=(cd.type_line||'').toLowerCase();
      const name=c.name.toLowerCase();
      const isLand=type.includes('land')||(!type&&(this.BASIC_LAND_NAMES.has(name)||/(plains|island|swamp|mountain|forest)/.test(name)||oracle.includes('{t}: add ')));
      if(isLand){
        res.lands.push(c.name);
        const isBasic=type.includes('basic')||this.BASIC_LAND_NAMES.has(name);
        if(isBasic)res.basics+=(c.qty||0);
        else res.nonbasics+=(c.qty||0);
        continue;
      }
      if(this.RAMP_KEYS.some(k=>oracle.includes(k)||name.includes(k)))res.ramp.push(c.name);
      if(this.DRAW_KEYS.some(k=>oracle.includes(k)||name.includes(k)))res.draw.push(c.name);
      if(this.REMOVAL_KEYS.some(k=>oracle.includes(k)||name.includes(k)))res.removal.push(c.name);
      if(this.COUNTER_KEYS.some(k=>oracle.includes(k)))res.interaction.push(c.name);
      if(this.PROTECTION_KEYS.some(k=>oracle.includes(k)||name.includes(k)))res.protection.push(c.name);
      if(this.WIN_CON_KEYS.some(k=>oracle.includes(k)||name.includes(k)))res.win_cons.push(c.name);
    }
    return res;
  },

  async _analyse(deck){
    const names=[deck.commander,deck.partner,...deck.cards.map(c=>c.name)].filter(Boolean);
    await Store.warmCards(names);

    const archetype=this._detectArchetype(deck);
    const targets=this.TARGETS[archetype];
    const cls=this._classify(deck);
    const totalCards=deck.cards.reduce((s,c)=>s+(c.qty||0),0);
    const totalNonLand=deck.cards.filter(c=>!(Store.card(c.name)||{}).type_line?.toLowerCase().includes('land'));
    const totalNonLandQty=totalNonLand.reduce((s,c)=>s+(c.qty||0),0);
    const avgCmc=totalNonLandQty?totalNonLand.reduce((s,c)=>s+(((Store.card(c.name)||{}).cmc||0)*(c.qty||0)),0)/totalNonLandQty:0;
    const landCount=deck.cards.reduce((s,c)=>{
      const cd=Store.card(c.name)||{};
      const type=(cd.type_line||'').toLowerCase();
      const name=c.name.toLowerCase();
      const isLand=type.includes('land')||(!type&&(this.BASIC_LAND_NAMES.has(name)||/(plains|island|swamp|mountain|forest)/.test(name)||((cd.oracle_text||'').toLowerCase().includes('{t}: add '))));
      return s+(isLand?(c.qty||0):0);
    },0);

    const colorCount=(Store.card(deck.commander)||{}).color_identity?.length||1;
    const fixingTarget=Math.max(0,(colorCount-1)*5);
    const cmdrProtected=cls.protection.length>=2;
    const hasWinCon=cls.win_cons.length>=1||deck.cards.some(c=>c.name===deck.commander&&(Store.card(c.name)||{}).oracle_text?.toLowerCase().includes('damage'));
    const idealLands=Math.max(30,Math.min(42,targets.lands_base+Math.round((avgCmc-3)*2)));

    const checks=[
      {id:'ramp',label:'Ramp and Mana',ico:'R',weight:15,count:cls.ramp.length,target:targets.ramp,desc:`${cls.ramp.length} ramp pieces (target: ${targets.ramp}+)`,fix:cls.ramp.length<targets.ramp?`Add ${targets.ramp-cls.ramp.length} more ramp.`:null,examples:['Sol Ring','Arcane Signet','Cultivate']},
      {id:'draw',label:'Card Draw',ico:'D',weight:15,count:cls.draw.length,target:targets.draw,desc:`${cls.draw.length} draw effects (target: ${targets.draw}+)`,fix:cls.draw.length<targets.draw?`Add ${targets.draw-cls.draw.length} more draw effects.`:null,examples:['Rhystic Study','Sylvan Library','Skullclamp']},
      {id:'removal',label:'Removal',ico:'X',weight:12,count:cls.removal.length,target:targets.removal,desc:`${cls.removal.length} removal spells (target: ${targets.removal}+)`,fix:cls.removal.length<targets.removal?`Add ${targets.removal-cls.removal.length} more removal spells.`:null,examples:['Swords to Plowshares','Beast Within','Generous Gift']},
      {id:'interaction',label:'Interaction',ico:'I',weight:10,count:cls.interaction.length,target:targets.interaction,desc:`${cls.interaction.length} interaction spells (target: ${targets.interaction}+)`,fix:cls.interaction.length<targets.interaction&&targets.interaction>2?`Add ${targets.interaction-cls.interaction.length} more responses.`:null,examples:['Counterspell','Negate','Swan Song']},
      {id:'lands',label:'Land Count',ico:'L',weight:18,count:landCount,target:idealLands,desc:`${landCount} lands (target: about ${idealLands})`,fix:landCount<idealLands-1?`Add ${idealLands-landCount} more lands.`:landCount>idealLands+2?`Consider cutting ${landCount-idealLands} lands and adding more ramp instead.`:null,examples:['Command Tower','Exotic Orchard','Arcane Sanctum']},
      {id:'fixing',label:'Mana Fixing',ico:'F',weight:8,count:cls.nonbasics,target:fixingTarget,desc:`${colorCount}-color deck: ${cls.nonbasics} non-basics (target: ${fixingTarget}+)`,fix:colorCount>=3&&cls.nonbasics<fixingTarget?`Add ${fixingTarget-cls.nonbasics} more dual or fetch lands.`:null,examples:['Command Tower','Exotic Orchard','Evolving Wilds']},
      {id:'protection',label:'Commander Protection',ico:'P',weight:8,pass:cmdrProtected,desc:cmdrProtected?`${cls.protection.length} protection effects found`:`Only ${cls.protection.length} protection effects found`,fix:!cmdrProtected?'Add more protection for your commander.':null,examples:['Lightning Greaves','Swiftfoot Boots','Darksteel Plate']},
      {id:'wincon',label:'Win Condition',ico:'W',weight:8,pass:hasWinCon,desc:hasWinCon?'Win condition detected':'No clear win condition found',fix:!hasWinCon?'Add a finisher, combo, or damage outlet.':null,examples:[]},
      {id:'cardcount',label:'Deck Size',ico:'C',weight:8,count:totalCards,target:100,desc:`${totalCards} cards total`,fix:totalCards!==100?`Adjust deck size by ${Math.abs(totalCards-100)} card${Math.abs(totalCards-100)!==1?'s':''}.`:null,examples:[]},
      {id:'curve',label:'Mana Curve',ico:'M',weight:8,_avgCmc:avgCmc,desc:`Avg CMC: ${avgCmc.toFixed(2)}`,fix:avgCmc>3.8?`High curve (${avgCmc.toFixed(1)}). Cut expensive cards or add ramp.`:archetype==='aggro'&&avgCmc>2.8?`Aggro decks usually want avg CMC under 2.8.`:null,examples:[]},
      {id:'singleton',label:'Singleton Rule',ico:'S',weight:8,_check:()=>{const violations=deck.cards.filter(c=>{const cd=Store.card(c.name)||{};return (c.qty||0)>1&&!((cd.type_line||'').toLowerCase().includes('basic'));});return violations.length===0?{ok:true,desc:'All non-basic cards are singleton'}:{ok:false,desc:`${violations.length} card${violations.length>1?'s':''} with qty > 1`,fix:`Remove duplicates: ${violations.map(c=>c.name).join(', ')}`};}}
    ];

    let totalScore=0,totalWeight=0;
    const processedChecks=checks.map(chk=>{
      let pct=0,statusClass='fail',pass=false,desc=chk.desc,fix=chk.fix;
      if(chk.id==='singleton'){
        const res=chk._check();
        pass=res.ok;
        pct=pass?100:0;
        statusClass=pass?'pass':'fail';
        desc=res.desc;
        fix=res.fix||null;
      }else if(chk.id==='protection'||chk.id==='wincon'){
        pass=chk.pass||false;
        pct=pass?100:0;
        statusClass=pass?'pass':'warn';
      }else if(chk.id==='curve'){
        const tgt=archetype==='aggro'?{lo:1.8,hi:2.8}:{lo:2.3,hi:3.6};
        if(chk._avgCmc>=tgt.lo&&chk._avgCmc<=tgt.hi){pct=100;statusClass='pass';pass=true;}
        else if(chk._avgCmc>=tgt.lo-0.4&&chk._avgCmc<=tgt.hi+0.5){pct=65;statusClass='warn';}
        else{pct=30;statusClass='fail';}
      }else if(chk.id==='cardcount'){
        pass=chk.count===100;
        pct=pass?100:Math.max(0,100-Math.abs(chk.count-100)*5);
        statusClass=pass?'pass':Math.abs(chk.count-100)<=2?'warn':'fail';
      }else if(chk.id==='fixing'){
        if(colorCount<=1){pass=true;pct=100;statusClass='pass';desc='Mono-color: no fixing needed';}
        else{pct=chk.target>0?Math.min(100,(chk.count/chk.target)*100):100;pass=chk.count>=chk.target;statusClass=pass?'pass':pct>=60?'warn':'fail';}
      }else{
        const ratio=chk.count/chk.target;
        pct=Math.min(100,ratio*100);
        pass=chk.count>=chk.target;
        statusClass=pass?'pass':pct>=65?'warn':'fail';
      }
      totalWeight+=chk.weight;
      totalScore+=Math.round((pct/100)*chk.weight);
      return{...chk,pct,statusClass,pass,desc,fix};
    });

    const score=Math.round((totalScore/totalWeight)*100);
    let grade,gradeColor;
    if(score>=90){grade='S - Optimal';gradeColor='var(--green2)';}
    else if(score>=80){grade='A - Excellent';gradeColor='var(--green2)';}
    else if(score>=70){grade='B - Good';gradeColor='var(--ice)';}
    else if(score>=60){grade='C - Decent';gradeColor='var(--gold)';}
    else if(score>=45){grade='D - Needs Work';gradeColor='var(--gold3)';}
    else{grade='F - Critical Issues';gradeColor='var(--crimson2)';}

    const numEl=document.getElementById('health-score-num');
    const gradeEl=document.getElementById('health-score-grade');
    if(numEl){numEl.textContent=score;numEl.style.fill=gradeColor;}
    if(gradeEl){gradeEl.textContent=grade.split(' ')[0];gradeEl.setAttribute('fill',gradeColor);}

    const arc=document.getElementById('health-ring-arc');
    if(arc){
      const circ=2*Math.PI*66;
      setTimeout(()=>{
        arc.style.strokeDashoffset=circ*(1-score/100);
        arc.style.stroke=score>=80?'#5aaa6a':score>=60?'#c8a84b':score>=40?'#e8703a':'#c22b3e';
      },80);
    }

    const archetypeBadge=document.getElementById('health-archetype-badge');
    if(archetypeBadge){
      archetypeBadge.textContent=this.ARCHETYPE_LABELS[archetype]||archetype;
      archetypeBadge.style.display='inline-block';
    }

    const checksEl=document.getElementById('health-checks');
    if(checksEl){
      checksEl.innerHTML='';
      for(const chk of processedChecks){
        const barColor=chk.statusClass==='pass'?'var(--green2)':chk.statusClass==='warn'?'var(--gold)':'var(--crimson2)';
        const row=document.createElement('div');
        row.className='health-check';
        row.innerHTML=`
          <div class="health-check-ico">${chk.ico}</div>
          <div class="health-check-info">
            <div class="health-check-label">${chk.label}</div>
            <div class="health-check-detail">${chk.desc}</div>
            <div class="health-bar-wrap" style="margin-top:4px">
              <div class="health-bar" style="width:${chk.pct}%;background:${barColor};transition:width .6s"></div>
            </div>
          </div>
          <div class="health-check-score ${chk.statusClass}">${chk.statusClass==='pass'?'OK':chk.pct+'%'}</div>`;
        checksEl.appendChild(row);
      }
    }

    const fixes=processedChecks.filter(c=>c.fix&&!c.pass);
    const sugEl=document.getElementById('health-suggestions');
    if(sugEl){
      if(!fixes.length){sugEl.style.display='none';return;}
      sugEl.style.display='block';
      const sugList=document.getElementById('health-sug-list');
      if(sugList){
        sugList.innerHTML='';
        fixes.sort((a,b)=>(b.weight||0)-(a.weight||0)).forEach(chk=>{
          const item=document.createElement('div');
          item.className='health-sug-item';
          item.innerHTML=`<div class="health-sug-ico">${chk.ico}</div><div class="health-sug-text">${chk.fix}${chk.examples?.length?'<br><span style="color:var(--text3);font-size:10px">e.g. '+chk.examples.slice(0,3).join(', ')+'</span>':''}</div>`;
          sugList.appendChild(item);
        });
      }
    }
  },

  render(){
    const sel=document.getElementById('health-deck-select');
    if(!sel)return;
    const prev=sel.value;
    sel.innerHTML='<option value="">- Select a deck to analyze -</option>';
    Store.decks.forEach(d=>{
      const opt=document.createElement('option');
      opt.value=d.id;
      opt.textContent=d.name+(d.commander?' - '+d.commander:'');
      sel.appendChild(opt);
    });
    const best=prev||App.curId||'';
    if(best){
      sel.value=best;
      if(sel.value)this.select(sel.value);
    }else{
      document.getElementById('health-content').style.display='none';
      document.getElementById('health-empty').style.display='block';
    }
  },

  select(id){
    const deck=Store.getDeck(id);
    const content=document.getElementById('health-content');
    const empty=document.getElementById('health-empty');
    if(!deck){
      if(content)content.style.display='none';
      if(empty)empty.style.display='block';
      return;
    }
    if(content)content.style.display='block';
    if(empty)empty.style.display='none';
    this._analyse(deck).catch(()=>{});
  }
};
