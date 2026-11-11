/* MagicTheDrinkering – tracker-live.js
   LifeTap-Stil: Vollbild-Live-Screen (online) + lokaler Ein-Geraete-Modus.
   Erweitert MPTracker aus tracker.js und muss danach geladen werden.
   ─────────────────────────────────────────────────────────────── */
(() => {
'use strict';

const T = MPTracker;
const LOCAL_KEY = 'mtd_local_game_v1';
const MINUS = '−';
const HOLD_MS = 420;       // ab hier gilt ein Druck als "halten"
const HOLD_STEP = 5;       // Schrittweite beim Halten
const HOLD_EVERY = 220;    // Wiederholung beim Halten (ms)
const FLUSH_MS = 900;      // Online: Tap-Serie gebuendelt speichern
const MAX_LOCAL = 6;

const COLOR_HEX = {
  gold: '#c9a84c', ice: '#5fb4dc', green: '#5fae5f', crimson: '#cf5a5a', purple: '#9a74d6',
  steel: '#8c97a8', orange: '#e08a3c', teal: '#3fb5a6', pink: '#d9739f', brown: '#a07650'
};
const hexOf = c => COLOR_HEX[c] || COLOR_HEX.gold;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sgn = d => (d > 0 ? '+' : MINUS) + Math.abs(d);
const rnd = n => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
const attrs = o => Object.entries(o)
  .filter(([, v]) => v !== undefined && v !== null)
  .map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');

Object.assign(T, {
  pendingLife: 0, flushTimer: null,
  pendingCmdDamage: {}, cmdFlushTimer: null,
  gesture: null, renderDeferred: false,
  burst: {},
  sheet: null, toolResult: null,
  local: null, localSetup: { count: 4, life: 40 },
  wakeLock: null
});

/* ═══════════════ Einbindung in bestehende Methoden ═══════════════ */

const origBind = T._bindLifecycle;
T._bindLifecycle = function () {
  origBind.call(this);
  this._bindLiveGestures();
};

const origClick = T._handleRootClick;
T._handleRootClick = function (event) {
  const el = event.target.closest('[data-action]');
  if (el && this._liveClick(el, event)) { this._haptic(el.dataset.action); return; }
  return origClick.call(this, event);
};

T._bindLiveGestures = function () {
  const root = document.getElementById('mp-root');
  if (!root || root.dataset.ltBound === '1') return;
  root.dataset.ltBound = '1';
  root.addEventListener('pointerdown', e => this._ltDown(e));
  root.addEventListener('pointerup', e => this._ltUp(e, false));
  root.addEventListener('pointercancel', e => this._ltUp(e, true));
  root.addEventListener('contextmenu', e => { if (e.target.closest('.lt-live, .lt-local')) e.preventDefault(); });
  root.addEventListener('change', e => this._liveChange(e));
  root.addEventListener('input', e => this._liveInput(e));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { this._ltFlush(); this._flushCmdReceived(); }
    else this._afterRender();
  });
  window.addEventListener('pagehide', () => { this._ltFlush(); this._flushCmdReceived(); });
};

T._afterRender = function () {
  const live = this.phase === 'live' || this.phase === 'local';
  document.body.classList.toggle('lt-fixed', live);
  this._ltWake(live);
};

T._ltWake = async function (on) {
  try {
    if (on) {
      if (!this.wakeLock && navigator.wakeLock && !document.hidden) {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => { this.wakeLock = null; });
      }
    } else if (this.wakeLock) {
      const lock = this.wakeLock; this.wakeLock = null;
      await lock.release();
    }
  } catch { /* Wake Lock optional */ }
};

/* ═══════════════ Gesten: Tippen = ±1, Halten = ±5 ═══════════════ */

T._ltDown = function (e) {
  const zone = e.target.closest('[data-zone]');
  if (!zone || !e.isPrimary || e.button > 0) return;
  this._ltCancelGesture();
  const owner = zone.dataset.owner;
  const dir = zone.dataset.zone.endsWith('plus') ? 1 : -1;
  const g = { owner, dir, held: false, el: zone, timer: null, interval: null };
  g.timer = setTimeout(() => {
    g.held = true;
    this._ltStep(owner, dir * HOLD_STEP);
    g.interval = setInterval(() => this._ltStep(owner, dir * HOLD_STEP), HOLD_EVERY);
  }, HOLD_MS);
  this.gesture = g;
  zone.classList.add('is-down');
  try { zone.setPointerCapture(e.pointerId); } catch { /* ignore */ }
};

T._ltCancelGesture = function () {
  const g = this.gesture;
  if (!g) return;
  clearTimeout(g.timer); clearInterval(g.interval);
  g.el.classList.remove('is-down');
  this.gesture = null;
};

T._ltUp = function (e, cancelled) {
  const g = this.gesture;
  if (!g) return;
  const wasHeld = g.held;
  this._ltCancelGesture();
  if (!cancelled && !wasHeld) this._ltStep(g.owner, g.dir);
  if (this.renderDeferred) { this.renderDeferred = false; this._render(); }
};

T._ltStep = function (owner, delta) {
  if (navigator.vibrate) navigator.vibrate(Math.abs(delta) > 1 ? 14 : 6);
  if (this.phase === 'local') return this._ltStepLocal(owner, delta);
  if (this.phase !== 'live' || !this._me()) return;
  if (owner !== 'me') return this.adjustCmdReceived(owner, delta);
  this.pendingLife += delta;
  clearTimeout(this.flushTimer);
  this.flushTimer = setTimeout(() => this._ltFlush(), FLUSH_MS);
  this._ltPaint('me');
};

/* Zahl + Delta-Bubble direkt im DOM aktualisieren (kein Re-Render waehrend des Drueckens) */
T._ltPaint = function (owner) {
  let life, delta;
  if (this.phase === 'local') {
    const p = this.local?.players.find(x => x.id === owner);
    if (!p) return;
    life = p.life; delta = this.burst[owner]?.delta || 0;
  } else {
    const me = this._me();
    if (!me) return;
    life = (me.life || 0) + this.pendingLife; delta = this.pendingLife;
  }
  const sel = k => document.querySelector(`[data-${k}="${CSS.escape(owner)}"]`);
  const lifeEl = sel('life');
  if (lifeEl) { lifeEl.textContent = life; lifeEl.className = 'lt-life ' + this._lifeClass(life); }
  const bub = sel('bubble');
  if (bub) {
    bub.textContent = delta ? sgn(delta) : '';
    bub.classList.toggle('show', !!delta);
    bub.classList.toggle('neg', delta < 0);
  }
  const panel = lifeEl?.closest('.lt-panel, .lt-me');
  if (panel) {
    const out = this.phase === 'local'
      ? this._localOut(this.local.players.find(x => x.id === owner))
      : life <= 0 || !!this._me()?.eliminated;
    panel.classList.toggle('is-out', out);
  }
};

T._ltFlush = async function () {
  clearTimeout(this.flushTimer);
  const d = this.pendingLife;
  this.pendingLife = 0;
  if (!d) return;
  if (this.phase !== 'live') return;
  await this.adjustLife(d);
};

/* ═══════════════ Online: Live-Screen ═══════════════ */

T._renderLive = function () {
  const me = this._me();
  if (!me) return this._renderLoading();
  const others = this.players.filter(p => p.id !== this.myPlayerId);
  const isMyTurn = this.lobby?.active_player_id === this.myPlayerId;
  const active = this.players.find(p => p.id === this.lobby?.active_player_id);
  const alive = this.players.filter(p => !p.eliminated);
  const pulse = this.uiPulseByPlayerId[this.myPlayerId];
  const pending = this.pendingLife;
  const pendingCmdLife = Object.values(this.pendingCmdDamage).reduce((sum, value) => sum + value, 0);
  const shown = (me.life || 0) + pending - pendingCmdLife;
  const cmdMax = this._cmdMax(me);
  const hasTargets = others.some(p => !p.eliminated);
  const syncing = this.pendingWrites > 0 || pending !== 0 || Object.keys(this.pendingCmdDamage).length > 0;

  const chips = [];
  if (me.poison > 0) chips.push(`<button class="lt-chip-btn is-bad" data-action="open-sheet" data-sheet="counters">☠ ${me.poison}/10</button>`);
  if (cmdMax > 0) chips.push(`<button class="lt-chip-btn ${cmdMax >= 14 ? 'is-bad' : ''}" data-action="open-sheet" data-sheet="counters">⚔ ${cmdMax}/21</button>`);
  if (me.monarch) chips.push('<span class="lt-chip-btn is-gold">♛ Monarch</span>');
  if (me.initiative) chips.push('<span class="lt-chip-btn is-gold">✦ Initiative</span>');

  return `
  <section class="lt-live" style="--pc:${hexOf(me.color)}">
    <header class="lt-top">
      <div class="lt-turn ${isMyTurn ? 'is-me' : ''}">
        <b>Zug ${this.lobby?.turn_number || 1}</b>
        <span>${isMyTurn ? '' : `${esc(active?.name || '?')} ist dran · `}${alive.length} im Spiel</span>
      </div>
      <div class="lt-top-right">
        <span class="lt-sync ${syncing ? 'is-syncing' : ''}">${syncing ? 'Sync…' : 'Live'}</span>
        ${this.lastUndo ? `<button class="lt-top-btn" data-action="undo" aria-label="Rückgängig">↶ ${esc(this.lastUndo.label || 'Undo')}</button>` : ''}
      </div>
    </header>

    <div id="mp-error" class="mp-error lt-error" style="${this.errorMessage ? '' : 'display:none;'}">${esc(this.errorMessage)}</div>

    <div class="lt-opps">
      ${others.map(p => this._renderOpp(p)).join('')}
    </div>

    <main class="lt-me ${me.eliminated ? 'is-out' : ''} ${isMyTurn ? 'is-turn' : ''} ${pulse ? `pulse-${pulse}` : ''}">
      <div class="lt-zone lt-zone-minus" data-zone="minus" data-owner="me" aria-label="Leben verringern"><span>${MINUS}</span></div>
      <div class="lt-zone lt-zone-plus" data-zone="plus" data-owner="me" aria-label="Leben erhöhen"><span>+</span></div>
      <div class="lt-center">
        <div class="lt-head">
          <span class="lt-name">${esc(me.name)}</span>
          <span class="lt-deck">${esc(me.deck || 'Kein Deck')}</span>
        </div>
        <div class="lt-life-wrap">
          <div class="lt-bubble ${pending ? 'show' : ''} ${pending < 0 ? 'neg' : ''}" data-bubble="me">${pending ? sgn(pending) : ''}</div>
          <div class="lt-life ${this._lifeClass(shown)}" data-life="me">${shown}</div>
        </div>
        <div class="lt-chips">${chips.join('')}</div>
      </div>
      <div class="lt-out"><span>Ausgeschieden</span></div>
    </main>

    <div class="lt-cmd-dock">
      <div class="lt-cmd-dock-label">COMMANDER-SCHADEN</div>
      <div class="lt-cmd-dock-list">
        ${others.filter(p => !p.eliminated).map(p => {
          const value = clamp((me.cmd_damage || {})[p.id] || 0, 0, 99) + (this.pendingCmdDamage[p.id] || 0);
          return `<button class="lt-cmd-dock-card" data-action="cmd-select" data-pid="${esc(p.id)}">
            <span>${esc(p.name)}</span><strong>${value}<small>/21</small></strong>
          </button>`;
        }).join('') || '<div class="lt-muted">Keine aktiven Gegner</div>'}
      </div>
    </div>
    ${isMyTurn ? '<button class="lt-pass" data-action="next-turn">Zug abgeben →</button>' : ''}

    <nav class="lt-dock" aria-label="Aktionen">
      ${hasTargets ? this._ltDockBtn('⚔', 'Combat', 'open-combat') : ''}
      ${this._ltDockBtn('◈', 'Counter', 'open-sheet', { sheet: 'counters' })}
      ${this._ltDockBtn('♛', 'Monarch', 'toggle-monarch', {}, me.monarch)}
      ${this._ltDockBtn('✦', 'Initiative', 'toggle-initiative', {}, me.initiative)}
      ${this._ltDockBtn('⚄', 'Würfel', 'open-sheet', { sheet: 'tools' })}
    </nav>

    ${this._renderSheet()}
    ${this.combatModalOpen ? this._renderCombatModal() : ''}
  </section>`;
};

T._ltDockBtn = function (glyph, label, action, a = {}, on = false) {
  return `<button class="lt-dock-btn ${on ? 'on' : ''}" data-action="${esc(action)}"${attrs(a)}><span class="lt-dock-glyph">${glyph}</span><span>${label}</span></button>`;
};

T._renderOpp = function (p) {
  const isActive = this.lobby?.active_player_id === p.id;
  const cmd = this._cmdMax(p);
  const pulse = this.uiPulseByPlayerId[p.id];
  const meta = [];
  if (p.poison > 0) meta.push(`☠${p.poison}`);
  if (cmd >= 7) meta.push(`⚔${cmd}`);
  if (p.monarch) meta.push('♛');
  if (p.initiative) meta.push('✦');
  return `
  <button class="lt-opp ${p.eliminated ? 'is-out' : ''} ${isActive ? 'is-active' : ''} ${pulse ? `pulse-${pulse}` : ''}" style="--pc:${hexOf(p.color)}" ${p.eliminated ? 'disabled' : ''} data-action="open-combat" data-target-id="${esc(p.id)}">
    <span class="lt-opp-name">${esc(p.name)}</span>
    <span class="lt-opp-life ${this._lifeClass(p.life)}">${p.life}</span>
    <span class="lt-opp-meta">${p.eliminated ? 'Out' : esc(meta.join(' '))}</span>
  </button>`;
};

/* Commander-Schaden auf der Empfaengerseite (wie bei LifeTap): zieht auch Leben ab */
T.adjustCmdReceived = function (fromId, delta) {
  const me = this._me();
  if (!me || this.phase !== 'live' || !fromId) return;
  const current = (me.cmd_damage || {})[fromId] || 0;
  const pending = this.pendingCmdDamage[fromId] || 0;
  const next = clamp(current + pending + (Number(delta) || 0), 0, 99);
  const applied = next - current - pending;
  if (!applied) return;
  this.pendingCmdDamage[fromId] = pending + applied;
  if (!this.pendingCmdDamage[fromId]) delete this.pendingCmdDamage[fromId];
  if (applied > 0) {
    MPStats.logEvent('commander_damage', {
      actorId: fromId, targetId: this.myPlayerId, amount: applied, turn: this.lobby?.turn_number || 1
    });
  }
  clearTimeout(this.cmdFlushTimer);
  this.cmdFlushTimer = setTimeout(() => this._flushCmdReceived(), 350);
  this._render();
};

T._flushCmdReceived = async function () {
  clearTimeout(this.cmdFlushTimer);
  this.cmdFlushTimer = null;
  if (this.phase !== 'live') { this.pendingCmdDamage = {}; return; }
  await this._ltFlush();
  const deltas = this.pendingCmdDamage;
  this.pendingCmdDamage = {};
  const me = this._me();
  if (!me || !Object.keys(deltas).length) return;
  const cmd = { ...(me.cmd_damage || {}) };
  let total = 0;
  Object.entries(deltas).forEach(([fromId, delta]) => {
    const next = clamp((cmd[fromId] || 0) + delta, 0, 99);
    total += next - (cmd[fromId] || 0);
    if (next > 0) cmd[fromId] = next; else delete cmd[fromId];
  });
  if (!total) return;
  const updates = this._buildPlayerUpdate(me, {
    life: (me.life || 0) - total,
    cmd_damage: cmd
  });
  await this._runOptimistic({
    playerUpdates: [{ id: this.myPlayerId, updates }],
    undoLabel: `Commander ${total > 0 ? '+' : ''}${total}`,
    pulses: [{ id: this.myPlayerId, kind: total > 0 ? 'damage' : 'heal' }]
  });
};

/* ═══════════════ Sheets (Counter, Werkzeuge, lokales Menue) ═══════════════ */

T._ctl = function (label, value, a, sub = '') {
  return `
  <div class="lt-ctl">
    <div class="lt-ctl-label">${label}${sub ? `<small>${sub}</small>` : ''}</div>
    <div class="lt-ctl-btns">
      <button class="lt-round"${attrs(a)} data-delta="-1" aria-label="weniger">${MINUS}</button>
      <span class="lt-ctl-val">${value}</span>
      <button class="lt-round"${attrs(a)} data-delta="1" aria-label="mehr">+</button>
    </div>
  </div>`;
};

T._ltToggle = function (label, action, on, a = {}) {
  return `<button class="lt-toggle ${on ? 'on' : ''}" data-action="${esc(action)}"${attrs(a)}>${label}</button>`;
};

T._renderSheet = function () {
  const s = this.sheet;
  if (!s) return '';
  let title = '', body = '', top = false;
  if (s.type === 'counters') { title = 'Counter'; body = this._sheetCounters(); }
  else if (s.type === 'commander') { title = 'Commander-Schaden'; body = this._sheetCommanderDamage(); }
  else if (s.type === 'commanderTarget') { title = s.pid ? (this.players.find(p => p.id === s.pid)?.name || 'Gegner') : 'Commander-Schaden'; body = this._sheetCommanderTarget(s.pid); top = true; }
  else if (s.type === 'tools') { title = 'Würfel & Werkzeuge'; body = this._sheetTools(); }
  else if (s.type === 'lmenu') { title = 'Spiel'; body = this._sheetLocalMenu(); }
  else if (s.type === 'lplayer') {
    const idx = this.local?.players.findIndex(p => p.id === s.pid) ?? -1;
    const p = this.local?.players[idx];
    if (!p) return '';
    title = p.name; body = this._sheetLocalPlayer(p);
    top = idx < Math.ceil(this.local.players.length / 2);
  } else return '';
  return `
  <div class="lt-sheet-backdrop ${top ? 'is-top' : ''}" data-action="close-sheet">
    <div class="lt-sheet ${top ? 'is-flipped' : ''}" role="dialog" aria-label="${esc(title)}">
      <div class="lt-sheet-head"><strong>${esc(title)}</strong><button class="lt-x" data-action="close-sheet" aria-label="Schließen">✕</button></div>
      <div class="lt-sheet-body">${body}</div>
    </div>
  </div>`;
};

T._sheetCommanderDamage = function () {
  return this._sheetCommanderTarget(this.players.find(p => p.id !== this.myPlayerId && !p.eliminated)?.id);
};

T._sheetCommanderTarget = function (playerId) {
  const me = this._me();
  const player = this.players.find(p => p.id === playerId && p.id !== this.myPlayerId);
  if (!me || !player) return '<div class="lt-muted">Gegner nicht verfügbar.</div>';
  const value = clamp((me.cmd_damage || {})[player.id] || 0, 0, 99) + (this.pendingCmdDamage[player.id] || 0);
  return `
    <div class="lt-cmd-expanded">
      <div class="lt-cmd-expanded-name">${esc(player.name)}</div>
      <div class="lt-cmd-expanded-value">${value}<small>/21 Commander-Schaden</small></div>
      <div class="lt-cmd-expanded-controls">
        <div class="lt-zone lt-zone-minus lt-cmd-zone" data-zone="cmd-minus" data-owner="${esc(player.id)}" aria-label="Commander-Schaden verringern"><span>−</span></div>
        <div class="lt-zone lt-zone-plus lt-cmd-zone" data-zone="cmd-plus" data-owner="${esc(player.id)}" aria-label="Commander-Schaden erhöhen"><span>+</span></div>
        <div class="lt-cmd-expanded-hint">Antippen = 1 · Gedrückt halten = 5</div>
      </div>
    </div>
    <div class="lt-cmd-switch">
      ${this.players.filter(p => p.id !== this.myPlayerId && !p.eliminated).map(p => `<button class="lt-cmd-switch-btn ${p.id === player.id ? 'is-active' : ''}" data-action="cmd-select" data-pid="${esc(p.id)}">${esc(p.name)}</button>`).join('')}
    </div>`;
};

T._sheetCounters = function () {
  const me = this._me();
  if (!me) return '';
  const others = this.players.filter(p => p.id !== this.myPlayerId);
  const c = this.miscCounters;
  return `
    ${this._ctl('Gift (Poison)', `${me.poison || 0}<i>/10</i>`, { action: 'adjust-poison' })}
    <div class="lt-sec">Commander-Schaden erhalten <small>zieht auch Leben ab</small></div>
    ${others.map(p => {
      const value = clamp((me.cmd_damage || {})[p.id] || 0, 0, 99) + (this.pendingCmdDamage[p.id] || 0);
      return `
        <div class="lt-ctl">
          <div class="lt-ctl-label">${esc(p.name)}</div>
          <div class="lt-cmd-btns">
            ${[-10, -5, -1].map(step => `<button class="lt-round" data-action="cmd-recv" data-from="${esc(p.id)}" data-delta="${step}">${step}</button>`).join('')}
            <span class="lt-ctl-val">${value}<i>/21</i></span>
            ${[1, 5, 10].map(step => `<button class="lt-round" data-action="cmd-recv" data-from="${esc(p.id)}" data-delta="${step}">+${step}</button>`).join('')}
          </div>
        </div>`;
    }).join('') || '<div class="lt-muted">Keine Gegner.</div>'}
    <div class="lt-sec">Weitere Counter <small>nur auf diesem Gerät</small></div>
    ${this._ctl('Energy', c.energy || 0, { action: 'adjust-counter', counter: 'energy' })}
    ${this._ctl('Experience', c.experience || 0, { action: 'adjust-counter', counter: 'experience' })}
    ${this._ctl('Rad', c.rad || 0, { action: 'adjust-counter', counter: 'rad' })}
    <div class="lt-sec">Optionen</div>
    <div class="lt-toggles">
      ${this._ltToggle('Lifelink (Combat heilt dich)', 'toggle-lifelink', this.combatLifelink)}
      ${this._ltToggle('Extra Turn vormerken', 'toggle-extra-turn', this.extraTurnQueued)}
    </div>`;
};

T._ltPlayers = function () {
  return this.phase === 'local' ? this.local.players.filter(p => !this._localOut(p)) : this.players.filter(p => !p.eliminated);
};

T._sheetTools = function () {
  const r = this.toolResult;
  const host = this.phase === 'live' && this._isHost();
  const alive = this.players.filter(p => !p.eliminated);
  return `
    <div class="lt-tools">
      <button class="lt-tool" data-action="roll" data-sides="6">W6</button>
      <button class="lt-tool" data-action="roll" data-sides="10">W10</button>
      <button class="lt-tool" data-action="roll" data-sides="20">W20</button>
      <button class="lt-tool" data-action="coin">Münze</button>
      <button class="lt-tool wide" data-action="pick-player">Zufälliger Spieler</button>
    </div>
    <div class="lt-result-box">${r ? `<div class="lt-result" data-r="${r.id}"><small>${esc(r.label)}</small><b>${esc(r.text)}</b></div>` : '<div class="lt-muted">Tippe auf einen Würfel, die Münze oder „Zufälliger Spieler“.</div>'}</div>
    ${host ? `
    <div class="lt-sec">Spiel beenden <small>nur Host</small></div>
    <div class="lt-toggles">
      ${alive.map(p => `<button class="lt-toggle" data-action="finish-game" data-value="${esc(p.id)}">${esc(p.name)} gewinnt</button>`).join('')}
      <button class="lt-toggle ghost" data-action="finish-game" data-value="">Kein Gewinner</button>
    </div>` : ''}`;
};

T._ltResult = function (label, text) {
  this.toolResult = { label, text, id: Date.now() };
  this._render();
};

/* ═══════════════ Lokaler Modus ═══════════════ */

T._localLoad = function () {
  try {
    const L = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
    if (!L || !Array.isArray(L.players) || !L.players.length) return null;
    L.history = Array.isArray(L.history) ? L.history : [];
    return L;
  } catch { return null; }
};
T._localSave = function () {
  if (!this.local) return;
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...this.local, history: this.local.history.slice(-20) })); } catch { /* voll */ }
};
T._localResumeOnBoot = function () {
  const L = this._localLoad();
  if (!L || !L.live) return false;
  this.local = L;
  return true;
};
T._localOut = function (p) {
  return p.life <= 0 || p.poison >= 10 || Math.max(0, ...Object.values(p.cmd || {})) >= 21;
};
T._localSnapshot = function () {
  const { players, turn, active, monarch, initiative } = this.local;
  return JSON.parse(JSON.stringify({ players, turn, active, monarch, initiative }));
};
T._localPush = function (snap) {
  const L = this.local;
  L.history.push(snap || this._localSnapshot());
  if (L.history.length > 40) L.history.shift();
};
T._localMutate = function (fn) {
  this._localPush();
  fn(this.local);
  this._localSave();
  this._render();
};
T._localUndo = function () {
  const L = this.local;
  const entry = L?.history.pop();
  if (!entry) return;
  if (entry.lifeUndo) {
    // Tap-Serie eines einzelnen Spielers: nur dessen Lebenspunkte zurückdrehen
    Object.entries(entry.lifeUndo).forEach(([id, d]) => {
      const p = L.players.find(x => x.id === id);
      if (p) p.life = clamp(p.life + d, -99, 999);
    });
  } else {
    Object.assign(L, entry);
  }
  this._localSave();
  this._render();
};

T._localStart = function (keepPlayers) {
  const prev = keepPlayers ? this.local : null;
  const { count, life } = this.localSetup;
  const n = prev ? prev.players.length : count;
  const startLife = prev ? prev.startLife : life;
  const names = prev ? prev.players.map(p => p.name) : [];
  const colors = prev ? prev.players.map(p => p.color) : [];
  this.local = {
    live: true, startLife, turn: 1, active: rnd(n), monarch: null, initiative: null, history: [],
    players: Array.from({ length: n }, (_, i) => ({
      id: 'L' + i, name: names[i] || `Spieler ${i + 1}`, life: startLife, poison: 0, cmd: {},
      ctr: { energy: 0, experience: 0, rad: 0 }, color: colors[i] || T.COLORS[i % T.COLORS.length]
    }))
  };
  this.burst = {};
  this.sheet = null; this.toolResult = null;
  this.phase = 'local';
  this._localSave();
  this._render();
};

T._ltStepLocal = function (owner, delta) {
  const L = this.local;
  const p = L?.players.find(x => x.id === owner);
  if (!p) return;
  const before = p.life;
  p.life = clamp(p.life + delta, -99, 999);
  delta = p.life - before;
  if (!delta) return;
  const b = this.burst[owner] || (this.burst[owner] = { delta: 0, timer: null });
  b.delta += delta;
  clearTimeout(b.timer);
  b.timer = setTimeout(() => this._ltEndBurst(owner), FLUSH_MS + 100);
  this._localSave();
  this._ltPaint(owner);
};

T._ltEndBurst = function (owner) {
  const b = this.burst[owner];
  delete this.burst[owner];
  if (b && b.delta !== 0 && this.local) {
    this.local.history.push({ lifeUndo: { [owner]: -b.delta } });
    if (this.local.history.length > 40) this.local.history.shift();
  }
  this._localSave();
  if (this.phase === 'local') this._render();
};

T._localNext = function () {
  this._localMutate(L => {
    const n = L.players.length;
    let next = (L.active + 1) % n;
    for (let i = 0; i < n && this._localOut(L.players[next]); i++) next = (next + 1) % n;
    L.active = next;
    L.turn += 1;
  });
};

T._renderLocalSetup = function () {
  const s = this.localSetup;
  return `
  <div class="mp-screen mp-menu lt-setup">
    ${this._renderLogo('mp-logo')}
    <div class="mp-logo-sub">Lokales Spiel</div>
    <div class="mp-menu-card">
      <label class="mp-label">Spieler</label>
      <div class="lt-stepper">
        <button class="lt-round" data-action="local-count" data-delta="-1" aria-label="weniger">${MINUS}</button>
        <span class="lt-stepper-val">${s.count}</span>
        <button class="lt-round" data-action="local-count" data-delta="1" aria-label="mehr">+</button>
      </div>
      <label class="mp-label">Startleben</label>
      <div class="lt-chips-row">
        ${[20, 30, 40].map(v => `<button class="lt-pill ${s.life === v ? 'on' : ''}" data-action="local-life" data-value="${v}">${v}</button>`).join('')}
      </div>
      <button class="mp-btn mp-btn-gold" data-action="local-start">Spiel starten</button>
      <button class="mp-btn mp-btn-outline" data-action="local-back">Zurück</button>
    </div>
  </div>`;
};

T._renderLocalMenu = function () {
  const saved = this._localLoad();
  return `
    <div class="mp-divider"><span>oder</span></div>
    ${saved ? `<button class="mp-btn mp-btn-outline" data-action="local-resume">Lokales Spiel fortsetzen · ${saved.players.length} Spieler · Zug ${saved.turn}</button>` : ''}
    <button class="mp-btn mp-btn-outline" data-action="local-setup">Lokales Spiel · ein Gerät</button>`;
};

T._renderLocal = function () {
  const L = this.local;
  if (!L) return this._renderMenu();
  const n = L.players.length;
  const topN = Math.ceil(n / 2);
  const panel = (p, i, flipped) => {
    const out = this._localOut(p);
    const bub = this.burst[p.id]?.delta || 0;
    const cmd = Math.max(0, ...Object.values(p.cmd || {}));
    const badges = [];
    if (p.poison > 0) badges.push(`<span class="lt-chip-btn is-bad">☠ ${p.poison}</span>`);
    if (cmd > 0) badges.push(`<span class="lt-chip-btn ${cmd >= 14 ? 'is-bad' : ''}">⚔ ${cmd}</span>`);
    if (L.monarch === p.id) badges.push('<span class="lt-chip-btn is-gold">♛</span>');
    if (L.initiative === p.id) badges.push('<span class="lt-chip-btn is-gold">✦</span>');
    return `
    <section class="lt-panel ${flipped ? 'is-flipped' : ''} ${out ? 'is-out' : ''} ${L.active === i ? 'is-turn' : ''}" style="--pc:${hexOf(p.color)}">
      <div class="lt-zone lt-zone-minus" data-zone="minus" data-owner="${p.id}" aria-label="Leben verringern"><span>${MINUS}</span></div>
      <div class="lt-zone lt-zone-plus" data-zone="plus" data-owner="${p.id}" aria-label="Leben erhöhen"><span>+</span></div>
      <div class="lt-center">
        <button class="lt-name-btn" data-action="local-player" data-pid="${p.id}">${esc(p.name)}</button>
        <div class="lt-life-wrap">
          <div class="lt-bubble ${bub ? 'show' : ''} ${bub < 0 ? 'neg' : ''}" data-bubble="${p.id}">${bub ? sgn(bub) : ''}</div>
          <div class="lt-life ${this._lifeClass(p.life)}" data-life="${p.id}">${p.life}</div>
        </div>
        <div class="lt-chips">${badges.join('')}</div>
      </div>
      <div class="lt-out"><span>☠</span></div>
    </section>`;
  };
  return `
  <div class="lt-local" data-n="${n}">
    <div class="lt-row">${L.players.slice(0, topN).map((p, i) => panel(p, i, true)).join('')}</div>
    <div class="lt-row">${L.players.slice(topN).map((p, i) => panel(p, i + topN, false)).join('')}</div>
    <button class="lt-hub" data-action="local-menu" aria-label="Menü"><small>Zug</small>${L.turn}</button>
    ${this._renderSheet()}
  </div>`;
};

T._sheetLocalMenu = function () {
  const L = this.local;
  const confirm = this.sheet?.confirm;
  const active = L.players[L.active];
  return `
    <div class="lt-menu-turn">Am Zug: <b>${esc(active?.name || '?')}</b></div>
    <div class="lt-menu">
      <button class="lt-tool wide gold" data-action="local-next">Nächster Zug →</button>
      <button class="lt-tool" data-action="local-undo" ${L.history.length ? '' : 'disabled'}>↶ Rückgängig</button>
      <button class="lt-tool" data-action="open-sheet" data-sheet="tools">⚄ Würfel</button>
      ${confirm
        ? `<button class="lt-tool wide danger" data-action="local-restart">Ja, neues Spiel starten</button>
           <button class="lt-tool wide" data-action="local-cancel">Abbrechen</button>`
        : `<button class="lt-tool" data-action="local-confirm">Neues Spiel</button>
           <button class="lt-tool" data-action="local-quit">Zum Menü</button>`}
    </div>`;
};

T._sheetLocalPlayer = function (p) {
  const L = this.local;
  const others = L.players.filter(o => o.id !== p.id);
  return `
    <input class="mp-input lt-input" type="text" maxlength="16" value="${esc(p.name)}" data-field="lp-name" data-pid="${p.id}" aria-label="Name">
    <div class="lt-colors">
      ${T.COLORS.map(c => `<button class="lt-color ${p.color === c ? 'on' : ''}" style="--pc:${hexOf(c)}" data-action="lp-color" data-pid="${p.id}" data-value="${c}" aria-label="${c}"></button>`).join('')}
    </div>
    <div class="lt-ctl">
      <div class="lt-ctl-label">Leben setzen</div>
      <input class="mp-input lt-num" type="number" inputmode="numeric" value="${p.life}" data-field="lp-life" data-pid="${p.id}" aria-label="Leben">
    </div>
    ${this._ctl('Gift (Poison)', `${p.poison}<i>/10</i>`, { action: 'lp-poison', pid: p.id })}
    <div class="lt-sec">Commander-Schaden erhalten <small>zieht auch Leben ab</small></div>
    ${others.map(o => this._ctl(esc(o.name), `${p.cmd?.[o.id] || 0}<i>/21</i>`, { action: 'lp-cmd', pid: p.id, from: o.id })).join('')}
    <div class="lt-sec">Weitere Counter</div>
    ${['energy', 'experience', 'rad'].map(k => this._ctl(k[0].toUpperCase() + k.slice(1), p.ctr?.[k] || 0, { action: 'lp-ctr', pid: p.id, counter: k })).join('')}
    <div class="lt-sec">Status</div>
    <div class="lt-toggles">
      ${this._ltToggle('♛ Monarch', 'lp-monarch', L.monarch === p.id, { pid: p.id })}
      ${this._ltToggle('✦ Initiative', 'lp-initiative', L.initiative === p.id, { pid: p.id })}
    </div>`;
};

/* ═══════════════ Klick-Dispatcher ═══════════════ */

T._liveClick = function (el, event) {
  const a = el.dataset.action;
  const d = Number(el.dataset.delta || 0);
  const L = this.local;
  const lp = () => L?.players.find(p => p.id === el.dataset.pid);
  switch (a) {
    case 'open-sheet': this.sheet = { type: el.dataset.sheet, pid: el.dataset.pid || null }; this.toolResult = null; this._render(); return true;
    case 'close-sheet':
      if (el.classList.contains('lt-sheet-backdrop') && event.target !== el) return true;
      this.sheet = null; this._render(); return true;
    case 'cmd-recv': this.adjustCmdReceived(el.dataset.from, d); return true;
    case 'cmd-select': this.sheet = { type: 'commanderTarget', pid: el.dataset.pid }; this._render(); return true;
    case 'roll': { const s = Number(el.dataset.sides) || 6; this._ltResult('W' + s, String(1 + rnd(s))); return true; }
    case 'coin': this._ltResult('Münze', rnd(2) ? 'Kopf' : 'Zahl'); return true;
    case 'pick-player': {
      const pool = this._ltPlayers();
      this._ltResult('Zufälliger Spieler', pool.length ? pool[rnd(pool.length)].name : '–');
      return true;
    }

    case 'local-setup': this.phase = 'local-setup'; this._render(); return true;
    case 'local-back': this.phase = 'menu'; this._render(); return true;
    case 'local-count': this.localSetup.count = clamp(this.localSetup.count + d, 2, MAX_LOCAL); this._render(); return true;
    case 'local-life': this.localSetup.life = Number(el.dataset.value) || 40; this._render(); return true;
    case 'local-start': this._localStart(false); return true;
    case 'local-resume': {
      const saved = this._localLoad();
      if (saved) { this.local = saved; this.local.live = true; this.phase = 'local'; this._localSave(); this._render(); }
      return true;
    }
    case 'local-menu': this.sheet = { type: 'lmenu' }; this._render(); return true;
    case 'local-player': this.sheet = { type: 'lplayer', pid: el.dataset.pid }; this._render(); return true;
    case 'local-next': this.sheet = null; this._localNext(); return true;
    case 'local-undo': this._localUndo(); return true;
    case 'local-confirm': this.sheet = { type: 'lmenu', confirm: true }; this._render(); return true;
    case 'local-cancel': this.sheet = { type: 'lmenu' }; this._render(); return true;
    case 'local-restart': this._localStart(true); return true;
    case 'local-quit':
      this.sheet = null; if (this.local) { this.local.live = false; this._localSave(); }
      this.phase = 'menu'; this._render(); return true;

    case 'lp-poison': { const p = lp(); if (p) this._localMutate(() => { p.poison = clamp(p.poison + d, 0, 10); }); return true; }
    case 'lp-ctr': { const p = lp(); const k = el.dataset.counter; if (p && k) this._localMutate(() => { p.ctr[k] = clamp((p.ctr[k] || 0) + d, 0, 999); }); return true; }
    case 'lp-cmd': {
      const p = lp(); const from = el.dataset.from;
      if (!p || !from) return true;
      this._localMutate(() => {
        const cur = p.cmd[from] || 0; const next = clamp(cur + d, 0, 99);
        p.life = clamp(p.life - (next - cur), -99, 999);
        if (next > 0) p.cmd[from] = next; else delete p.cmd[from];
      });
      return true;
    }
    case 'lp-monarch': { const p = lp(); if (p) this._localMutate(l => { l.monarch = l.monarch === p.id ? null : p.id; }); return true; }
    case 'lp-initiative': { const p = lp(); if (p) this._localMutate(l => { l.initiative = l.initiative === p.id ? null : p.id; }); return true; }
    case 'lp-color': { const p = lp(); if (p) this._localMutate(() => { p.color = el.dataset.value; }); return true; }
  }
  return false;
};

T._liveChange = function (event) {
  const el = event.target;
  if (!this.local || !el.matches?.('[data-field^="lp-"]')) return;
  const p = this.local.players.find(x => x.id === el.dataset.pid);
  if (!p) return;
  if (el.dataset.field === 'lp-life') {
    const v = clamp(parseInt(el.value, 10), -99, 999);
    if (Number.isNaN(v)) return;
    this._localMutate(() => { p.life = v; });
  } else if (el.dataset.field === 'lp-name') {
    p.name = el.value.trim().slice(0, 16) || p.name;
    this._localSave();
  }
};

T._liveInput = function (event) {
  const el = event.target;
  if (!this.local || !el.matches?.('[data-field="lp-name"]')) return;
  const p = this.local.players.find(x => x.id === el.dataset.pid);
  if (p) { p.name = el.value.slice(0, 16) || p.name; this._localSave(); }
};

})();
