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
    { y: 420, scale: 1.12, x0: 338, n: 7, dx: 72 },
    { y: 360, scale: 1.0,  x0: 352, n: 7, dx: 68 },
    { y: 300, scale: 0.9,  x0: 366, n: 7, dx: 64 },
  ];
  const FLOOR = { x0: 140, x1: 790, y0: 478, y1: 592 };
  const floorScale = (y) => 1.18 + (y - FLOOR.y0) / (FLOOR.y1 - FLOOR.y0) * 0.32;
  const SEATS = [];
  TIERS.forEach((tr, ti) => { for (let i = 0; i < tr.n; i++) SEATS.push({ id: ti * 10 + i, tier: ti, x: tr.x0 + i * tr.dx, y: tr.y, scale: tr.scale }); });

  let el, ctx, roomId, ch = null, pid, me, people = [], temp = 80, steam = [], bubbles = [], log = [], chat = [], masters = {}, raf = null, lastTick = 0, lastAmbient = 0, lastTemp = 0;
  let enteredAt = 0, rounds = 1, nudged = false, inSince = 0, throws = [], tonttuUntil = 0, lastTonttu = 0, soundOn = true, lastStarter = -1, quiz = null, duel = null, person = null;
  const channels = {}, subscribed = {}, counts = {}, metasByRoom = {}, watchers = {};
  let figure = { hat: 'none', towel: -1 };
  let faces = {}, reactBarFor = null, projectiles = [], lastMoose = -1, lastAurora = -1, shockUntil = 0;
  let pos = {}, dest = {}, lastMove = 0;   // floor positions and walk targets by person id
  const MOODS = [['😂','laugh'],['😍','love'],['😎','cool'],['😮‍💨','relax'],['😴','sleepy'],['🥵','hot'],['🥶','cold'],['🤔','think'],['😮','wow'],['🍺','beer']];
  const EMOJIS = ['😀','😂','😍','😎','😅','🤗','😮','🙏','👍','👏','❤️','🔥','💧','🌿','❄️','🧊','🍺','☕','🧖','🏊','🌲','🌙','⭐','🎉'];
  const MREACTS = ['❤️','🔥','😂','👍','🥶'];
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
    const planks = []; for (let y = 60; y < 460; y += 26) planks.push(`<line x1="0" y1="${y}" x2="800" y2="${y}"/>`);
    const boards = []; for (let y = 482; y < 600; y += 22) boards.push(`<line x1="0" y1="${y}" x2="800" y2="${y}"/>`);
    const stones = [];
    for (let i = 0; i < 14; i++) { const x = 160 + (i % 5) * 20 + (Math.floor(i / 5) % 2) * 10, y = 296 + Math.floor(i / 5) * 10; stones.push(`<ellipse cx="${x}" cy="${y}" rx="11" ry="8" fill="#55524f" stroke="#2e2c2a"/>`); }
    const flakes = []; for (let i = 0; i < 16; i++) flakes.push(`<circle cx="${30 + (i * 37) % 80}" cy="${130 + (i * 53) % 400}" r="${1.5 + (i % 3)}" fill="#fff" opacity=".7"/>`);
    const slats = (x, y, w, h) => { let s = ''; for (let i = 0; i < w; i += 24) s += `<rect x="${x + i}" y="${y}" width="22" height="${h}" rx="3" fill="url(#${u}bench)" stroke="#8a5a2b" stroke-opacity=".8"/><rect x="${x + i + 2}" y="${y + 1.5}" width="18" height="2" rx="1" fill="#fff" fill-opacity=".35"/>`; return s; };
    const u = mini ? 'p' : 'r';
    const grain = []; for (let x = 0; x < 800; x += 97) grain.push(`<line x1="${x}" y1="60" x2="${x + 3}" y2="460"/>`);
    const stars = []; for (let i = 0; i < 12; i++) stars.push(`<circle cx="${600 + (i * 53) % 130}" cy="${98 + (i * 29) % 40}" r="${0.8 + (i % 3) * 0.5}" fill="#fff" opacity="${0.5 + (i % 2) * 0.4}"/>`);
    return `
<svg viewBox="0 0 800 600" class="roomScene" xmlns="http://www.w3.org/2000/svg" ${mini ? '' : 'id="roomSvg"'}>
  <defs>
    <linearGradient id="${u}wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a2c16"/><stop offset=".45" stop-color="#7a4a26"/><stop offset="1" stop-color="#8f5c33"/></linearGradient>
    <linearGradient id="${u}bench" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0cf9a"/><stop offset="1" stop-color="#cf9a60"/></linearGradient>
    <linearGradient id="${u}face" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a86d3c"/><stop offset="1" stop-color="#6b3f1f"/></linearGradient>
    <linearGradient id="${u}night" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1830"/><stop offset="1" stop-color="#27507c"/></linearGradient>
    <linearGradient id="${u}cold" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0d2140"/><stop offset="1" stop-color="#2d5a8a"/></linearGradient>
    <linearGradient id="${u}steel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2f2f2f"/><stop offset=".5" stop-color="#5a5a5a"/><stop offset="1" stop-color="#2a2a2a"/></linearGradient>
    <radialGradient id="${u}glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffc466" stop-opacity="1"/><stop offset=".6" stop-color="#ff7a1a" stop-opacity=".45"/><stop offset="1" stop-color="#ff5a00" stop-opacity="0"/></radialGradient>
    <radialGradient id="${u}lamp" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffe2a8" stop-opacity=".55"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>
    <radialGradient id="${u}kiuaslight" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ff9a3c" stop-opacity=".28"/><stop offset="1" stop-color="#ff9a3c" stop-opacity="0"/></radialGradient>
    <radialGradient id="${u}vignette" cx=".5" cy=".55" r=".75"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></radialGradient>
    <radialGradient id="${u}fire" cx=".5" cy="1" r="1"><stop offset="0" stop-color="#fff1a8"/><stop offset=".45" stop-color="#ff8a1f"/><stop offset="1" stop-color="#9c1d08"/></radialGradient>
    <radialGradient id="${u}moon" cx=".5" cy=".5" r=".5"><stop offset=".5" stop-color="#fff5d6" stop-opacity=".9"/><stop offset="1" stop-color="#fff5d6" stop-opacity="0"/></radialGradient>
    <linearGradient id="${u}aurora" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3dff9a" stop-opacity="0"/><stop offset=".3" stop-color="#3dff9a"/><stop offset=".6" stop-color="#7ad3ff"/><stop offset=".85" stop-color="#c67bff"/><stop offset="1" stop-color="#c67bff" stop-opacity="0"/></linearGradient>
    <clipPath id="${u}winclip"><rect x="590" y="93" width="150" height="100" rx="4"/></clipPath>
    <clipPath id="${u}doorclip"><rect x="26" y="124" width="88" height="432"/></clipPath>
    <linearGradient id="${u}floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b3f1f"/><stop offset="1" stop-color="#3d2210"/></linearGradient>
    ${mini ? '' : `<filter id="${u}blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.5"/></filter>`}
  </defs>
  <rect width="800" height="600" fill="url(#${u}wall)"/>
  <g stroke="#2a170c" stroke-opacity=".5">${planks.join('')}</g>
  <g stroke="#ffd9a8" stroke-opacity=".07" transform="translate(0,1)">${planks.join('')}</g>
  <g stroke="#2a170c" stroke-opacity=".18">${grain.join('')}</g>
  <rect width="800" height="60" fill="#2b170a"/>
  <rect y="58" width="800" height="4" fill="#1d0f06"/>
  <!-- floor -->
  <rect y="460" width="800" height="140" fill="url(#${u}floor)"/>
  <g stroke="#1d0f06" stroke-opacity=".6">${boards.join('')}</g>
  <g stroke="#ffd9a8" stroke-opacity=".05" transform="translate(0,1)">${boards.join('')}</g>
  <rect y="458" width="800" height="5" fill="#241308"/>
  <circle cx="430" cy="585" r="9" fill="#1a0e06" stroke="#4a2c16" stroke-width="2"/><path d="M424 585 L436 585 M430 579 L430 591" stroke="#4a2c16" stroke-width="1.5"/>
  <!-- beer table -->
  <g class="hot" data-act="beertable" style="cursor:pointer" transform="translate(600,540)">
    <rect x="-34" y="-6" width="68" height="8" rx="3" fill="#b57c4a" stroke="#5b3a1f" stroke-width="2"/>
    <rect x="-26" y="2" width="6" height="36" fill="#8a5a2b"/><rect x="20" y="2" width="6" height="36" fill="#8a5a2b"/>
    <rect x="-30" y="-24" width="60" height="18" rx="3" fill="#f6ecd8" stroke="#8c5a35" stroke-width="2"/>
    <rect x="-22" y="-34" width="9" height="22" rx="2" fill="#f2b632" stroke="#8a5a1a"/><rect x="-22" y="-37" width="9" height="5" rx="2" fill="#fff8e1"/>
    <rect x="-5" y="-34" width="9" height="22" rx="2" fill="#f2b632" stroke="#8a5a1a"/><rect x="-5" y="-37" width="9" height="5" rx="2" fill="#fff8e1"/>
    <rect x="12" y="-34" width="9" height="22" rx="2" fill="#f2b632" stroke="#8a5a1a"/><rect x="12" y="-37" width="9" height="5" rx="2" fill="#fff8e1"/>
    ${mini ? '' : '<text x="0" y="56" text-anchor="middle" font-size="11" fill="#ffd166" font-family="Inter,sans-serif" class="kiuasHint">🍺</text>'}
  </g>
  <rect class="floorHit" x="${FLOOR.x0}" y="${FLOOR.y0 - 30}" width="${FLOOR.x1 - FLOOR.x0}" height="${FLOOR.y1 - FLOOR.y0 + 38}" fill="#fff" fill-opacity="0" style="cursor:pointer"/>
  <!-- kiuas light on the wall and the lantern -->
  <ellipse cx="215" cy="330" rx="260" ry="200" fill="url(#${u}kiuaslight)"/>
  <ellipse cx="500" cy="150" rx="230" ry="150" fill="url(#${u}lamp)"/>
  <g transform="translate(500,110)">
    <path d="M-14 -30 L14 -30 L10 -6 L-10 -6 Z" fill="#3b2a1c" stroke="#1d110a"/>
    <rect x="-9" y="-6" width="18" height="26" rx="3" fill="#ffd98a" stroke="#3b2a1c" stroke-width="2"/>
    <rect x="-5" y="-2" width="10" height="18" rx="2" fill="#fff3c4" class="flicker"/>
    <rect x="-11" y="20" width="22" height="5" rx="2" fill="#3b2a1c"/>
    <path d="M0 -30 L0 -40 L-40 -40" stroke="#1d110a" stroke-width="4" fill="none"/>
  </g>
  <!-- window -->
  <rect x="585" y="88" width="160" height="110" rx="6" fill="url(#${u}night)" stroke="#2b170a" stroke-width="10"/>
  <g clip-path="url(#${u}winclip)">
    <g class="aurora" style="opacity:.22">
      <path d="M580 120 Q620 95 660 118 T740 110" stroke="url(#${u}aurora)" stroke-width="16" fill="none" stroke-linecap="round" class="band b1"/>
      <path d="M585 135 Q630 112 670 132 T750 122" stroke="url(#${u}aurora)" stroke-width="12" fill="none" stroke-linecap="round" class="band b2"/>
    </g>
    <g>${stars.join('')}</g>
    <circle cx="700" cy="118" r="24" fill="url(#${u}moon)"/><circle cx="700" cy="118" r="12" fill="#fff6d8"/>
    <g class="snowfall">${[...Array(10)].map((_, i) => `<circle cx="${595 + (i * 41) % 145}" cy="${90 + (i * 37) % 100}" r="${1 + (i % 2)}" fill="#fff" opacity=".8"/>`).join('')}</g>
    <path d="M595 168 Q620 160 645 168 T695 168 T740 168 L740 192 L595 192 Z" fill="#dfe9f4"/>
    <path d="M595 168 Q620 162 645 168 T695 168 T740 168 L740 176 L595 176 Z" fill="#fff" fill-opacity=".5"/>
    <path d="M598 158 L622 126 L646 158 Z M650 160 L672 134 L694 160 Z M698 160 L716 140 L734 160 Z" fill="#102640"/>
    <path d="M598 158 L622 126 L646 158 Z M650 160 L672 134 L694 160 Z M698 160 L716 140 L734 160 Z" fill="#fff" fill-opacity=".12"/>
    <g class="moose" transform="translate(-100,0)" style="opacity:0">
      <g transform="scale(.55)" fill="#0b1a2e">
        <ellipse cx="0" cy="0" rx="26" ry="13"/><rect x="-22" y="6" width="5" height="20"/><rect x="-10" y="6" width="5" height="22"/><rect x="6" y="6" width="5" height="22"/><rect x="18" y="6" width="5" height="20"/>
        <path d="M20 -6 L34 -18 L44 -14 L40 -2 Z"/><path d="M30 -16 L26 -30 M34 -18 L38 -32 M30 -16 L22 -26 M34 -18 L44 -26" stroke="#0b1a2e" stroke-width="3" fill="none" stroke-linecap="round"/>
        <path d="M-26 -4 q-6 2 -4 8" stroke="#0b1a2e" stroke-width="3" fill="none"/>
      </g>
    </g>
  </g>
  <line x1="665" y1="88" x2="665" y2="198" stroke="#2b170a" stroke-width="6"/>
  <rect x="585" y="88" width="160" height="110" rx="6" fill="none" stroke="#3b2a1c" stroke-width="3"/>
  <!-- the door to the cold -->
  <g class="hot" data-act="cool" style="cursor:pointer">
    <rect x="22" y="120" width="96" height="440" rx="4" fill="url(#${u}cold)" stroke="#1d110a" stroke-width="8"/>
    <rect x="26" y="124" width="88" height="432" fill="#9fd0ff" fill-opacity=".08"/>
    <path d="M26 556 L114 556 L114 520 Q70 505 26 520 Z" fill="#e6eef7"/>
    <ellipse cx="70" cy="552" rx="30" ry="7" fill="#1b4a7a" stroke="#cfe6ff" stroke-width="2"/>
    <ellipse cx="70" cy="552" rx="22" ry="4" fill="#2d6aa3"/>
    <g clip-path="url(#${u}doorclip)"><g class="snowfall slow">${flakes.join('')}</g><g class="snowfall" transform="translate(0,-160)">${flakes.join('')}</g><g class="snowfall" transform="translate(0,-320)">${flakes.join('')}</g></g>
    <text x="70" y="140" text-anchor="middle" font-size="11" fill="#bfe0ff" font-family="Inter,sans-serif" class="coolLabel">Vilvoittelu</text>
  </g>
  <!-- vihta -->
  <g transform="translate(300,120)" class="hot" data-act="vihta" style="cursor:pointer">
    <circle cx="0" cy="-4" r="3" fill="#222"/>
    <path d="M0 0 L0 40" stroke="#6b4a2b" stroke-width="4"/>
    <ellipse cx="-12" cy="52" rx="14" ry="24" fill="#4e8a3d" transform="rotate(-15 -12 52)"/>
    <ellipse cx="12" cy="52" rx="14" ry="24" fill="#5fa04a" transform="rotate(15 12 52)"/>
    <ellipse cx="0" cy="58" rx="13" ry="26" fill="#74b35a"/>
    <ellipse cx="-3" cy="52" rx="6" ry="14" fill="#a3d68a" fill-opacity=".5"/>
  </g>
  <!-- thermometer -->
  <g transform="translate(400,100)">
    <rect x="-26" y="-18" width="52" height="54" rx="8" fill="#f6ecd8" stroke="#8c5a35" stroke-width="3"/>
    <text x="0" y="10" text-anchor="middle" font-size="18" font-weight="700" fill="#8c5a35" font-family="Outfit,Inter,sans-serif" class="tempText">80°</text>
    <text x="0" y="28" text-anchor="middle" font-size="9" fill="#8c5a35" font-family="Inter,sans-serif">löyly</text>
  </g>
  <g transform="translate(135,470)"><g class="tonttu" style="opacity:0;transition:opacity .6s">
    <ellipse cx="0" cy="40" rx="16" ry="20" fill="#9b2d2d"/>
    <ellipse cx="-8" cy="58" rx="6" ry="3" fill="#2b1d12"/><ellipse cx="8" cy="58" rx="6" ry="3" fill="#2b1d12"/>
    <circle cx="0" cy="12" r="12" fill="#f1c9a5"/>
    <path d="M-14 8 L0 -26 L14 8 Z" fill="#d32f2f"/><circle cx="0" cy="-26" r="4" fill="#fff"/>
    <path d="M-10 18 Q0 34 10 18 Z" fill="#eee"/>
    <circle cx="-4" cy="10" r="1.6" fill="#2b1d12"/><circle cx="4" cy="10" r="1.6" fill="#2b1d12"/>
    <path d="M14 30 q8 -10 6 -22" stroke="#f1c9a5" stroke-width="4" fill="none" stroke-linecap="round" class="tonttuArm"/>
  </g></g>
  <!-- kiuas -->
  <g class="hot" data-act="loyly" style="cursor:pointer">
    <rect x="200" y="110" width="18" height="190" fill="url(#${u}steel)"/>
    <rect x="150" y="290" width="118" height="170" rx="8" fill="url(#${u}steel)" stroke="#1a1a1a" stroke-width="3"/>
    <rect x="156" y="296" width="106" height="158" rx="6" fill="none" stroke="#777" stroke-opacity=".35"/>
    <rect x="150" y="285" width="118" height="12" rx="4" fill="#232323"/>
    <ellipse cx="209" cy="300" rx="90" ry="40" fill="url(#${u}glow)" class="kiuasGlow"/>
    ${stones.join('')}
    <ellipse cx="196" cy="320" rx="9" ry="6" fill="#ff8a3c" fill-opacity=".55"/><ellipse cx="226" cy="318" rx="7" ry="5" fill="#ff6a1a" fill-opacity=".45"/>
    <rect x="172" y="410" width="74" height="26" rx="4" fill="url(#${u}fire)"/>
    <g class="flames"><path d="M186 436 q-4 -10 4 -16 q0 8 6 10 q2 -8 8 -12 q-2 10 6 14 q4 -6 2 -12 q8 8 2 16 Z" fill="#ffd166" fill-opacity=".9" class="flame"/><path d="M196 436 q-2 -8 4 -12 q1 6 5 8 q3 -6 5 -9 q0 9 3 13 Z" fill="#fff3b0" class="flame f2"/></g>
    <rect x="172" y="410" width="74" height="26" rx="4" fill="none" stroke="#1a1a1a" stroke-width="3"/>
    <path d="M100 430 L108 470 L144 470 L152 430 Z" fill="#b57c4a" stroke="#5b3a1f" stroke-width="2"/>
    <path d="M104 440 L148 440" stroke="#7a4e28" stroke-width="2"/>
    <ellipse cx="126" cy="430" rx="26" ry="7" fill="#7cc0e8" stroke="#5b3a1f" stroke-width="2"/>
    <g class="ladle"><path d="M140 428 L178 392" stroke="#d9b07a" stroke-width="5" stroke-linecap="round"/><ellipse cx="180" cy="390" rx="8" ry="5" fill="#d9b07a" stroke="#5b3a1f"/></g>
    ${mini ? '' : '<text x="209" y="476" text-anchor="middle" font-size="11" fill="#ffd166" font-family="Inter,sans-serif" class="kiuasHint">💧</text>'}
  </g>
  <!-- lauteet: pale aspen tops, warm fronts -->
  <rect x="330" y="300" width="470" height="60" fill="url(#${u}face)"/><rect x="330" y="300" width="470" height="6" fill="#000" fill-opacity=".2"/>${slats(330, 292, 470, 14)}
  <rect x="315" y="360" width="485" height="60" fill="url(#${u}face)"/><rect x="315" y="360" width="485" height="6" fill="#000" fill-opacity=".2"/>${slats(315, 352, 485, 14)}
  <rect x="300" y="420" width="500" height="40" fill="url(#${u}face)"/><rect x="300" y="420" width="500" height="6" fill="#000" fill-opacity=".2"/>${slats(300, 412, 500, 14)}
  <rect width="800" height="600" fill="url(#${u}vignette)" pointer-events="none"/>
  <rect width="800" height="600" fill="#ff6a00" class="heatTint" style="opacity:0" pointer-events="none"/>
  <g class="seatHits"></g>
  <g class="people"></g>
  <g class="steam" ${mini ? '' : `filter="url(#${u}blur)"`}></g>
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
  const HAIR_COLORS = ['#2b1d12','#4a2c17','#8a5a2b','#d9b36a','#b23a2a','#1a1a1a','#6b6b6b','#e8d3a0'];
  const SKIN_SHADE = ['#d9a884','#c48f66','#a86f45','#8c5533','#6e3d22','#dbb897'];
  function hairFor(p, color) {
    const style = hash(p.name + 'h') % 6;
    const c = color;
    switch (style) {
      case 0: return `<path d="M-17 -70 Q-15 -90 0 -88 Q15 -90 17 -70 Q11 -79 0 -78 Q-11 -79 -17 -70 Z" fill="${c}"/>`;                                         // short
      case 1: return `<path d="M-17 -70 Q-15 -90 0 -88 Q15 -90 17 -70 Q11 -79 0 -78 Q-11 -79 -17 -70 Z" fill="${c}"/><circle cx="2" cy="-90" r="6.5" fill="${c}"/>`; // bun
      case 2: return `<path d="M-17 -68 Q-17 -92 0 -88 Q17 -92 17 -68 L19 -46 L12 -48 L12 -64 Q0 -76 -12 -64 L-12 -48 L-19 -46 Z" fill="${c}"/>`;             // long
      case 3: return `<g fill="${c}"><circle cx="-12" cy="-80" r="7"/><circle cx="0" cy="-86" r="8"/><circle cx="12" cy="-80" r="7"/><circle cx="-16" cy="-70" r="5"/><circle cx="16" cy="-70" r="5"/><circle cx="-6" cy="-84" r="6"/><circle cx="6" cy="-84" r="6"/></g>`; // curly
      case 4: return `<path d="M-17 -72 Q-10 -90 4 -90 Q17 -88 17 -72 Q14 -82 4 -82 Q-6 -80 -17 -72 Z" fill="${c}"/>`;                                         // side swept
      default: return `<ellipse cx="-5" cy="-78" rx="5" ry="3" fill="#fff" fill-opacity=".25"/>`;                                                               // bald shine
    }
  }
  function avatar(p, x, y, s, isMe, moving, faceLeft) {
    const ti = (p.towel >= 0 && p.towel < TOWELS.length) ? p.towel : hash(p.name) % TOWELS.length;
    const tow = TOWELS[ti], towDark = shade(tow, -22);
    const si = hash(p.name + 'k') % SKINS.length, skin = SKINS[si], skinD = SKIN_SHADE[si];
    const hairC = HAIR_COLORS[hash(p.name + 'c') % HAIR_COLORS.length];
    const crowned = p.crown && p.crown > Date.now();
    const hat = crowned ? HATS.crown : (HATS[p.hat] || (p.hat === true ? HATS.felt : ''));
    const ring = isMe ? `<ellipse cx="0" cy="10" rx="30" ry="8" fill="none" stroke="#ffd166" stroke-width="2.5" stroke-dasharray="4 3"/>` : '';
    const label = `<rect x="-30" y="12" width="60" height="15" rx="7" fill="#1f1b17" fill-opacity=".72"/><text x="0" y="23" text-anchor="middle" font-size="10.5" fill="#fff" font-family="Inter,sans-serif">${esc(p.name.slice(0, 10))}</text>`;
    const cold = p.zone === 'cool', hot = temp > 95 && !cold;
    const blush = cold ? .15 : hot ? .6 : .32;
    const mouth = cold ? `<path d="M-4 -60 q4 -3 8 0" stroke="#5a2d1a" stroke-width="1.4" fill="none"/>` : hot ? `<ellipse cx="0" cy="-59" rx="3" ry="2.4" fill="#5a2d1a"/>` : `<path d="M-5 -61 q5 5 10 0" stroke="#5a2d1a" stroke-width="1.5" fill="none" stroke-linecap="round"/>`;
    const standing = p.zone === 'floor' || cold;
    const legs = standing
      ? `<path d="M-14 -10 L-15 10 L-7 10 L-6 -8 Z M6 -8 L7 10 L15 10 L14 -10 Z" fill="${skin}"/><ellipse cx="-11" cy="11" rx="7" ry="3" fill="${skinD}"/><ellipse cx="11" cy="11" rx="7" ry="3" fill="${skinD}"/>`
      : `<path d="M-17 -12 L-17 6 L-10 6 L-10 -8 Z M10 -8 L10 6 L17 6 L17 -12 Z" fill="${skin}"/><ellipse cx="-13.5" cy="7.5" rx="6" ry="3" fill="${skinD}"/><ellipse cx="13.5" cy="7.5" rx="6" ry="3" fill="${skinD}"/>`;
    return `<g class="av" data-person="${esc(p.id)}" data-pname="${esc(p.name)}" transform="translate(${x},${y}) scale(${s})" style="cursor:${isMe?'default':'pointer'}">
      ${ring}
      <g transform="scale(${faceLeft ? -1 : 1},1)">
      <g class="${cold ? 'shiver' : moving ? 'walk' : 'bob'}" style="animation-delay:-${(hash(p.id || p.name) % 30) / 10}s">
      ${legs}
      <path d="M-21 -44 Q-24 -24 -23 -8 L23 -8 Q24 -24 21 -44 Q0 -53 -21 -44 Z" fill="${tow}" stroke="${towDark}" stroke-opacity=".7"/>
      <path d="M-21 -44 L6 -36 L7 -10" stroke="#000" stroke-opacity=".12" stroke-width="1.5" fill="none"/>
      <path d="M-23 -8 L23 -8 L24 -2 Q0 4 -24 -2 Z" fill="${towDark}"/>
      <path d="M-20 -42 Q-30 -30 -24 -12" stroke="${skin}" stroke-width="7.5" fill="none" stroke-linecap="round"/><circle cx="-23" cy="-10" r="4.5" fill="${skin}"/>
      ${armSvg((faces[p.id] && faces[p.id].until > Date.now()) ? faces[p.id].face : '', skin)}
      <rect x="-4.5" y="-58" width="9" height="12" fill="${skinD}"/>
      <circle cx="-16" cy="-67" r="3.5" fill="${skin}"/><circle cx="16" cy="-67" r="3.5" fill="${skin}"/>
      <circle cx="0" cy="-68" r="16.5" fill="${skin}"/>
      <path d="M-16.5 -68 A16.5 16.5 0 0 0 16.5 -68 A16.5 16.5 0 0 1 -16.5 -68 Z" fill="${skinD}" fill-opacity=".18"/>
      ${hairFor(p, hairC)}
      <circle cx="-9" cy="-62" r="3.6" fill="#e2645a" fill-opacity="${blush}"/><circle cx="9" cy="-62" r="3.6" fill="#e2645a" fill-opacity="${blush}"/>
      ${faceSvg((faces[p.id] && faces[p.id].until > Date.now()) ? faces[p.id].face : '', { hot, cold, hairC, mouth, skin })}
      ${hat}
      </g>
      </g>
      ${p.first ? `<text x="19" y="-80" font-size="12">🙋</text>` : ''}
      ${label}
    </g>`;
  }
  function armSvg(pose, skin) {
    if (pose === 'wave') return `<g class="wavehand"><path d="M20 -42 Q34 -56 28 -78" stroke="${skin}" stroke-width="7.5" fill="none" stroke-linecap="round"/><circle cx="28" cy="-80" r="5" fill="${skin}"/></g>`;
    if (pose === 'vihta') return `<g class="swing"><path d="M20 -42 Q36 -50 34 -70" stroke="${skin}" stroke-width="7.5" fill="none" stroke-linecap="round"/><circle cx="34" cy="-72" r="4.5" fill="${skin}"/><path d="M34 -72 L40 -92" stroke="#6b4a2b" stroke-width="3"/><ellipse cx="36" cy="-100" rx="7" ry="11" fill="#5fa04a" transform="rotate(-20 36 -100)"/><ellipse cx="46" cy="-98" rx="7" ry="11" fill="#74b35a" transform="rotate(15 46 -98)"/></g>`;
    if (pose === 'ladle') return `<path d="M20 -42 Q34 -40 30 -22" stroke="${skin}" stroke-width="7.5" fill="none" stroke-linecap="round"/><circle cx="30" cy="-20" r="4.5" fill="${skin}"/><path d="M30 -20 L52 -46" stroke="#d9b07a" stroke-width="4" stroke-linecap="round"/><ellipse cx="54" cy="-48" rx="7" ry="4.5" fill="#d9b07a" stroke="#5b3a1f"/>`;
    if (pose === 'snowhit') return `<path d="M20 -42 Q30 -30 24 -12" stroke="${skin}" stroke-width="7.5" fill="none" stroke-linecap="round"/><circle cx="23" cy="-10" r="4.5" fill="${skin}"/><circle cx="4" cy="-84" r="7" fill="#fff" fill-opacity=".9"/><circle cx="-6" cy="-80" r="4" fill="#fff" fill-opacity=".8"/><circle cx="12" cy="-78" r="3" fill="#fff" fill-opacity=".8"/>`;
    return `<path d="M20 -42 Q30 -30 24 -12" stroke="${skin}" stroke-width="7.5" fill="none" stroke-linecap="round"/><circle cx="23" cy="-10" r="4.5" fill="${skin}"/>`;
  }
  function faceSvg(face, o) {
    const eyes = `<g class="blink" style="animation-delay:-${(Math.random() * 4).toFixed(1)}s"><ellipse cx="-6" cy="-69" rx="2.7" ry="3.4" fill="#2b1d12"/><ellipse cx="6" cy="-69" rx="2.7" ry="3.4" fill="#2b1d12"/><circle cx="-5" cy="-70.5" r="1" fill="#fff"/><circle cx="7" cy="-70.5" r="1" fill="#fff"/></g>`;
    if (face === 'snowhit') face = 'cold';
    if (face === 'wave' || face === 'vihta' || face === 'ladle') face = 'laugh';
    const brows = `<path d="M-9.5 -75 q3.5 -2.5 7 0 M2.5 -75 q3.5 -2.5 7 0" stroke="${o.hairC}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`;
    if (face === 'tongue') return `<path d="M-9 -69 q3 -4.5 6 0" stroke="#2b1d12" stroke-width="1.8" fill="none" stroke-linecap="round"/><circle cx="6" cy="-69" r="3" fill="#2b1d12"/><circle cx="7" cy="-70.5" r="1" fill="#fff"/>${brows}<path d="M-5 -61 q5 4 10 0" stroke="#5a2d1a" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M1 -60 q4 0 4 5 q0 4 -4 4 q-3 0 -3 -4 Z" fill="#f06a7a"/>`;
    const sweat = `<path d="M15 -74 q3 5 0 8 q-3 -3 0 -8" fill="#9fd3f5"/><path d="M-17 -60 q2.5 4 0 7 q-2.5 -3 0 -7" fill="#9fd3f5"/>`;
    const smile = `<path d="M-5 -61 q5 5 10 0" stroke="#5a2d1a" stroke-width="1.5" fill="none" stroke-linecap="round"/>`;
    const happyEyes = `<path d="M-9 -69 q3 -4.5 6 0 M3 -69 q3 -4.5 6 0" stroke="#2b1d12" stroke-width="1.8" fill="none" stroke-linecap="round"/>`;
    switch (face) {
      case 'laugh': return `${happyEyes}${brows}<path d="M-7 -62 q7 10 14 0 Z" fill="#5a2d1a"/><path d="M-4 -57.5 q4 2.5 8 0 q-4 3 -8 0 Z" fill="#f28b9b"/><path d="M-7 -62 L7 -62" stroke="#fff" stroke-width="1.6"/><text x="15" y="-84" font-size="9" fill="#fff">ha!</text>`;
      case 'love': return `<text x="-6" y="-65" text-anchor="middle" font-size="10">❤️</text><text x="6" y="-65" text-anchor="middle" font-size="10">❤️</text>${brows}${smile}`;
      case 'cool': return `<rect x="-13" y="-73" width="11" height="7" rx="2" fill="#1a1a1a"/><rect x="2" y="-73" width="11" height="7" rx="2" fill="#1a1a1a"/><path d="M-2 -70 L2 -70 M-13 -71 L-16 -72 M13 -71 L16 -72" stroke="#1a1a1a" stroke-width="1.5"/><path d="M-4 -61 q4 3 8 0" stroke="#5a2d1a" stroke-width="1.5" fill="none" stroke-linecap="round"/>`;
      case 'relax': return `${happyEyes}${brows}${smile}<text x="14" y="-80" font-size="10">💨</text>`;
      case 'sleepy': return `<path d="M-9 -68 q3 2.5 6 0 M3 -68 q3 2.5 6 0" stroke="#2b1d12" stroke-width="1.8" fill="none" stroke-linecap="round"/>${brows}<ellipse cx="0" cy="-60" rx="2" ry="2.6" fill="#5a2d1a"/><text x="13" y="-84" font-size="9" fill="#fff" font-family="Inter,sans-serif">z z</text>`;
      case 'hot': return `${eyes}${brows}<ellipse cx="0" cy="-59" rx="3.5" ry="3" fill="#5a2d1a"/>${sweat}`;
      case 'cold': return `${eyes}${brows}<path d="M-4 -60 q4 -3 8 0" stroke="#4a7fb5" stroke-width="2.2" fill="none"/><text x="13" y="-84" font-size="10">❄️</text>`;
      case 'think': return `${eyes}<path d="M-9.5 -75 q3.5 -2.5 7 0 M2.5 -79 q3.5 -2.5 7 0" stroke="${o.hairC}" stroke-width="1.4" fill="none" stroke-linecap="round"/><path d="M-4 -60 L4 -61.5" stroke="#5a2d1a" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="-57" r="4" fill="${o.skin}"/><text x="14" y="-84" font-size="10">💭</text>`;
      case 'wow': return `<circle cx="-6" cy="-69" r="3.8" fill="#2b1d12"/><circle cx="6" cy="-69" r="3.8" fill="#2b1d12"/><circle cx="-5" cy="-70.5" r="1.3" fill="#fff"/><circle cx="7" cy="-70.5" r="1.3" fill="#fff"/><path d="M-9.5 -78 q3.5 -2.5 7 0 M2.5 -78 q3.5 -2.5 7 0" stroke="${o.hairC}" stroke-width="1.4" fill="none" stroke-linecap="round"/><ellipse cx="0" cy="-59" rx="3" ry="4" fill="#5a2d1a"/>`;
      case 'beer': return `${happyEyes}${brows}${smile}<rect x="25" y="-26" width="9" height="13" rx="2" fill="#f2b632" stroke="#8a5a1a"/><rect x="25" y="-28" width="9" height="4" rx="2" fill="#fff8e1"/><path d="M34 -22 q5 0 5 4 q0 4 -5 4" stroke="#8a5a1a" stroke-width="1.5" fill="none"/>`;
      default: return `${eyes}${brows}${o.mouth}${o.hot ? sweat : ''}`;
    }
  }
  function shade(hex, pct) {
    const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255, f = (v) => Math.max(0, Math.min(255, Math.round(v + (pct / 100) * (pct < 0 ? v : 255 - v))));
    return '#' + [f(r), f(g), f(b)].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  function layout(list) {
    const taken = {}, seated = [], cooling = [], floor = [];
    const sorted = list.slice().sort((a, b) => (a.since || 0) - (b.since || 0));
    for (const p of sorted) {
      if (p.zone === 'cool') { cooling.push(p); continue; }
      if (p.zone === 'floor') { floor.push(p); continue; }
      let seat = SEATS.find(s => s.id === p.seat && !taken[s.id]) || SEATS.find(s => !taken[s.id]);
      if (!seat) { floor.push(Object.assign({}, p, { zone: 'floor', x: 300 + floor.length * 60, y: 540 })); continue; }
      taken[seat.id] = p; seated.push({ p, seat });
    }
    seated.sort((a, b) => b.seat.tier - a.seat.tier);
    return { taken, seated, cooling, floor };
  }
  function coolPos(i) { return { x: 45 + (i % 2) * 36, y: 548 - Math.floor(i / 2) * 60 }; }
  function floorPos(p) {
    const cur = pos[p.id] || { x: p.x || 400, y: p.y || 540 };
    return { x: Math.max(FLOOR.x0, Math.min(FLOOR.x1, cur.x)), y: Math.max(FLOOR.y0, Math.min(FLOOR.y1, cur.y)) };
  }

  function placePeople() {
    const { taken, seated, cooling, floor } = layout(people);
    let html = seated.map(({ p, seat }) => avatar(p, seat.x, seat.y, seat.scale, p.id === pid)).join('');
    cooling.forEach((p, i) => { const c = coolPos(i); html += avatar(p, c.x, c.y, 0.85, p.id === pid) + `<text x="${c.x + 12}" y="${c.y - 70}" font-size="12">❄️</text>`; });
    floor.slice().sort((a, b) => floorPos(a).y - floorPos(b).y).forEach(p => { const c = floorPos(p); const moving = !!dest[p.id]; html += avatar(p, c.x, c.y, floorScale(c.y), p.id === pid, moving, moving && dest[p.id].x < c.x); });
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
    if (ts - lastAmbient > 420) { spawnSteam(1, false); lastAmbient = ts; windowTick(); }
    if (ts - lastTemp > 1000) {
      temp = Math.max(70, temp - (temp > 95 ? 0.12 : 0.05)); lastTemp = ts; el.querySelector('.tempText').textContent = Math.round(temp) + '°';
      const mins = Math.floor((Date.now() - enteredAt) / 60000);
      const meta = el.querySelector('#roomMeta'); if (meta) meta.innerHTML = `<span>⏱ ${mins} ${esc(ctx.t('min'))} ${esc(ctx.t('inRoomFor'))}</span><span>🔁 ${rounds}. ${esc(ctx.t('rounds'))}</span><span>🌡 ${Math.round(temp)}°C</span>`;
      if (!nudged && me.zone === 'in' && Date.now() - inSince > 15 * 60000) { nudged = true; ctx.toast(ctx.t('nudge')); addLog(`❄️ ${ctx.t('nudge')}`); }
      renderStrip(); renderMeter(); starterTick(); gameTick();
      if (me.crown && me.crown < Date.now()) { me.crown = 0; track(); }
      const expired = Object.keys(faces).filter(k => faces[k].until <= Date.now()); if (expired.length) { expired.forEach(k => delete faces[k]); placePeople(); }
    }
    moveTick(dt);
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
    // flying snowballs, vihtas and beers
    if (projectiles.length) {
      const live = [];
      let html = '';
      for (const pr of projectiles) {
        const k = Math.min(1, (now - pr.t0) / pr.dur);
        const x = pr.x0 + (pr.x1 - pr.x0) * k, y = pr.y0 + (pr.y1 - pr.y0) * k - Math.sin(k * Math.PI) * 90;
        html += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="22" text-anchor="middle" transform="rotate(${(k * 360).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})">${pr.emoji}</text>`;
        if (k >= 1) { if (pr.after) pr.after(); } else live.push(pr);
      }
      projectiles = live;
      el.querySelector('.bubbles').insertAdjacentHTML('beforeend', html);
    }
    const glow = el.querySelector('.kiuasGlow'); if (glow) glow.setAttribute('ry', (30 + (temp - 70) * 0.6).toFixed(1));
    const tint = el.querySelector('.heatTint'); if (tint) tint.style.opacity = Math.max(0, (temp - 92) / 160).toFixed(3);
    const tonttu = el.querySelector('.tonttu'); if (tonttu) { const show = now < tonttuUntil; tonttu.style.opacity = show ? 1 : 0; tonttu.classList.toggle('walk', show); }
    raf = requestAnimationFrame(tick);
  }
  /* Things seen through the window, on a shared clock so every phone sees them together. */
  function windowTick() {
    const now = Date.now();
    const mc = Math.floor(now / 420000), mp = now % 420000, mooseOn = mp < 14000;
    const moose = el.querySelector('.moose');
    if (moose) { moose.style.opacity = mooseOn ? 1 : 0; if (mooseOn) moose.setAttribute('transform', `translate(${(760 - (mp / 14000) * 220).toFixed(0)},150)`); }
    if (mooseOn && lastMoose !== mc) { lastMoose = mc; addChat({ sys: true, text: `🫎 ${ctx.t('moose')}` }); addLog(`🫎 ${ctx.t('moose')}`); }
    const ac = Math.floor((now + 150000) / 300000), ap = (now + 150000) % 300000, auroraOn = ap < 40000;
    const aurora = el.querySelector('.aurora');
    if (aurora) aurora.style.opacity = auroraOn ? (0.5 + 0.4 * Math.sin(ap / 2500)).toFixed(2) : .22;
    if (auroraOn && lastAurora !== ac) { lastAurora = ac; addChat({ sys: true, text: `🌌 ${ctx.t('aurora')}` }); addLog(`🌌 ${ctx.t('aurora')}`); }
  }
  function findPos(id) {
    const { seated, cooling, floor } = layout(people);
    const s = seated.find(e => e.p.id === id); if (s) return { x: s.seat.x, y: s.seat.y };
    const f = floor.find(e => e.id === id); if (f) return floorPos(f);
    const i = cooling.findIndex(e => e.id === id); return i >= 0 ? coolPos(i) : null;
  }
  function moveTick(dt) {
    let any = false;
    for (const id of Object.keys(dest)) {
      const d = dest[id], c = pos[id] || (pos[id] = { x: d.x, y: d.y + 1 });
      const dx = d.x - c.x, dy = d.y - c.y, dist = Math.hypot(dx, dy), step = 230 * dt / 1000;
      if (dist <= step) { pos[id] = { x: d.x, y: d.y }; delete dest[id]; } else { c.x += dx / dist * step; c.y += dy / dist * step; }
      any = true;
    }
    if (any) placePeople();
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
    m.at = m.at || Date.now(); m.mid = m.mid || ((m.id || 's') + '-' + m.at + '-' + Math.random().toString(36).slice(2, 5)); m.reacts = m.reacts || {}; m.who = m.who || {};
    chat.push(m); chat = chat.slice(-40); renderChat();
  }
  function renderChat() {
    const box = el.querySelector('#chatList'); if (!box) return;
    box.innerHTML = chat.length ? chat.map(m => {
      const reacts = Object.entries(m.reacts).filter(([, n]) => n > 0).map(([e, n]) => `<span class="mr">${e} ${n}</span>`).join('');
      const bar = reactBarFor === m.mid ? `<div class="mrbar">${MREACTS.map(e => `<button type="button" data-mr="${e}" data-mid="${esc(m.mid)}">${e}</button>`).join('')}</div>` : '';
      return `<div class="msg ${m.sys ? 'sys' : ''} ${m.id === pid ? 'mine' : ''} ${m.big ? 'big' : ''}" data-mid="${esc(m.mid)}">${m.by ? `<b>${esc(m.by)}</b> ` : ''}${esc(m.text)}<small>${clock(m.at)}</small>${reacts ? `<div class="mrs">${reacts}</div>` : ''}${bar}</div>`;
    }).join('') : `<div class="small muted">${esc(ctx.t('chatEmpty'))}</div>`;
    if (!reactBarFor) box.scrollTop = box.scrollHeight;
  }
  function setFace(id, face, ms) { faces[id] = { face, until: Date.now() + ms }; placePeople(); }
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
      el.querySelectorAll('.people .bob').forEach(g => { g.classList.remove('shock'); void g.getBBox(); g.classList.add('shock'); });
      if (duel && !duel.done) { const r = duel.tally[ev.id] || (duel.tally[ev.id] = { id: ev.id, name: by, n: 0, first: now }); r.n++; renderGame(); }
      renderMasters(); renderMeter(); addLog(`💧 ${by} ${t('threw')}`); bubbles.push({ id: ev.id, emoji: '💧', at: now, until: now + 3000 });
      el.querySelector('.tempText').textContent = Math.round(temp) + '°'; const l = el.querySelector('.ladle'); if (l) { l.classList.remove('pour'); void l.getBBox(); l.classList.add('pour'); }
    }
    else if (ev.type === 'react') {
      if (ev.target) {
        const line = `${ev.emoji} ${by} ${t(ev.verb || 'waved')} ${ev.targetName || ''}`; addLog(line); addChat({ sys: true, text: line });
        if (ev.verb === 'cheered') {
          setFace(ev.id, 'beer', 8000); setFace(ev.target, 'beer', 8000);
          bubbles.push({ id: ev.id, emoji: '🍻', at: now, until: now + 3000 }); bubbles.push({ id: ev.target, emoji: '🍻', at: now, until: now + 3000 });
          el.querySelectorAll('.people .av').forEach(a => { if (a.dataset.person === ev.id || a.dataset.person === ev.target) { const g = a.querySelector('.bob,.walk'); if (g) g.classList.add('clink'); } });
          ding(); setTimeout(ding, 180);
        } else if (ev.verb === 'teased') {
          setFace(ev.id, 'tongue', 3000); setFace(ev.target, 'wow', 1500); setTimeout(() => { if (raf) setFace(ev.target, 'laugh', 4000); }, 1500);
          const tl = D.TEASES[(ev.line || 0) % D.TEASES.length]; addChat({ id: ev.id, by, text: `😜 ${ev.targetName}: ${LP(tl)}`, mid: ev.mid });
          bubbles.push({ id: ev.id, emoji: '😜', at: now, until: now + 3000 });
        } else if (ev.verb === 'hifived') {
          setFace(ev.id, 'wave', 2500); setFace(ev.target, 'wave', 2500);
          bubbles.push({ id: ev.id, emoji: '✋', at: now, until: now + 2500 }); bubbles.push({ id: ev.target, emoji: '✋', at: now, until: now + 2500 }); ding();
        } else if (ev.verb === 'gaveLadle') {
          setFace(ev.target, 'ladle', 12000); bubbles.push({ id: ev.target, emoji: '🥄', at: now, until: now + 3000 });
        } else if (ev.verb === 'snowed' || ev.verb === 'whisked2' || ev.verb === 'offered') {
          const from = findPos(ev.id), to = findPos(ev.target);
          const after = ev.verb === 'snowed' ? () => setFace(ev.target, 'snowhit', 5000) : ev.verb === 'whisked2' ? () => setFace(ev.target, 'relax', 6000) : () => setFace(ev.target, 'beer', 9000);
          if (from && to) projectiles.push({ x0: from.x, y0: from.y - 70, x1: to.x, y1: to.y - 80, t0: now, dur: 700, emoji: ev.verb === 'snowed' ? '❄️' : ev.verb === 'whisked2' ? '🌿' : '🍺', after });
          else { after(); }
          if (ev.verb === 'snowed') setFace(ev.id, 'laugh', 3000);
          if (ev.verb === 'whisked2') setFace(ev.id, 'vihta', 3000);
        } else {
          bubbles.push({ id: ev.target, emoji: ev.emoji, at: now, until: now + 3500 });
          setFace(ev.id, 'wave', 2500);
        }
        if (ev.target === pid) { ctx.toast(`${ev.emoji} ${by}`); ding(); }
      } else {
        bubbles.push({ id: ev.id, emoji: ev.emoji, at: now, until: now + 3500 });
        if (ev.emoji === '🙏') { addLog(`🙏 ${by}: ${t('greet')}!`); setFace(ev.id, 'relax', 2500); }
        else if (ev.emoji === '🌿') { addLog(`🌿 ${by} ${t('whisked')}`); setFace(ev.id, 'vihta', 3000); }
        else addLog(`${ev.emoji} ${by}`);
      }
    }
    else if (ev.type === 'say') { const text = String(ev.text || '').slice(0, 80); bubbles = bubbles.filter(b => !(b.id === ev.id && b.text)); bubbles.push({ id: ev.id, text, at: now, until: now + 7000 }); addLog(`💬 ${by}: ${text}`); addChat({ id: ev.id, by, text, mid: ev.mid }); if (ev.id !== pid) ding(); }
    else if (ev.type === 'mood') { const face = String(ev.face || ''); setFace(ev.id, face, ev.ms || 9000); bubbles = bubbles.filter(b => !(b.id === ev.id && b.emoji)); bubbles.push({ id: ev.id, emoji: ev.emoji, at: now, until: now + 3500 }); if (ev.note) { addLog(`${ev.emoji} ${by} ${t(ev.note)}`); addChat({ sys: true, text: `${ev.emoji} ${by} ${t(ev.note)}` }); } else addChat({ id: ev.id, by, text: ev.emoji, big: true, mid: ev.mid }); if (ev.id !== pid) ding(); }
    else if (ev.type === 'move') { const p = people.find(x => x.id === ev.id); if (p) { if (p.zone !== 'floor') { const from = findPos(ev.id); if (from) pos[ev.id] = { x: from.x, y: Math.max(FLOOR.y0, from.y) }; } p.zone = 'floor'; p.x = ev.x; p.y = ev.y; } dest[ev.id] = { x: ev.x, y: ev.y }; if (!pos[ev.id]) pos[ev.id] = { x: ev.x, y: ev.y }; placePeople(); }
    else if (ev.type === 'mreact') { const m = chat.find(x => x.mid === ev.mid); if (!m) return; const key = ev.id + ':' + ev.emoji; if (m.who[key]) return; m.who[key] = true; m.reacts[ev.emoji] = (m.reacts[ev.emoji] || 0) + 1; renderChat(); if (m.id === pid && ev.id !== pid) { ctx.toast(`${ev.emoji} ${by}`); } }
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
    for (const p of next) {
      if (p.zone === 'floor' && p.x != null) {
        if (!pos[p.id]) pos[p.id] = { x: p.x, y: p.y };
        else if (!dest[p.id] && Math.hypot(pos[p.id].x - p.x, pos[p.id].y - p.y) > 3) dest[p.id] = { x: p.x, y: p.y };
      } else { delete dest[p.id]; delete pos[p.id]; }
    }
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
    people = []; steam = []; bubbles = []; log = []; chat = []; masters = {}; temp = 80; throws = []; tonttuUntil = 0; lastStarter = -1; quiz = null; duel = null; person = null; faces = {}; reactBarFor = null; projectiles = []; pos = {}; dest = {};
    lastMoose = Math.floor(Date.now() / 420000); lastAurora = Math.floor((Date.now() + 150000) / 300000);
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
      <div class="card chat">
        <div class="row between"><h3 style="margin:0">💬 ${esc(t('chat'))}</h3><span class="small muted">${esc(t('reactHint'))}</span></div>
        <div id="chatList" class="chatList"></div>
        <div class="moods"><span class="small muted">${esc(t('mood'))}</span>${MOODS.map(m => `<button class="chipbtn mood" data-mood="${m[1]}" data-emo="${m[0]}">${m[0]}</button>`).join('')}</div>
        <div class="phrases">${D.PHRASES.map(p => `<button class="chipbtn" data-phrase="${esc(p[0])}" title="${esc(p[1])}">${esc(p[0])}${ctx.lang() === 'en' ? ` <small>· ${esc(p[1])}</small>` : ''}</button>`).join('')}</div>
        <form class="row" id="sayForm" style="margin-top:8px">
          <button type="button" class="chipbtn" id="emojiBtn" title="Emoji">😊</button>
          <input id="sayInput" maxlength="80" placeholder="${esc(t('sayPh'))}" style="flex:1;min-width:0;border:1px solid var(--line);background:var(--bg);border-radius:999px;padding:9px 14px">
          <button class="btn small" type="submit">${esc(t('send'))}</button>
        </form>
        <div class="emojiGrid" id="emojiGrid" style="display:none">${EMOJIS.map(e => `<button type="button" data-ins="${e}">${e}</button>`).join('')}</div>
      </div>
      <div class="card personBar" id="personBar" style="display:none"></div>
      <div class="card gameBox" id="gameBox" style="display:none"></div>
      <p class="small muted" style="margin:4px 0 8px">${esc(t('floorHint'))}<br>${esc(t('tapHint'))}</p>
      <div class="pill-row" style="margin:8px 0">
        <button class="btn small" data-act="loyly">💧 ${esc(t('throwLoyly'))}</button>
        <button class="btn small secondary" data-act="vihta">🌿 ${esc(t('vihta'))}</button>
        <button class="btn small secondary" data-act="cool" id="coolBtn">❄️ ${esc(t('coolOff'))}</button>
        <button class="btn small secondary" data-act="greet">🙏 ${esc(t('greet'))}</button>
        <button class="btn small secondary" data-act="figure">🎭 ${esc(t('myFigure'))}</button>
        <button class="btn small lake" data-act="quiz">🧠 ${esc(t('quiz'))}</button>
        <button class="btn small lake" data-act="duel">💧 ${esc(t('duel'))}</button>
      </div>
      <div class="card figureBar" id="figureBar" style="display:none"></div>
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
          <button class="btn small" data-pact="cheers">🍻 ${esc(t('cheers'))}</button>
          <button class="btn small" data-pact="tease">😜 ${esc(t('tease'))}</button>
          <button class="btn small" data-pact="hifive">✋ ${esc(t('hifive'))}</button>
          <button class="btn small secondary" data-pact="wave">👋 ${esc(t('wave'))}</button>
          <button class="btn small secondary" data-pact="whisk">🌿 ${esc(t('whisk'))}</button>
          <button class="btn small secondary" data-pact="beer">🍺 ${esc(t('beer'))}</button>
          <button class="btn small secondary" data-pact="snow">☃️ ${esc(t('snow'))}</button>
          <button class="btn small secondary" data-pact="ladle">🥄 ${esc(t('ladle'))}</button>
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
      if (act === 'cool') { me.zone = me.zone === 'cool' ? 'in' : 'cool'; if (me.zone === 'in') { rounds++; inSince = Date.now(); nudged = false; } delete me.x; delete me.y; delete dest[pid]; delete pos[pid]; updateCoolBtn(); addLog(me.zone === 'cool' ? `❄️ ${me.name} ${t('wentOut')}` : `🔥 ${me.name} ${t('cameIn')}`); track(); }
    }
    root.addEventListener('click', e => {
      const seat = e.target.closest('[data-seat]');
      if (seat) { me.seat = +seat.dataset.seat; if (me.zone === 'cool') { rounds++; inSince = Date.now(); nudged = false; } me.zone = 'in'; delete me.x; delete me.y; delete dest[pid]; delete pos[pid]; updateCoolBtn(); track(); return; }
      const pr = e.target.closest('[data-person]');
      if (pr) { if (pr.dataset.person !== pid) showPerson(pr.dataset.person, pr.dataset.pname); return; }
      const pa = e.target.closest('[data-pact]');
      if (pa && person) {
        const k = pa.dataset.pact;
        if (k === 'close') { el.querySelector('#personBar').style.display = 'none'; person = null; return; }
        const map = { wave: ['👋', 'waved'], whisk: ['🌿', 'whisked2'], beer: ['🍺', 'offered'], snow: ['☃️', 'snowed'], cheers: ['🍻', 'cheered'], tease: ['😜', 'teased'], hifive: ['✋', 'hifived'], ladle: ['🥄', 'gaveLadle'] };
        send({ type: 'react', emoji: map[k][0], verb: map[k][1], target: person.id, targetName: person.name, line: Math.floor(Math.random() * D.TEASES.length), mid: pid + '-' + Date.now() });
        return;
      }
      const fh = e.target.closest('.floorHit');
      if (fh) {
        const svg = el.querySelector('#roomSvg'); const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
        const m = svg.getScreenCTM(); if (!m) return; const q = pt.matrixTransform(m.inverse());
        const x = Math.max(FLOOR.x0, Math.min(FLOOR.x1, q.x)), y = Math.max(FLOOR.y0, Math.min(FLOOR.y1, q.y));
        if (me.zone !== 'floor') { const from = findPos(pid); if (from) pos[pid] = { x: from.x, y: Math.max(FLOOR.y0, from.y) }; }
        if (me.zone === 'cool') { rounds++; inSince = Date.now(); nudged = false; updateCoolBtn(); }
        me.zone = 'floor'; me.x = x; me.y = y;
        send({ type: 'move', x, y }); track(); return;
      }
      if (e.target.closest('[data-act=beertable]')) { send({ type: 'mood', face: 'beer', emoji: '🍺', note: 'tookBeer', ms: 15000, mid: pid + '-' + Date.now() }); return; }
      const hat = e.target.closest('[data-hat]'); if (hat) { me.hat = hat.dataset.hat; figure.hat = me.hat; saveFigure(); track(); showFigure(); showFigure(); return; }
      const tw = e.target.closest('[data-towel]'); if (tw) { me.towel = +tw.dataset.towel; figure.towel = me.towel; saveFigure(); track(); showFigure(); showFigure(); return; }
      const qa = e.target.closest('[data-qa]'); if (qa && quiz && !quiz.done && quiz.mine == null) { const c = +qa.dataset.qa; send({ type: 'answer', q: quiz.q, choice: c, ok: c === D.QUIZ[quiz.q].a }); return; }
      const ph = e.target.closest('[data-phrase]'); if (ph) { send({ type: 'say', text: ph.dataset.phrase, mid: pid + '-' + Date.now() }); return; }
      const md = e.target.closest('[data-mood]'); if (md) { send({ type: 'mood', face: md.dataset.mood, emoji: md.dataset.emo, mid: pid + '-' + Date.now() }); return; }
      if (e.target.closest('#emojiBtn')) { const g = el.querySelector('#emojiGrid'); g.style.display = g.style.display === 'none' ? '' : 'none'; return; }
      const ins = e.target.closest('[data-ins]'); if (ins) { const inp = el.querySelector('#sayInput'); inp.value = (inp.value + ins.dataset.ins).slice(0, 80); inp.focus(); return; }
      const mr = e.target.closest('[data-mr]'); if (mr) { send({ type: 'mreact', mid: mr.dataset.mid, emoji: mr.dataset.mr }); reactBarFor = null; renderChat(); return; }
      const msg = e.target.closest('.msg[data-mid]'); if (msg && !msg.classList.contains('sys')) { reactBarFor = reactBarFor === msg.dataset.mid ? null : msg.dataset.mid; renderChat(); return; }
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'loyly') { if (Date.now() - (root._lastLoyly || 0) < 1500) return; root._lastLoyly = Date.now(); }
      doAct(b.dataset.act, b.tagName === 'BUTTON' ? b : el.querySelector('button[data-act=loyly]'));
    });
    el.querySelector('#sayForm').addEventListener('submit', e => {
      e.preventDefault(); const inp = el.querySelector('#sayInput'); const text = inp.value.trim(); if (!text) return; inp.value = ''; el.querySelector('#emojiGrid').style.display = 'none'; send({ type: 'say', text, mid: pid + '-' + Date.now() });
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
    const { seated, cooling, floor } = layout(metas || []);
    let html = seated.map(({ p, seat }) => avatar(p, seat.x, seat.y, seat.scale, p.id === pid)).join('');
    cooling.forEach((p, i) => { const c = coolPos(i); html += avatar(p, c.x, c.y, 0.85, false); });
    floor.forEach(p => { const c = { x: Math.max(FLOOR.x0, Math.min(FLOOR.x1, p.x || 400)), y: Math.max(FLOOR.y0, Math.min(FLOOR.y1, p.y || 540)) }; html += avatar(p, c.x, c.y, floorScale(c.y), false); });
    container.querySelector('.people').innerHTML = html;
  }

  function watch(client, id, cb) {
    if (!client) return;
    pid = pid || deviceId(cb.deviceSuffix || '');
    (watchers[id] = watchers[id] || []).push(cb);
    getChannel(client, id);
    if (counts[id] != null) cb(counts[id], (metasByRoom[id] || []).map(m => m.name), metasByRoom[id] || []);
  }

  return { enter, leave, watch, preview, isOpen: () => !!raf, count: (id) => counts[id] || 0, metas: (id) => metasByRoom[id] || [], _state: () => ({ me, pos, dest, people }) };
})();
