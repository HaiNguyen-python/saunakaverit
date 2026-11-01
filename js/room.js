/* Saunakaverit - Löylyhuone: a shared virtual sauna. Everyone present sits on the lauteet as a
   small figure. Presence and events go over Supabase Realtime (no database rows); without a
   backend the room still works for one person. */
window.SK_ROOM = (function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const TOWELS = ['#e9b8a6','#b8d8e9','#cfe3b8','#f3d9a4','#d9c2ec','#f2bcd0','#bfe6dd','#f0cfa0'];
  const SKINS = ['#f1c9a5','#e0ac82','#c68b5b','#a96d45','#8a4f2e','#f5d6b8'];
  const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

  // Benches: three tiers, back tier highest and farthest.
  const TIERS = [
    { y: 440, scale: 1.18, x0: 338, n: 7, dx: 72 },
    { y: 372, scale: 1.04, x0: 352, n: 7, dx: 68 },
    { y: 308, scale: 0.92, x0: 366, n: 7, dx: 64 },
  ];
  const SEATS = [];
  TIERS.forEach((tr, ti) => { for (let i = 0; i < tr.n; i++) SEATS.push({ id: ti * 10 + i, tier: ti, x: tr.x0 + i * tr.dx, y: tr.y, scale: tr.scale }); });

  let el, ctx, roomId, ch = null, pid, me, people = [], temp = 80, steam = [], bubbles = [], log = [], masters = {}, raf = null, lastTick = 0, lastAmbient = 0, lastTemp = 0;
  const channels = {}, subscribed = {}, counts = {}, watchers = {};

  /* One realtime channel per room, shared by the room view and the home-card counter. */
  function getChannel(client, id) {
    if (channels[id]) return channels[id];
    const c = client.channel('room:' + id, { config: { presence: { key: pid }, broadcast: { self: false } } });
    c.on('presence', { event: 'sync' }, () => {
      const st = c.presenceState();
      counts[id] = Object.keys(st).length;
      const names = Object.values(st).map(m => m && m.length ? m[m.length - 1].name : null).filter(Boolean);
      (watchers[id] || []).forEach(cb => cb(counts[id], names));
      if (raf && roomId === id) syncPresence();
    });
    c.on('broadcast', { event: 'sk' }, ({ payload }) => { if (raf && roomId === id) onEvent(payload || {}); });
    c.subscribe(status => { if (status === 'SUBSCRIBED') { subscribed[id] = true; if (raf && roomId === id) track(); } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') subscribed[id] = false; });
    channels[id] = c;
    return c;
  }

  function deviceId(suffix) {
    const k = 'saunakaverit.pid' + (suffix || '');
    let v = null; try { v = localStorage.getItem(k); } catch (e) {}
    if (!v) { v = Math.random().toString(36).slice(2, 10) + Date.now().toString(36); try { localStorage.setItem(k, v); } catch (e) {} }
    return v;
  }

  /* ---------- scene ---------- */
  function scene() {
    const planks = []; for (let y = 60; y < 480; y += 26) planks.push(`<line x1="0" y1="${y}" x2="800" y2="${y}"/>`);
    const stones = [];
    for (let i = 0; i < 14; i++) { const x = 160 + (i % 5) * 20 + (Math.floor(i / 5) % 2) * 10, y = 296 + Math.floor(i / 5) * 10; stones.push(`<ellipse cx="${x}" cy="${y}" rx="11" ry="8" fill="#55524f" stroke="#2e2c2a"/>`); }
    const flakes = []; for (let i = 0; i < 14; i++) flakes.push(`<circle cx="${30 + (i * 37) % 80}" cy="${150 + (i * 53) % 260}" r="${1.5 + (i % 3)}" fill="#fff" opacity=".7"/>`);
    const slats = (x, y, w, h) => { let s = ''; for (let i = 0; i < w; i += 24) s += `<rect x="${x + i}" y="${y}" width="22" height="${h}" rx="3" fill="url(#bench)" stroke="#5b3a1f"/>`; return s; };
    return `
<svg viewBox="0 0 800 480" class="roomScene" xmlns="http://www.w3.org/2000/svg" id="roomSvg">
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2415"/><stop offset="1" stop-color="#5c3b22"/></linearGradient>
    <linearGradient id="bench" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9a66b"/><stop offset="1" stop-color="#a66f3f"/></linearGradient>
    <linearGradient id="face" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8c5a35"/><stop offset="1" stop-color="#5a3519"/></linearGradient>
    <linearGradient id="night" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d1a2e"/><stop offset="1" stop-color="#1f3b5a"/></linearGradient>
    <radialGradient id="glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffb347" stop-opacity=".95"/><stop offset="1" stop-color="#ff6a00" stop-opacity="0"/></radialGradient>
    <radialGradient id="lamp" cx=".5" cy="0" r=".9"><stop offset="0" stop-color="#ffd9a0" stop-opacity=".35"/><stop offset="1" stop-color="#ffd9a0" stop-opacity="0"/></radialGradient>
    <radialGradient id="fire" cx=".5" cy="1" r="1"><stop offset="0" stop-color="#ffd166"/><stop offset=".5" stop-color="#ff7a1a"/><stop offset="1" stop-color="#b3200a"/></radialGradient>
  </defs>
  <rect width="800" height="480" fill="url(#wall)"/>
  <g stroke="#2a170c" stroke-opacity=".55">${planks.join('')}</g>
  <rect width="800" height="60" fill="#241308"/>
  <ellipse cx="420" cy="60" rx="380" ry="200" fill="url(#lamp)"/>
  <!-- window with lake and moon -->
  <rect x="585" y="88" width="160" height="110" rx="6" fill="url(#night)" stroke="#1d110a" stroke-width="10"/>
  <circle cx="700" cy="118" r="13" fill="#f6ecc9"/>
  <path d="M595 165 Q620 158 645 165 T695 165 T740 165 L740 192 L595 192 Z" fill="#17304a"/>
  <path d="M595 150 L620 128 L645 150 Z M650 150 L672 132 L694 150 Z" fill="#0b1626"/>
  <line x1="665" y1="88" x2="665" y2="198" stroke="#1d110a" stroke-width="6"/>
  <!-- door, open to the cold -->
  <rect x="22" y="120" width="96" height="340" rx="4" fill="url(#night)" stroke="#1d110a" stroke-width="8"/>
  <g>${flakes.join('')}</g>
  <text x="70" y="140" text-anchor="middle" font-size="11" fill="#9fc3e6" font-family="Inter,sans-serif" id="coolLabel">Vilvoittelu</text>
  <!-- vihta on the wall -->
  <g transform="translate(300,120)">
    <circle cx="0" cy="-4" r="3" fill="#222"/>
    <path d="M0 0 L0 40" stroke="#6b4a2b" stroke-width="4"/>
    <ellipse cx="-12" cy="52" rx="14" ry="24" fill="#4f7a3c" transform="rotate(-15 -12 52)"/>
    <ellipse cx="12" cy="52" rx="14" ry="24" fill="#5f8c45" transform="rotate(15 12 52)"/>
    <ellipse cx="0" cy="58" rx="13" ry="26" fill="#6a9a4c"/>
  </g>
  <!-- thermometer -->
  <g transform="translate(400,100)">
    <rect x="-26" y="-18" width="52" height="54" rx="8" fill="#f1e6d2" stroke="#8c5a35" stroke-width="3"/>
    <text x="0" y="10" text-anchor="middle" font-size="18" font-weight="700" fill="#8c5a35" font-family="Outfit,Inter,sans-serif" id="tempText">80°</text>
    <text x="0" y="28" text-anchor="middle" font-size="9" fill="#8c5a35" font-family="Inter,sans-serif">löyly</text>
  </g>
  <!-- kiuas -->
  <rect x="200" y="110" width="18" height="190" fill="#2c2c2c"/>
  <rect x="150" y="290" width="118" height="170" rx="8" fill="#3b3b3b" stroke="#1f1f1f" stroke-width="3"/>
  <rect x="150" y="285" width="118" height="12" rx="4" fill="#2a2a2a"/>
  <ellipse cx="209" cy="300" rx="80" ry="34" fill="url(#glow)" id="kiuasGlow"/>
  ${stones.join('')}
  <rect x="172" y="410" width="74" height="26" rx="4" fill="url(#fire)"/>
  <rect x="172" y="410" width="74" height="26" rx="4" fill="none" stroke="#1f1f1f" stroke-width="3"/>
  <!-- kiulu and kauha -->
  <path d="M100 430 L108 470 L144 470 L152 430 Z" fill="#9c6a3e" stroke="#5b3a1f" stroke-width="2"/>
  <ellipse cx="126" cy="430" rx="26" ry="7" fill="#6fa8c9" stroke="#5b3a1f" stroke-width="2"/>
  <path d="M140 428 L178 392" stroke="#c9a06a" stroke-width="5" stroke-linecap="round"/>
  <ellipse cx="180" cy="390" rx="8" ry="5" fill="#c9a06a" stroke="#5b3a1f"/>
  <!-- lauteet: back, middle, front -->
  <rect x="330" y="308" width="470" height="64" fill="url(#face)"/>${slats(330, 300, 470, 14)}
  <rect x="315" y="372" width="485" height="68" fill="url(#face)"/>${slats(315, 364, 485, 14)}
  <rect x="300" y="440" width="500" height="40" fill="url(#face)"/>${slats(300, 432, 500, 14)}
  <g id="seatHits"></g>
  <g id="people"></g>
  <g id="steam"></g>
  <g id="bubbles"></g>
</svg>`;
  }

  function avatar(p, x, y, s, isMe, hatOn) {
    const tow = TOWELS[hash(p.name) % TOWELS.length], skin = SKINS[hash(p.name + 'k') % SKINS.length];
    const hat = hatOn ? `<path d="M-16 -74 Q0 -96 16 -74 Z" fill="#d9d2c5" stroke="#8a8071"/><rect x="-19" y="-76" width="38" height="6" rx="3" fill="#d9d2c5" stroke="#8a8071"/>` : '';
    const ring = isMe ? `<ellipse cx="0" cy="2" rx="26" ry="7" fill="none" stroke="#ffd166" stroke-width="2.5" stroke-dasharray="4 3"/>` : '';
    const label = `<rect x="-30" y="6" width="60" height="15" rx="7" fill="#1f1b17" fill-opacity=".75"/><text x="0" y="17" text-anchor="middle" font-size="10.5" fill="#fff" font-family="Inter,sans-serif">${esc(p.name.slice(0, 10))}</text>`;
    return `<g class="av" transform="translate(${x},${y}) scale(${s})">
      ${ring}
      <path d="M-18 -8 L-20 -48 Q0 -56 20 -48 L18 -8 Q0 2 -18 -8 Z" fill="${tow}" stroke="#5b3a1f" stroke-opacity=".5"/>
      <rect x="-22" y="-14" width="44" height="12" rx="6" fill="${tow}" stroke="#5b3a1f" stroke-opacity=".4"/>
      <circle cx="-9" cy="-4" r="4" fill="${skin}"/><circle cx="9" cy="-4" r="4" fill="${skin}"/>
      <circle cx="0" cy="-66" r="15" fill="${skin}" stroke="#5b3a1f" stroke-opacity=".3"/>
      <circle cx="-5" cy="-68" r="1.6" fill="#2b1d12"/><circle cx="5" cy="-68" r="1.6" fill="#2b1d12"/>
      <path d="M-5 -60 Q0 -57 5 -60" stroke="#2b1d12" stroke-width="1.3" fill="none"/>
      ${hat}
      ${p.first ? `<text x="18" y="-74" font-size="12">🙋</text>` : ''}
      ${label}
    </g>`;
  }

  function placePeople() {
    const taken = {};
    const seated = [], cooling = [];
    const sorted = people.slice().sort((a, b) => (a.since || 0) - (b.since || 0));
    for (const p of sorted) {
      if (p.zone === 'cool') { cooling.push(p); continue; }
      let seat = SEATS.find(s => s.id === p.seat && !taken[s.id]) || SEATS.find(s => !taken[s.id]);
      if (!seat) { cooling.push(p); continue; }
      taken[seat.id] = p; seated.push({ p, seat });
    }
    seated.sort((a, b) => b.seat.tier - a.seat.tier); // back tier first so front overlaps
    let html = seated.map(({ p, seat }) => avatar(p, seat.x, seat.y, seat.scale, p.id === pid, p.hat)).join('');
    cooling.forEach((p, i) => { html += avatar(p, 45 + (i % 2) * 36, 445 - Math.floor(i / 2) * 60, 0.85, p.id === pid, p.hat) + `<text x="${45 + (i % 2) * 36 + 12}" y="${445 - Math.floor(i / 2) * 60 - 70}" font-size="12">❄️</text>`; });
    el.querySelector('#people').innerHTML = html;
    el.querySelector('#seatHits').innerHTML = SEATS.filter(s => !taken[s.id]).map(s => `<ellipse cx="${s.x}" cy="${s.y - 20 * s.scale}" rx="${24 * s.scale}" ry="${30 * s.scale}" fill="#fff" fill-opacity=".02" stroke="#ffd166" stroke-opacity=".12" stroke-dasharray="3 3" data-seat="${s.id}" style="cursor:pointer"/>`).join('');
    el.querySelector('#presentCount').textContent = people.length;
    renderMasters();
  }

  /* ---------- steam, temperature, bubbles ---------- */
  function spawnSteam(n, big) {
    for (let i = 0; i < n; i++) steam.push({ x: 209 + (Math.random() - .5) * 90, y: 292, r: big ? 14 + Math.random() * 22 : 6 + Math.random() * 8, vy: big ? 0.9 + Math.random() * 1.1 : 0.35 + Math.random() * 0.4, vx: (Math.random() - .5) * 0.6, life: 1, decay: big ? 0.006 : 0.009 });
  }
  let enteredAt = 0, rounds = 1, nudged = false, inSince = 0;
  function tick(ts) {
    const dt = Math.min(50, ts - (lastTick || ts)); lastTick = ts;
    if (ts - lastAmbient > 420) { spawnSteam(1, false); lastAmbient = ts; }
    if (ts - lastTemp > 1000) {
      temp = Math.max(70, temp - (temp > 95 ? 0.12 : 0.05)); lastTemp = ts; el.querySelector('#tempText').textContent = Math.round(temp) + '°';
      const mins = Math.floor((Date.now() - enteredAt) / 60000);
      const meta = el.querySelector('#roomMeta'); if (meta) meta.innerHTML = `<span>⏱ ${mins} ${esc(ctx.t('min'))} ${esc(ctx.t('inRoomFor'))}</span><span>🔁 ${rounds}. ${esc(ctx.t('rounds'))}</span><span>🌡 ${Math.round(temp)}°C</span>`;
      if (!nudged && me.zone === 'in' && Date.now() - inSince > 15 * 60000) { nudged = true; ctx.toast(ctx.t('nudge')); addLog(`❄️ ${ctx.t('nudge')}`); }
    }
    for (const s of steam) { s.y -= s.vy * dt / 16; s.x += s.vx * dt / 16; s.r += 0.06 * dt / 16; s.life -= s.decay * dt / 16; }
    steam = steam.filter(s => s.life > 0 && s.y > -40);
    el.querySelector('#steam').innerHTML = steam.map(s => `<circle cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="${s.r.toFixed(1)}" fill="#fff" fill-opacity="${(s.life * 0.28).toFixed(3)}"/>`).join('');
    const now = Date.now();
    bubbles = bubbles.filter(b => b.until > now);
    el.querySelector('#bubbles').innerHTML = bubbles.map(b => {
      const pos = findPos(b.id); if (!pos) return '';
      const age = (now - b.at) / 1000;
      if (b.emoji) return `<text x="${pos.x + 14}" y="${pos.y - 95 - age * 12}" font-size="22" opacity="${Math.max(0, 1 - age / 4)}">${b.emoji}</text>`;
      const w = Math.min(260, 14 + b.text.length * 6.2);
      return `<g transform="translate(${Math.min(790 - w, Math.max(10, pos.x - w / 2))},${pos.y - 118})"><rect width="${w}" height="24" rx="12" fill="#fff" fill-opacity=".95"/><text x="${w / 2}" y="16" text-anchor="middle" font-size="11" fill="#1f1b17" font-family="Inter,sans-serif">${esc(b.text)}</text></g>`;
    }).join('');
    const glow = el.querySelector('#kiuasGlow'); if (glow) glow.setAttribute('ry', (30 + (temp - 70) * 0.6).toFixed(1));
    raf = requestAnimationFrame(tick);
  }
  function findPos(id) {
    const p = people.find(x => x.id === id); if (!p) return null;
    if (p.zone === 'cool') { const i = people.filter(x => x.zone === 'cool').indexOf(p); return { x: 45 + (i % 2) * 36, y: 445 - Math.floor(i / 2) * 60 }; }
    const g = Array.from(el.querySelectorAll('#people .av')).find(a => a.querySelector('text') && a.querySelector('text').textContent === p.name.slice(0, 10));
    if (!g) return null;
    const m = /translate\(([\d.]+),([\d.]+)\)/.exec(g.getAttribute('transform')); return m ? { x: +m[1], y: +m[2] } : null;
  }

  /* ---------- events ---------- */
  function addLog(text) {
    log.unshift({ text, at: Date.now() }); log = log.slice(0, 6);
    const box = el.querySelector('#roomLog'); if (box) box.innerHTML = log.map(l => `<div class="logline">${esc(l.text)}</div>`).join('');
  }
  function renderMasters() {
    const list = Object.entries(masters).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const box = el.querySelector('#masters'); if (!box) return;
    box.innerHTML = list.length ? list.map(([n, c], i) => `<div class="row between small"><span>${['🥇','🥈','🥉','4.','5.'][i]} ${esc(n)}</span><b>${c} 💧</b></div>`).join('') : `<div class="small muted">${esc(ctx.t('noLoylyYet'))}</div>`;
  }
  function onEvent(ev) {
    const by = ev.by || '?';
    if (ev.type === 'loyly') { temp = Math.min(110, temp + 4); spawnSteam(26, true); masters[by] = (masters[by] || 0) + 1; renderMasters(); addLog(`💧 ${by} ${ctx.t('threw')}`); bubbles.push({ id: ev.id, emoji: '💧', at: Date.now(), until: Date.now() + 3000 }); el.querySelector('#tempText').textContent = Math.round(temp) + '°'; }
    else if (ev.type === 'react') { bubbles.push({ id: ev.id, emoji: ev.emoji, at: Date.now(), until: Date.now() + 3500 }); if (ev.emoji === '🙏') addLog(`🙏 ${by}: ${ctx.t('greet')}!`); if (ev.emoji === '🌿') addLog(`🌿 ${by} ${ctx.t('whisked')}`); }
    else if (ev.type === 'say') { const text = String(ev.text || '').slice(0, 80); bubbles = bubbles.filter(b => !(b.id === ev.id && b.text)); bubbles.push({ id: ev.id, text, at: Date.now(), until: Date.now() + 7000 }); addLog(`💬 ${by}: ${text}`); }
  }
  function send(ev) {
    ev.id = pid; ev.by = me.name;
    onEvent(ev);
    if (ch) ch.send({ type: 'broadcast', event: 'sk', payload: ev }).catch(() => {});
  }
  function track() {
    if (ch) ch.track(me).catch(() => {});
    else { people = [Object.assign({ id: pid }, me)]; placePeople(); }
  }

  /* ---------- presence ---------- */
  function syncPresence() {
    const st = ch.presenceState();
    const next = [];
    for (const key of Object.keys(st)) { const metas = st[key]; if (!metas || !metas.length) continue; const m = metas[metas.length - 1]; next.push(Object.assign({ id: key }, m)); }
    const before = new Set(people.map(p => p.id));
    for (const p of next) if (!before.has(p.id) && p.id !== pid && people.length) addLog(`🚪 ${p.name} ${ctx.t('entered')}`);
    const after = new Set(next.map(p => p.id));
    for (const p of people) if (!after.has(p.id) && p.id !== pid) addLog(`👋 ${p.name} ${ctx.t('leftRoom')}`);
    people = next.sort((a, b) => (a.since || 0) - (b.since || 0)); placePeople();
  }

  /* ---------- public ---------- */
  function enter(container, id, options) {
    leave();
    el = container; ctx = options; roomId = id;
    pid = pid || deviceId(ctx.deviceSuffix);
    const prof = ctx.profile();
    const name = prof.name || ctx.t('guest');
    me = { name, seat: SEATS[hash(pid) % SEATS.length].id, zone: 'in', hat: false, first: !!prof.firstTimer, since: Date.now() };
    people = []; steam = []; bubbles = []; log = []; masters = {}; temp = 80;
    enteredAt = Date.now(); inSince = enteredAt; rounds = 1; nudged = false;
    const t = ctx.t;
    el.innerHTML = `<div class="roomRoot">
      <div class="row between" style="margin:4px 0 6px">
        <div><div class="small muted">${esc(t('roomTitle'))}</div><h2 style="margin:0">🧖 ${esc(options.label || t('roomCommon'))}</h2></div>
        <div class="live"><span class="dot"></span> LIVE · <b id="presentCount">1</b> ${esc(t('present'))}</div>
      </div>
      <div class="roomWrap">${scene()}</div>
      <div class="roomMeta" id="roomMeta"><span>⏱ 0 ${esc(t('min'))} ${esc(t('inRoomFor'))}</span><span>🔁 1. ${esc(t('rounds'))}</span><span>🌡 80°C</span></div>
      <p class="small muted" style="margin:0 0 6px">${esc(t('seatHint'))}</p>
      <div class="pill-row" style="margin:8px 0">
        <button class="btn small" data-act="loyly">💧 ${esc(t('throwLoyly'))}</button>
        <button class="btn small secondary" data-act="vihta">🌿 ${esc(t('vihta'))}</button>
        <button class="btn small secondary" data-act="cool" id="coolBtn">❄️ ${esc(t('coolOff'))}</button>
        <button class="btn small secondary" data-act="greet">🙏 ${esc(t('greet'))}</button>
        <button class="btn small secondary" data-act="hat" id="hatBtn">🧢 ${esc(t('hat'))}</button>
      </div>
      <form class="row" id="sayForm" style="margin:8px 0">
        <input id="sayInput" maxlength="80" placeholder="${esc(t('sayPh'))}" style="flex:1;border:1px solid var(--line);background:var(--bg2);border-radius:999px;padding:9px 14px">
        <button class="btn small" type="submit">${esc(t('send'))}</button>
      </form>
      <div class="grid2">
        <div class="card" style="margin:6px 0"><h3>${esc(t('loylyMasters'))}</h3><div id="masters"></div></div>
        <div class="card" style="margin:6px 0"><h3>${esc(t('happening'))}</h3><div id="roomLog" class="small muted">${esc(t('quietRoom'))}</div></div>
      </div>
      <p class="small muted">${esc(t('roomRules'))}</p></div>`;
    const root = el.querySelector('.roomRoot');
    el.querySelector('#coolLabel').textContent = t('coolZone');

    el.querySelector('#roomSvg').addEventListener('click', e => {
      const hit = e.target.closest('[data-seat]'); if (!hit) return;
      me.seat = +hit.dataset.seat; if (me.zone === 'cool') { me.zone = 'in'; updateCoolBtn(); }
      track();
    });
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const act = b.dataset.act;
      if (act === 'loyly') { b.disabled = true; b.classList.add('pulse'); setTimeout(() => { b.disabled = false; b.classList.remove('pulse'); }, 1500); try { navigator.vibrate && navigator.vibrate(30); } catch (e) {} send({ type: 'loyly' }); }
      if (act === 'vihta') send({ type: 'react', emoji: '🌿' });
      if (act === 'greet') send({ type: 'react', emoji: '🙏' });
      if (act === 'hat') { me.hat = !me.hat; track(); }
      if (act === 'cool') { me.zone = me.zone === 'cool' ? 'in' : 'cool'; if (me.zone === 'in') { rounds++; inSince = Date.now(); nudged = false; } updateCoolBtn(); addLog(me.zone === 'cool' ? `❄️ ${me.name} ${t('wentOut')}` : `🔥 ${me.name} ${t('cameIn')}`); track(); }
    });
    el.querySelector('#sayForm').addEventListener('submit', e => {
      e.preventDefault(); const inp = el.querySelector('#sayInput'); const text = inp.value.trim(); if (!text) return; inp.value = ''; send({ type: 'say', text });
    });
    function updateCoolBtn(){ el.querySelector('#coolBtn').innerHTML = me.zone === 'cool' ? `🔥 ${esc(t('backIn'))}` : `❄️ ${esc(t('coolOff'))}`; }

    people = [Object.assign({ id: pid }, me)]; placePeople();
    lastTick = 0; raf = requestAnimationFrame(tick);
    if (ctx.client) {
      ch = getChannel(ctx.client, roomId);
      if (subscribed[roomId]) { track(); syncPresence(); }
    }
  }

  function leave() {
    if (raf) cancelAnimationFrame(raf); raf = null;
    if (ch) { const c = ch; ch = null; c.untrack().catch(() => {}); }
    roomId = null;
  }

  /* Count people in a room without entering it (for the home card). */
  function watch(client, id, cb) {
    if (!client) return;
    pid = pid || deviceId(cb.deviceSuffix || '');
    (watchers[id] = watchers[id] || []).push(cb);
    getChannel(client, id);
    if (counts[id] != null) cb(counts[id]);
  }

  return { enter, leave, watch, isOpen: () => !!raf, count: (id) => counts[id] || 0 };
})();
