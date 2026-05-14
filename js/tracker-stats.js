/* MagicTheDrinkering – tracker-stats.js
   Game Event Tracking + Post-Game Stats Renderer
   ─────────────────────────────────────────────── */

const MPStats = {

  /* ── Config ── */
  SUPABASE_URL: 'https://pwrpvtzocycnemgnsooz.supabase.co',
  SUPABASE_KEY: 'sb_publishable_doroVk7_Pblbapi7z9njyQ_zfVTZOmG',

  /* ── State ── */
  _sb: null,
  _lobbyId: null,
  _myPlayerId: null,
  _players: [],

  /* ── Init ── */
  attach(sb, lobbyId, myPlayerId, players) {
    this._sb = sb;
    this._lobbyId = lobbyId;
    this._myPlayerId = myPlayerId;
    this._players = players || [];
  },

  updatePlayers(players) {
    this._players = players || [];
  },

  /* ══════════════════════════════════════════
     EVENT LOGGING (GROUPED JSON EVENTS)
  ══════════════════════════════════════════ */

  async logEvent(type, {
    actorId,
    targetId = null,
    amount = 0,
    turn = 1
  } = {}) {

    if (!this._sb || !this._lobbyId || !actorId) return;

    try {

      const normalizedAmount = Math.round(Number(amount) || 0);

      const newEvent = {
        type,
        target_id: targetId,
        amount: normalizedAmount,
        ts: Date.now()
      };

      const { data, error } = await this._sb
        .from('mp_game_events')
        .select('id, events')
        .eq('lobby_id', this._lobbyId)
        .eq('turn', turn)
        .eq('actor_id', actorId)
        .limit(1);

      if (error) throw error;

      const existing = data?.[0];

      if (existing?.id) {

        const updatedEvents = Array.isArray(existing.events)
          ? [...existing.events, newEvent]
          : [newEvent];

        const { error: updateError } = await this._sb
          .from('mp_game_events')
          .update({
            events: updatedEvents
          })
          .eq('id', existing.id);

        if (updateError) throw updateError;

      } else {

        const { error: insertError } = await this._sb
          .from('mp_game_events')
          .insert({
            lobby_id: this._lobbyId,
            turn,
            actor_id: actorId,
            events: [newEvent]
          });

        if (insertError) throw insertError;
      }

    } catch (err) {
      console.warn('[MPStats.logEvent]', err);
    }
  },

  /* ══════════════════════════════════════════
     STATS LADEN + RENDERN
  ══════════════════════════════════════════ */

  async renderFinishedStats(lobbyId, players, lobby) {

    const container = document.getElementById('mp-stats-root');
    if (!container) return;

    container.innerHTML = `<div class="mps-loading">Lade Stats…</div>`;

    try {

      const { data: rows, error } = await this._sb
        .from('mp_game_events')
        .select('*')
        .eq('lobby_id', lobbyId)
        .order('turn', { ascending: true });

      if (error) throw error;

      const stats = this._crunch(rows || [], players || []);

      container.innerHTML = this._renderStats(
        stats,
        players || [],
        lobby || {}
      );

    } catch (err) {
      console.warn('[MPStats.renderFinishedStats]', err);

      container.innerHTML = `
        <div class="mps-loading">
          Stats konnten nicht geladen werden.
        </div>
      `;
    }
  },

  /* ══════════════════════════════════════════
     CRUNCH STATS
  ══════════════════════════════════════════ */

  _crunch(rows, players) {

    const byId = {};

    (players || []).forEach(p => {

      byId[p.id] = {
        id: p.id,
        name: p.name,
        color: p.color,

        totalDamageDealt: 0,
        totalDamageReceived: 0,

        totalHealingDone: 0,

        totalCmdDealt: 0,
        totalCmdReceived: 0,

        totalPoison: 0,

        attackCount: 0,

        biggestHit: 0,
        biggestHitTurn: 0,

        targetsHit: {},
        attackedBy: {},
        cmdByActor: {}
      };
    });

    (rows || []).forEach(row => {

      const actor = byId[row.actor_id];
      if (!actor) return;

      const turn = Number(row.turn) || 0;
      const events = Array.isArray(row.events)
        ? row.events
        : [];

      events.forEach(ev => {

        if (!ev || typeof ev !== 'object') return;

        const type = String(ev.type || '').toLowerCase();

        const target = ev.target_id
          ? byId[ev.target_id]
          : null;

        const amt = Math.max(
          0,
          Number(ev.amount) || 0
        );

        /* ─────────────────────────────
           DAMAGE / COMBAT DAMAGE
        ───────────────────────────── */

        if (
          (type === 'damage' || type === 'combat_damage') &&
          target &&
          amt > 0
        ) {

          actor.totalDamageDealt += amt;
          target.totalDamageReceived += amt;

          actor.attackCount += 1;

          actor.targetsHit[target.id] =
            (actor.targetsHit[target.id] || 0) + amt;

          target.attackedBy[row.actor_id] =
            (target.attackedBy[row.actor_id] || 0) + amt;

          if (amt > actor.biggestHit) {
            actor.biggestHit = amt;
            actor.biggestHitTurn = turn;
          }
        }

        /* ─────────────────────────────
           COMMANDER DAMAGE
        ───────────────────────────── */

        if (
          (type === 'cmd_damage' || type === 'commander_damage') &&
          target &&
          amt > 0
        ) {

          actor.totalCmdDealt += amt;
          target.totalCmdReceived += amt;

          actor.attackCount += 1;

          actor.targetsHit[target.id] =
            (actor.targetsHit[target.id] || 0) + amt;

          target.attackedBy[row.actor_id] =
            (target.attackedBy[row.actor_id] || 0) + amt;

          target.cmdByActor[row.actor_id] =
            (target.cmdByActor[row.actor_id] || 0) + amt;

          if (amt > actor.biggestHit) {
            actor.biggestHit = amt;
            actor.biggestHitTurn = turn;
          }
        }

        /* ─────────────────────────────
           HEALING
        ───────────────────────────── */

        if (
          (type === 'heal' || type === 'healing') &&
          amt > 0
        ) {

          actor.totalHealingDone += amt;
        }

        /* ─────────────────────────────
           POISON
        ───────────────────────────── */

        if (
          type === 'poison' &&
          target &&
          amt > 0
        ) {

          actor.totalPoison += amt;
        }

      });

    });

    return byId;
  },

  /* ══════════════════════════════════════════
     HTML RENDERER
  ══════════════════════════════════════════ */

  _renderStats(stats, players, lobby) {

    const pStats = (players || [])
      .map(p => stats[p.id])
      .filter(Boolean);

    const turns = lobby?.turn_number || '?';

    const winner = (players || []).find(
      p => p.id === lobby?.winner_id
    );

    const mvp = [...pStats]
      .sort((a, b) => b.totalDamageDealt - a.totalDamageDealt)[0];

    const tankiest = [...pStats]
      .sort((a, b) => b.totalDamageReceived - a.totalDamageReceived)[0];

    const healer = [...pStats]
      .sort((a, b) => b.totalHealingDone - a.totalHealingDone)[0];

    const cmdking = [...pStats]
      .sort((a, b) => b.totalCmdDealt - a.totalCmdDealt)[0];

    return `
    <div class="mps-wrap">

      <div class="mps-header">
        <div class="mps-header-title">
          Game Stats
        </div>

        <div class="mps-header-sub">
          Turn ${turns}
          · ${players.length} Spieler
          ${winner ? ` · Gewinner: ${this._esc(winner.name)}` : ''}
        </div>
      </div>

      <!-- Highlights -->
      <div class="mps-highlights">
        ${this._highlight(
          '⚔',
          'Most Damage',
          mvp?.name,
          `${mvp?.totalDamageDealt || 0} dealt`
        )}

        ${this._highlight(
          '🛡',
          'Most Tanked',
          tankiest?.name,
          `${tankiest?.totalDamageReceived || 0} received`
        )}

        ${this._highlight(
          '💚',
          'Most Healed',
          healer?.name,
          `${healer?.totalHealingDone || 0} healed`
        )}

        ${this._highlight(
          '👑',
          'Commander King',
          cmdking?.name,
          `${cmdking?.totalCmdDealt || 0} cmd`
        )}
      </div>

      <!-- Per Player -->
      <div class="mps-players">
        ${pStats
          .map(s => this._renderPlayerStat(s, stats, players))
          .join('')}
      </div>

      <!-- Matrix -->
      <div class="mps-section">
        <div class="mps-section-title">
          Wer hat wen angegriffen
        </div>

        ${this._renderMatrix(pStats, players)}
      </div>

    </div>
    `;
  },

  _highlight(icon, label, name, value) {

    if (!name) return '';

    return `
    <div class="mps-highlight-card">
      <div class="mps-highlight-icon">${icon}</div>
      <div class="mps-highlight-label">${label}</div>
      <div class="mps-highlight-name">${this._esc(name)}</div>
      <div class="mps-highlight-value">${this._esc(value)}</div>
    </div>
    `;
  },

  _renderPlayerStat(s, allStats, players) {

    const nameById = Object.fromEntries(
      (players || []).map(p => [p.id, p.name])
    );

    const topTarget = Object.entries(s.targetsHit || {})
      .sort((a, b) => b[1] - a[1])[0];

    const topAttacker = Object.entries(s.attackedBy || {})
      .sort((a, b) => b[1] - a[1])[0];

    return `
    <div class="mps-player-card mps-color-${s.color || 'gold'}">

      <div class="mps-player-head">
        <div class="mps-player-orb">
          ${this._initials(s.name)}
        </div>

        <div class="mps-player-name">
          ${this._esc(s.name)}
        </div>
      </div>

      <div class="mps-stat-grid">

        <div class="mps-stat">
          <span class="mps-stat-val">${s.totalDamageDealt}</span>
          <span class="mps-stat-label">Dealt</span>
        </div>

        <div class="mps-stat">
          <span class="mps-stat-val">${s.totalDamageReceived}</span>
          <span class="mps-stat-label">Received</span>
        </div>

        <div class="mps-stat">
          <span class="mps-stat-val">${s.totalCmdDealt}</span>
          <span class="mps-stat-label">CMD Out</span>
        </div>

        <div class="mps-stat">
          <span class="mps-stat-val">${s.totalCmdReceived}</span>
          <span class="mps-stat-label">CMD In</span>
        </div>

        <div class="mps-stat">
          <span class="mps-stat-val">${s.totalHealingDone}</span>
          <span class="mps-stat-label">Healed</span>
        </div>

        <div class="mps-stat">
          <span class="mps-stat-val">${s.attackCount}</span>
          <span class="mps-stat-label">Attacks</span>
        </div>

        ${s.biggestHit > 0 ? `
          <div class="mps-stat mps-stat-wide">
            <span class="mps-stat-val">${s.biggestHit}</span>
            <span class="mps-stat-label">
              Biggest Hit (Turn ${s.biggestHitTurn})
            </span>
          </div>
        ` : ''}

      </div>

      ${topTarget ? `
        <div class="mps-relation">
          Lieblingsziel:
          <strong>
            ${this._esc(nameById[topTarget[0]] || '?')}
          </strong>
          (${topTarget[1]} dmg)
        </div>
      ` : ''}

      ${topAttacker ? `
        <div class="mps-relation">
          Meist angegriffen von:
          <strong>
            ${this._esc(nameById[topAttacker[0]] || '?')}
          </strong>
          (${topAttacker[1]} dmg)
        </div>
      ` : ''}

    </div>
    `;
  },

  _renderMatrix(pStats, players) {

    if (!pStats || pStats.length < 2) {
      return `
        <div class="mps-empty">
          Nicht genug Daten.
        </div>
      `;
    }

    const rows = pStats.map(attacker => {

      const cells = pStats.map(target => {

        if (attacker.id === target.id) {
          return `<td class="mps-matrix-self">–</td>`;
        }

        const dmg = attacker.targetsHit?.[target.id] || 0;

        const intensity =
          dmg === 0
            ? ''
            : dmg < 10
              ? 'low'
              : dmg < 25
                ? 'mid'
                : 'high';

        return `
          <td class="mps-matrix-cell ${intensity}">
            ${dmg || ''}
          </td>
        `;

      }).join('');

      return `
        <tr>
          <td class="mps-matrix-name">
            ${this._esc(attacker.name)}
          </td>
          ${cells}
        </tr>
      `;

    }).join('');

    const headers = pStats.map(p => `
      <th class="mps-matrix-th">
        ${this._esc(p.name)}
      </th>
    `).join('');

    return `
    <div class="mps-matrix-wrap">
      <table class="mps-matrix">

        <thead>
          <tr>
            <th class="mps-matrix-corner">
              ↓ dealt / →
            </th>
            ${headers}
          </tr>
        </thead>

        <tbody>
          ${rows}
        </tbody>

      </table>
    </div>
    `;
  },

  /* ══════════════════════════════════════════
     HELPERS
  ══════════════════════════════════════════ */

  _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  _initials(n) {
    return String(n || 'P')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(w => w[0] || '')
      .join('')
      .toUpperCase() || 'P';
  }
};