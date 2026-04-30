/* MagicTheDrinkering – Multiplayer Commander Tracker
   Supabase Realtime Lobby System
   ─────────────────────────────────────────────────── */

/* ── Hilfsfunktionen ── */
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

/* ── Supabase Config (gleiche wie bisher) ── */
const SUPABASE_URL = 'https://pwrpvtzocycnemgnsooz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_doroVk7_Pblbapi7z9njyQ_zfVTZOmG';

/* ══════════════════════════════════════════
   MULTIPLAYER TRACKER
══════════════════════════════════════════ */
const MPTracker = {

  /* ── Konstanten ── */
  START_LIFE: 40,
  MAX_PLAYERS: 6,
  SESSION_KEY: 'mtd_mp_session_v1',
  COLORS: ['gold','ice','green','crimson','purple','steel'],

  /* ── State ── */
  sb: null,
  sessionId: null,
  playerName: '',
  lobbyId: null,
  lobbyCode: null,
  myPlayerId: null,
  lobby: null,
  players: [],
  subscription: null,
  phase: 'menu', // menu | creating | waiting | setup | live | finished

  /* ── Init ── */
  async init() {
    this.sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, storage: window.localStorage, storageKey: 'cforge_sb_session', autoRefreshToken: true, detectSessionInUrl: false }
    });
    this.sessionId = this._getOrCreateSession();
    this._render();
  },

  _getOrCreateSession() {
    let s = localStorage.getItem(this.SESSION_KEY);
    if (!s) { s = 'sess-' + Date.now().toString(36) + Math.random().toString(36).slice(2,8); localStorage.setItem(this.SESSION_KEY, s); }
    return s;
  },

  /* ── Lobby erstellen ── */
  async createLobby() {
    const nameInput = document.getElementById('mp-name-input');
    const name = (nameInput?.value || '').trim();
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
      this._render();
    } catch(err) {
      console.error(err);
      this.phase = 'menu';
      this._showError('Lobby konnte nicht erstellt werden: ' + (err.message || err));
      this._render();
    }
  },

  /* ── Lobby beitreten ── */
  async joinLobby() {
    const nameInput = document.getElementById('mp-name-input');
    const codeInput = document.getElementById('mp-code-input');
    const name = (nameInput?.value || '').trim();
    const code = (codeInput?.value || '').trim().toUpperCase();
    if (!name) { this._showError('Bitte gib deinen Namen ein.'); return; }
    if (!code || code.length !== 6) { this._showError('Bitte gib einen gültigen 6-stelligen Code ein.'); return; }
    this.playerName = name;
    this.phase = 'creating';
    this._render();

    try {
      const { data: lobby, error: le } = await this.sb.from('mp_lobbies').select('*').eq('code', code).single();
      if (le || !lobby) throw new Error('Lobby nicht gefunden.');
      if (lobby.phase === 'live') throw new Error('Das Spiel läuft bereits.');
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
      this._render();
    } catch(err) {
      console.error(err);
      this.phase = 'menu';
      this._showError(err.message || 'Beitreten fehlgeschlagen.');
      this._render();
    }
  },

  /* ── Realtime Subscription ── */
  _subscribe() {
    if (this.subscription) { this.sb.removeChannel(this.subscription); }
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
      this.players = this.players.filter(p => p.id !== oldRow.id);
    }
    this._render();
  },

  _handleLobbyChange(payload) {
    if (!payload.new) return;
    this.lobby = payload.new;
    if (this.lobby.phase === 'live' && this.phase !== 'live') { this.phase = 'live'; }
    if (this.lobby.phase === 'finished' && this.phase !== 'finished') { this.phase = 'finished'; }
    this._render();
  },

  /* ── Host: Spiel starten ── */
  async startGame() {
    if (!this._isHost()) return;
    if (this.players.length < 2) { this._showError('Mindestens 2 Spieler benötigt.'); return; }
    const firstPlayer = this.players[0];
    try {
      await this.sb.from('mp_lobbies').update({
        phase: 'live',
        active_player_id: firstPlayer.id,
        started_at: new Date().toISOString(),
        turn_number: 1
      }).eq('id', this.lobbyId);
      await this.sb.from('mp_players').update({ life: this.START_LIFE, poison: 0, monarch: false, initiative: false, eliminated: false }).eq('lobby_id', this.lobbyId);
    } catch(err) { this._showError('Fehler beim Starten: ' + err.message); }
  },

  /* ── Life anpassen ── */
  async adjustLife(delta) {
    const me = this._me();
    if (!me || me.eliminated || this.phase !== 'live') return;
    const newLife = Math.max(-99, Math.min(999, me.life + delta));
    await this.sb.from('mp_players').update({ life: newLife }).eq('id', this.myPlayerId);
  },

  /* ── Commander Damage ── */
  async dealCommanderDamage(targetId, delta) {
    const target = this.players.find(p => p.id === targetId);
    if (!target || target.eliminated || this.phase !== 'live') return;
    const key = 'cmd_from_' + this.myPlayerId.replace(/-/g,'_').slice(-8);
    const cmdDamage = target.cmd_damage || {};
    const current = cmdDamage[this.myPlayerId] || 0;
    const newVal = Math.max(0, Math.min(99, current + delta));
    cmdDamage[this.myPlayerId] = newVal;
    let updates = { cmd_damage: cmdDamage };
    if (newVal >= 21 && !target.eliminated) { updates.eliminated = true; }
    await this.sb.from('mp_players').update(updates).eq('id', targetId);
  },

  /* ── Poison ── */
  async adjustPoison(delta) {
    const me = this._me();
    if (!me || me.eliminated || this.phase !== 'live') return;
    const newPoison = Math.max(0, Math.min(10, me.poison + delta));
    let updates = { poison: newPoison };
    if (newPoison >= 10) updates.eliminated = true;
    await this.sb.from('mp_players').update(updates).eq('id', this.myPlayerId);
  },

  /* ── Setup: Name/Deck ändern ── */
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

  /* ── Toggle Monarch/Initiative ── */
  async toggleMonarch() {
    const me = this._me();
    if (!me || this.phase !== 'live') return;
    const next = !me.monarch;
    if (next) await this.sb.from('mp_players').update({ monarch: false }).eq('lobby_id', this.lobbyId);
    await this.sb.from('mp_players').update({ monarch: next }).eq('id', this.myPlayerId);
  },

  async toggleInitiative() {
    const me = this._me();
    if (!me || this.phase !== 'live') return;
    const next = !me.initiative;
    if (next) await this.sb.from('mp_players').update({ initiative: false }).eq('lobby_id', this.lobbyId);
    await this.sb.from('mp_players').update({ initiative: next }).eq('id', this.myPlayerId);
  },

  /* ── Turn weiterreichen ── */
  async nextTurn() {
    if (!this.lobby || this.lobby.active_player_id !== this.myPlayerId) return;
    const alive = this.players.filter(p => !p.eliminated);
    if (!alive.length) return;
    const cur = Math.max(0, alive.findIndex(p => p.id === this.myPlayerId));
    const next = alive[(cur + 1) % alive.length];
    const newTurn = (this.lobby.turn_number || 1) + 1;
    await this.sb.from('mp_lobbies').update({ active_player_id: next.id, turn_number: newTurn }).eq('id', this.lobbyId);
  },

  /* ── Spiel beenden ── */
  async finishGame(winnerId = '') {
    if (!this._isHost()) return;
    await this.sb.from('mp_lobbies').update({ phase: 'finished', finished_at: new Date().toISOString(), winner_id: winnerId || null }).eq('id', this.lobbyId);
  },

  /* ── Lobby verlassen ── */
  async leaveLobby() {
    if (this.subscription) { this.sb.removeChannel(this.subscription); this.subscription = null; }
    if (this.myPlayerId) { await this.sb.from('mp_players').delete().eq('id', this.myPlayerId); }
    this.lobbyId = null; this.lobbyCode = null; this.myPlayerId = null; this.lobby = null; this.players = []; this.phase = 'menu';
    this._render();
  },

  /* ── Helpers ── */
  _me() { return this.players.find(p => p.id === this.myPlayerId) || null; },
  _isHost() { return this.lobby?.host_session === this.sessionId; },
  _genCode() { return Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6).padEnd(6,'X'); },
  _initials(n) { return String(n||'P').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()||'P'; },
  _lifeClass(l) { if(l<=5)return'critical'; if(l<=10)return'low'; if(l<=20)return'warning'; if(l>=50)return'high'; return''; },
  _cmdMax(player) {
    const dmg = player.cmd_damage || {};
    return Math.max(0, ...Object.values(dmg));
  },
  _showError(msg) {
    const el = document.getElementById('mp-error');
    if (el) { el.textContent = msg; el.style.display = 'block'; setTimeout(() => { el.style.display = 'none'; }, 4000); }
  },

  /* ══════════════════════════════════════════
     RENDER LAYER
  ══════════════════════════════════════════ */
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

  /* ── Menü ── */
  _renderMenu() {
    return `
    <div class="mp-screen mp-menu">
      <div class="mp-logo">MagicThe<em>Drinkering</em></div>
      <div class="mp-logo-sub">Commander Tracker</div>
      <div id="mp-error" class="mp-error" style="display:none;"></div>
      <div class="mp-menu-card">
        <label class="mp-label">Dein Name</label>
        <input id="mp-name-input" class="mp-input" type="text" maxlength="24" placeholder="z.B. Felix" autocomplete="off">

        <button class="mp-btn mp-btn-gold" onclick="MPTracker.createLobby()">
          <span class="mp-btn-icon">⚔</span> Lobby erstellen
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

  /* ── Loading ── */
  _renderLoading() {
    return `<div class="mp-screen mp-center"><div class="mp-spinner"></div><div class="mp-loading-text">Verbinde...</div></div>`;
  },

  /* ── Wartezimmer ── */
  _renderWaiting() {
    const isHost = this._isHost();
    const canStart = isHost && this.players.length >= 2;
    const me = this._me();

    return `
    <div class="mp-screen mp-waiting">
      <div class="mp-waiting-header">
        <button class="mp-back-btn" onclick="MPTracker.leaveLobby()">← Verlassen</button>
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
              <span>${esc(p.deck || 'Kein Deck gewählt')}</span>
            </div>
            ${p.session_id === this.lobby?.host_session ? '<div class="mp-host-badge">Host</div>' : ''}
          </div>`).join('')}
        ${this.players.length < 2 ? '<div class="mp-waiting-hint">Warte auf weitere Spieler…</div>' : ''}
      </div>

      <div class="mp-setup-section">
        <div class="mp-section-label">Dein Setup</div>
        <label class="mp-label">Name</label>
        <input class="mp-input" type="text" value="${esc(me?.name || this.playerName)}" maxlength="24" onchange="MPTracker.updateMyName(this.value)">
        <label class="mp-label">Deck</label>
        <input class="mp-input" type="text" value="${esc(me?.deck || '')}" maxlength="60" placeholder="Deck-Name" onchange="MPTracker.updateMyDeck(this.value)">
      </div>

      ${isHost ? `
      <div class="mp-host-actions">
        <button class="mp-btn ${canStart ? 'mp-btn-gold' : 'mp-btn-disabled'}" ${canStart ? '' : 'disabled'} onclick="MPTracker.startGame()">
          ${canStart ? '⚔ Spiel starten' : `Warte auf Spieler (${this.players.length}/2+)`}
        </button>
      </div>` : `
      <div class="mp-waiting-for-host">Warte auf Host…</div>`}
    </div>`;
  },

  /* ── Live Game ── */
  _renderLive() {
    const me = this._me();
    if (!me) return this._renderLoading();
    const others = this.players.filter(p => p.id !== this.myPlayerId);
    const isMyTurn = this.lobby?.active_player_id === this.myPlayerId;
    const activePlayer = this.players.find(p => p.id === this.lobby?.active_player_id);
    const alive = this.players.filter(p => !p.eliminated);

    return `
    <div class="mp-screen mp-live">

      <!-- Top Bar: andere Spieler -->
      <div class="mp-top-strip">
        <div class="mp-strip-meta">
          <span class="mp-turn-badge ${isMyTurn ? 'active' : ''}">Turn ${this.lobby?.turn_number || 1}</span>
          <span class="mp-active-label">${esc(activePlayer?.name || '?')} ist dran</span>
        </div>
        <div class="mp-other-players">
          ${others.map(p => this._renderOtherCard(p)).join('')}
        </div>
      </div>

      <!-- Meine große Karte -->
      <div class="mp-my-card mp-color-bg-${me.color || 'gold'} ${me.eliminated ? 'is-eliminated' : ''} ${isMyTurn ? 'is-my-turn' : ''}">
        <div class="mp-my-card-inner">

          <!-- Header -->
          <div class="mp-my-header">
            <div class="mp-my-name-row">
              <span class="mp-my-name">${esc(me.name)}</span>
              <span class="mp-my-deck">${esc(me.deck || 'Kein Deck')}</span>
            </div>
            <div class="mp-my-badges">
              ${isMyTurn ? '<button class="mp-badge active-badge" onclick="MPTracker.nextTurn()">Am Zug · Weiter →</button>' : ''}
              ${me.monarch ? '<button class="mp-badge monarch-badge" onclick="MPTracker.toggleMonarch()">Monarch</button>' : ''}
              ${me.initiative ? '<button class="mp-badge initiative-badge" onclick="MPTracker.toggleInitiative()">Initiative</button>' : ''}
              ${me.eliminated ? '<span class="mp-badge out-badge">Ausgeschieden</span>' : ''}
            </div>
          </div>

          <!-- Leben -->
          <div class="mp-life-section">
            <div class="mp-life-number ${this._lifeClass(me.life)}">${me.life}</div>
            <div class="mp-life-label">Lebenspunkte</div>
          </div>

          <!-- Life Controls -->
          <div class="mp-life-controls">
            <button class="mp-lbtn" onclick="MPTracker.adjustLife(-10)">-10</button>
            <button class="mp-lbtn" onclick="MPTracker.adjustLife(-5)">-5</button>
            <button class="mp-lbtn mp-lbtn-big" onclick="MPTracker.adjustLife(-1)">−</button>
            <button class="mp-lbtn mp-lbtn-big mp-lbtn-plus" onclick="MPTracker.adjustLife(1)">+</button>
            <button class="mp-lbtn" onclick="MPTracker.adjustLife(5)">+5</button>
            <button class="mp-lbtn" onclick="MPTracker.adjustLife(10)">+10</button>
          </div>

          <!-- Poison + Status Toggle -->
          <div class="mp-mini-row">
            <div class="mp-poison-ctrl">
              <button class="mp-mini-btn" onclick="MPTracker.adjustPoison(-1)">−</button>
              <div class="mp-poison-display">
                <span class="mp-poison-icon">☠</span>
                <span class="mp-poison-val">${me.poison}</span>
                <span class="mp-poison-max">/10</span>
              </div>
              <button class="mp-mini-btn" onclick="MPTracker.adjustPoison(1)">+</button>
            </div>
            <div class="mp-toggle-btns">
              <button class="mp-toggle-btn ${me.monarch ? 'on' : ''}" onclick="MPTracker.toggleMonarch()">Monarch</button>
              <button class="mp-toggle-btn ${me.initiative ? 'on' : ''}" onclick="MPTracker.toggleInitiative()">Initiative</button>
            </div>
          </div>

          <!-- Commander Damage auf andere austeilen -->
          ${others.length > 0 ? `
          <div class="mp-cmd-section">
            <div class="mp-cmd-title">Commander Damage austeilen</div>
            <div class="mp-cmd-targets">
              ${others.map(t => {
                const myDmgOnTarget = (t.cmd_damage || {})[this.myPlayerId] || 0;
                return `<div class="mp-cmd-target">
                  <div class="mp-cmd-target-name">${esc(t.name)}</div>
                  <div class="mp-cmd-target-controls">
                    <button class="mp-cmd-btn" onclick="MPTracker.dealCommanderDamage('${t.id}',-1)">−</button>
                    <span class="mp-cmd-val ${myDmgOnTarget >= 21 ? 'danger' : myDmgOnTarget >= 14 ? 'warning' : ''}">${myDmgOnTarget}</span>
                    <button class="mp-cmd-btn" onclick="MPTracker.dealCommanderDamage('${t.id}',1)">+</button>
                  </div>
                </div>`;
              }).join('')}
            </div>
          </div>` : ''}

          <!-- Host Aktionen -->
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

    </div>`;
  },

  /* ── Andere Spieler-Karte (klein, oben) ── */
  _renderOtherCard(p) {
    const isActive = this.lobby?.active_player_id === p.id;
    const cmdReceived = this._cmdMax(p);
    return `
    <div class="mp-other-card mp-color-${p.color || 'gold'} ${p.eliminated ? 'is-out' : ''} ${isActive ? 'is-active' : ''}">
      <div class="mp-other-orb">${this._initials(p.name)}</div>
      <div class="mp-other-info">
        <span class="mp-other-name">${esc(p.name)}</span>
        <span class="mp-other-life ${this._lifeClass(p.life)}">${p.life}</span>
        ${p.poison > 0 ? `<span class="mp-other-poison">☠${p.poison}</span>` : ''}
        ${cmdReceived >= 7 ? `<span class="mp-other-cmd ${cmdReceived >= 21 ? 'danger' : cmdReceived >= 14 ? 'warn' : ''}">⚔${cmdReceived}</span>` : ''}
      </div>
      ${p.eliminated ? '<div class="mp-other-out">Out</div>' : ''}
      ${isActive ? '<div class="mp-other-turn">▶</div>' : ''}
    </div>`;
  },

  /* ── Fertig ── */
  _renderFinished() {
    const winner = this.players.find(p => p.id === this.lobby?.winner_id);
    return `
    <div class="mp-screen mp-finished">
      <div class="mp-finished-inner">
        <div class="mp-finished-crown">♛</div>
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
        <button class="mp-btn mp-btn-gold" onclick="MPTracker.leaveLobby()">Zurück zum Menü</button>
      </div>
    </div>`;
  }
};

/* ── Start ── */
document.addEventListener('DOMContentLoaded', () => MPTracker.init());