/* Saunakaverit - Löylyhuone: a shared virtual sauna. Everyone present sits on the lauteet as a
   small figure. Presence and events go over Supabase Realtime (no database rows); without a
   backend the room still works for one person. */
window.SK_ROOM = (function () {
  const D = window.SK_DATA;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const TOWELS = ['#e9b8a6','#b8d8e9','#cfe3b8','#f3d9a4','#d9c2ec','#f2bcd0','#bfe6dd','#f0cfa0'];
  const SKINS = ['#f1c9a5','#e0ac82','#c68b5b','#a96d45','#8a4f2e','#f5d6b8'];
  const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
  const pad = (n) => String(n).padStart(2, '0');
  const clock = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

  const TIERS = [
    { y: 440, scale: 1.18, x0: 338, n: 7, dx: 72 },
    { y: 372, scale: 1.04, x0: 352, n: 7, dx: 68 },
    { y: 308, scale: 0.92, x0: 366, n: 7, dx: 64 },
  ];
  const SEATS = [];
  TIERS.forEach((tr, ti) => { for (let i = 0; i < tr.n; i++) SEATS.push({ id: ti * 10 + i, tier: ti, x: tr.x0 + i * tr.dx, y: tr.y, scale: tr.scale }); });

  let el, ctx, roomId, ch = null, pid, me, people = [], temp = 80, steam = [], bubbles = [], log = [], chat = [], masters = {}, raf = null, lastTick = 0, lastAmbient = 0, lastTemp = 0;
  let enteredAt = 0, rounds = 1, nudged = false, inSince = 0, throws = [], tonttuUntil = 0, lastTonttu = 0, soundOn = true, lastStarter = -1, quiz = null, duel = null, person = null;
  const channels = {}, subscribed = {}, counts = {}, metasByRoom = {}, watchers = {};
  let figure = { hat: 'none', towel: -1 };
  try { soundOn = localStorage.getItem('saunakaverit.sound') !== 'off'; figure = Object.assign(figure, JSON.parse(localStorage.getItem('saunakaverit.figure') || '{}')); } catch (e) {}
  const L = (o) => ctx && ctx.lang() === 'en' ? o.en : o.fi;
  const LP = (pair) => ctx && ctx.lang() === 'en' ? pair[1] : pair[0];

  function deviceId(suffix) {
    const k = 'saunakaverit.pid' + (suffix || '');
    let v = null; try { v = localStorage.getItem(k); } catch (e) {}
    if (!v) { v = Math.random().toString(36).slice(2, 10) + Date.now().toString(36); try { localStorage.setItem(k, v); } catch (e) {} }
    return v;
  }

  function getChannel(client, id) {
    if (channels[id]) return channels[id];
    const c = client.channel('room:' + id, { config: { presence: { key: pid }, broadcast: { self: false } } });
    c.on('presence', { event: 'sync' }, () => {
      const st = c.presenceState();
      const metas = Object.keys(st).map(k => { const m = st[k]; return m && m.length ? Object.assign({ id: k }, m[m.length - 1]) : null; }).filter(Boolean);
      counts[id] = metas.length; metasByRoom[id] = metas;
      (watchers[id] || []).forEach(cb => cb(counts[id], metas.map(m => m.name), metas));
      if (raf && roomId === id) syncPresence();
    });
    c.on('broadcast', { event: 'sk' }, ({ payload }) => { if (raf && roomId === id) onEvent(payload || {}); });
    c.subscribe(status => { if (status === 'SUBSCRIBED') { subscribed[id] = true; if (raf && roomId === id) track(); } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') subscribed[id] = false; });
    channels[id] = c;
    return c;
  }

  /* ---------- sound ---------- */
  let audio = null;
  function hiss(big) {
    if (!soundOn) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      const dur = big ? 1.6 : 0.9, sr = audio.sampleRate, buf = audio.createBuffer(1, sr * dur, sr), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
      const src = audio.createBufferSource(); src.buffer = buf;
      const f = audio.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = big ? 2600 : 3400; f.Q.value = 0.6;
      const g = audio.createGain(); const t0 = audio.currentTime;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(big ? 0.5 : 0.25, t0 + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f); f.connect(g); g.connect(audio.destination); src.start(t0); src.stop(t0 + dur);
    } catch (e) {}
  }
  function ding() {
    if (!soundOn) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator(), g = audio.createGain(), t0 = audio.currentTime;
      o.type = 'sine'; o.frequency.setValueAtTime(880, t0); o.frequency.exponentialRampToValueAtTime(1320, t0 + 0.15);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      o.connect(g); g.connect(audio.destination); o.start(t0); o.stop(t0 + 0.5);
    } catch (e) {}
  }

  /* ---------- scene ---------- */
  function scene(mini) {
    const planks = []; for (let y = 60; y < 480; y += 26) planks.push(`<line x1="0" y1="${y}" x2="800" y2="${y}"/>`);
    const stones = [];
    for (let i = 0; i < 14; i++) { const x = 160 + (i % 5) * 20 + (Math.floor(i / 5) % 2) * 10, y = 296 + Math.floor(i / 5) * 10; stones.push(`<ellipse cx="${x}" cy="${y}" rx="11" ry="8" fill="#55524f" stroke="#2e2c2a"/>`); }
    const flakes = []; for (let i = 0; i < 14; i++) flakes.push(`<circle cx="${30 + (i * 37) % 80}" cy="${150 + (i * 53) % 260}" r="${1.5 + (i % 3)}" fill="#fff" opacity=".7"/>`);
    const slats = (x, y, w, h) => { let s = ''; for (let i = 0; i < w; i += 24) s += `<rect x="${x + i}" y="${y}" width="22" height="${h}" rx="3" fill="url(#bench)" stroke="#5b3a1f"/>`; return s; };
    const u = mini ? 'p' : 'r';
    return `
<svg viewBox="0 0 800 480" class="roomScene" xmlns="http://www.w3.org/2000/svg" ${mini ? '' : 'id="roomSvg"'}>
  <defs>
    <linearGradient id="${u}wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2415"/><stop offset="1" stop-color="#5c3b22"/></linearGradient>
    <linearGradient id="bench" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9a66b"/><stop offset="1" stop-color="#a66f3f"/></linearGradient>
    <linearGradient id="face" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8c5a35"/><stop offset="1" stop-color="#5a3519"/></linearGradient>
    <linearGradient id="night" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d1a2e"/><stop offset="1" stop-color="#1f3b5a"/></linearGradient>
    <radialGradient id="glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffb347" stop-opacity=".95"/><stop offset="1" stop-color="#ff6a00" stop-opacity="0"/></radialGradient>
    <radialGradient id="lamp" cx=".5" cy="0" r=".9"><stop offset="0" stop-color="#ffd9a0" stop-opacity=".35"/><stop offset="1" stop-color="#ffd9a0" stop-opacity="0"/></radialGradient>
    <radialGradient id="fire" cx=".5" cy="1" r="1"><stop offset="0" stop-color="#ffd166"/><stop offset=".5" stop-color="#ff7a1a"/><stop offset="1" stop-color="#b3200a"/></radialGradient>
  </defs>
  <rect width="800" height="480" fill="url(#${u}wall)"/>
  <g stroke="#2a170c" stroke-opacity=".55">${planks.join('')}</g>
  <rect width="800" height="60" fill="#241308"/>
  <ellipse cx="420" cy="60" rx="380" ry="200" fill="url(#lamp)"/>
  <rect x="585" y="88" width="160" height="110" rx="6" fill="url(#night)" stroke="#1d110a" stroke-width="10"/>
  <circle cx="700" cy="118" r="13" fill="#f6ecc9"/>
  <path d="M595 165 Q620 158 645 165 T695 165 T740 165 L740 192 L595 192 Z" fill="#17304a"/>
  <path d="M595 150 L620 128 L645 150 Z M650 150 L672 132 L694 150 Z" fill="#0b1626"/>
  <line x1="665" y1="88" x2="665" y2="198" stroke="#1d110a" stroke-width="6"/>
  <g class="hot" data-act="cool" style="cursor:pointer">
    <rect x="22" y="120" width="96" height="340" rx="4" fill="url(#night)" stroke="#1d110a" stroke-width="8"/>
    <g>${flakes.join('')}</g>
    <text x="70" y="140" text-anchor="middle" font-size="11" fill="#9fc3e6" font-family="Inter,sans-serif" class="coolLabel">Vilvoittelu</text>
  </g>
  <g transform="translate(300,120)" class="hot" data-act="vihta" style="cursor:pointer">
    <circle cx="0" cy="-4" r="3" fill="#222"/>
    <path d="M0 0 L0 40" stroke="#6b4a2b" stroke-width="4"/>
    <ellipse cx="-12" cy="52" rx="14" ry="24" fill="#4f7a3c" transform="rotate(-15 -12 52)"/>
    <ellipse cx="12" cy="52" rx="14" ry="24" fill="#5f8c45" transform="rotate(15 12 52)"/>
    <ellipse cx="0" cy="58" rx="13" ry="26" fill="#6a9a4c"/>
  </g>
  <g transform="translate(400,100)">
    <rect x="-26" y="-18" width="52" height="54" rx="8" fill="#f1e6d2" stroke="#8c5a35" stroke-width="3"/>
    <text x="0" y="10" text-anchor="middle" font-size="18" font-weight="700" fill="#8c5a35" font-family="Outfit,Inter,sans-serif" class="tempText">80°</text>
    <text x="0" y="28" text-anchor="middle" font-size="9" fill="#8c5a35" font-family="Inter,sans-serif">löyly</text>
  </g>
  <g class="tonttu" style="opacity:0;transition:opacity .6s" transform="translate(130,330)">
    <ellipse cx="0" cy="40" rx="16" ry="20" fill="#9b2d2d"/>
    <circle cx="0" cy="12" r="12" fill="#f1c9a5"/>
    <path d="M-14 8 L0 -26 L14 8 Z" fill="#c62828"/><circle cx="0" cy="-26" r="4" fill="#fff"/>
    <path d="M-10 18 Q0 34 10 18 Z" fill="#eee"/>
    <circle cx="-4" cy="10" r="1.6" fill="#2b1d12"/><circle cx="4" cy="10" r="1.6" fill="#2b1d12"/>
  </g>
  <g class="hot" data-act="loyly" style="cursor:pointer">
    <rect x="200" y="110" width="18" height="190" fill="#2c2c2c"/>
    <rect x="150" y="290" width="118" height="170" rx="8" fill="#3b3b3b" stroke="#1f1f1f" stroke-width="3"/>
    <rect x="150" y="285" width="118" height="12" rx="4" fill="#2a2a2a"/>
    <ellipse cx="209" cy="300" rx="80" ry="34" fill="url(#glow)" class="kiuasGlow"/>
    ${stones.join('')}
    <rect x="172" y="410" width="74" height="26" rx="4" fill="url(#fire)"/>
    <rect x="172" y="410" width="74" height="26" rx="4" fill="none" stroke="#1f1f1f" stroke-width="3"/>
    <path d="M100 430 L108 470 L144 470 L152 430 Z" fill="#9c6a3e" stroke="#5b3a1f" stroke-width="2"/>
    <ellipse cx="126" cy="430" rx="26" ry="7" fill="#6fa8c9" stroke="#5b3a1f" stroke-width="2"/>
    <g class="ladle"><path d="M140 428 L178 392" stroke="#c9a06a" stroke-width="5" stroke-linecap="round"/><ellipse cx="180" cy="390" rx="8" ry="5" fill="#c9a06a" stroke="#5b3a1f"/></g>
    ${mini ? '' : '<text x="209" y="476" text-anchor="middle" font-size="11" fill="#ffd166" font-family="Inter,sans-serif" class="kiuasHint">💧</text>'}
  </g>
  <rect x="330" y="308" width="470" height="64" fill="url(#face)"/>${slats(330, 300, 470, 14)}
  <rect x="315" y="372" width="485" height="68" fill="url(#face)"/>${slats(315, 364, 485, 14)}
  <rect x="300" y="440" width="500" height="40" fill="url(#face)"/>${slats(300, 432, 500, 14)}
  <g class="seatHits"></g>
  <g class="people"></g>
  <g class="steam"></g>
  <g class="bubbles"></g>
</svg>`;
  }

  const HATS = {
    none: '',
    felt: `<path d="M-16 -74 Q0 -96 16 -74 Z" fill="#d9d2c5" stroke="#8a8071"/><rect x="-19" y="-76" width="38" height="6" rx="3" fill="#d9d2c5" stroke="#8a8071"/>`,
    tonttu: `<path d="M-15 -74 L4 -106 L15 -74 Z" fill="#c62828"/><circle cx="4" cy="-106" r="4" fill="#fff"/><rect x="-17" y="-78" width="34" height="6" rx="3" fill="#fff"/>`,
    viking: `<path d="M-15 -74 Q0 -92 15 -74 Z" fill="#7d7d7d" stroke="#555"/><path d="M-14 -78 Q-27 -84 -22 -100" stroke="#eee" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M14 -78 Q27 -84 22 -100" stroke="#eee" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    bucket: `<path d="M-14 -72 L-16 -96 L16 -96 L14 -72 Z" fill="#6fa8c9" stroke="#2b5d7a"/><rect x="-18" y="-99" width="36" height="5" rx="2" fill="#2b5d7a"/>`,
    crown: `<path d="M-14 -76 L-14 -92 L-7 -84 L0 -98 L7 -84 L14 -92 L14 -76 Z" fill="#ffd166" stroke="#b8860b"/>`,
  };
  function avatar(p, x, y, s, isMe) {
    const tow = (p.towel >= 0 && TOWELS[p.towel]) || TOWELS[hash(p.name) % TOWELS.length], skin = SKINS[hash(p.name + 'k') % SKINS.length];
    const crowned = p.crown && p.crown > Date.now();
    const hat = crowned ? HATS.crown : (HATS[p.hat] || (p.hat === true ? HATS.felt : ''));
    const ring = isMe ? `<ellipse cx="0" cy="2" rx="26" ry="7" fill="none" stroke="#ffd166" stroke-width="2.5" stroke-dasharray="4 3"/>` : '';
    const label = `<rect x="-30" y="6" width="60" height="15" rx="7" fill="#1f1b17" fill-opacity=".75"/><text x="0" y="17" text-anchor="middle" font-size="10.5" fill="#fff" font-family="Inter,sans-serif">${esc(p.name.slice(0, 10))}</text>`;
    const cold = p.zone === 'cool';
    return `<g class="av" data-person="${esc(p.id)}" data-pname="${esc(p.name)}" transform="translate(${x},${y}) scale(${s})" style="cursor:${isMe?'default':'pointer'}">
      ${ring}
      <g class="${cold ? 'shiver' : 'bob'}" style="animation-delay:-${(hash(p.id || p.name) % 30) / 10}s">
      <path d="M-18 -8 L-20 -48 Q0 -56 20 -48 L18 -8 Q0 2 -18 -8 Z" fill="${tow}" stroke="#5b3a1f" stroke-opacity=".5"/>
      <rect x="-22" y="-14" width="44" height="12" rx="6" fill="${tow}" stroke="#5b3a1f" stroke-opacity=".4"/>
      <circle cx="-9" cy="-4" r="4" fill="${skin}"/><circle cx="9" cy="-4" r="4" fill="${skin}"/>
      <circle cx="0" cy="-66" r="15" fill="${skin}" stroke="#5b3a1f" stroke-opacity=".3"/>
      <circle cx="-5" cy="-68" r="1.6" fill="#2b1d12"/><circle cx="5" cy="-68" r="1.6" fill="#2b1d12"/>
      <path d="M-5 -60 Q0 -57 5 -60" stroke="#2b1d12" stroke-width="1.3" fill="none"/>
      ${temp > 95 && !cold ? '<path d="M14 -70 q3 4 0 7 q-3 -3 0 -7" fill="#9fd3f5"/>' : ''}
      ${hat}
      </g>
      ${p.first ? `<text x="18" y="-74" font-size="12">🙋</text>` : ''}
      ${label}
    </g>`;
  }

  function layout(list) {
    const taken = {}, seated = [], cooling = [];
    const sorted = list.slice().sort((a, b) => (a.since || 0) - (b.since || 0));
    for (const p of sorted) {
      if (p.zone === 'cool') { cooling.push(p); continue; }
      let seat = SEATS.find(s => s.id === p.seat && !taken[s.id]) || SEATS.find(s => !taken[s.id]);
      if (!seat) { cooling.push(p); continue; }
      taken[seat.id] = p; seated.push({ p, seat });
    }
    seated.sort((a, b) => b.seat.tier - a.seat.tier);
    return { taken, seated, cooling };
  }
  function coolPos(i) { return { x: 45 + (i % 2) * 36, y: 445 - Math.floor(i / 2) * 60 }; }

  function placePeople() {
    const { taken, seated, cooling } = layout(people);
    let html = seated.map(({ p, seat }) => avatar(p, seat.x, seat.y, seat.scale, p.id === pid)).join('');
    cooling.forEach((p, i) => { const c = coolPos(i); html += avatar(p, c.x, c.y, 0.85, p.id === pid) + `<text x="${c.x + 12}" y="${c.y - 70}" font-size="12">❄️</text>`; });
    el.querySelector('.people').innerHTML = html;
    el.querySelector('.seatHits').innerHTML = SEATS.filter(s => !taken[s.id]).map(s => `<ellipse cx="${s.x}" cy="${s.y - 20 * s.scale}" rx="${24 * s.scale}" ry="${30 * s.scale}" fill="#fff" fill-opacity=".02" stroke="#ffd166" stroke-opacity=".12" stroke-dasharray="3 3" data-seat="${s.id}" style="cursor:pointer"/>`).join('');
    el.querySelector('#presentCount').textContent = people.length;
    renderMasters(); renderStrip();
  }
  function renderStrip() {
    const box = el.querySelector('#peopleStrip'); if (!box) return;
    const now = Date.now();
    box.innerHTML = people.slice().sort((a, b) => (a.since || 0) - (b.since || 0)).map(p => {
      const mins = Math.max(0, Math.floor((now - (p.since || now)) / 60000));
      const crowned = p.crown && p.crown > now;
      return `<span class="pchip ${p.id === pid ? 'me' : ''}" data-person="${esc(p.id)}" data-pname="${esc(p.name)}"><i style="background:${TOWELS[(p.towel >= 0 ? p.towel : hash(p.name) % TOWELS.length)]}">${esc(p.name.charAt(0).toUpperCase())}</i>${crowned ? '👑 ' : ''}${esc(p.name)} <small>${p.zone === 'cool' ? '❄️' : mins + ' ' + esc(ctx.t('min'))}</small></span>`;
    }).join('');
  }

  /* ---------- steam, temperature, bubbles, timers ---------- */
  function spawnSteam(n, big) {
    for (let i = 0; i < n; i++) steam.push({ x: 209 + (Math.random() - .5) * 90, y: 292, r: big ? 14 + Math.random() * 22 : 6 + Math.random() * 8, vy: big ? 0.9 + Math.random() * 1.1 : 0.35 + Math.random() * 0.4, vx: (Math.random() - .5) * 0.6, life: 1, decay: big ? 0.006 : 0.009 });
  }
  function tick(ts) {
    const dt = Math.min(50, ts - (lastTick || ts)); lastTick = ts;
    if (ts - lastAmbient > 420) { spawnSteam(1, false); lastAmbient = ts; }
    if (ts - lastTemp > 1000) {
      temp = Math.max(70, temp - (temp > 95 ? 0.12 : 0.05)); lastTemp = ts; el.querySelector('.tempText').textContent = Math.round(temp) + '°';
      const mins = Math.floor((Date.now() - enteredAt) / 60000);
      const meta = el.querySelector('#roomMeta'); if (meta) meta.innerHTML = `<span>⏱ ${mins} ${esc(ctx.t('min'))} ${esc(ctx.t('inRoomFor'))}</span><span>🔁 ${rounds}. ${esc(ctx.t('rounds'))}</span><span>🌡 ${Math.round(temp)}°C</span>`;
      if (!nudged && me.zone === 'in' && Date.now() - inSince > 15 * 60000) { nudged = true; ctx.toast(ctx.t('nudge')); addLog(`❄️ ${ctx.t('nudge')}`); }
      renderStrip(); renderMeter(); starterTick(); gameTick();
      if (me.crown && me.crown < Date.now()) { me.crown = 0; track(); }
    }
    for (const s of steam) { s.y -= s.vy * dt / 16; s.x += s.vx * dt / 16; s.r += 0.06 * dt / 16; s.life -= s.decay * dt / 16; }
    steam = steam.filter(s => s.life > 0 && s.y > -40);
    el.querySelector('.steam').innerHTML = steam.map(s => `<circle cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="${s.r.toFixed(1)}" fill="#fff" fill-opacity="${(s.life * 0.28).toFixed(3)}"/>`).join('');
    const now = Date.now();
    bubbles = bubbles.filter(b => b.until > now);
    el.querySelector('.bubbles').innerHTML = bubbles.map(b => {
      const pos = findPos(b.id); if (!pos) return '';
      const age = (now - b.at) / 1000;
      if (b.emoji) return `<text x="${pos.x + 14}" y="${pos.y - 95 - age * 12}" font-size="22" opacity="${Math.max(0, 1 - age / 4)}">${b.emoji}</text>`;
      const w = Math.min(260, 14 + b.text.length * 6.2);
      return `<g transform="translate(${Math.min(790 - w, Math.max(10, pos.x - w / 2))},${pos.y - 118})"><rect width="${w}" height="24" rx="12" fill="#fff" fill-opacity=".95"/><text x="${w / 2}" y="16" text-anchor="middle" font-size="11" fill="#1f1b17" font-family="Inter,sans-serif">${esc(b.text)}</text></g>`;
    }).join('');
    const glow = el.querySelector('.kiuasGlow'); if (glow) glow.setAttribute('ry', (30 + (temp - 70) * 0.6).toFixed(1));
    const tonttu = el.querySelector('.tonttu'); if (tonttu) tonttu.style.opacity = now < tonttuUntil ? 1 : 0;
    raf = requestAnimationFrame(tick);
  }
  function findPos(id) {
    const { seated, cooling } = layout(people);
    const s = seated.find(e => e.p.id === id); if (s) return { x: s.seat.x, y: s.seat.y };
    const i = cooling.findIndex(e => e.id === id); return i >= 0 ? coolPos(i) : null;
  }
  function renderMeter() {
    const bar = el.querySelector('#meterFill'); if (!bar) return;
    const now = Date.now(); throws = throws.filter(t => now - t < 60000);
    bar.style.width = (Math.min(8, throws.length) / 8 * 100) + '%';
    el.querySelector('#meterText').textContent = `${throws.length}/8`;
    if (throws.length >= 8 && now - lastTonttu > 120000) { lastTonttu = now; tonttuUntil = now + 12000; throws = []; spawnSteam(60, true); hiss(true); addLog(`🧝 ${ctx.t('tonttu')}`); addChat({ sys: true, text: `🧝 ${ctx.t('tonttu')}` }); ctx.toast(ctx.t('tonttu')); }
  }
  function starterTick() {
    const idx = Math.floor(Date.now() / 240000) % D.STARTERS.length;
    if (idx === lastStarter) return;
    lastStarter = idx;
    addChat({ sys: true, by: ctx.t('starterBy'), text: `💭 ${LP(D.STARTERS[idx])}` });
  }

  /* ---------- chat and log ---------- */
  function addLog(text) {
    log.unshift({ text, at: Date.now() }); log = log.slice(0, 6);
    const box = el.querySelector('#roomLog'); if (box) box.innerHTML = log.map(l => `<div class="logline">${esc(l.text)}</div>`).join('');
  }
  function addChat(m) {
    m.at = m.at || Date.now(); chat.push(m); chat = chat.slice(-40); renderChat();
  }
  function renderChat() {
    const box = el.querySelector('#chatList'); if (!box) return;
    box.innerHTML = chat.length ? chat.map(m => `<div class="msg ${m.sys ? 'sys' : ''} ${m.id === pid ? 'mine' : ''}">${m.by ? `<b>${esc(m.by)}</b> ` : ''}${esc(m.text)}<small>${clock(m.at)}</small></div>`).join('') : `<div class="small muted">${esc(ctx.t('chatEmpty'))}</div>`;
    box.scrollTop = box.scrollHeight;
  }
  function renderMasters() {
    const list = Object.entries(masters).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const box = el.querySelector('#masters'); if (!box) return;
    box.innerHTML = list.length ? list.map(([n, c], i) => `<div class="row between small"><span>${['🥇','🥈','🥉','4.','5.'][i]} ${esc(n)}</span><b>${c} 💧</b></div>`).join('') : `<div class="small muted">${esc(ctx.t('noLoylyYet'))}</div>`;
  }

  /* ---------- games ---------- */
  function renderGame() {
    const box = el.querySelector('#gameBox'); if (!box) return;
    const t = ctx.t, now = Date.now();
    if (quiz) {
      const q = D.QUIZ[quiz.q], Q = L(q);
      const left = Math.max(0, Math.ceil((quiz.at + 20000 - now) / 1000));
      box.style.display = '';
      box.innerHTML = `<div class="small muted">🧠 ${esc(t('quiz'))} · ${esc(quiz.by)}${quiz.done ? '' : ` · ${left} ${esc(t('secondsLeft'))}`}</div>
        <h3>${esc(Q[0])}</h3>
        <div class="qopts">${Q[1].map((o, i) => `<button class="btn small ${quiz.done ? (i === q.a ? '' : 'secondary') : (quiz.mine === i ? '' : 'secondary')}" data-qa="${i}" ${quiz.done || quiz.mine != null ? 'disabled' : ''}>${esc(o)}${quiz.done && i === q.a ? ' ✓' : ''}</button>`).join('')}</div>
        ${quiz.done ? `<p class="small"><b>${quiz.winner ? `🏆 ${esc(quiz.winner)} ${esc(t('winner'))}!` : esc(t('nobody'))}</b> · ${esc(t('correctIs'))}: ${esc(Q[1][q.a])}</p>` : ''}
        ${quiz.answers.length ? `<div class="small muted">${quiz.answers.map(a => `${a.ok ? '✅' : '❌'} ${esc(a.by)}`).join(' · ')}</div>` : ''}`;
    } else if (duel) {
      const left = Math.max(0, Math.ceil((duel.at + 30000 - now) / 1000));
      const rows = Object.values(duel.tally).sort((a, b) => b.n - a.n);
      box.style.display = '';
      box.innerHTML = `<div class="small muted">💧 ${esc(t('duel'))} · ${esc(duel.by)}</div>
        <h3>${duel.done ? esc(t('duelOver')) : `${esc(t('duelLive'))} <b>${left}</b> ${esc(t('secondsLeft'))}`}</h3>
        <div class="small">${rows.length ? rows.map((r, i) => `${i === 0 && duel.done ? '👑' : '💧'} ${esc(r.name)}: <b>${r.n}</b>`).join(' · ') : esc(t('tally')) + ': 0'}</div>
        ${duel.done && rows.length ? `<p class="small"><b>🏆 ${esc(rows[0].name)} ${esc(t('winner'))}!</b> ${esc(t('crownNote'))}.</p>` : ''}`;
    } else { box.style.display = 'none'; box.innerHTML = ''; }
  }
  function gameTick() {
    const now = Date.now();
    if (quiz) {
      if (!quiz.done && now - quiz.at > 20000) { quiz.done = true; quiz.doneAt = now; addLog(`🧠 ${quiz.winner ? quiz.winner + ' ' + ctx.t('winner') : ctx.t('nobody')}`); }
      if (quiz.done && now - (quiz.doneAt || now) > 15000) quiz = null;
      renderGame();
    }
    if (duel) {
      if (!duel.done && now - duel.at > 30000) {
        duel.done = true; duel.doneAt = now;
        const rows = Object.values(duel.tally).sort((a, b) => b.n - a.n || a.first - b.first);
        if (rows.length) {
          addLog(`👑 ${rows[0].name} ${ctx.t('winner')} (${rows[0].n} 💧)`); addChat({ sys: true, text: `👑 ${rows[0].name} ${ctx.t('winner')} · ${ctx.t('duel')}` });
          if (rows[0].id === pid) { me.crown = now + 10 * 60000; track(); ctx.toast(ctx.t('youWon')); ding(); }
        }
      }
      if (duel.done && now - (duel.doneAt || now) > 15000) duel = null;
      renderGame();
    }
  }

  /* ---------- events ---------- */
  function onEvent(ev) {
    const by = ev.by || '?', t = ctx.t, now = Date.now();
    if (ev.type === 'loyly') {
      temp = Math.min(110, temp + 4); spawnSteam(26, true); hiss(false); throws.push(now); masters[by] = (masters[by] || 0) + 1;
      if (duel && !duel.done) { const r = duel.tally[ev.id] || (duel.tally[ev.id] = { id: ev.id, name: by, n: 0, first: now }); r.n++; renderGame(); }
      renderMasters(); renderMeter(); addLog(`💧 ${by} ${t('threw')}`); bubbles.push({ id: ev.id, emoji: '💧', at: now, until: now + 3000 });
      el.querySelector('.tempText').textContent = Math.round(temp) + '°'; const l = el.querySelector('.ladle'); if (l) { l.classList.remove('pour'); void l.getBBox(); l.classList.add('pour'); }
    }
    else if (ev.type === 'react') {
      if (ev.target) {
        bubbles.push({ id: ev.target, emoji: ev.emoji, at: now, until: now + 3500 });
        const line = `${ev.emoji} ${by} ${t(ev.verb || 'waved')} ${ev.targetName || ''}`; addLog(line); addChat({ sys: true, text: line });
        if (ev.target === pid) { ctx.toast(`${ev.emoji} ${by}`); ding(); }
      } else {
        bubbles.push({ id: ev.id, emoji: ev.emoji, at: now, until: now + 3500 });
        if (ev.emoji === '🙏') addLog(`🙏 ${by}: ${t('greet')}!`); else if (ev.emoji === '🌿') addLog(`🌿 ${by} ${t('whisked')}`); else addLog(`${ev.emoji} ${by}`);
      }
    }
    else if (ev.type === 'say') { const text = String(ev.text || '').slice(0, 80); bubbles = bubbles.filter(b => !(b.id === ev.id && b.text)); bubbles.push({ id: ev.id, text, at: now, until: now + 7000 }); addLog(`💬 ${by}: ${text}`); addChat({ id: ev.id, by, text }); if (ev.id !== pid) ding(); }
    else if (ev.type === 'quiz') { if (quiz && !quiz.done) return; quiz = { q: ev.q % D.QUIZ.length, at: ev.at || now, by, answers: [], mine: null, done: false, winner: null }; addLog(`🧠 ${by} ${t('quizStarted')}`); addChat({ sys: true, text: `🧠 ${by} ${t('quizStarted')}` }); ding(); renderGame(); }
    else if (ev.type === 'answer') { if (!quiz || ev.q !== quiz.q) return; if (ev.id === pid) quiz.mine = ev.choice; if (!quiz.answers.some(a => a.id === ev.id)) quiz.answers.push({ id: ev.id, by, ok: !!ev.ok }); if (ev.ok && !quiz.winner) { quiz.winner = by; quiz.done = true; quiz.doneAt = now; addLog(`🏆 ${by} ${t('answered')}`); addChat({ sys: true, text: `🏆 ${by} ${t('answered')} · ${t('quiz')}` }); } renderGame(); }
    else if (ev.type === 'duel') { if (duel && !duel.done) return; duel = { at: ev.at || now, by, tally: {}, done: false }; addLog(`💧 ${by} ${t('duelStarted')}`); addChat({ sys: true, text: `💧 ${by} ${t('duelStarted')}` }); ctx.toast(t('duelLive')); ding(); renderGame(); }
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
  function syncPresence() {
    const next = (metasByRoom[roomId] || []).slice();
    const before = new Set(people.map(p => p.id));
    for (const p of next) if (!before.has(p.id) && p.id !== pid && people.length) { addLog(`🚪 ${p.name} ${ctx.t('entered')}`); addChat({ sys: true, text: `🚪 ${p.name} ${ctx.t('entered')}` }); }
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
    me = { name, seat: SEATS[hash(pid) % SEATS.length].id, zone: 'in', hat: figure.hat, towel: figure.towel, crown: 0, first: !!prof.firstTimer, since: Date.now() };
    people = []; steam = []; bubbles = []; log = []; chat = []; masters = {}; temp = 80; throws = []; tonttuUntil = 0; lastStarter = -1; quiz = null; duel = null; person = null;
    enteredAt = Date.now(); inSince = enteredAt; rounds = 1; nudged = false;
    const t = ctx.t, nx = ctx.next;
    el.innerHTML = `<div class="roomRoot">
      <div class="row between" style="margin:4px 0 6px">
        <div><div class="small muted">${esc(t('roomTitle'))}</div><h2 style="margin:0">🧖 ${esc(options.label || t('roomCommon'))}</h2></div>
        <div class="row"><button class="chipbtn ghost" data-act="sound" id="soundBtn" title="${esc(t('sound'))}">${soundOn ? '🔊' : '🔇'}</button><div class="live"><span class="dot"></span> LIVE · <b id="presentCount">1</b> ${esc(t('present'))}</div></div>
      </div>
      <div class="roomWrap">${scene(false)}</div>
      <div class="meter"><span>🔥 ${esc(t('yhteisloyly'))}</span><div class="bar"><div id="meterFill"></div></div><b id="meterText">0/8</b></div>
      <div class="roomMeta" id="roomMeta"><span>⏱ 0 ${esc(t('min'))} ${esc(t('inRoomFor'))}</span><span>🔁 1. ${esc(t('rounds'))}</span><span>🌡 80°C</span></div>
      <div class="pstrip" id="peopleStrip"></div>
      <p class="small muted" style="margin:4px 0 8px">${esc(t('tapHint'))}</p>
      <div class="card personBar" id="personBar" style="display:none"></div>
      <div class="card gameBox" id="gameBox" style="display:none"></div>
      <div class="pill-row" style="margin:8px 0">
        <button class="btn small" data-act="loyly">💧 ${esc(t('throwLoyly'))}</button>
        <button class="btn small secondary" data-act="vihta">🌿 ${esc(t('vihta'))}</button>
        <button class="btn small secondary" data-act="cool" id="coolBtn">❄️ ${esc(t('coolOff'))}</button>
        <button class="btn small secondary" data-act="greet">🙏 ${esc(t('greet'))}</button>
        <button class="btn small secondary" data-act="figure">🎭 ${esc(t('myFigure'))}</button>
      </div>
      <div class="card figureBar" id="figureBar" style="display:none"></div>
      <div class="pill-row emo">${['😮‍💨','😌','🔥','❄️','🍺','😂'].map(e => `<button class="chipbtn" data-act="emo" data-emo="${e}">${e}</button>`).join('')}
        <span class="small muted" style="align-self:center;margin-left:4px">${esc(t('games'))}:</span>
        <button class="chipbtn" data-act="quiz">🧠 ${esc(t('quiz'))}</button><button class="chipbtn" data-act="duel">💧 ${esc(t('duel'))}</button></div>
      <div class="card chat">
        <h3 style="margin-bottom:6px">💬 ${esc(t('chat'))}</h3>
        <div id="chatList" class="chatList"></div>
        <div class="phrases">${D.PHRASES.map(p => `<button class="chipbtn" data-phrase="${esc(p[0])}" title="${esc(p[1])}">${esc(p[0])}${ctx.lang() === 'en' ? ` <small>· ${esc(p[1])}</small>` : ''}</button>`).join('')}</div>
        <form class="row" id="sayForm" style="margin-top:8px">
          <input id="sayInput" maxlength="80" placeholder="${esc(t('sayPh'))}" style="flex:1;border:1px solid var(--line);background:var(--bg);border-radius:999px;padding:9px 14px">
          <button class="btn small" type="submit">${esc(t('send'))}</button>
        </form>
      </div>
      ${nx ? `<div class="card nextCard" data-open="${esc(nx.id)}"><div><div class="small muted">🔥 ${esc(t('nextSauna'))}</div><b>${esc(nx.text)}</b></div><span class="btn small">${esc(nx.cta)} →</span></div>` : ''}
      <div class="grid2">
        <div class="card" style="margin:6px 0"><h3>${esc(t('loylyMasters'))}</h3><div id="masters"></div></div>
        <div class="card" style="margin:6px 0"><h3>${esc(t('happening'))}</h3><div id="roomLog" class="small muted">${esc(t('quietRoom'))}</div></div>
      </div>
      <p class="small muted">${esc(t('roomRules'))}</p></div>`;
    const root = el.querySelector('.roomRoot');
    el.querySelector('.coolLabel').textContent = t('coolZone');
    renderChat();
    function updateCoolBtn(){ el.querySelector('#coolBtn').innerHTML = me.zone === 'cool' ? `🔥 ${esc(t('backIn'))}` : `❄️ ${esc(t('coolOff'))}`; }
    function showPerson(id, name) {
      person = { id, name };
      const bar = el.querySelector('#personBar'); bar.style.display = '';
      bar.innerHTML = `<div class="row between wrap"><b>${esc(name)} · ${esc(t('personActions'))}</b><button class="chipbtn ghost" data-pact="close">✕</button></div>
        <div class="pill-row" style="margin-top:6px">
          <button class="btn small" data-pact="wave">👋 ${esc(t('wave'))}</button>
          <button class="btn small secondary" data-pact="whisk">🌿 ${esc(t('whisk'))}</button>
          <button class="btn small secondary" data-pact="beer">🍺 ${esc(t('beer'))}</button>
          <button class="btn small secondary" data-pact="snow">☃️ ${esc(t('snow'))}</button>
        </div>`;
    }
    function showFigure() {
      const bar = el.querySelector('#figureBar'); const open = bar.style.display === 'none'; bar.style.display = open ? '' : 'none'; if (!open) return;
      bar.innerHTML = `<div class="small muted">${esc(t('hatLabel'))}</div><div class="pill-row" style="margin:4px 0 8px">${Object.keys(D.HATS).filter(h => h !== 'crown').map(h => `<button class="chipbtn ${me.hat === h ? 'active' : ''}" data-hat="${h}">${esc(L(D.HATS[h]))}</button>`).join('')}</div>
        <div class="small muted">${esc(t('towelLabel'))}</div><div class="pill-row" style="margin-top:4px">${TOWELS.map((c, i) => `<button class="swatch ${me.towel === i ? 'on' : ''}" data-towel="${i}" style="background:${c}"></button>`).join('')}</div>`;
    }
    function doAct(act, b) {
      if (act === 'loyly') { if (b) { b.disabled = true; b.classList.add('pulse'); setTimeout(() => { b.disabled = false; b.classList.remove('pulse'); }, 1500); } try { navigator.vibrate && navigator.vibrate(30); } catch (e) {} send({ type: 'loyly' }); }
      if (act === 'vihta') send({ type: 'react', emoji: '🌿' });
      if (act === 'greet') send({ type: 'react', emoji: '🙏' });
      if (act === 'emo') send({ type: 'react', emoji: b.dataset.emo });
      if (act === 'figure') showFigure();
      if (act === 'quiz') { if (quiz && !quiz.done) return; send({ type: 'quiz', q: Math.floor(Math.random() * D.QUIZ.length), at: Date.now() }); }
      if (act === 'duel') { if (duel && !duel.done) return; send({ type: 'duel', at: Date.now() }); }
      if (act === 'sound') { soundOn = !soundOn; try { localStorage.setItem('saunakaverit.sound', soundOn ? 'on' : 'off'); } catch (e) {} el.querySelector('#soundBtn').textContent = soundOn ? '🔊' : '🔇'; if (soundOn) hiss(false); }
      if (act === 'cool') { me.zone = me.zone === 'cool' ? 'in' : 'cool'; if (me.zone === 'in') { rounds++; inSince = Date.now(); nudged = false; } updateCoolBtn(); addLog(me.zone === 'cool' ? `❄️ ${me.name} ${t('wentOut')}` : `🔥 ${me.name} ${t('cameIn')}`); track(); }
    }
    root.addEventListener('click', e => {
      const seat = e.target.closest('[data-seat]');
      if (seat) { me.seat = +seat.dataset.seat; if (me.zone === 'cool') { me.zone = 'in'; rounds++; inSince = Date.now(); updateCoolBtn(); } track(); return; }
      const pr = e.target.closest('[data-person]');
      if (pr) { if (pr.dataset.person !== pid) showPerson(pr.dataset.person, pr.dataset.pname); return; }
      const pa = e.target.closest('[data-pact]');
      if (pa && person) {
        const k = pa.dataset.pact;
        if (k === 'close') { el.querySelector('#personBar').style.display = 'none'; person = null; return; }
        const map = { wave: ['👋', 'waved'], whisk: ['🌿', 'whisked2'], beer: ['🍺', 'offered'], snow: ['☃️', 'snowed'] };
        send({ type: 'react', emoji: map[k][0], verb: map[k][1], target: person.id, targetName: person.name });
        return;
      }
      const hat = e.target.closest('[data-hat]'); if (hat) { me.hat = hat.dataset.hat; figure.hat = me.hat; saveFigure(); track(); showFigure(); showFigure(); return; }
      const tw = e.target.closest('[data-towel]'); if (tw) { me.towel = +tw.dataset.towel; figure.towel = me.towel; saveFigure(); track(); showFigure(); showFigure(); return; }
      const qa = e.target.closest('[data-qa]'); if (qa && quiz && !quiz.done && quiz.mine == null) { const c = +qa.dataset.qa; send({ type: 'answer', q: quiz.q, choice: c, ok: c === D.QUIZ[quiz.q].a }); return; }
      const ph = e.target.closest('[data-phrase]'); if (ph) { send({ type: 'say', text: ph.dataset.phrase }); return; }
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'loyly') { if (Date.now() - (root._lastLoyly || 0) < 1500) return; root._lastLoyly = Date.now(); }
      doAct(b.dataset.act, b.tagName === 'BUTTON' ? b : el.querySelector('button[data-act=loyly]'));
    });
    el.querySelector('#sayForm').addEventListener('submit', e => {
      e.preventDefault(); const inp = el.querySelector('#sayInput'); const text = inp.value.trim(); if (!text) return; inp.value = ''; send({ type: 'say', text });
    });

    people = [Object.assign({ id: pid }, me)]; placePeople();
    lastTick = 0; raf = requestAnimationFrame(tick);
    starterTick();
    if (ctx.client) {
      ch = getChannel(ctx.client, roomId);
      if (subscribed[roomId]) { track(); syncPresence(); }
    }
  }
  function saveFigure(){ try { localStorage.setItem('saunakaverit.figure', JSON.stringify(figure)); } catch (e) {} }

  function leave() {
    if (raf) cancelAnimationFrame(raf); raf = null;
    if (ch) { const c = ch; ch = null; c.untrack().catch(() => {}); }
    roomId = null;
  }

  function preview(container, metas) {
    if (!container) return;
    if (!container.querySelector('svg')) container.innerHTML = scene(true);
    const { seated, cooling } = layout(metas || []);
    let html = seated.map(({ p, seat }) => avatar(p, seat.x, seat.y, seat.scale, p.id === pid)).join('');
    cooling.forEach((p, i) => { const c = coolPos(i); html += avatar(p, c.x, c.y, 0.85, false); });
    container.querySelector('.people').innerHTML = html;
  }

  function watch(client, id, cb) {
    if (!client) return;
    pid = pid || deviceId(cb.deviceSuffix || '');
    (watchers[id] = watchers[id] || []).push(cb);
    getChannel(client, id);
    if (counts[id] != null) cb(counts[id], (metasByRoom[id] || []).map(m => m.name), metasByRoom[id] || []);
  }

  return { enter, leave, watch, preview, isOpen: () => !!raf, count: (id) => counts[id] || 0, metas: (id) => metasByRoom[id] || [] };
})();
