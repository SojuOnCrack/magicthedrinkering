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
  MAX_PLAYERS: 6,
  SESSION_KEY: 'mtd_mp_session_v1',
  LOBBY_STATE_KEY: 'mtd_mp_lobby_state_v1',
  COLORS: ['gold','ice','green','crimson','purple','steel'],

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
  pendingWrites: 0,
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
      this.phase = 'menu';
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
      playerName: this.playerName
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
      this._persistLobbyState();
      this._render();
      return true;
    } catch (err) {
      console.warn('[MPTracker._restoreLobby]', err);
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
    if (eventType === 'INSERT') {
      if (!this.players.find(p => p.id === newRow.id)) { this.players.push(newRow); this.players.sort((a,b) => a.seat - b.seat); }
    } else if (eventType === 'UPDATE') {
      const idx = this.players.findIndex(p => p.id === newRow.id);
      if (idx >= 0) this.players[idx] = newRow; else this.players.push(newRow);
      this.players.sort((a,b) => a.seat - b.seat);
    } else if (eventType === 'DELETE') {
      if (oldRow?.id === this.myPlayerId) {
        this._showError('Du wurdest aus der Lobby entfernt.');
        this._resetLobbyState();
        this._render();
        return;
      }
      this.players = this.players.filter(p => p.id !== oldRow.id);
    }
    this._checkAutoFinish();
    this._render();
  },

  _handleLobbyChange(payload) {
    if (!payload.new) return;
    this.lobby = payload.new;
    if (this.lobby.phase === 'waiting' && this.phase !== 'waiting') { this.phase = 'waiting'; }
    if (this.lobby.phase === 'live' && this.phase !== 'live') { this.phase = 'live'; }
    if (this.lobby.phase === 'finished' && this.phase !== 'finished') { this.phase = 'finished'; }
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

  /* â”€â”€ Life anpassen â”€â”€ */
  async adjustLife(delta) {
    const me = this._me();
    if (!me || this.phase !== 'live') return;
    const updates = this._buildPlayerUpdate(me, { life: (me.life || 0) + delta });
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

  /* â”€â”€ Turn weiterreichen â”€â”€ */
  async nextTurn() {
    if (!this.lobby || this.lobby.active_player_id !== this.myPlayerId) return;
    const alive = this.players.filter(p => !p.eliminated);
    if (!alive.length) return;
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

  /* â”€â”€ Helpers â”€â”€ */
  _me() { return this.players.find(p => p.id === this.myPlayerId) || null; },
  _isHost() { return this.lobby?.host_session === this.sessionId; },
  _genCode() { return Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6).padEnd(6,'X'); },
  _initials(n) { return String(n||'P').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()||'P'; },
  _lifeClass(l) { if(l<=5)return'critical'; if(l<=10)return'low'; if(l<=20)return'warning'; if(l>=50)return'high'; return''; },
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
    this.players.sort((a, b) => a.seat - b.seat);
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
  _showError(msg) {
    const el = document.getElementById('mp-error');
    if (el) { el.textContent = msg; el.style.display = 'block'; setTimeout(() => { el.style.display = 'none'; }, 4000); }
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
    switch(this.phase) {
      case 'menu':    root.innerHTML = this._renderMenu(); break;
      case 'creating':root.innerHTML = this._renderLoading(); break;
      case 'waiting': root.innerHTML = this._renderWaiting(); break;
      case 'live':    root.innerHTML = this._renderLive(); break;
      case 'finished':root.innerHTML = this._renderFinished(); break;
      default:        root.innerHTML = this._renderMenu();
    }
  },

  /* â”€â”€ MenÃ¼ â”€â”€ */
  _renderMenu() {
    return `
    <div class="mp-screen mp-menu">
      <div class="mp-logo">MagicThe<em>Drinkering</em></div>
      <div class="mp-logo-sub">Commander Tracker</div>
      <div id="mp-error" class="mp-error" style="display:none;"></div>
      <div class="mp-menu-card">
        ${this.authUser ? `
        <div class="mp-auth-card">
          <div class="mp-auth-title">Angemeldet</div>
          <div class="mp-auth-name">${esc(this.playerName || this.authUser.email || 'User')}</div>
          <div class="mp-auth-sub">${this.deckOptions.length} Deck${this.deckOptions.length===1?'':'s'} verfuegbar</div>
        </div>` : `
        <label class="mp-label">Dein Name</label>
        <input id="mp-name-input" class="mp-input" type="text" maxlength="24" placeholder="z.B. Felix" autocomplete="off">`}

        <button class="mp-btn mp-btn-gold" onclick="MPTracker.createLobby()">
          <span class="mp-btn-icon">+</span> Lobby erstellen
        </button>

        <div class="mp-divider"><span>oder</span></div>

        <label class="mp-label">Lobby-Code</label>
        <input id="mp-code-input" class="mp-input mp-code-input" type="text" maxlength="6" placeholder="ABC123" autocomplete="off" oninput="this.value=this.value.toUpperCase().replace(/[^A-Z0-9]/g,'')">
        <button class="mp-btn mp-btn-outline" onclick="MPTracker.joinLobby()">
          Lobby beitreten
        </button>
      </div>
    </div>`;
  },

  /* â”€â”€ Loading â”€â”€ */
  _renderLoading() {
    return `<div class="mp-screen mp-center"><div class="mp-spinner"></div><div class="mp-loading-text">Verbinde...</div></div>`;
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
        <button class="mp-back-btn" onclick="MPTracker.leaveLobby()">Zurueck</button>
        <div class="mp-logo-sm">MagicThe<em>Drinkering</em></div>
      </div>

      <div class="mp-code-display">
        <div class="mp-code-label">Lobby-Code</div>
        <div class="mp-code-big">${esc(this.lobbyCode || '------')}</div>
        <button class="mp-copy-btn" onclick="navigator.clipboard.writeText('${esc(this.lobbyCode || '')}').then(()=>{this.textContent='Kopiert!';setTimeout(()=>this.textContent='Code kopieren',1500)})">Code kopieren</button>
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
          : `<input class="mp-input" type="text" value="${esc(me?.name || this.playerName)}" maxlength="24" onchange="MPTracker.updateMyName(this.value)">`
        }
        <label class="mp-label">Deck</label>
        ${this.deckOptions.length
          ? `<select class="mp-input mp-select" onchange="MPTracker.updateMyDeckChoice(this.value)">
              <option value="">Deck auswaehlen</option>
              ${this.deckOptions.map(deck=>`<option value="${esc(deck.name)}" ${deck.name===(me?.deck||'')?'selected':''}>${esc(deck.name)}${deck.commander?` - ${esc(deck.commander)}${deck.partner?` + ${esc(deck.partner)}`:''}`:''}</option>`).join('')}
            </select>`
          : `<input class="mp-input" type="text" value="${esc(me?.deck || '')}" maxlength="60" placeholder="Deck-Name" onchange="MPTracker.updateMyDeck(this.value)">`
        }
        ${this._renderDeckMeta(me?.deck || '')}
      </div>

      ${isHost ? `
      <div class="mp-host-actions">
        <button class="mp-btn ${canStart ? 'mp-btn-gold' : 'mp-btn-disabled'}" ${canStart ? '' : 'disabled'} onclick="MPTracker.startGame()">
          ${canStart ? 'Spiel starten' : `Warte auf Spieler (${this.players.length}/2+)`}
        </button>
      </div>` : `
      <div class="mp-waiting-for-host">Warte auf Host...</div>`}
      </div>
    </div>`;
  },

  /* â”€â”€ Live Game â”€â”€ */
  _renderLive() {
    const me = this._me();
    if (!me) return this._renderLoading();
    const others = this.players.filter(p => p.id !== this.myPlayerId);
    const isMyTurn = this.lobby?.active_player_id === this.myPlayerId;
    const activePlayer = this.players.find(p => p.id === this.lobby?.active_player_id);
    const alive = this.players.filter(p => !p.eliminated);
    const myPulse = this.uiPulseByPlayerId[this.myPlayerId];

    return `
    <div class="mp-screen mp-live">
      <div class="mp-top-strip">
        <div class="mp-strip-meta">
          <span class="mp-turn-badge ${isMyTurn ? 'active' : ''}">Turn ${this.lobby?.turn_number || 1}</span>
          <span class="mp-active-label">${esc(activePlayer?.name || '?')} ist dran</span>
          <span class="mp-top-chip">${alive.length} alive</span>
          <span class="mp-top-chip ${this.pendingWrites ? 'is-syncing' : ''}">${this.pendingWrites ? 'Syncing…' : 'Live Sync'}</span>
          ${this.lastUndo ? `<button class="mp-undo-btn" onclick="MPTracker.undoLastAction()">Undo${this.lastUndo.label ? ` · ${esc(this.lastUndo.label)}` : ''}</button>` : ''}
          ${isMyTurn ? '<button class="mp-pass-btn" onclick="MPTracker.nextTurn()">Turn abgeben</button>' : ''}
        </div>
        <div class="mp-other-players">
          ${others.map(p => this._renderOtherCard(p)).join('')}
        </div>
      </div>

      <div class="mp-my-card mp-color-bg-${me.color || 'gold'} ${me.eliminated ? 'is-eliminated' : ''} ${isMyTurn ? 'is-my-turn' : ''} ${myPulse ? `pulse-${myPulse}` : ''}">
        <div class="mp-my-card-inner">
          <div class="mp-my-header">
            <div class="mp-my-name-row">
              <span class="mp-my-name">${esc(me.name)}</span>
              <span class="mp-my-deck">${esc(me.deck || 'Kein Deck')}</span>
              ${this._renderDeckMeta(me.deck)}
            </div>
            <div class="mp-my-badges">
              ${isMyTurn ? '<span class="mp-badge active-badge">Am Zug</span>' : ''}
              ${me.monarch ? '<button class="mp-badge monarch-badge" onclick="MPTracker.toggleMonarch()">Monarch</button>' : ''}
              ${me.initiative ? '<button class="mp-badge initiative-badge" onclick="MPTracker.toggleInitiative()">Initiative</button>' : ''}
              ${me.eliminated ? '<span class="mp-badge out-badge">Ausgeschieden</span>' : ''}
            </div>
          </div>

          <div class="mp-live-grid">
            <section class="mp-surface mp-life-surface">
              <div class="mp-life-section">
                <div class="mp-life-number ${this._lifeClass(me.life)}">${me.life}</div>
                <div class="mp-life-label">Lebenspunkte</div>
              </div>

              <div class="mp-life-control-groups">
                <div class="mp-control-group">
                  <div class="mp-cmd-title">Damage</div>
                  <div class="mp-life-controls">
                    <button class="mp-lbtn" onclick="MPTracker.adjustLife(-1)">-1</button>
                    <button class="mp-lbtn" onclick="MPTracker.adjustLife(-3)">-3</button>
                    <button class="mp-lbtn" onclick="MPTracker.adjustLife(-5)">-5</button>
                    <button class="mp-lbtn" onclick="MPTracker.adjustLife(-10)">-10</button>
                  </div>
                </div>
                <div class="mp-control-group">
                  <div class="mp-cmd-title">Heal / Lifegain</div>
                  <div class="mp-life-controls mp-life-controls-heal">
                    <button class="mp-lbtn mp-lbtn-plus" onclick="MPTracker.adjustLife(1)">+1</button>
                    <button class="mp-lbtn mp-lbtn-plus" onclick="MPTracker.adjustLife(3)">+3</button>
                    <button class="mp-lbtn mp-lbtn-plus" onclick="MPTracker.adjustLife(5)">+5</button>
                    <button class="mp-lbtn mp-lbtn-plus" onclick="MPTracker.adjustLife(10)">+10</button>
                  </div>
                </div>
              </div>
            </section>

            <section class="mp-surface mp-utility-surface">
              <div class="mp-cmd-title">Status & Basics</div>
              <div class="mp-utility-grid">
                <div class="mp-poison-card">
                  <span class="mp-utility-label">Poison</span>
                  <div class="mp-poison-ctrl">
                    <button class="mp-mini-btn" onclick="MPTracker.adjustPoison(-1)">−</button>
                    <div class="mp-poison-display">
                      <span class="mp-poison-icon">☠</span>
                      <span class="mp-poison-val">${me.poison}</span>
                      <span class="mp-poison-max">/10</span>
                    </div>
                    <button class="mp-mini-btn" onclick="MPTracker.adjustPoison(1)">+</button>
                  </div>
                </div>
                <div class="mp-toggle-stack">
                  <button class="mp-toggle-btn ${me.monarch ? 'on' : ''}" onclick="MPTracker.toggleMonarch()">Monarch</button>
                  <button class="mp-toggle-btn ${me.initiative ? 'on' : ''}" onclick="MPTracker.toggleInitiative()">Initiative</button>
                  <button class="mp-toggle-btn ${this.combatLifelink ? 'on lifelink' : ''}" onclick="MPTracker.toggleCombatLifelink()">Lifelink</button>
                </div>
              </div>
              <div class="mp-rules-hint">Commander Damage zieht direkt Leben ab. Mit aktivem Lifelink heilst du dich um denselben Schaden.</div>
            </section>
          </div>

          ${others.length > 0 ? `
          <section class="mp-surface mp-arena-surface mp-arena-launcher">
            <div>
              <div class="mp-cmd-title">Combat</div>
              <div class="mp-rules-hint">Tippe oben auf einen Gegner, um das Combat-Overlay zu öffnen und Schaden auf mehrere Ziele zu verteilen.</div>
            </div>
            <button class="mp-btn mp-btn-outline mp-combat-open-btn" onclick="MPTracker.openCombatModal()">Combat öffnen</button>
          </section>` : ''}

          ${this._isHost() && alive.length <= 2 ? `
          <div class="mp-finish-section">
            <div class="mp-cmd-title">Spiel beenden</div>
            <div class="mp-finish-btns">
              ${alive.map(p => `<button class="mp-finish-btn" onclick="MPTracker.finishGame('${p.id}')">${esc(p.name)} gewinnt</button>`).join('')}
              <button class="mp-finish-btn ghost" onclick="MPTracker.finishGame('')">Kein Gewinner</button>
            </div>
          </div>` : ''}

        </div>
      </div>

      ${this.combatModalOpen ? this._renderCombatModal() : ''}

    </div>`;
  },

  /* Other player cards */
  _renderOtherCard(p) {
    const isActive = this.lobby?.active_player_id === p.id;
    const cmdReceived = this._cmdMax(p);
    const pulse = this.uiPulseByPlayerId[p.id];
    return `
    <button class="mp-other-card mp-color-${p.color || 'gold'} ${p.eliminated ? 'is-out' : ''} ${isActive ? 'is-active' : ''} ${pulse ? `pulse-${pulse}` : ''}" ${p.eliminated ? 'disabled' : ''} onclick="MPTracker.openCombatModal('${p.id}')">
      <div class="mp-other-orb">${this._initials(p.name)}</div>
      <div class="mp-other-info">
        <span class="mp-other-name">${esc(p.name)}</span>
        <span class="mp-other-life ${this._lifeClass(p.life)}">${p.life}</span>
        ${p.poison > 0 ? `<span class="mp-other-poison">P ${p.poison}</span>` : ''}
        ${cmdReceived >= 7 ? `<span class="mp-other-cmd ${cmdReceived >= 21 ? 'danger' : cmdReceived >= 14 ? 'warn' : ''}">CMD ${cmdReceived}</span>` : ''}
      </div>
      ${isActive ? '<span class="mp-other-active-pill">Active</span>' : ''}
      ${p.eliminated ? '<div class="mp-other-out">Out</div>' : ''}
      ${isActive ? '<div class="mp-other-turn">TURN</div>' : ''}
    </button>`;
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
          <div class="mp-action-buttons">
            <button class="mp-cmd-btn" onclick="MPTracker.dealCombatDamage('${player.id}',-1)">-1</button>
            <button class="mp-cmd-btn" onclick="MPTracker.dealCombatDamage('${player.id}',1)">1</button>
            <button class="mp-cmd-btn" onclick="MPTracker.dealCombatDamage('${player.id}',3)">3</button>
            <button class="mp-cmd-btn" onclick="MPTracker.dealCombatDamage('${player.id}',5)">5</button>
          </div>
        </div>
        <div class="mp-combat-action-row">
          <span class="mp-utility-label">Commander Damage</span>
          <div class="mp-action-buttons">
            <button class="mp-cmd-btn" onclick="MPTracker.dealCommanderDamage('${player.id}',-1)">-1</button>
            <button class="mp-cmd-btn commander" onclick="MPTracker.dealCommanderDamage('${player.id}',1)">1</button>
            <button class="mp-cmd-btn commander" onclick="MPTracker.dealCommanderDamage('${player.id}',3)">3</button>
            <button class="mp-cmd-btn commander" onclick="MPTracker.dealCommanderDamage('${player.id}',5)">5</button>
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
    <div class="mp-combat-modal-backdrop" onclick="MPTracker.closeCombatModal()">
      <div class="mp-combat-modal" onclick="event.stopPropagation()">
        <div class="mp-combat-modal-head">
          <div>
            <div class="mp-cmd-title">Combat Overlay</div>
            <div class="mp-combat-modal-sub">Wähle ein oder mehrere Ziele und verteile den Schaden individuell.</div>
          </div>
          <button class="mp-back-btn" onclick="MPTracker.closeCombatModal()">Schließen</button>
        </div>

        <div class="mp-combat-target-picker">
          ${targets.map(player => {
            const selected = this.combatTargetIds.includes(player.id);
            return `<button class="mp-combat-target-pill ${selected ? 'is-selected' : ''}" onclick="MPTracker.toggleCombatTarget('${player.id}')">${esc(player.name)}</button>`;
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
        <div class="mp-finished-sub">Turn ${this.lobby?.turn_number || '?'} Â· ${this.players.length} Spieler</div>
        <div class="mp-finished-players">
          ${this.players.map(p => `
            <div class="mp-finished-row ${p.id === this.lobby?.winner_id ? 'winner' : ''}">
              <div class="mp-player-orb mp-color-${p.color || 'gold'}">${this._initials(p.name)}</div>
              <strong>${esc(p.name)}</strong>
              <span>${p.life} LP Â· ${p.poison} Gift</span>
              ${p.id === this.lobby?.winner_id ? '<span class="mp-winner-badge">Gewinner</span>' : ''}
            </div>`).join('')}
        </div>
        ${isHost ? `
        <div class="mp-finished-actions">
          <button class="mp-btn mp-btn-gold" onclick="MPTracker.rematchSamePlayers()">Neues Spiel, gleiches Pod</button>
          <button class="mp-btn mp-btn-outline" onclick="MPTracker.returnToWaitingRoom()">Zurück in den Waiting Room</button>
        </div>` : `
        <div class="mp-finished-note">Der Host kann jetzt ein Rematch starten oder den Waiting Room für neue Decks öffnen.</div>`}
        <button class="mp-btn mp-btn-gold" onclick="MPTracker.leaveLobby()">Zurueck zum Menue</button>
      </div>
    </div>`;
  }
};

/* â”€â”€ Start â”€â”€ */
document.addEventListener('DOMContentLoaded', () => MPTracker.init());

