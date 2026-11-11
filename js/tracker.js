/* MagicTheDrinkering â€“ Multiplayer Commander Tracker
   Supabase Realtime Lobby System
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

/* â”€â”€ Hilfsfunktionen â”€â”€ */
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

/* â”€â”€ Supabase Config (gleiche wie bisher) â”€â”€ */
const SUPABASE_URL = 'https://pwrpvtzocycnemgnsooz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_doroVk7_Pblbapi7z9njyQ_zfVTZOmG';

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   MULTIPLAYER TRACKER
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const MPTracker = {

  /* â”€â”€ Konstanten â”€â”€ */
  START_LIFE: 40,
  MAX_PLAYERS: 10,
  SESSION_KEY: 'mtd_mp_session_v1',
  LOBBY_STATE_KEY: 'mtd_mp_lobby_state_v1',
  COLORS: ['gold','ice','green','crimson','purple','steel','orange','teal','pink','brown'],

  /* â”€â”€ State â”€â”€ */
  sb: null,
  sessionId: null,
  playerName: '',
  authUser: null,
  authReady: false,
  deckOptions: [],
  combatLifelink: false,
  combatModalOpen: false,
  combatTargetIds: [],
  countersOpen: false,
  extraTurnQueued: false,
  miscCounters: { energy: 0, experience: 0, rad: 0 },
  errorMessage: '',
  combatHoldTimeout: null,
  combatHoldInterval: null,
  combatHoldTriggered: false,
  pendingWrites: 0,
  lastRenderedMarkup: '',
  lastUndo: null,
  uiPulseByPlayerId: {},
  lobbyId: null,
  lobbyCode: null,
  myPlayerId: null,
  lobby: null,
  players: [],
  subscription: null,
  phase: 'menu', // menu | creating | waiting | setup | live | finished

  /* â”€â”€ Init â”€â”€ */
  async init() {
    this.sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, storage: window.localStorage, storageKey: 'cforge_sb_session', autoRefreshToken: true, detectSessionInUrl: false }
    });
    this.sessionId = this._getOrCreateSession();
    this._bindLifecycle();
    this.phase = 'creating';
    this._render();
    await this._bootstrapIdentity();
    const restored = await this._restoreLobby();
    if (!restored) {
      this.phase = this._localResumeOnBoot() ? 'local' : 'menu';
      this._render();
    }
  },

  _getOrCreateSession() {
    let s = localStorage.getItem(this.SESSION_KEY);
    if (!s) { s = 'sess-' + Date.now().toString(36) + Math.random().toString(36).slice(2,8); localStorage.setItem(this.SESSION_KEY, s); }
    return s;
  },

  _bindLifecycle() {
    window.addEventListener('beforeunload', () => {
      this._destroySubscription();
    });
    window.addEventListener('online', () => this._restoreLobby());
    window.addEventListener('offline', () => this._showError('Offline: letzter Stand bleibt sichtbar, Sync pausiert.'));
    const root = document.getElementById('mp-root');
    if (!root || root.dataset.bound === '1') return;
    root.dataset.bound = '1';
    root.addEventListener('click', (event) => this._handleRootClick(event));
    root.addEventListener('change', (event) => this._handleRootChange(event));
    root.addEventListener('input', (event) => this._handleRootInput(event));
    root.addEventListener('pointerdown', (event) => this._handleRootPointerDown(event));
    root.addEventListener('pointerup', (event) => this._handleRootPointerEnd(event));
    root.addEventListener('pointerleave', (event) => this._handleRootPointerEnd(event), true);
    root.addEventListener('pointercancel', (event) => this._handleRootPointerEnd(event), true);
  },

  _handleRootClick(event) {
    const el = event.target.closest('[data-action]');
    if (!el) return;
    this._haptic(el.dataset.action);
    const { action, targetId = '', counter = '', value = '', deck = '' } = el.dataset;
    if (action === 'close-combat' && el.classList.contains('mp-combat-modal-backdrop') && event.target !== el) return;
    const delta = Number(el.dataset.delta || 0);
    if (action === 'create-lobby') return this.createLobby();
    if (action === 'join-lobby') return this.joinLobby();
    if (action === 'leave-lobby') return this.leaveLobby();
    if (action === 'start-game') return this.startGame();
    if (action === 'copy-code') return this.copyLobbyCode(el);
    if (action === 'adjust-life') return this.adjustLife(delta);
    if (action === 'adjust-poison') return this.adjustPoison(delta);
    if (action === 'adjust-counter') return this.adjustMiscCounter(counter, delta);
    if (action === 'toggle-monarch') return this.toggleMonarch();
    if (action === 'toggle-initiative') return this.toggleInitiative();
    if (action === 'toggle-lifelink') return this.toggleCombatLifelink();
    if (action === 'toggle-extra-turn') return this.toggleExtraTurn();
    if (action === 'toggle-counters') return this.toggleCountersPanel();
    if (action === 'next-turn') return this.nextTurn();
    if (action === 'undo') return this.undoLastAction();
    if (action === 'open-combat') return this.openCombatModal(targetId);
    if (action === 'close-combat') return this.closeCombatModal();
    if (action === 'toggle-combat-target') return this.toggleCombatTarget(targetId);
    if (action === 'finish-game') return this.finishGame(value);
    if (action === 'rematch') return this.rematchSamePlayers();
    if (action === 'waiting-room') return this.returnToWaitingRoom();
    if (action === 'select-deck') return this.updateMyDeckChoice(deck);
  },

  _handleRootChange(event) {
    const el = event.target;
    if (el.matches('[data-field="name"]')) return this.updateMyName(el.value);
    if (el.matches('[data-field="deck"]')) return this.updateMyDeck(el.value);
    if (el.matches('[data-field="deck-choice"]')) return this.updateMyDeckChoice(el.value);
  },

  _handleRootInput(event) {
    const el = event.target;
    if (!el.matches('[data-field="code"]')) return;
    el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g,'');
  },

  _handleRootPointerDown(event) {
    const el = event.target.closest('[data-hold-mode]');
    if (!el) return;
    this._haptic('hold');
    el.setPointerCapture?.(event.pointerId);
    this.startCombatAdjust(el.dataset.holdMode, el.dataset.targetId, Number(el.dataset.direction || 0));
  },

  _handleRootPointerEnd(event) {
    const el = event.target.closest('[data-hold-mode]');
    if (!el) return this.stopCombatAdjust();
    this.stopCombatAdjust(el.dataset.holdMode, el.dataset.targetId, Number(el.dataset.direction || 0));
  },

  _destroySubscription() {
    if (!this.subscription || !this.sb) return;
    try { this.sb.removeChannel(this.subscription); } catch {}
    this.subscription = null;
  },

  _persistLobbyState() {
    if (!this.lobbyId || !this.myPlayerId) { this._clearLobbyState(); return; }
    localStorage.setItem(this.LOBBY_STATE_KEY, JSON.stringify({
      lobbyId: this.lobbyId,
      lobbyCode: this.lobbyCode,
      myPlayerId: this.myPlayerId,
      playerName: this.playerName,
      cachedAt: Date.now(),
      lobby: this.lobby,
      players: this.players
    }));
  },

  _clearLobbyState() {
    localStorage.removeItem(this.LOBBY_STATE_KEY);
  },

  _savedLobbyState() {
    try { return JSON.parse(localStorage.getItem(this.LOBBY_STATE_KEY) || 'null'); } catch { return null; }
  },

  async _restoreLobby() {
    const saved = this._savedLobbyState();
    if (!saved?.lobbyId || !saved?.myPlayerId) return false;
    try {
      const [{ data: lobby }, { data: me }, { data: players }] = await Promise.all([
        this.sb.from('mp_lobbies').select('*').eq('id', saved.lobbyId).maybeSingle(),
        this.sb.from('mp_players').select('*').eq('id', saved.myPlayerId).maybeSingle(),
        this.sb.from('mp_players').select('*').eq('lobby_id', saved.lobbyId).order('seat')
      ]);
      if (!lobby || !me) {
        this._clearLobbyState();
        return false;
      }
      this.lobbyId = lobby.id;
      this.lobbyCode = lobby.code || saved.lobbyCode || '';
      this.myPlayerId = me.id;
      this.playerName = me.name || saved.playerName || '';
      this.lobby = lobby;
      this.players = players || [];
      this.phase = lobby.phase === 'finished' ? 'finished' : lobby.phase === 'live' ? 'live' : 'waiting';
      this._subscribe();
      MPStats.attach(this.sb, this.lobby.id, this.myPlayerId, this.players); // NEU
      this._persistLobbyState();
      this._render();
      return true;
    } catch (err) {
      console.warn('[MPTracker._restoreLobby]', err);
      if (saved?.lobby && Array.isArray(saved.players)) {
        this.lobbyId = saved.lobbyId;
        this.lobbyCode = saved.lobbyCode || saved.lobby?.code || '';
        this.myPlayerId = saved.myPlayerId;
        this.playerName = saved.playerName || '';
        this.lobby = saved.lobby;
        this.players = saved.players;
        this.phase = saved.lobby.phase === 'finished' ? 'finished' : saved.lobby.phase === 'live' ? 'live' : 'waiting';
        MPStats.attach(this.sb, this.lobbyId, this.myPlayerId, this.players);
        this._render();
        this._showError('Offline-Modus: letzter gespeicherter Stand geladen.');
        return true;
      }
      this._clearLobbyState();
      return false;
    }
  },

  /* â”€â”€ Lobby erstellen â”€â”€ */
  async _bootstrapIdentity() {
    try {
      const { data: { session } } = await this.sb.auth.getSession();
      const user = session?.user || null;
      if (!user) {
        this.authUser = null;
        this.authReady = true;
        return;
      }
      this.authUser = user;
      const [profileRes, decksRes] = await Promise.all([
        this.sb.from('profiles').select('username,email').eq('id', user.id).maybeSingle(),
        this.sb.from('decks').select('id,name,commander,partner').eq('user_id', user.id).order('name')
      ]);
      const profile = profileRes.data || null;
      const displayName = profile?.username || user.user_metadata?.username || user.email?.split('@')[0] || 'Player';
      this.playerName = this.playerName || displayName;
      this.deckOptions = (decksRes.data || []).map(deck => ({
        id: deck.id,
        name: deck.name || 'Untitled Deck',
        commander: deck.commander || '',
        partner: deck.partner || ''
      }));
    } catch (err) {
      console.warn('[MPTracker._bootstrapIdentity]', err);
      this.authUser = null;
      this.deckOptions = [];
    } finally {
      this.authReady = true;
    }
  },

  async createLobby() {
    const nameInput = document.getElementById('mp-name-input');
    const name = (nameInput?.value || this.playerName || '').trim();
    if (!name) { this._showError('Bitte gib deinen Namen ein.'); return; }
    this.playerName = name;
    this.phase = 'creating';
    this._render();

    try {
      const code = this._genCode();
      const { data: lobby, error: le } = await this.sb.from('mp_lobbies').insert({
        code,
        host_session: this.sessionId,
        phase: 'waiting',
        turn_number: 1,
        active_player_id: null,
        started_at: null,
        finished_at: null
      }).select().single();
      if (le) throw le;

      const { data: player, error: pe } = await this.sb.from('mp_players').insert({
        lobby_id: lobby.id,
        session_id: this.sessionId,
        name: this.playerName,
        deck: '',
        life: this.START_LIFE,
        poison: 0,
        monarch: false,
        initiative: false,
        eliminated: false,
        seat: 0,
        color: this.COLORS[0]
      }).select().single();
      if (pe) throw pe;

      this.lobbyId = lobby.id;
      this.lobbyCode = code;
      this.myPlayerId = player.id;
      this.lobby = lobby;
      this.players = [player];
      this.phase = 'waiting';
      this._subscribe();
      MPStats.attach(this.sb, this.lobbyId, this.myPlayerId, this.players);
      this._persistLobbyState();
      this._render();
    } catch(err) {
      console.error(err);
      this.phase = 'menu';
      this._showError('Lobby konnte nicht erstellt werden: ' + (err.message || err));
      this._render();
    }
  },

  /* â”€â”€ Lobby beitreten â”€â”€ */
  async joinLobby() {
    const nameInput = document.getElementById('mp-name-input');
    const codeInput = document.getElementById('mp-code-input');
    const name = (nameInput?.value || this.playerName || '').trim();
    const code = (codeInput?.value || '').trim().toUpperCase();
    if (!name) { this._showError('Bitte gib deinen Namen ein.'); return; }
    if (!code || code.length !== 6) { this._showError('Bitte gib einen gueltigen 6-stelligen Code ein.'); return; }
    this.playerName = name;
    this.phase = 'creating';
    this._render();

    try {
      const { data: lobby, error: le } = await this.sb.from('mp_lobbies').select('*').eq('code', code).single();
      if (le || !lobby) throw new Error('Lobby nicht gefunden.');
      if (lobby.phase === 'live') throw new Error('Das Spiel laeuft bereits.');
      if (lobby.phase === 'finished') throw new Error('Diese Lobby ist beendet.');

      const { data: existing } = await this.sb.from('mp_players').select('id').eq('lobby_id', lobby.id).eq('session_id', this.sessionId).maybeSingle();
      if (existing) {
        this.myPlayerId = existing.id;
        this.lobbyId = lobby.id;
        this.lobbyCode = code;
        this.lobby = lobby;
        const { data: players } = await this.sb.from('mp_players').select('*').eq('lobby_id', lobby.id).order('seat');
        this.players = players || [];
        this.phase = lobby.phase === 'waiting' ? 'waiting' : 'live';
        this._subscribe();
        MPStats.attach(this.sb, this.lobbyId, this.myPlayerId, this.players);
        this._persistLobbyState();
        this._render();
        return;
      }

      const { data: countData } = await this.sb.from('mp_players').select('id').eq('lobby_id', lobby.id);
      if ((countData || []).length >= this.MAX_PLAYERS) throw new Error('Lobby ist voll.');
      const seat = (countData || []).length;

      const { data: player, error: pe } = await this.sb.from('mp_players').insert({
        lobby_id: lobby.id,
        session_id: this.sessionId,
        name: this.playerName,
        deck: '',
        life: this.START_LIFE,
        poison: 0,
        monarch: false,
        initiative: false,
        eliminated: false,
        seat,
        color: this.COLORS[seat % this.COLORS.length]
      }).select().single();
      if (pe) throw pe;

      this.lobbyId = lobby.id;
      this.lobbyCode = code;
      this.myPlayerId = player.id;
      this.lobby = lobby;
      const { data: players } = await this.sb.from('mp_players').select('*').eq('lobby_id', lobby.id).order('seat');
      this.players = players || [];
      this.phase = 'waiting';
      this._subscribe();
      MPStats.attach(this.sb, this.lobbyId, this.myPlayerId, this.players);
      this._persistLobbyState();
      this._render();
    } catch(err) {
      console.error(err);
      this.phase = 'menu';
      this._showError(err.message || 'Beitreten fehlgeschlagen.');
      this._render();
    }
  },

  /* â”€â”€ Realtime Subscription â”€â”€ */
  _subscribe() {
    this._destroySubscription();
    this.subscription = this.sb.channel('lobby:' + this.lobbyId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mp_players', filter: 'lobby_id=eq.' + this.lobbyId }, (payload) => {
        this._handlePlayerChange(payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mp_lobbies', filter: 'id=eq.' + this.lobbyId }, (payload) => {
        this._handleLobbyChange(payload);
      })
      .subscribe();
  },

  _handlePlayerChange(payload) {
    const { eventType, new: newRow, old: oldRow } = payload;
    // Während lokaler Writes keine möglicherweise veralteten UPDATE-Echos übernehmen.
    // Nach Abschluss aller Writes wird der autoritative Stand einmal neu geladen.
    if (eventType === 'INSERT') {
      if (!this.players.find(p => p.id === newRow.id)) this.players = this._sortedPlayers([...this.players, newRow]);
    } else if (eventType === 'UPDATE') {
      if (this.pendingWrites > 0 || this._recentLocalPlayerWrites?.has(newRow?.id)) return;
      const idx = this.players.findIndex(p => p.id === newRow.id);
      if (idx >= 0) this.players[idx] = newRow; else this.players.push(newRow);
      this.players = this._sortedPlayers();
    } else if (eventType === 'DELETE') {
      if (oldRow?.id === this.myPlayerId) {
        this._showError('Du wurdest aus der Lobby entfernt.');
        this._resetLobbyState();
        this._render();
        return;
      }
      this.players = this.players.filter(p => p.id !== oldRow.id);
    }
    MPStats.updatePlayers(this.players); // NEU
    this._checkAutoFinish();
    this._render();
  },

  _handleLobbyChange(payload) {
    if (!payload.new) return;
    this.lobby = payload.new;
    if (this.lobby.phase === 'waiting' && this.phase !== 'waiting') { this.phase = 'waiting'; }
    if (this.lobby.phase === 'live' && this.phase !== 'live') { this.phase = 'live'; }
    if (this.lobby.phase === 'finished' && this.phase !== 'finished') 
      { this.phase = 'finished'; 
      this._persistLobbyState();
      this._render();
      setTimeout(() =>{
        MPStats.renderFinishedStats(this.lobbyId, this.players, this.lobby)
      }, 100);
      return;
  }
  this._persistLobbyState();
  this._render();
},
  /* â”€â”€ Host: Spiel starten â”€â”€ */
  async startGame() {
    if (!this._isHost()) return;
    if (this.players.length < 2) { this._showError('Mindestens 2 Spieler benoetigt.'); return; }
    const firstPlayer = this.players[0];
    try {
      await this.sb.from('mp_lobbies').update({
        phase: 'live',
        active_player_id: firstPlayer.id,
        started_at: new Date().toISOString(),
        finished_at: null,
        winner_id: null,
        turn_number: 1
      }).eq('id', this.lobbyId);
      await this.sb.from('mp_players').update({
        life: this.START_LIFE,
        poison: 0,
        monarch: false,
        initiative: false,
        eliminated: false,
        cmd_damage: {}
      }).eq('lobby_id', this.lobbyId);
    } catch(err) { this._showError('Fehler beim Starten: ' + err.message); }
  },

 /* ── Life anpassen ── */
async adjustLife(delta) {
  const me = this._me();
  if (!me || this.phase !== 'live') return;
  const updates = this._buildPlayerUpdate(me, { life: (me.life || 0) + delta });

  if (delta > 0) {
    MPStats.logEvent('heal', {
      actorId: this.myPlayerId,
      amount: delta,
      turn: this.lobby?.turn_number || 1
    });
  }

  await this._runOptimistic({
    playerUpdates: [{ id: this.myPlayerId, updates }],
    undoLabel: delta >= 0 ? `Heal ${delta}` : `Damage ${Math.abs(delta)}`,
    pulses: [{ id: this.myPlayerId, kind: delta >= 0 ? 'heal' : 'damage' }]
  });
},
  /* â”€â”€ Commander Damage â”€â”€ */
  async dealCommanderDamage(targetId, delta) {
    await this.dealCombatDamage(targetId, delta, { commander: true });
  },

  async dealCombatDamage(targetId, delta, { commander = false } = {}) {
    const target = this.players.find(p => p.id === targetId);
    const me = this._me();
    if (!target || !me || me.eliminated || this.phase !== 'live') return;
    const amount = Number(delta) || 0;
    if (!amount || (target.eliminated && amount > 0)) return;

    const nextCmdDamage = { ...(target.cmd_damage || {}) };
    if (commander) {
      const current = nextCmdDamage[this.myPlayerId] || 0;
      nextCmdDamage[this.myPlayerId] = Math.max(0, Math.min(99, current + amount));
      if (nextCmdDamage[this.myPlayerId] <= 0) delete nextCmdDamage[this.myPlayerId];
    }

    const playerUpdates = [];
    const targetUpdates = this._buildPlayerUpdate(target, {
      life: (target.life || 0) - amount,
      cmd_damage: commander ? nextCmdDamage : (target.cmd_damage || {})
    });
    playerUpdates.push({ id: targetId, updates: targetUpdates });

    if (this.combatLifelink && amount > 0) {
      const meUpdates = this._buildPlayerUpdate(me, { life: (me.life || 0) + amount });
      playerUpdates.push({ id: this.myPlayerId, updates: meUpdates });
    }
    const turn = this.lobby?.turn_number || 1;
    if (amount > 0) {
      MPStats.logEvent(commander ? 'commander_damage' : 'combat_damage', {
        actorId: this.myPlayerId,
        targetId,
        amount,
        turn
      });
    }

    await this._runOptimistic({
      playerUpdates,
      undoLabel: commander ? `Commander ${amount}` : `Combat ${amount}`,
      pulses: [
        { id: targetId, kind: amount > 0 ? 'damage' : 'heal' },
        ...(this.combatLifelink && amount > 0 ? [{ id: this.myPlayerId, kind: 'heal' }] : [])
      ]
    });
  },

  /* â”€â”€ Poison â”€â”€ */
  async adjustPoison(delta) {
  const me = this._me();
  if (!me || this.phase !== 'live') return;
  const updates = this._buildPlayerUpdate(me, { poison: (me.poison || 0) + delta });

  if (delta > 0) {
    MPStats.logEvent('poison', {
      actorId: this.myPlayerId,
      targetId: this.myPlayerId,
      amount: delta,
      turn: this.lobby?.turn_number || 1
    });
  }

  await this._runOptimistic({
    playerUpdates: [{ id: this.myPlayerId, updates }],
    undoLabel: delta >= 0 ? `Poison +${delta}` : `Poison ${delta}`,
    pulses: [{ id: this.myPlayerId, kind: delta >= 0 ? 'damage' : 'heal' }]
  });
},

  /* â”€â”€ Setup: Name/Deck Ã¤ndern â”€â”€ */
  async updateMyName(name) {
    const v = String(name || '').trim().slice(0, 24);
    if (!v) return;
    this.playerName = v;
    if (this.myPlayerId) await this.sb.from('mp_players').update({ name: v }).eq('id', this.myPlayerId);
  },

  async updateMyDeck(deck) {
    const v = String(deck || '').trim().slice(0, 60);
    if (this.myPlayerId) await this.sb.from('mp_players').update({ deck: v }).eq('id', this.myPlayerId);
  },

  async updateMyDeckChoice(deck) {
    await this.updateMyDeck(deck);
  },

  /* â”€â”€ Toggle Monarch/Initiative â”€â”€ */
  async toggleMonarch() {
    const me = this._me();
    if (!me || this.phase !== 'live') return;
    const next = !me.monarch;
    const playerUpdates = [];
    if (next) {
      this.players.forEach(player => {
        if (player.monarch) playerUpdates.push({ id: player.id, updates: { monarch: false } });
      });
    }
    playerUpdates.push({ id: this.myPlayerId, updates: { monarch: next } });
    await this._runOptimistic({ playerUpdates, undoLabel: next ? 'Monarch genommen' : 'Monarch abgelegt', recordUndo: false });
  },

  async toggleInitiative() {
    const me = this._me();
    if (!me || this.phase !== 'live') return;
    const next = !me.initiative;
    const playerUpdates = [];
    if (next) {
      this.players.forEach(player => {
        if (player.initiative) playerUpdates.push({ id: player.id, updates: { initiative: false } });
      });
    }
    playerUpdates.push({ id: this.myPlayerId, updates: { initiative: next } });
    await this._runOptimistic({ playerUpdates, undoLabel: next ? 'Initiative genommen' : 'Initiative abgelegt', recordUndo: false });
  },

  toggleCombatLifelink() {
    if (this.phase !== 'live') return;
    this.combatLifelink = !this.combatLifelink;
    this._render();
  },

  openCombatModal(initialTargetId = '') {
    if (this.phase !== 'live') return;
    const targets = this.players.filter(p => p.id !== this.myPlayerId && !p.eliminated);
    if (!targets.length) return;
    const validIds = new Set(targets.map(p => p.id));
    const selected = [];
    if (initialTargetId && validIds.has(initialTargetId)) selected.push(initialTargetId);
    this.combatTargetIds.forEach(id => {
      if (validIds.has(id) && !selected.includes(id)) selected.push(id);
    });
    this.combatModalOpen = true;
    this.combatTargetIds = selected.length ? selected : [targets[0].id];
    this._render();
  },

  closeCombatModal() {
    this.combatModalOpen = false;
    this._render();
  },

  toggleCombatTarget(targetId) {
    if (!this.combatModalOpen) return;
    const next = new Set(this.combatTargetIds);
    if (next.has(targetId)) next.delete(targetId); else next.add(targetId);
    this.combatTargetIds = Array.from(next);
    this._render();
  },

  toggleCountersPanel() {
    this.countersOpen = !this.countersOpen;
    this._render();
  },

  toggleExtraTurn() {
    this.extraTurnQueued = !this.extraTurnQueued;
    this._render();
  },

  adjustMiscCounter(counterKey, delta) {
    const allowed = ['energy', 'experience', 'rad'];
    if (!allowed.includes(counterKey)) return;
    const current = Number(this.miscCounters[counterKey] || 0);
    this.miscCounters[counterKey] = Math.max(0, Math.min(999, current + delta));
    this._render();
  },

  _haptic(action = '') {
    if (!navigator.vibrate) return;
    const strong = ['next-turn', 'finish-game', 'undo'].includes(action);
    navigator.vibrate(strong ? 18 : 8);
  },

  startCombatAdjust(mode, targetId, direction) {
    this.stopCombatAdjust();
    this.combatHoldTriggered = false;
    this.combatHoldTimeout = setTimeout(() => {
      this.combatHoldTriggered = true;
      const step = Number(direction) || 0;
      this._runCombatAdjust(mode, targetId, step);
      this.combatHoldInterval = setInterval(() => {
        this._runCombatAdjust(mode, targetId, step);
      }, 180);
    }, 320);
  },

  stopCombatAdjust(mode = '', targetId = '', direction = 0) {
    if (this.combatHoldTimeout) {
      clearTimeout(this.combatHoldTimeout);
      this.combatHoldTimeout = null;
    }
    if (this.combatHoldInterval) {
      clearInterval(this.combatHoldInterval);
      this.combatHoldInterval = null;
    }
    if (!this.combatHoldTriggered && mode && targetId && direction) {
      this._runCombatAdjust(mode, targetId, direction);
    }
    this.combatHoldTriggered = false;
  },

  _runCombatAdjust(mode, targetId, amount) {
    if (mode === 'commander') return this.dealCommanderDamage(targetId, amount);
    return this.dealCombatDamage(targetId, amount);
  },

  /* â”€â”€ Turn weiterreichen â”€â”€ */
  async nextTurn() {
    if (!this.lobby || this.lobby.active_player_id !== this.myPlayerId) return;
    const alive = this.players.filter(p => !p.eliminated);
    if (!alive.length) return;
    if (this.extraTurnQueued) {
      this.extraTurnQueued = false;
      const newTurn = (this.lobby.turn_number || 1) + 1;
      await this._runOptimistic({
        lobbyUpdates: { active_player_id: this.myPlayerId, turn_number: newTurn },
        undoLabel: 'Extra Turn genommen',
        pulses: [{ id: this.myPlayerId, kind: 'turn' }]
      });
      return;
    }
    const cur = Math.max(0, alive.findIndex(p => p.id === this.myPlayerId));
    const next = alive[(cur + 1) % alive.length];
    const newTurn = (this.lobby.turn_number || 1) + 1;
    await this._runOptimistic({
      lobbyUpdates: { active_player_id: next.id, turn_number: newTurn },
      undoLabel: 'Turn weitergegeben',
      pulses: [{ id: next.id, kind: 'turn' }]
    });
  },

  /* â”€â”€ Spiel beenden â”€â”€ */
  async finishGame(winnerId = '') {
    if (!this._isHost()) return;
    await this.sb.from('mp_lobbies').update({ phase: 'finished', finished_at: new Date().toISOString(), winner_id: winnerId || null }).eq('id', this.lobbyId);
  },

  async rematchSamePlayers() {
    if (!this._isHost()) return;
    await this.startGame();
  },

  async returnToWaitingRoom() {
    if (!this._isHost()) return;
    try {
      await this.sb.from('mp_lobbies').update({
        phase: 'waiting',
        active_player_id: null,
        started_at: null,
        finished_at: null,
        winner_id: null,
        turn_number: 1
      }).eq('id', this.lobbyId);
      await this.sb.from('mp_players').update({
        life: this.START_LIFE,
        poison: 0,
        monarch: false,
        initiative: false,
        eliminated: false,
        cmd_damage: {}
      }).eq('lobby_id', this.lobbyId);
    } catch (err) {
      this._showError('Waiting Room konnte nicht geöffnet werden: ' + (err.message || err));
    }
  },

  async undoLastAction() {
    if (!this.lastUndo) return;
    const undo = this.lastUndo;
    this.lastUndo = null;
    await this._runOptimistic({
      playerUpdates: undo.playerUpdates || [],
      lobbyUpdates: undo.lobbyUpdates || null,
      undoLabel: '',
      recordUndo: false,
      pulses: undo.pulses || []
    });
  },

  /* â”€â”€ Lobby verlassen â”€â”€ */
  async leaveLobby() {
    this._destroySubscription();
    if (this.myPlayerId) { await this.sb.from('mp_players').delete().eq('id', this.myPlayerId); }
    this._resetLobbyState();
    this._render();
  },

  async copyLobbyCode(button) {
    const code = this.lobbyCode || '';
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      const prev = button.textContent;
      button.textContent = 'Kopiert!';
      setTimeout(() => { button.textContent = prev || 'Code kopieren'; }, 1500);
    } catch {
      this._showError('Code konnte nicht kopiert werden.');
    }
  },

  /* â”€â”€ Helpers â”€â”€ */
  _me() { return this.players.find(p => p.id === this.myPlayerId) || null; },
  _isHost() { return this.lobby?.host_session === this.sessionId; },
  _genCode() { return Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6).padEnd(6,'X'); },
  _initials(n) { return String(n||'P').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()||'P'; },
  _lifeClass(l) { if(l<=5)return'critical'; if(l<=10)return'low'; if(l<=20)return'warning'; if(l>=50)return'high'; return''; },
  _sortedPlayers(players = this.players) { return [...players].sort((a, b) => a.seat - b.seat); },
  _clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); },
  _clampLife(life) { return Math.max(-99, Math.min(999, Number(life) || 0)); },
  _normalizeCmdDamage(cmdDamage = {}) {
    const next = {};
    Object.entries(cmdDamage || {}).forEach(([key, value]) => {
      const safe = Math.max(0, Math.min(99, Number(value) || 0));
      if (safe > 0) next[key] = safe;
    });
    return next;
  },
  _buildPlayerUpdate(player, overrides = {}) {
    const nextLife = this._clampLife(overrides.life ?? player.life ?? this.START_LIFE);
    const nextPoison = Math.max(0, Math.min(10, Number(overrides.poison ?? player.poison ?? 0) || 0));
    const nextCmdDamage = this._normalizeCmdDamage(overrides.cmd_damage ?? player.cmd_damage ?? {});
    const maxCmd = Math.max(0, ...Object.values(nextCmdDamage));
    return {
      life: nextLife,
      poison: nextPoison,
      cmd_damage: nextCmdDamage,
      eliminated: nextLife <= 0 || nextPoison >= 10 || maxCmd >= 21
    };
  },
  _applyLocalPlayerUpdate(id, updates) {
    const idx = this.players.findIndex(p => p.id === id);
    if (idx < 0) return;
    this.players[idx] = { ...this.players[idx], ...this._clone(updates) };
    this.players = this._sortedPlayers();
  },
  _applyLocalLobbyUpdate(updates) {
    if (!this.lobby) return;
    this.lobby = { ...this.lobby, ...this._clone(updates) };
  },
  _flashPlayers(pulses = []) {
    if (!pulses.length) return;
    pulses.forEach(({ id, kind }) => {
      if (!id || !kind) return;
      this.uiPulseByPlayerId[id] = kind;
      setTimeout(() => {
        if (this.uiPulseByPlayerId[id] === kind) {
          delete this.uiPulseByPlayerId[id];
          this._render();
        }
      }, kind === 'turn' ? 1200 : 650);
    });
  },
  async _runOptimistic({ playerUpdates = [], lobbyUpdates = null, undoLabel = '', pulses = [], recordUndo = true }) {
    const prevUndoState = this.lastUndo;
    const prevPlayers = playerUpdates.map(({ id, updates }) => {
      const current = this.players.find(p => p.id === id);
      if (!current) return null;
      const prev = {};
      Object.keys(updates || {}).forEach(key => { prev[key] = this._clone(current[key]); });
      return { id, updates: prev };
    }).filter(Boolean);
    const prevLobby = lobbyUpdates ? Object.fromEntries(Object.keys(lobbyUpdates).map(key => [key, this._clone(this.lobby?.[key])])) : null;

    playerUpdates.forEach(({ id, updates }) => this._applyLocalPlayerUpdate(id, updates));
    if (lobbyUpdates) this._applyLocalLobbyUpdate(lobbyUpdates);
    if (recordUndo && (prevPlayers.length || prevLobby)) {
      this.lastUndo = {
        label: undoLabel,
        playerUpdates: prevPlayers,
        lobbyUpdates: prevLobby,
        pulses: prevPlayers.map(p => ({ id: p.id, kind: 'heal' }))
      };
    }
    this.pendingWrites += 1;
    this._flashPlayers(pulses);
    this._render();

    try {
      const jobs = [];
      playerUpdates.forEach(({ id, updates }) => {
        jobs.push(this.sb.from('mp_players').update(updates).eq('id', id));
      });
      if (lobbyUpdates) {
        jobs.push(this.sb.from('mp_lobbies').update(lobbyUpdates).eq('id', this.lobbyId));
      }
      const results = await Promise.all(jobs);
      const failed = results.find(result => result?.error);
      if (failed?.error) throw failed.error;
    } catch (err) {
      prevPlayers.forEach(({ id, updates }) => this._applyLocalPlayerUpdate(id, updates));
      if (prevLobby) this._applyLocalLobbyUpdate(prevLobby);
      this.lastUndo = prevUndoState;
      this._render();
      this._showError(err.message || 'Aktion konnte nicht gespeichert werden.');
    } finally {
      this.pendingWrites = Math.max(0, this.pendingWrites - 1);
      this._render();
      if (this.pendingWrites === 0 && this.lobbyId) {
        const lobbyId = this.lobbyId;
        try {
          const { data, error } = await this.sb.from('mp_players')
            .select('*').eq('lobby_id', lobbyId).order('seat');
          if (!error && Array.isArray(data) && this.lobbyId === lobbyId) {
            this.players = this._sortedPlayers(data);
            MPStats.updatePlayers(this.players);
            this._checkAutoFinish();
            this._render();
          }
        } catch (syncError) {
          console.warn('[MPTracker] Realtime-Abgleich fehlgeschlagen:', syncError);
        }
      }
    }
  },
  _cmdMax(player) {
    const dmg = player.cmd_damage || {};
    return Math.max(0, ...Object.values(dmg));
  },
  _deckMetaByName(name) {
    const deckName = String(name || '').trim().toLowerCase();
    if (!deckName) return null;
    return this.deckOptions.find(deck => deck.name.toLowerCase() === deckName) || null;
  },
  _renderDeckMeta(deckName) {
    const meta = this._deckMetaByName(deckName);
    if (!meta || (!meta.commander && !meta.partner)) return '';
    return `<div class="mp-deck-meta">${meta.commander ? `<span class="mp-deck-commander">${esc(meta.commander)}</span>` : ''}${meta.partner ? `<span class="mp-deck-partner">+ ${esc(meta.partner)}</span>` : ''}</div>`;
  },
  _button(label, action, attrs = {}, className = '') {
    const dataAttrs = Object.entries(attrs)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => ` data-${key}="${esc(value)}"`)
      .join('');
    return `<button class="${className}" data-action="${esc(action)}"${dataAttrs}>${label}</button>`;
  },
  _renderCombatAdjustButton(mode, targetId, amount, className = '') {
    const label = amount > 0 ? `+${amount}` : String(amount);
    return `<button class="mp-cmd-btn mp-cmd-btn-stepper ${className}" data-hold-mode="${esc(mode)}" data-target-id="${esc(targetId)}" data-direction="${amount}">${label}</button>`;
  },
  _renderCombatAdjustButtons(mode, targetId, className = '') {
    return [-10, -5, -2, -1, 1, 2, 5, 10]
      .map(amount => this._renderCombatAdjustButton(mode, targetId, amount, className))
      .join('');
  },
  _showError(msg) {
    this.errorMessage = msg;
    const el = document.getElementById('mp-error');
    if (el) el.style.display = 'block';
    setTimeout(() => {
      if (this.errorMessage === msg) this.errorMessage = '';
      const current = document.getElementById('mp-error');
      if (current) current.style.display = 'none';
    }, 4000);
  },

  /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
     RENDER LAYER
  â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
  _resetLobbyState() {
    this._clearLobbyState();
    this.lobbyId = null;
    this.lobbyCode = null;
    this.myPlayerId = null;
    this.lobby = null;
    this.players = [];
    this.phase = 'menu';
  },

  _checkAutoFinish() {
    if (!this._isHost() || this.lobby?.phase !== 'live') return;
    const alive = this.players.filter(p => !p.eliminated);
    if (alive.length === 1) this.finishGame(alive[0].id);
    else if (alive.length === 0) this.finishGame('');
  },

  _render() {
    const root = document.getElementById('mp-root');
    if (!root) return;
    if (this.gesture) { this.renderDeferred = true; return; }
    if (this.phase !== 'live' && this.phase !== 'local') this.sheet = null;
    let markup = '';
    switch(this.phase) {
      case 'menu':    markup = this._renderMenu(); break;
      case 'creating':markup = this._renderLoading(); break;
      case 'waiting': markup = this._renderWaiting(); break;
      case 'live':    markup = this._renderLive(); break;
      case 'local-setup': markup = this._renderLocalSetup(); break;
      case 'local':   markup = this._renderLocal(); break;
      case 'finished':markup = this._renderFinished(); break;
      default:        markup = this._renderMenu();
    }
    if (markup !== this.lastRenderedMarkup) {
      root.innerHTML = markup;
      this.lastRenderedMarkup = markup;
      if (this.lobbyId && this.myPlayerId) this._persistLobbyState();
    }
    this._afterRender();
  },

  /* â”€â”€ MenÃ¼ â”€â”€ */
  _renderMenu() {
    return `
    <div class="mp-screen mp-menu">
      ${this._renderLogo('mp-logo')}
      <div class="mp-logo-sub">Commander Tracker</div>
      <div id="mp-error" class="mp-error" style="${this.errorMessage ? '' : 'display:none;'}">${esc(this.errorMessage)}</div>
      <div class="mp-menu-card">
        ${this.authUser ? `
        <div class="mp-auth-card">
          <div class="mp-auth-title">Angemeldet</div>
          <div class="mp-auth-name">${esc(this.playerName || this.authUser.email || 'User')}</div>
          <div class="mp-auth-sub">${this.deckOptions.length} Deck${this.deckOptions.length===1?'':'s'} verfuegbar</div>
        </div>` : `
        <label class="mp-label">Dein Name</label>
        <input id="mp-name-input" class="mp-input" type="text" maxlength="24" placeholder="z.B. Felix" autocomplete="off">`}

        <button class="mp-btn mp-btn-gold" data-action="create-lobby">
          <span class="mp-btn-icon">+</span> Lobby erstellen
        </button>

        <div class="mp-divider"><span>oder</span></div>

        <label class="mp-label">Lobby-Code</label>
        <input id="mp-code-input" class="mp-input mp-code-input" type="text" maxlength="6" placeholder="ABC123" autocomplete="off" data-field="code">
        <button class="mp-btn mp-btn-outline" data-action="join-lobby">
          Lobby beitreten
        </button>

        ${this._renderLocalMenu()}
      </div>
    </div>`;
  },

  /* â”€â”€ Loading â”€â”€ */
  _renderLoading() {
    return this._renderSplash('Verbinde mit deinem Pod...');
  },

  _renderSplash(status = 'Lade Commander Tracker...') {
    return `
    <div class="mp-splash" role="status" aria-live="polite">
      <div class="mp-splash-inner">
        <div class="mp-splash-mark" aria-hidden="true">
          <img class="mp-splash-logo" src="/favicon.svg" alt="">
        </div>
        <div class="mp-splash-title">MagicThe<em>Drinkering</em></div>
        <div class="mp-splash-status">${esc(status)}</div>
        <div class="mp-splash-bar" aria-hidden="true"></div>
      </div>
    </div>`;
  },

  _renderLogo(className = 'mp-logo') {
    return `
      <div class="${className}">
        <img class="mp-logo-icon" src="/favicon.svg" alt="MagicTheDrinkering">
      </div>`;
  },

  /* â”€â”€ Wartezimmer â”€â”€ */
  _renderWaiting() {
    const isHost = this._isHost();
    const canStart = isHost && this.players.length >= 2;
    const me = this._me();

    return `
    <div class="mp-screen mp-waiting">
      <div class="mp-waiting-inner">
      <div class="mp-waiting-header">
        <button class="mp-back-btn" data-action="leave-lobby">back</button>
        ${this._renderLogo('mp-logo-sm')}
      </div>
      <div id="mp-error" class="mp-error" style="${this.errorMessage ? '' : 'display:none;'}">${esc(this.errorMessage)}</div>

      <div class="mp-code-display">
        <div class="mp-code-label">Lobby-Code</div>
        <div class="mp-code-big">${esc(this.lobbyCode || '------')}</div>
        <button class="mp-copy-btn" data-action="copy-code">Code kopieren</button>
      </div>

      <div class="mp-waiting-players">
        <div class="mp-section-label">Spieler im Pod (${this.players.length}/${this.MAX_PLAYERS})</div>
        ${this.players.map((p, i) => `
          <div class="mp-player-row ${p.id === this.myPlayerId ? 'is-me' : ''}">
            <div class="mp-player-orb mp-color-${p.color || 'gold'}">${this._initials(p.name)}</div>
            <div class="mp-player-info">
              <strong>${esc(p.name)}</strong>
              ${this._renderDeckMeta(p.deck)}
              <span>${esc(p.deck || 'Kein Deck gewaehlt')}</span>
            </div>
            ${p.session_id === this.lobby?.host_session ? '<div class="mp-host-badge">Host</div>' : ''}
          </div>`).join('')}
        ${this.players.length < 2 ? '<div class="mp-waiting-hint">Warte auf weitere Spieler...</div>' : ''}
      </div>

      <div class="mp-setup-section">
        <div class="mp-section-label">Dein Setup</div>
        <label class="mp-label">Name</label>
        ${this.authUser
          ? `<input class="mp-input is-readonly" type="text" value="${esc(me?.name || this.playerName)}" readonly>`
          : `<input class="mp-input" type="text" value="${esc(me?.name || this.playerName)}" maxlength="24" data-field="name">`
        }
        <label class="mp-label">Deck</label>
        ${this.deckOptions.length
          ? `<select class="mp-input mp-select" data-field="deck-choice">
              <option value="">Deck auswaehlen</option>
              ${this.deckOptions.map(deck=>`<option value="${esc(deck.name)}" ${deck.name===(me?.deck||'')?'selected':''}>${esc(deck.name)}${deck.commander?` - ${esc(deck.commander)}${deck.partner?` + ${esc(deck.partner)}`:''}`:''}</option>`).join('')}
            </select>`
          : `<input class="mp-input" type="text" value="${esc(me?.deck || '')}" maxlength="60" placeholder="Deck-Name" data-field="deck">`
        }
        ${this._renderDeckMeta(me?.deck || '')}
      </div>

      ${isHost ? `
      <div class="mp-host-actions">
        <button class="mp-btn ${canStart ? 'mp-btn-gold' : 'mp-btn-disabled'}" ${canStart ? '' : 'disabled'} data-action="start-game">
          ${canStart ? 'Spiel starten' : `Warte auf Spieler (${this.players.length}/2+)`}
        </button>
      </div>` : `
      <div class="mp-waiting-for-host">Warte auf Host...</div>`}
      </div>
    </div>`;
  },

  _renderCombatTargetRow(player) {
    const isActive = this.lobby?.active_player_id === player.id;
    const myCmdOnTarget = (player.cmd_damage || {})[this.myPlayerId] || 0;
    const cmdClass = myCmdOnTarget >= 21 ? 'danger' : myCmdOnTarget >= 14 ? 'warning' : '';
    const pulse = this.uiPulseByPlayerId[player.id];
    return `
    <article class="mp-combat-card ${player.eliminated ? 'is-out' : ''} ${isActive ? 'is-active' : ''} ${pulse ? `pulse-${pulse}` : ''}">
      <div class="mp-combat-card-head">
        <div class="mp-combat-title-wrap">
          <div class="mp-player-orb mp-color-${player.color || 'gold'}">${this._initials(player.name)}</div>
          <div class="mp-combat-title-copy">
            <div class="mp-combat-name">${esc(player.name)}</div>
            <div class="mp-combat-deck">${esc(player.deck || 'Kein Deck')}</div>
          </div>
        </div>
        <div class="mp-combat-stats">
          <span class="mp-combat-life ${this._lifeClass(player.life)}">${player.life} LP</span>
          <span class="mp-combat-poison ${player.poison > 0 ? 'is-hot' : ''}">${player.poison} Poison</span>
        </div>
      </div>
      <div class="mp-combat-clock">
        <span>Commander von dir</span>
        <strong class="${cmdClass}">${myCmdOnTarget} / 21</strong>
      </div>
      <div class="mp-combat-actions">
        <div class="mp-combat-action-row">
          <span class="mp-utility-label">Combat Damage</span>
          <div class="mp-action-buttons mp-action-buttons-stepper">
            ${this._renderCombatAdjustButtons('combat', player.id)}
          </div>
        </div>
        <div class="mp-combat-action-row">
          <span class="mp-utility-label">Commander Damage</span>
          <div class="mp-action-buttons mp-action-buttons-stepper">
            ${this._renderCombatAdjustButtons('commander', player.id, 'commander')}
          </div>
        </div>
      </div>
      ${player.eliminated ? '<div class="mp-combat-overlay">Ausgeschieden</div>' : ''}
    </article>`;
  },

  _renderCombatModal() {
    const targets = this.players.filter(p => p.id !== this.myPlayerId && !p.eliminated);
    const selectedTargets = targets.filter(p => this.combatTargetIds.includes(p.id));
    return `
    <div class="mp-combat-modal-backdrop" data-action="close-combat">
      <div class="mp-combat-modal">
        <div class="mp-combat-modal-head">
          <div>
            <div class="mp-cmd-title">Combat Overlay</div>
            <div class="mp-combat-modal-sub">Wähle ein oder mehrere Ziele und verteile den Schaden individuell.</div>
          </div>
          <button class="mp-back-btn" data-action="close-combat">Schließen</button>
        </div>

        <div class="mp-combat-target-picker">
          ${targets.map(player => {
            const selected = this.combatTargetIds.includes(player.id);
            return this._button(esc(player.name), 'toggle-combat-target', { 'target-id': player.id }, `mp-combat-target-pill ${selected ? 'is-selected' : ''}`);
          }).join('')}
        </div>

        <div class="mp-combat-modal-body">
          ${selectedTargets.length
            ? selectedTargets.map(player => this._renderCombatTargetRow(player)).join('')
            : '<div class="mp-combat-empty">Wähle mindestens ein Ziel aus.</div>'}
        </div>
      </div>
    </div>`;
  },

  /* â”€â”€ Fertig â”€â”€ */
  _renderFinished() {
    const winner = this.players.find(p => p.id === this.lobby?.winner_id);
    const isHost = this._isHost();
    return `
    <div class="mp-screen mp-finished">
      <div class="mp-finished-inner">
        <div class="mp-finished-crown">WIN</div>
        <div class="mp-finished-title">${winner ? esc(winner.name) + ' gewinnt!' : 'Spiel beendet'}</div>
        <div class="mp-finished-sub">Turn ${this.lobby?.turn_number || '?'} · ${this.players.length} Spieler</div>
        <div class="mp-finished-players">
          ${this.players.map(p => `
            <div class="mp-finished-row ${p.id === this.lobby?.winner_id ? 'winner' : ''}">
              <div class="mp-player-orb mp-color-${p.color || 'gold'}">${this._initials(p.name)}</div>
              <strong>${esc(p.name)}</strong>
              <span>${p.life} LP · ${p.poison} Gift</span>
              ${p.id === this.lobby?.winner_id ? '<span class="mp-winner-badge">Gewinner</span>' : ''}
            </div>`).join('')}
        </div>
        <details class="mp-stats-details">
        <summary class="mp-stats-summary">Spielstatistiken</summary>
        <div id="mp-stats-root"></div>
        </details>
        ${isHost ? `
          <button class="mp-btn mp-btn-gold" data-action="rematch">Neues Spiel starten</button>
          <button class="mp-btn mp-btn-outline" data-action="waiting-room">Zurück in den Waiting Room</button>
        ` : `
          <div class="mp-finished-note">Der Host kann jetzt ein Rematch starten oder alle zurück in den Waiting Room schicken, um die Decks zu wechseln.</div>
        `}
        </div>
     </div>
     `;
  }
};

/* â”€â”€ Start â”€â”€ */
document.addEventListener('DOMContentLoaded', () => MPTracker.init());
