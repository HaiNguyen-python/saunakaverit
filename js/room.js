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
    { y: 420, scale: 1.12, x0: 978, n: 7, dx: 72 },
    { y: 360, scale: 1.0,  x0: 992, n: 7, dx: 68 },
    { y: 300, scale: 0.9,  x0: 1006, n: 7, dx: 64 },
  ];
  /* The world: terrace 0..640, sauna 640..1440, lounge 1440..2000. The camera shows 900 of it. */
  const WORLD_W = 2000, VIEW_W = 900, SAUNA_X0 = 640, LOUNGE_X0 = 1440;
  const isOutside = (x) => x < SAUNA_X0;
  function clampFloor(x, y) { x = Math.max(30, Math.min(WORLD_W - 30, x)); const y0 = isOutside(x) ? 430 : 478; return { x, y: Math.max(y0, Math.min(670, y)) }; }
  const floorScale = (y) => 1.0 + (y - 430) / 240 * 0.5;
  let cam = 550, camHold = 0, suppressClick = false;
  const SEATS = [];
  TIERS.forEach((tr, ti) => { for (let i = 0; i < tr.n; i++) SEATS.push({ id: ti * 10 + i, tier: ti, x: tr.x0 + i * tr.dx, y: tr.y, scale: tr.scale }); });

  let el, ctx, roomId, ch = null, pid, me, people = [], temp = 80, steam = [], bubbles = [], log = [], chat = [], masters = {}, raf = null, lastTick = 0, lastAmbient = 0, lastTemp = 0;
  let enteredAt = 0, rounds = 1, nudged = false, inSince = 0, throws = [], tonttuUntil = 0, lastTonttu = 0, soundOn = true, lastStarter = -1, quiz = null, duel = null, person = null;
  const channels = {}, subscribed = {}, counts = {}, metasByRoom = {}, watchers = {};
  let figure = { hat: 'none', towel: -1 };
  let faces = {}, reactBarFor = null, projectiles = [], lastMoose = -1, lastAurora = -1, shockUntil = 0;
  let pos = {}, dest = {}, lastMove = 0;   // floor positions and walk targets by person id
  let counters = {}, hero = false, imprints = [], warned = {}, snowfight = null, dipAt = 0, angelAt = 0, lastStage = 0, hotWarned = false, tonttuCallAt = 0;
  let singers = {}, npc = null, npcStage = -1, stats = {}, ladle = null, throwTimes = [], lastKiuasScold = 0, lastKiuasLonely = 0, lastLoylyAt = 0, pcut = false, lastPcut = -1, lastAval = -1, lastPentti = -1, lastChorus = 0;
  let petPos = {}, fireworks = [], sledding = {}, fishing = {}, fishAt = 0, catchAt = 0;
  /* Progression: sauna points, levels, titles, weekly leaderboard */
  let prog = { points: 0, totals: {}, week: 0 }, scoreQueue = {}, lastFlush = 0, flushing = false, lb = [], lbAt = 0, menuOpen = null;
  const POINT_VALUES = { loyly: 1, perfect: 3, dip: 5, angel: 2, rocket: 1, sled: 2, fish: 3, cheers: 2, quiz: 10, vocab: 10, duel: 15, snowfight: 15, song: 1, tease: 1, thaw: 5, water: 5, challenge: 20, round: 3, host: 25, word: 1 };
  const levelFor = (pts) => { let lv = D.LEVELS[0]; for (const l of D.LEVELS) if (pts >= l.min) lv = l; return lv; };
  const nextLevel = (pts) => D.LEVELS.find(l => l.min > pts) || null;
  const titlesFor = (totals) => D.TITLES.filter(x => (totals[x.key] || 0) >= x.n);
  const bestTitle = (totals) => { const got = titlesFor(totals); return got.length ? got[got.length - 1] : null; };
  const serverPoints = () => !!(ctx.addPoints && (!ctx.isOnline || ctx.isOnline()));
  function score(kind, n) {
    n = n || 1; if (!POINT_VALUES[kind]) return;
    if (!serverPoints()) {
      const before = { lv: levelFor(prog.points), titles: titlesFor(prog.totals).length };
      prog.points += POINT_VALUES[kind] * n; prog.week += POINT_VALUES[kind] * n; prog.totals[kind] = (prog.totals[kind] || 0) + n;
      try { localStorage.setItem('saunakaverit.prog', JSON.stringify(prog)); } catch (e) {}
      afterProg(before); return;
    }
    scoreQueue[kind] = (scoreQueue[kind] || 0) + n;
  }
  async function flushScores() {
    if (flushing || !serverPoints()) return; const kinds = Object.keys(scoreQueue); if (!kinds.length) return;
    flushing = true; const batch = scoreQueue; scoreQueue = {};
    const before = { lv: levelFor(prog.points), titles: titlesFor(prog.totals).length };
    let gained = 0;
    for (const k of kinds) { try { const r = await ctx.addPoints(k, batch[k]); if (r) { prog.points = r.points; prog.totals = r.totals || prog.totals; prog.week = r.week; gained += r.gain || 0; } } catch (e) {} }
    flushing = false;
    if (ctx.onProg) ctx.onProg(prog);
    if (gained) ctx.toast(ctx.t('gained').replace('{n}', gained));
    afterProg(before);
  }
  function afterProg(before) {
    const lv = levelFor(prog.points), tl = titlesFor(prog.totals);
    if (lv !== before.lv && lv.min > before.lv.min) { ctx.toast(ctx.t('newLevel').replace('{t}', L(lv))); addChat({ sys: true, text: `🏅 ${me.name}: ${L(lv)}` }); ding(); setTimeout(ding, 200); }
    if (tl.length > before.titles) { const nt = tl[tl.length - 1]; ctx.toast(ctx.t('newTitle').replace('{t}', nt.ic + ' ' + L(nt))); addChat({ sys: true, text: `${nt.ic} ${me.name}: ${L(nt)}` }); }
    const bt = bestTitle(prog.totals); const ic = bt ? bt.ic : '';
    if (me.titleIc !== ic) { me.titleIc = ic; track(); }
    renderProgress();
  }
  function renderProgress() {
    const t = ctx.t, lv = levelFor(prog.points), nx = nextLevel(prog.points);
    const chip = el.querySelector('#progChip'); if (chip) chip.textContent = `⭐ ${prog.points} ${t('points')} · ${L(lv)}`;
    const box = el.querySelector('#progCard'); if (!box) return;
    const pct = nx ? Math.round((prog.points - lv.min) / (nx.min - lv.min) * 100) : 100;
    const got = titlesFor(prog.totals);
    const near = D.TITLES.filter(x => (prog.totals[x.key] || 0) < x.n).map(x => ({ x, r: (prog.totals[x.key] || 0) / x.n })).sort((a, b) => b.r - a.r)[0];
    const myName = me.name;
    const week = lb.slice().sort((a, b) => b.week - a.week), all = lb.slice().sort((a, b) => b.points - a.points);
    const myRankW = week.findIndex(r => r.name === myName) + 1;
    const row = (r, i, key) => `<div class="lbrow ${r.name === myName ? 'me' : ''}"><span>${i + 1}. ${esc(r.name)}${bestTitle(r.totals || {}) ? ' ' + bestTitle(r.totals || {}).ic : ''}</span><b>${r[key]} ${esc(t('points'))}</b></div>`;
    box.innerHTML = `
      <div class="row between"><b>⭐ ${prog.points} ${esc(t('points'))}</b><span class="small muted">${esc(t('level'))}: <b>${esc(L(lv))}</b>${nx ? ` · ${nx.min - prog.points} → ${esc(L(nx))}` : ''}</span></div>
      <div class="lvbar"><div style="width:${pct}%"></div></div>
      <div class="small" style="margin-top:6px">${got.length ? got.map(x => `<span class="tag kind">${x.ic} ${esc(L(x))}</span>`).join('') : `<span class="muted">${esc(t('titlesLbl'))}: –</span>`}
        ${near ? `<span class="tag">${esc(t('nearTitle'))}: ${near.x.ic} ${esc(L(near.x))} ${prog.totals[near.x.key] || 0}/${near.x.n}</span>` : ''}</div>
      ${lb.length ? `<div class="grid2" style="margin-top:8px"><div><div class="small muted">🏆 ${esc(t('weekTop'))}${myRankW ? ` · ${esc(t('yourRank'))} ${myRankW}` : ''}</div>${week.slice(0, 5).map((r, i) => row(r, i, 'week')).join('')}</div><div><div class="small muted">🏛 ${esc(t('allTime'))}</div>${all.slice(0, 5).map((r, i) => row(r, i, 'points')).join('')}</div></div>` : ''}`;
  }
  async function refreshLeaderboard() { if (!ctx.leaderboard || (ctx.isOnline && !ctx.isOnline())) return; try { lb = await ctx.leaderboard(); lbAt = Date.now(); renderProgress(); } catch (e) {} }
  function setProg(p) { if (!raf || !p) return; prog = { points: p.points || 0, totals: p.totals || {}, week: p.week || 0 }; const bt = bestTitle(prog.totals); const ic = bt ? bt.ic : ''; if (me.titleIc !== ic) { me.titleIc = ic; track(); } renderProgress(); refreshLeaderboard(); }
  /* Finnish practice mode */
  let practice = false, showWords = false, pstats = { words: 0, quiz: 0, phrases: 0, answers: 0 }, ainoOpen = null, ainoAt = 0, ainoIdx = 0, myThrows = 0, praised = {};
  try { practice = localStorage.getItem('saunakaverit.practice') === 'on'; pstats = Object.assign(pstats, JSON.parse(localStorage.getItem('saunakaverit.pstats') || '{}')); } catch (e) {}
  function savePractice() { try { localStorage.setItem('saunakaverit.practice', practice ? 'on' : 'off'); localStorage.setItem('saunakaverit.pstats', JSON.stringify(pstats)); } catch (e) {} }
  function speakFi(text) {
    if (!soundOn || !window.speechSynthesis) return;
    try {
      const v = speechSynthesis.getVoices().find(v => v.lang && v.lang.toLowerCase().startsWith('fi'));
      const u = new SpeechSynthesisUtterance(text); if (v) u.voice = v; u.lang = 'fi-FI'; u.rate = 0.9; u.volume = .95; speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch (e) {}
  }
  function renderLabels() {
    const g = el.querySelector('#roomSvg .labels'); if (!g) return;
    g.style.display = (practice && showWords) ? '' : 'none';
    if (!g.innerHTML) g.innerHTML = D.WORDS.map((w, i) => { const wdt = 14 + w.fi.length * 8.5; return `<g data-word="${i}" style="cursor:pointer" transform="translate(${w.x},${w.y})"><rect x="${-wdt / 2}" y="-12" width="${wdt}" height="22" rx="11" fill="#fff8e1" fill-opacity=".95" stroke="#8c5a35" stroke-width="1.5"/><text x="0" y="4" text-anchor="middle" font-size="13" font-weight="700" fill="#3a2415" font-family="Inter,sans-serif">${esc(w.fi)}</text></g>`; }).join('');
  }
  function renderPractice() {
    const box = el.querySelector('#practicePanel'); if (!box) return;
    const t = ctx.t;
    if (!practice) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.style.display = '';
    const ph = D.PHRASES[Math.floor(Date.now() / 86400000) % D.PHRASES.length];
    const aino = ainoOpen ? `<div class="card ainoCard"><div class="small muted">👩‍🏫 ${esc(t('aino'))}</div><b>${esc(D.AINO[ainoOpen.i][0])}</b><div class="small muted">${esc(t('ainoHint'))}: ${esc(D.AINO[ainoOpen.i][1])}</div>${ainoOpen.model ? `<div class="small">${esc(t('ainoModel'))}: <b>${esc(D.AINO[ainoOpen.i][2])}</b></div>` : ''}</div>` : '';
    box.innerHTML = `
      <div class="card phraseCard"><div class="small muted">🇫🇮 ${esc(t('phraseDay'))}</div><b style="font-size:1.1rem">${esc(ph[0])}</b><div class="small muted">${esc(ph[1])}</div>
        <div class="pill-row" style="margin-top:6px"><button class="btn small secondary" data-act="phraseListen">🔊 ${esc(t('listen'))}</button><button class="btn small" data-act="phraseSay">💬 ${esc(t('sayIt'))}</button><button class="btn small secondary" data-act="words">🔤 ${esc(t('wordsBtn'))} ${showWords ? '✓' : ''}</button><button class="btn small lake" data-act="vocab">🔡 ${esc(t('vocabQuiz'))}</button></div>
        ${showWords ? `<div class="small muted" style="margin-top:4px">${esc(t('wordsHint'))}</div>` : ''}</div>
      ${aino}
      <div class="small muted" style="margin:4px 0 8px">📚 <b>${esc(t('practiceStats'))}:</b> ${pstats.words} ${esc(t('pWords'))} · ${pstats.quiz} ${esc(t('pQuiz'))} · ${pstats.phrases} ${esc(t('pPhrases'))} · ${pstats.answers} ${esc(t('pAnswers'))}</div>`;
  }
  function ainoTick() {
    if (!practice) return;
    const now = Date.now(), t = ctx.t;
    if (!ainoOpen && now - ainoAt > 150000) {
      ainoAt = now; ainoIdx = (ainoIdx + 1 + Math.floor(Math.random() * 3)) % D.AINO.length; ainoOpen = { i: ainoIdx, at: now, model: false };
      const q = D.AINO[ainoIdx]; addChat({ sys: true, by: `👩‍🏫 ${t('aino')}`, text: `${q[0]}  (${t('ainoHint')}: ${q[1]})` }); speakFi(q[0]); praised = {}; renderPractice();
    }
    if (ainoOpen && !ainoOpen.model && now - ainoOpen.at > 90000) { ainoOpen.model = true; addChat({ sys: true, by: `👩‍🏫 ${t('aino')}`, text: `${t('ainoModel')}: ${D.AINO[ainoOpen.i][2]}` }); renderPractice(); }
    if (ainoOpen && now - ainoOpen.at > 130000) { ainoOpen = null; renderPractice(); }
  }
  function ainoHears(ev) {
    if (!practice || !ainoOpen || praised[ev.id] || Date.now() - ainoOpen.at > 90000) return;
    praised[ev.id] = true; const t = ctx.t;
    addChat({ sys: true, by: `👩‍🏫 ${t('aino')}`, text: `${t('ainoPraise').replace('{n}', ev.by)} ${!ainoOpen.model ? `${t('ainoModel')}: ${D.AINO[ainoOpen.i][2]}` : ''}` });
    if (ev.id === pid) { pstats.answers++; savePractice(); renderPractice(); }
  }
  const FX_COLORS = ['#ffd166', '#ff7a7a', '#7ad3ff', '#3dff9a', '#c67bff', '#fff'];
  function boom() {
    if (!soundOn) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const sr = audio.sampleRate, buf = audio.createBuffer(1, sr * 0.6, sr), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
      const src = audio.createBufferSource(); src.buffer = buf; const f = audio.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
      const g = audio.createGain(); g.gain.value = 0.6; src.connect(f); f.connect(g); g.connect(audio.destination); src.start();
    } catch (e) {}
  }
  const sledPos = (k) => ({ x: 90 + 330 * k, y: 430 + 190 * k * k });
  function speak(text) {
    if (!soundOn || !window.speechSynthesis) return;
    try {
      const want = ctx.lang() === 'en' ? 'en' : 'fi';
      const v = speechSynthesis.getVoices().find(v => v.lang && v.lang.toLowerCase().startsWith(want));
      if (!v) return;
      const u = new SpeechSynthesisUtterance(text); u.voice = v; u.rate = 1; u.pitch = 1.1; u.volume = .9; speechSynthesis.speak(u);
    } catch (e) {}
  }
  function note(freq, at, dur) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator(), g = audio.createGain(), t0 = audio.currentTime + at;
      o.type = 'triangle'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(audio.destination); o.start(t0); o.stop(t0 + dur + 0.05);
    } catch (e) {}
  }
  function melody(seed) {
    if (!soundOn) return;
    const scale = [261.6, 293.7, 329.6, 392.0, 440.0, 523.3];
    let s = seed || 1; const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    for (let i = 0; i < 6; i++) note(scale[Math.floor(rnd() * scale.length)], i * 0.28, 0.26);
  }
  function kiuasSay(kind) {
    const lines = D.KIUAS[kind]; const line = LP(lines[Math.floor(Math.random() * lines.length)]);
    const now = Date.now(); bubbles = bubbles.filter(b => b.id !== 'kiuas'); bubbles.push({ id: 'kiuas', text: line, at: now, until: now + 7000 });
    addChat({ sys: true, text: `🔥 ${ctx.t('kiuasSays')}: ${line}` }); addLog(`🔥 ${ctx.t('kiuasSays')}: ${line}`); speak(line);
  }
  const dayKey = () => new Date().toISOString().slice(0, 10);
  const todayChallenge = () => D.CHALLENGES[Math.floor(Date.now() / 86400000) % D.CHALLENGES.length];
  /* Outside it is Finnish winter: the hour decides how cold, and how fast people freeze. */
  function outTempNow() { const d = new Date(), h = d.getHours() + d.getMinutes() / 60; return Math.round(-12 + 8 * Math.sin((h - 14) / 24 * 2 * Math.PI)); }
  const coldRate = () => 1 + Math.max(0, (-outTempNow() - 6) / 14);
  function coldStage(p) { if (!p || !p.outSince) return 0; const s = (Date.now() - p.outSince) / 1000 * coldRate(); return s > 300 ? 3 : s > 180 ? 2 : s > 90 ? 1 : 0; }
  const isDizzy = (p) => !!(p && p.zone === 'in' && p.inSince && Date.now() - p.inSince > 25 * 60000);
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
    const u = mini ? 'p' : 'r';
    const planks = []; for (let y = 60; y < 460; y += 26) planks.push(`<line x1="640" y1="${y}" x2="1440" y2="${y}"/>`);
    const boards = []; for (let y = 482; y < 700; y += 22) boards.push(`<line x1="640" y1="${y}" x2="2000" y2="${y}"/>`);
    const grain = []; for (let x = 640; x < 1440; x += 97) grain.push(`<line x1="${x}" y1="60" x2="${x + 3}" y2="460"/>`);
    const panels = []; for (let x = 1440; x < 2000; x += 44) panels.push(`<line x1="${x}" y1="60" x2="${x}" y2="460"/>`);
    const stones = [];
    for (let i = 0; i < 14; i++) { const x = 800 + (i % 5) * 20 + (Math.floor(i / 5) % 2) * 10, y = 296 + Math.floor(i / 5) * 10; stones.push(`<ellipse cx="${x}" cy="${y}" rx="11" ry="8" fill="#55524f" stroke="#2e2c2a"/>`); }
    const flakes = (x0, w, y0, h, n) => { let s = ''; for (let i = 0; i < n; i++) s += `<circle cx="${x0 + (i * 37) % w}" cy="${y0 + (i * 53) % h}" r="${1.2 + (i % 3) * 0.6}" fill="#fff" opacity=".75"/>`; return s; };
    const stars = []; for (let i = 0; i < 40; i++) stars.push(`<circle cx="${(i * 97) % 640}" cy="${20 + (i * 61) % 340}" r="${0.7 + (i % 3) * 0.5}" fill="#fff" opacity="${0.45 + (i % 2) * 0.4}"/>`);
    const wstars = []; for (let i = 0; i < 12; i++) wstars.push(`<circle cx="${1240 + (i * 53) % 130}" cy="${98 + (i * 29) % 40}" r="${0.8 + (i % 3) * 0.5}" fill="#fff" opacity="${0.5 + (i % 2) * 0.4}"/>`);
    const slats = (x, y, w, h) => { let s = ''; for (let i = 0; i < w; i += 24) s += `<rect x="${x + i}" y="${y}" width="22" height="${h}" rx="3" fill="url(#${u}bench)" stroke="#8a5a2b" stroke-opacity=".8"/><rect x="${x + i + 2}" y="${y + 1.5}" width="18" height="2" rx="1" fill="#fff" fill-opacity=".35"/>`; return s; };
    const tree = (x, y, s) => `<g transform="translate(${x},${y}) scale(${s})"><path d="M0 -90 L-26 -40 L-14 -40 L-34 0 L34 0 L14 -40 L26 -40 Z" fill="#0b1a2e"/><path d="M0 -90 L-12 -66 L12 -66 Z M-8 -44 L8 -44 L0 -58 Z" fill="#dfe9f4" fill-opacity=".55"/><rect x="-5" y="0" width="10" height="12" fill="#1a1008"/></g>`;
    const towel = (x, c) => `<path d="M${x} 150 L${x} 230 Q${x + 10} 236 ${x + 20} 230 L${x + 20} 150 Z" fill="${c}" stroke="#5b3a1f" stroke-opacity=".4"/>`;
    return `
<svg viewBox="${mini ? '640 0 800 700' : '550 0 900 700'}" class="roomScene" xmlns="http://www.w3.org/2000/svg" ${mini ? '' : 'id="roomSvg"'}>
  <defs>
    <linearGradient id="${u}wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a2c16"/><stop offset=".45" stop-color="#7a4a26"/><stop offset="1" stop-color="#8f5c33"/></linearGradient>
    <linearGradient id="${u}bench" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0cf9a"/><stop offset="1" stop-color="#cf9a60"/></linearGradient>
    <linearGradient id="${u}face" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a86d3c"/><stop offset="1" stop-color="#6b3f1f"/></linearGradient>
    <linearGradient id="${u}night" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1830"/><stop offset="1" stop-color="#27507c"/></linearGradient>
    <linearGradient id="${u}sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050c1c"/><stop offset=".6" stop-color="#132a4a"/><stop offset="1" stop-color="#2d5a8a"/></linearGradient>
    <linearGradient id="${u}snow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f8fd"/><stop offset="1" stop-color="#c9d9ea"/></linearGradient>
    <linearGradient id="${u}ice" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b8d8f0"/><stop offset="1" stop-color="#6fa3cc"/></linearGradient>
    <linearGradient id="${u}cold" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0d2140"/><stop offset="1" stop-color="#2d5a8a"/></linearGradient>
    <linearGradient id="${u}steel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2f2f2f"/><stop offset=".5" stop-color="#5a5a5a"/><stop offset="1" stop-color="#2a2a2a"/></linearGradient>
    <linearGradient id="${u}floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b3f1f"/><stop offset="1" stop-color="#3d2210"/></linearGradient>
    <linearGradient id="${u}lwall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3c598"/><stop offset="1" stop-color="#c49a66"/></linearGradient>
    <linearGradient id="${u}lfloor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a5a2b"/><stop offset="1" stop-color="#5a3519"/></linearGradient>
    <radialGradient id="${u}glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffc466" stop-opacity="1"/><stop offset=".6" stop-color="#ff7a1a" stop-opacity=".45"/><stop offset="1" stop-color="#ff5a00" stop-opacity="0"/></radialGradient>
    <radialGradient id="${u}lamp" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffe2a8" stop-opacity=".55"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>
    <radialGradient id="${u}kiuaslight" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ff9a3c" stop-opacity=".28"/><stop offset="1" stop-color="#ff9a3c" stop-opacity="0"/></radialGradient>
    <radialGradient id="${u}vignette" cx=".5" cy=".55" r=".75"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></radialGradient>
    <radialGradient id="${u}fire" cx=".5" cy="1" r="1"><stop offset="0" stop-color="#fff1a8"/><stop offset=".45" stop-color="#ff8a1f"/><stop offset="1" stop-color="#9c1d08"/></radialGradient>
    <radialGradient id="${u}moon" cx=".5" cy=".5" r=".5"><stop offset=".5" stop-color="#fff5d6" stop-opacity=".9"/><stop offset="1" stop-color="#fff5d6" stop-opacity="0"/></radialGradient>
    <radialGradient id="${u}fireglow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffb347" stop-opacity=".55"/><stop offset="1" stop-color="#ff7a1a" stop-opacity="0"/></radialGradient>
    <linearGradient id="${u}aurora" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3dff9a" stop-opacity="0"/><stop offset=".3" stop-color="#3dff9a"/><stop offset=".6" stop-color="#7ad3ff"/><stop offset=".85" stop-color="#c67bff"/><stop offset="1" stop-color="#c67bff" stop-opacity="0"/></linearGradient>
    <clipPath id="${u}winclip"><rect x="1230" y="93" width="150" height="100" rx="4"/></clipPath>
    <clipPath id="${u}doorclip"><rect x="666" y="124" width="88" height="432"/></clipPath>
    <clipPath id="${u}terraceclip"><rect x="0" y="0" width="640" height="700"/></clipPath>
    ${mini ? '' : `<filter id="${u}blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.5"/></filter>`}
  </defs>

  <!-- ===== TERASSI (outside, 0..640) ===== -->
  <rect x="0" y="0" width="640" height="700" fill="url(#${u}sky)"/>
  <g clip-path="url(#${u}terraceclip)">
    <g class="aurora" style="opacity:.3">
      <path d="M-40 150 Q120 90 260 140 T560 120 T720 150" stroke="url(#${u}aurora)" stroke-width="34" fill="none" stroke-linecap="round" class="band b1"/>
      <path d="M-20 200 Q140 150 300 190 T620 170" stroke="url(#${u}aurora)" stroke-width="22" fill="none" stroke-linecap="round" class="band b2"/>
    </g>
    <g>${stars.join('')}</g>
    <circle cx="520" cy="90" r="44" fill="url(#${u}moon)"/><circle cx="520" cy="90" r="22" fill="#fff6d8"/>
    <path d="M0 400 Q160 370 320 395 T640 390 L640 700 L0 700 Z" fill="url(#${u}snow)"/>
    ${tree(40, 400, 1.1)}${tree(110, 395, 0.8)}${tree(230, 390, 1.0)}${tree(590, 396, 0.9)}${tree(640, 400, 0.7)}
    <g class="moose" transform="translate(-100,0)" style="opacity:0"><g transform="scale(.9)" fill="#0b1a2e">
      <ellipse cx="0" cy="0" rx="26" ry="13"/><rect x="-22" y="6" width="5" height="20"/><rect x="-10" y="6" width="5" height="22"/><rect x="6" y="6" width="5" height="22"/><rect x="18" y="6" width="5" height="20"/>
      <path d="M20 -6 L34 -18 L44 -14 L40 -2 Z"/><path d="M30 -16 L26 -30 M34 -18 L38 -32 M30 -16 L22 -26 M34 -18 L44 -26" stroke="#0b1a2e" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M-26 -4 q-6 2 -4 8" stroke="#0b1a2e" stroke-width="3" fill="none"/></g></g>
    <!-- frozen lake with the avanto -->
    <ellipse cx="330" cy="600" rx="240" ry="70" fill="url(#${u}ice)" stroke="#f4f8fd" stroke-width="4"/>
    <path d="M150 585 Q330 560 510 590" stroke="#fff" stroke-opacity=".35" stroke-width="2" fill="none"/>
    <g class="hot" data-act="avanto" style="cursor:pointer">
    <ellipse cx="330" cy="605" rx="46" ry="16" fill="#1b4a7a" stroke="#dbeafc" stroke-width="3"/>
    <ellipse cx="330" cy="604" rx="34" ry="9" fill="#2d6aa3"/>
    <path d="M372 590 L372 622 M384 586 L384 620 M372 598 L384 596 M372 610 L384 608" stroke="#c9a06a" stroke-width="3" stroke-linecap="round"/>
    <text x="330" y="650" text-anchor="middle" font-size="12" fill="#1b4a7a" font-family="Inter,sans-serif">avanto</text>
    </g>
    <!-- bonfire -->
    <ellipse cx="140" cy="572" rx="70" ry="30" fill="url(#${u}fireglow)"/>
    <rect x="112" y="556" width="56" height="9" rx="3" fill="#5b3a1f" transform="rotate(-14 140 560)"/><rect x="112" y="556" width="56" height="9" rx="3" fill="#4a2c16" transform="rotate(14 140 560)"/>
    <g class="flames"><path d="M124 560 q-6 -18 8 -30 q0 14 10 18 q3 -16 14 -22 q-3 18 10 26 q6 -10 3 -22 q14 14 4 30 Z" fill="#ffd166" fill-opacity=".95" class="flame"/><path d="M134 560 q-3 -12 7 -20 q1 10 8 13 q4 -10 8 -14 q0 14 5 21 Z" fill="#fff3b0" class="flame f2"/></g>
    <rect x="40" y="578" width="90" height="12" rx="4" fill="#8a5a2b" stroke="#4a2c16"/><rect x="48" y="590" width="8" height="14" fill="#4a2c16"/><rect x="114" y="590" width="8" height="14" fill="#4a2c16"/>
    <!-- snowman with a bucket hat -->
    <g transform="translate(540,520)">
      <circle cx="0" cy="0" r="26" fill="#fff"/><circle cx="0" cy="-36" r="19" fill="#fff"/><circle cx="0" cy="-64" r="14" fill="#fff"/>
      <circle cx="-5" cy="-67" r="1.8" fill="#222"/><circle cx="5" cy="-67" r="1.8" fill="#222"/><path d="M0 -63 L14 -60 L0 -58 Z" fill="#f08a24"/>
      <path d="M-3 -56 q3 3 6 0" stroke="#222" stroke-width="1.2" fill="none"/>
      <circle cx="0" cy="-40" r="2" fill="#222"/><circle cx="0" cy="-30" r="2" fill="#222"/>
      <path d="M-19 -40 L-40 -52 M19 -40 L40 -52" stroke="#5b3a1f" stroke-width="3" stroke-linecap="round"/>
      <path d="M-14 -48 Q0 -40 14 -48 L12 -42 Q0 -34 -12 -42 Z" fill="#b23a3a"/>
      <path d="M-12 -72 L-14 -92 L14 -92 L12 -72 Z" fill="#6fa8c9" stroke="#2b5d7a"/><rect x="-16" y="-95" width="32" height="5" rx="2" fill="#2b5d7a"/>
    </g>
    <!-- the sauna's outer wall, lamp and a sign -->
    <rect x="606" y="150" width="40" height="550" fill="#2b170a"/>
    <g transform="translate(612,300)"><path d="M0 -20 L0 -34 L-30 -34" stroke="#1d110a" stroke-width="4" fill="none"/><rect x="-9" y="-20" width="18" height="26" rx="3" fill="#ffd98a" stroke="#3b2a1c" stroke-width="2"/><rect x="-5" y="-16" width="10" height="18" rx="2" fill="#fff3c4" class="flicker"/></g>
    <ellipse cx="560" cy="330" rx="120" ry="90" fill="url(#${u}lamp)"/>
    <g transform="translate(470,430)"><rect x="-3" y="-60" width="6" height="60" fill="#5b3a1f"/><rect x="-36" y="-66" width="72" height="20" rx="3" fill="#b57c4a" stroke="#4a2c16"/><text x="0" y="-52" text-anchor="middle" font-size="12" font-weight="700" fill="#2b170a" font-family="Inter,sans-serif">SAUNA →</text><rect x="-24" y="-40" width="48" height="16" rx="3" fill="#f6ecd8" stroke="#4a2c16"/><text x="0" y="-28" text-anchor="middle" font-size="11" font-weight="700" fill="#1b4a7a" font-family="Inter,sans-serif" class="outTempText">-12°C</text></g>
    <g class="snowfall slow">${flakes(0, 640, 0, 700, 40)}</g><g class="snowfall" transform="translate(0,-160)">${flakes(0, 640, 0, 700, 40)}</g>
  </g>

  <!-- ===== SAUNA (640..1440) ===== -->
  <rect x="640" y="0" width="800" height="700" fill="url(#${u}wall)"/>
  <g stroke="#2a170c" stroke-opacity=".5">${planks.join('')}</g>
  <g stroke="#ffd9a8" stroke-opacity=".07" transform="translate(0,1)">${planks.join('')}</g>
  <g stroke="#2a170c" stroke-opacity=".18">${grain.join('')}</g>
  <rect x="640" width="800" height="60" fill="#2b170a"/>
  <rect x="640" y="58" width="800" height="4" fill="#1d0f06"/>
  <rect x="640" y="460" width="800" height="240" fill="url(#${u}floor)"/>
  <g stroke="#1d0f06" stroke-opacity=".6">${boards.join('')}</g>
  <g stroke="#ffd9a8" stroke-opacity=".05" transform="translate(0,1)">${boards.join('')}</g>
  <rect x="640" y="458" width="800" height="5" fill="#241308"/>
  <circle cx="1070" cy="650" r="9" fill="#1a0e06" stroke="#4a2c16" stroke-width="2"/><path d="M1064 650 L1076 650 M1070 644 L1070 656" stroke="#4a2c16" stroke-width="1.5"/>
  <ellipse cx="855" cy="330" rx="260" ry="200" fill="url(#${u}kiuaslight)"/>
  <ellipse cx="1140" cy="150" rx="230" ry="150" fill="url(#${u}lamp)"/>
  <g transform="translate(1140,110)">
    <path d="M-14 -30 L14 -30 L10 -6 L-10 -6 Z" fill="#3b2a1c" stroke="#1d110a"/>
    <rect x="-9" y="-6" width="18" height="26" rx="3" fill="#ffd98a" stroke="#3b2a1c" stroke-width="2"/>
    <rect x="-5" y="-2" width="10" height="18" rx="2" fill="#fff3c4" class="flicker"/>
    <rect x="-11" y="20" width="22" height="5" rx="2" fill="#3b2a1c"/>
    <path d="M0 -30 L0 -40 L-40 -40" stroke="#1d110a" stroke-width="4" fill="none"/>
  </g>
  <rect x="1225" y="88" width="160" height="110" rx="6" fill="url(#${u}night)" stroke="#2b170a" stroke-width="10"/>
  <g clip-path="url(#${u}winclip)">
    <g>${wstars.join('')}</g>
    <circle cx="1340" cy="118" r="24" fill="url(#${u}moon)"/><circle cx="1340" cy="118" r="12" fill="#fff6d8"/>
    <g class="snowfall">${flakes(1235, 145, 90, 100, 10)}</g>
    <path d="M1235 168 Q1260 160 1285 168 T1335 168 T1380 168 L1380 192 L1235 192 Z" fill="#dfe9f4"/>
    <path d="M1238 158 L1262 126 L1286 158 Z M1290 160 L1312 134 L1334 160 Z M1338 160 L1356 140 L1374 160 Z" fill="#102640"/>
  </g>
  <line x1="1305" y1="88" x2="1305" y2="198" stroke="#2b170a" stroke-width="6"/>
  <rect x="1225" y="88" width="160" height="110" rx="6" fill="none" stroke="#3b2a1c" stroke-width="3"/>
  <!-- doorway to the terrace -->
  <g class="hot" data-act="cool" style="cursor:pointer">
    <rect x="662" y="120" width="96" height="440" rx="4" fill="url(#${u}cold)" stroke="#1d110a" stroke-width="8"/>
    <rect x="666" y="124" width="88" height="432" fill="#9fd0ff" fill-opacity=".08"/>
    <path d="M666 556 L754 556 L754 520 Q710 505 666 520 Z" fill="#e6eef7"/>
    <g clip-path="url(#${u}doorclip)"><g class="snowfall slow">${flakes(670, 80, 130, 400, 16)}</g><g class="snowfall" transform="translate(0,-160)">${flakes(670, 80, 130, 400, 16)}</g></g>
    <text x="710" y="140" text-anchor="middle" font-size="11" fill="#bfe0ff" font-family="Inter,sans-serif" class="coolLabel">Terassi</text>
  </g>
  <!-- doorway to the lounge -->
  <g class="hot" data-act="lounge" style="cursor:pointer">
    <rect x="1382" y="120" width="56" height="440" rx="4" fill="url(#${u}lwall)" stroke="#1d110a" stroke-width="8"/>
    <rect x="1386" y="460" width="48" height="96" fill="url(#${u}lfloor)"/>
    <text x="1410" y="140" text-anchor="middle" font-size="10" fill="#5b3a1f" font-family="Inter,sans-serif" class="loungeLabel">Pukuhuone</text>
  </g>
  <g transform="translate(940,120)" class="hot" data-act="vihta" style="cursor:pointer">
    <circle cx="0" cy="-4" r="3" fill="#222"/>
    <path d="M0 0 L0 40" stroke="#6b4a2b" stroke-width="4"/>
    <ellipse cx="-12" cy="52" rx="14" ry="24" fill="#4e8a3d" transform="rotate(-15 -12 52)"/>
    <ellipse cx="12" cy="52" rx="14" ry="24" fill="#5fa04a" transform="rotate(15 12 52)"/>
    <ellipse cx="0" cy="58" rx="13" ry="26" fill="#74b35a"/>
    <ellipse cx="-3" cy="52" rx="6" ry="14" fill="#a3d68a" fill-opacity=".5"/>
  </g>
  <g transform="translate(1040,100)">
    <rect x="-26" y="-18" width="52" height="54" rx="8" fill="#f6ecd8" stroke="#8c5a35" stroke-width="3"/>
    <text x="0" y="10" text-anchor="middle" font-size="18" font-weight="700" fill="#8c5a35" font-family="Outfit,Inter,sans-serif" class="tempText">80°</text>
    <text x="0" y="28" text-anchor="middle" font-size="9" fill="#8c5a35" font-family="Inter,sans-serif">löyly</text>
  </g>
  <g transform="translate(775,470)"><g class="tonttu" style="opacity:0;transition:opacity .6s">
    <ellipse cx="0" cy="40" rx="16" ry="20" fill="#9b2d2d"/>
    <ellipse cx="-8" cy="58" rx="6" ry="3" fill="#2b1d12"/><ellipse cx="8" cy="58" rx="6" ry="3" fill="#2b1d12"/>
    <circle cx="0" cy="12" r="12" fill="#f1c9a5"/>
    <path d="M-14 8 L0 -26 L14 8 Z" fill="#d32f2f"/><circle cx="0" cy="-26" r="4" fill="#fff"/>
    <path d="M-10 18 Q0 34 10 18 Z" fill="#eee"/>
    <circle cx="-4" cy="10" r="1.6" fill="#2b1d12"/><circle cx="4" cy="10" r="1.6" fill="#2b1d12"/>
    <path d="M14 30 q8 -10 6 -22" stroke="#f1c9a5" stroke-width="4" fill="none" stroke-linecap="round" class="tonttuArm"/>
  </g></g>
  <g class="hot" data-act="loyly" style="cursor:pointer">
    <rect x="840" y="110" width="18" height="190" fill="url(#${u}steel)"/>
    <rect x="790" y="290" width="118" height="170" rx="8" fill="url(#${u}steel)" stroke="#1a1a1a" stroke-width="3"/>
    <rect x="796" y="296" width="106" height="158" rx="6" fill="none" stroke="#777" stroke-opacity=".35"/>
    <rect x="790" y="285" width="118" height="12" rx="4" fill="#232323"/>
    <ellipse cx="849" cy="300" rx="90" ry="40" fill="url(#${u}glow)" class="kiuasGlow"/>
    ${stones.join('')}
    <ellipse cx="836" cy="320" rx="9" ry="6" fill="#ff8a3c" fill-opacity=".55"/><ellipse cx="866" cy="318" rx="7" ry="5" fill="#ff6a1a" fill-opacity=".45"/>
    <rect x="812" y="410" width="74" height="26" rx="4" fill="url(#${u}fire)"/>
    <g class="flames"><path d="M826 436 q-4 -10 4 -16 q0 8 6 10 q2 -8 8 -12 q-2 10 6 14 q4 -6 2 -12 q8 8 2 16 Z" fill="#ffd166" fill-opacity=".9" class="flame"/><path d="M836 436 q-2 -8 4 -12 q1 6 5 8 q3 -6 5 -9 q0 9 3 13 Z" fill="#fff3b0" class="flame f2"/></g>
    <rect x="812" y="410" width="74" height="26" rx="4" fill="none" stroke="#1a1a1a" stroke-width="3"/>
    <path d="M740 430 L748 470 L784 470 L792 430 Z" fill="#b57c4a" stroke="#5b3a1f" stroke-width="2"/>
    <path d="M744 440 L788 440" stroke="#7a4e28" stroke-width="2"/>
    <ellipse cx="766" cy="430" rx="26" ry="7" fill="#7cc0e8" stroke="#5b3a1f" stroke-width="2"/>
    <g class="ladle"><path d="M780 428 L818 392" stroke="#d9b07a" stroke-width="5" stroke-linecap="round"/><ellipse cx="820" cy="390" rx="8" ry="5" fill="#d9b07a" stroke="#5b3a1f"/></g>
    ${mini ? '' : '<text x="849" y="476" text-anchor="middle" font-size="11" fill="#ffd166" font-family="Inter,sans-serif" class="kiuasHint">💧</text>'}
  </g>
  <rect x="970" y="300" width="470" height="60" fill="url(#${u}face)"/><rect x="970" y="300" width="470" height="6" fill="#000" fill-opacity=".2"/>${slats(970, 292, 470, 14)}
  <rect x="955" y="360" width="485" height="60" fill="url(#${u}face)"/><rect x="955" y="360" width="485" height="6" fill="#000" fill-opacity=".2"/>${slats(955, 352, 485, 14)}
  <rect x="940" y="420" width="500" height="40" fill="url(#${u}face)"/><rect x="940" y="420" width="500" height="6" fill="#000" fill-opacity=".2"/>${slats(940, 412, 500, 14)}
  <rect x="640" width="800" height="700" fill="url(#${u}vignette)" pointer-events="none"/>
  <rect x="640" width="800" height="700" fill="#ff6a00" class="heatTint" style="opacity:0" pointer-events="none"/>

  <!-- ===== PUKUHUONE (lounge, 1440..2000) ===== -->
  <rect x="1440" y="0" width="560" height="460" fill="url(#${u}lwall)"/>
  <g stroke="#8a5a2b" stroke-opacity=".25">${panels.join('')}</g>
  <rect x="1440" width="560" height="60" fill="#3b2a1c"/>
  <rect x="1440" y="460" width="560" height="240" fill="url(#${u}lfloor)"/>
  <rect x="1440" y="458" width="560" height="5" fill="#2b170a"/>
  <rect x="1560" y="590" width="340" height="70" rx="6" fill="#b23a3a"/><rect x="1560" y="604" width="340" height="10" fill="#f6ecd8" fill-opacity=".6"/><rect x="1560" y="636" width="340" height="10" fill="#f6ecd8" fill-opacity=".6"/>
  <!-- window -->
  <rect x="1800" y="90" width="160" height="110" rx="6" fill="url(#${u}night)" stroke="#5b3a1f" stroke-width="10"/>
  <g>${flakes(1810, 140, 100, 90, 8)}</g><circle cx="1920" cy="120" r="10" fill="#fff6d8"/>
  <line x1="1880" y1="90" x2="1880" y2="200" stroke="#5b3a1f" stroke-width="6"/>
  <!-- coat rack with towels -->
  <rect x="1460" y="132" width="110" height="12" rx="3" fill="#8a5a2b"/>
  <circle cx="1480" cy="146" r="3" fill="#222"/><circle cx="1515" cy="146" r="3" fill="#222"/><circle cx="1550" cy="146" r="3" fill="#222"/>
  ${towel(1470, '#e9b8a6')}${towel(1505, '#b8d8e9')}${towel(1540, '#cfe3b8')}
  <!-- sofa -->
  <g transform="translate(1650,560)">
    <rect x="-90" y="-50" width="180" height="40" rx="10" fill="#4e6b4a"/>
    <rect x="-100" y="-16" width="200" height="40" rx="10" fill="#5c7d57"/>
    <rect x="-96" y="-30" width="20" height="56" rx="8" fill="#4e6b4a"/><rect x="76" y="-30" width="20" height="56" rx="8" fill="#4e6b4a"/>
    <rect x="-70" y="-44" width="60" height="30" rx="8" fill="#f3d9a4"/><rect x="10" y="-44" width="60" height="30" rx="8" fill="#e9b8a6"/>
    <g class="hot" data-act="cat" style="cursor:pointer" transform="translate(40,-30)">
      <ellipse cx="0" cy="0" rx="22" ry="11" fill="#4a4a4a"/><circle cx="-18" cy="-6" r="9" fill="#4a4a4a"/>
      <path d="M-25 -12 L-27 -22 L-19 -14 Z M-11 -12 L-8 -22 L-15 -14 Z" fill="#4a4a4a"/>
      <path d="M20 -2 q14 -6 10 -16" stroke="#4a4a4a" stroke-width="4" fill="none" stroke-linecap="round"/>
      <path d="M-23 -5 q2 2 4 0 M-16 -5 q2 2 4 0" stroke="#111" stroke-width="1.2" fill="none"/>
      <path d="M-3 2 L-14 -2 M-3 4 L-14 6" stroke="#ddd" stroke-width="1"/>
    </g>
  </g>
  <!-- beer table and fridge -->
  <g class="hot" data-act="beertable" style="cursor:pointer" transform="translate(1800,600)">
    <rect x="-34" y="-6" width="68" height="8" rx="3" fill="#b57c4a" stroke="#5b3a1f" stroke-width="2"/>
    <rect x="-26" y="2" width="6" height="36" fill="#8a5a2b"/><rect x="20" y="2" width="6" height="36" fill="#8a5a2b"/>
    <rect x="-30" y="-24" width="60" height="18" rx="3" fill="#f6ecd8" stroke="#8c5a35" stroke-width="2"/>
    <rect x="-22" y="-34" width="9" height="22" rx="2" fill="#f2b632" stroke="#8a5a1a"/><rect x="-22" y="-37" width="9" height="5" rx="2" fill="#fff8e1"/>
    <rect x="-5" y="-34" width="9" height="22" rx="2" fill="#f2b632" stroke="#8a5a1a"/><rect x="-5" y="-37" width="9" height="5" rx="2" fill="#fff8e1"/>
    <rect x="12" y="-34" width="9" height="22" rx="2" fill="#f2b632" stroke="#8a5a1a"/><rect x="12" y="-37" width="9" height="5" rx="2" fill="#fff8e1"/>
    ${mini ? '' : '<text x="0" y="56" text-anchor="middle" font-size="11" fill="#ffd166" font-family="Inter,sans-serif" class="kiuasHint">🍺</text>'}
  </g>
  <g class="hot" data-act="beertable" style="cursor:pointer" transform="translate(1930,470)">
    <rect x="-30" y="0" width="60" height="136" rx="6" fill="#f4f1ea" stroke="#9a9a9a" stroke-width="2"/>
    <rect x="-30" y="46" width="60" height="3" fill="#9a9a9a"/><rect x="18" y="14" width="5" height="24" rx="2" fill="#777"/><rect x="18" y="58" width="5" height="40" rx="2" fill="#777"/>
    <text x="0" y="90" text-anchor="middle" font-size="10" font-weight="700" fill="#2b5d7a" font-family="Inter,sans-serif">KYLMÄ</text>
  </g>
  <!-- floor lamp and board games -->
  <g transform="translate(1490,470)"><rect x="-2" y="0" width="4" height="130" fill="#333"/><path d="M-22 0 L22 0 L14 -34 L-14 -34 Z" fill="#f3d9a4" stroke="#8a5a2b"/><ellipse cx="0" cy="130" rx="14" ry="4" fill="#333"/></g>
  <ellipse cx="1490" cy="520" rx="90" ry="70" fill="url(#${u}lamp)"/>
  <g transform="translate(1890,400)"><rect x="-40" y="20" width="110" height="6" fill="#8a5a2b"/><rect x="-36" y="0" width="30" height="20" fill="#b23a3a"/><rect x="-4" y="4" width="36" height="16" fill="#2b6a8f"/><rect x="34" y="-2" width="32" height="22" fill="#3e8a44"/></g>

  <!-- walkable areas and the live layers -->
  <rect class="floorHit" x="0" y="420" width="640" height="280" fill="#fff" fill-opacity="0" style="cursor:pointer"/>
  <rect class="floorHit" x="640" y="470" width="1360" height="230" fill="#fff" fill-opacity="0" style="cursor:pointer"/>
  <rect class="blackout" x="640" y="0" width="1360" height="700" fill="#050302" style="opacity:0;transition:opacity .6s" pointer-events="none"/>
  <ellipse class="emberGlow" cx="849" cy="300" rx="110" ry="50" fill="url(#${u}glow)" style="opacity:0;transition:opacity .6s" pointer-events="none"/>
  <g class="roofsnow" style="display:none">${[...Array(16)].map((_, i) => `<circle cx="${480 + (i * 23) % 170}" cy="${140 + (i * 31) % 60}" r="${3 + (i % 3) * 2}" fill="#fff" class="fall" style="animation-delay:${(i % 4) * 0.15}s"/>`).join('')}</g>
  <g class="imprints"></g>
  <g class="labels" style="display:none"></g>
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
    icecrown: `<path d="M-14 -76 L-14 -92 L-7 -84 L0 -98 L7 -84 L14 -92 L14 -76 Z" fill="#bfe3ff" stroke="#4a90c2"/><circle cx="0" cy="-90" r="2" fill="#fff"/>`,
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
  function avatar(p, x, y, s, isMe, moving, faceLeft, onSled) {
    const ti = (p.towel >= 0 && p.towel < TOWELS.length) ? p.towel : hash(p.name) % TOWELS.length;
    const tow = TOWELS[ti], towDark = shade(tow, -22);
    const si = hash(p.name + 'k') % SKINS.length, skin = SKINS[si], skinD = SKIN_SHADE[si];
    const hairC = HAIR_COLORS[hash(p.name + 'c') % HAIR_COLORS.length];
    const crowned = p.crown && p.crown > Date.now(), iced = p.icecrown && p.icecrown > Date.now();
    const hat = crowned ? HATS.crown : iced ? HATS.icecrown : (HATS[p.hat] || (p.hat === true ? HATS.felt : ''));
    const stage = coldStage(p), dizzy = isDizzy(p);
    const ring = isMe ? `<ellipse cx="0" cy="10" rx="30" ry="8" fill="none" stroke="#ffd166" stroke-width="2.5" stroke-dasharray="4 3"/>` : '';
    const label = `<rect x="-30" y="12" width="60" height="15" rx="7" fill="#1f1b17" fill-opacity=".72"/><text x="0" y="23" text-anchor="middle" font-size="10.5" fill="#fff" font-family="Inter,sans-serif">${p.titleIc ? p.titleIc + ' ' : ''}${p.hero ? '⭐ ' : ''}${esc(p.name.slice(0, 10))}</text>`;
    const cold = p.zone === 'cool' || (p.zone === 'floor' && isOutside(pos[p.id] ? pos[p.id].x : (p.x || 0))), hot = temp > 95 && !cold;
    const blush = cold ? .15 : hot ? .6 : .32;
    const mouth = cold ? `<path d="M-4 -60 q4 -3 8 0" stroke="#5a2d1a" stroke-width="1.4" fill="none"/>` : hot ? `<ellipse cx="0" cy="-59" rx="3" ry="2.4" fill="#5a2d1a"/>` : `<path d="M-5 -61 q5 5 10 0" stroke="#5a2d1a" stroke-width="1.5" fill="none" stroke-linecap="round"/>`;
    const standing = p.zone === 'floor' || cold;
    const legs = standing
      ? `<path d="M-14 -10 L-15 10 L-7 10 L-6 -8 Z M6 -8 L7 10 L15 10 L14 -10 Z" fill="${skin}"/><ellipse cx="-11" cy="11" rx="7" ry="3" fill="${skinD}"/><ellipse cx="11" cy="11" rx="7" ry="3" fill="${skinD}"/>`
      : `<path d="M-17 -12 L-17 6 L-10 6 L-10 -8 Z M10 -8 L10 6 L17 6 L17 -12 Z" fill="${skin}"/><ellipse cx="-13.5" cy="7.5" rx="6" ry="3" fill="${skinD}"/><ellipse cx="13.5" cy="7.5" rx="6" ry="3" fill="${skinD}"/>`;
    return `<g class="av" data-person="${esc(p.id)}" data-pname="${esc(p.name)}" transform="translate(${x},${y}) scale(${s})" style="cursor:${isMe?'default':'pointer'}">
      ${ring}
      ${onSled ? `<rect x="-36" y="6" width="72" height="9" rx="4" fill="#b23a3a" stroke="#7a1f1f"/><path d="M36 10 q12 0 10 -14" stroke="#b23a3a" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M-30 15 l-14 6 M-10 15 l-12 8" stroke="#fff" stroke-opacity=".7" stroke-width="2"/>` : ''}
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
      ${(faces[p.id] && faces[p.id].until > Date.now() && faces[p.id].face === 'hidden') ? `<path d="M-27 -6 L-31 -50 L31 -50 L27 -6 Z" fill="#6fa8c9" stroke="#2b5d7a" stroke-width="2"/><rect x="-34" y="-54" width="68" height="7" rx="3" fill="#2b5d7a"/>` : ''}
      </g>
      </g>
      ${stage >= 3 ? `<rect x="-34" y="-106" width="68" height="122" rx="12" fill="#9fd3f5" fill-opacity=".55" stroke="#e3f2ff" stroke-width="2"/><path d="M-22 16 l4 14 l4 -14 M2 16 l4 18 l4 -18 M18 16 l3 10 l3 -10" fill="#cfe9ff" stroke="#9fd3f5"/>` : stage === 2 ? `<text x="-34" y="-84" font-size="14">🥶</text>` : ''}
      ${dizzy ? `<g class="dizzy" style="transform-origin:0px -100px"><text x="-18" y="-96" font-size="12">✨</text><text x="6" y="-104" font-size="12">✨</text><text x="12" y="-88" font-size="10">✨</text></g>` : ''}
      ${p.first ? `<text x="19" y="-80" font-size="12">🙋</text>` : ''}
      ${label}
    </g>`;
  }
  function armSvg(pose, skin) {
    if (pose === 'wave') return `<g class="wavehand"><path d="M20 -42 Q34 -56 28 -78" stroke="${skin}" stroke-width="7.5" fill="none" stroke-linecap="round"/><circle cx="28" cy="-80" r="5" fill="${skin}"/></g>`;
    if (pose === 'vihta') return `<g class="swing"><path d="M20 -42 Q36 -50 34 -70" stroke="${skin}" stroke-width="7.5" fill="none" stroke-linecap="round"/><circle cx="34" cy="-72" r="4.5" fill="${skin}"/><path d="M34 -72 L40 -92" stroke="#6b4a2b" stroke-width="3"/><ellipse cx="36" cy="-100" rx="7" ry="11" fill="#5fa04a" transform="rotate(-20 36 -100)"/><ellipse cx="46" cy="-98" rx="7" ry="11" fill="#74b35a" transform="rotate(15 46 -98)"/></g>`;
    if (pose === 'fish') return `<path d="M20 -42 Q30 -36 28 -20" stroke="${skin}" stroke-width="7.5" fill="none" stroke-linecap="round"/><circle cx="28" cy="-18" r="4.5" fill="${skin}"/><path d="M28 -18 L62 -70" stroke="#8a5a2b" stroke-width="3" stroke-linecap="round"/><path d="M62 -70 L64 10" stroke="#ddd" stroke-width="1"/><ellipse cx="64" cy="12" rx="10" ry="4" fill="#1b4a7a" stroke="#dbeafc"/>`;
    if (pose === 'ladle') return `<path d="M20 -42 Q34 -40 30 -22" stroke="${skin}" stroke-width="7.5" fill="none" stroke-linecap="round"/><circle cx="30" cy="-20" r="4.5" fill="${skin}"/><path d="M30 -20 L52 -46" stroke="#d9b07a" stroke-width="4" stroke-linecap="round"/><ellipse cx="54" cy="-48" rx="7" ry="4.5" fill="#d9b07a" stroke="#5b3a1f"/>`;
    if (pose === 'snowhit') return `<path d="M20 -42 Q30 -30 24 -12" stroke="${skin}" stroke-width="7.5" fill="none" stroke-linecap="round"/><circle cx="23" cy="-10" r="4.5" fill="${skin}"/><circle cx="4" cy="-84" r="7" fill="#fff" fill-opacity=".9"/><circle cx="-6" cy="-80" r="4" fill="#fff" fill-opacity=".8"/><circle cx="12" cy="-78" r="3" fill="#fff" fill-opacity=".8"/>`;
    return `<path d="M20 -42 Q30 -30 24 -12" stroke="${skin}" stroke-width="7.5" fill="none" stroke-linecap="round"/><circle cx="23" cy="-10" r="4.5" fill="${skin}"/>`;
  }
  function faceSvg(face, o) {
    const eyes = `<g class="blink" style="animation-delay:-${(Math.random() * 4).toFixed(1)}s"><ellipse cx="-6" cy="-69" rx="2.7" ry="3.4" fill="#2b1d12"/><ellipse cx="6" cy="-69" rx="2.7" ry="3.4" fill="#2b1d12"/><circle cx="-5" cy="-70.5" r="1" fill="#fff"/><circle cx="7" cy="-70.5" r="1" fill="#fff"/></g>`;
    if (face === 'snowhit') face = 'cold';
    if (face === 'hidden') face = 'wow';
    if (face === 'wave' || face === 'vihta' || face === 'ladle') face = 'laugh';
    if (face === 'fish') face = 'think';
    if (face === 'sing') return `<path d="M-9 -69 q3 -4.5 6 0 M3 -69 q3 -4.5 6 0" stroke="#2b1d12" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M-9.5 -75 q3.5 -2.5 7 0 M2.5 -75 q3.5 -2.5 7 0" stroke="${o.hairC}" stroke-width="1.4" fill="none" stroke-linecap="round"/><ellipse cx="0" cy="-59" rx="3.5" ry="4.5" fill="#5a2d1a"/><text x="14" y="-88" font-size="12" fill="#fff">♪</text><text x="-26" y="-94" font-size="10" fill="#fff">♫</text>`;
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
      if (p.zone === 'cool') { floor.push(Object.assign({}, p, { zone: 'floor', x: 330, y: 600 })); continue; }
      if (p.zone === 'floor') { floor.push(p); continue; }
      let seat = SEATS.find(s => s.id === p.seat && !taken[s.id]) || SEATS.find(s => !taken[s.id]);
      if (!seat) { floor.push(Object.assign({}, p, { zone: 'floor', x: 1000 + floor.length * 60, y: 560 })); continue; }
      taken[seat.id] = p; seated.push({ p, seat });
    }
    seated.sort((a, b) => b.seat.tier - a.seat.tier);
    return { taken, seated, cooling, floor };
  }
  function coolPos(i) { return { x: 300 + (i % 3) * 40, y: 600 }; }
  function floorPos(p) {
    const sl = sledding[p.id]; if (sl) { const k = Math.min(1, (Date.now() - sl.t0) / 2400); return sledPos(k); }
    const cur = pos[p.id] || { x: p.x || 1000, y: p.y || 560 };
    return clampFloor(cur.x, cur.y);
  }
  function petSvg(p, x, y, s, faceLeft) {
    const pet = D.PETS[p.pet]; if (!pet || !pet.e) return '';
    const tx = x + (faceLeft ? 46 : -46) * s, ty = y + 6;
    const c = petPos[p.id] || (petPos[p.id] = { x: tx, y: ty });
    return `<text class="pet bob" data-pet="${esc(p.id)}" x="${c.x.toFixed(1)}" y="${c.y.toFixed(1)}" font-size="${(26 * s).toFixed(0)}" text-anchor="middle" style="animation-delay:-${(hash(p.id) % 20) / 10}s">${pet.e}</text>`;
  }
  function petTick(dt) {
    const all = npc ? people.concat([npc]) : people;
    for (const p of all) {
      if (!p.pet || !D.PETS[p.pet] || !D.PETS[p.pet].e) continue;
      const c = findPos(p.id); if (!c) continue;
      const left = dest[p.id] && dest[p.id].x < c.x;
      const s = p.zone === 'floor' ? floorScale(c.y) : 1;
      const tx = c.x + (left ? 46 : -46) * s, ty = c.y + 6;
      const pp = petPos[p.id] || (petPos[p.id] = { x: tx, y: ty });
      const k = Math.min(1, dt / 260); pp.x += (tx - pp.x) * k; pp.y += (ty - pp.y) * k;
      const elp = el.querySelector(`[data-pet="${p.id}"]`); if (elp) { elp.setAttribute('x', pp.x.toFixed(1)); elp.setAttribute('y', pp.y.toFixed(1)); }
    }
  }

  function placePeople() {
    const { taken, seated, cooling, floor } = layout(npc ? people.concat([npc]) : people);
    let html = seated.map(({ p, seat }) => petSvg(p, seat.x, seat.y, seat.scale, false) + avatar(p, seat.x, seat.y, seat.scale, p.id === pid)).join('');
    floor.slice().sort((a, b) => floorPos(a).y - floorPos(b).y).forEach(p => { const c = floorPos(p); const moving = !!dest[p.id]; const left = moving && dest[p.id].x < c.x; html += petSvg(p, c.x, c.y, floorScale(c.y), left) + avatar(p, c.x, c.y, floorScale(c.y), p.id === pid, moving, left, !!sledding[p.id]); });
    el.querySelector('.people').innerHTML = html;
    renderMinimap();
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
    for (let i = 0; i < n; i++) steam.push({ x: 849 + (Math.random() - .5) * 90, y: 292, r: big ? 14 + Math.random() * 22 : 6 + Math.random() * 8, vy: big ? 0.9 + Math.random() * 1.1 : 0.35 + Math.random() * 0.4, vx: (Math.random() - .5) * 0.6, life: 1, decay: big ? 0.006 : 0.009 });
  }
  function tick(ts) {
    const rawDt = ts - (lastTick || ts), dt = Math.min(50, rawDt); lastTick = ts;
    moveTick(Math.min(1200, rawDt));
    if (ts - lastAmbient > 420) { spawnSteam(1, false); lastAmbient = ts; windowTick(); }
    if (ts - lastTemp > 1000) {
      temp = Math.max(70, temp - (temp > 95 ? 0.12 : 0.05)); lastTemp = ts; el.querySelector('.tempText').textContent = Math.round(temp) + '°';
      const mins = Math.floor((Date.now() - enteredAt) / 60000);
      const meta = el.querySelector('#roomMeta'); if (meta) meta.innerHTML = `<span>⏱ ${mins} ${esc(ctx.t('min'))} ${esc(ctx.t('inRoomFor'))}</span><span>🔁 ${rounds}. ${esc(ctx.t('rounds'))}</span><span>🌡 ${Math.round(temp)}°C</span><span>🌨 ${esc(ctx.t('outTemp'))} ${outTempNow()}°C</span>`;
      const ot = el.querySelector('.outTempText'); if (ot) ot.textContent = outTempNow() + '°C';
      if (!nudged && me.zone === 'in' && Date.now() - inSince > 15 * 60000) { nudged = true; ctx.toast(ctx.t('nudge')); addLog(`❄️ ${ctx.t('nudge')}`); }
      renderStrip(); renderMeter(); starterTick(); gameTick(); bodyTick(); eventsTick(); ainoTick();
      if (Date.now() - lastFlush > 6000 && Object.keys(scoreQueue).length) { lastFlush = Date.now(); flushScores(); }
      if (ctx.leaderboard && Date.now() - lbAt > 90000) { lbAt = Date.now(); refreshLeaderboard(); }
      if (me.icecrown && me.icecrown < Date.now()) { me.icecrown = 0; track(); }
      if (me.crown && me.crown < Date.now()) { me.crown = 0; track(); }
      const expired = Object.keys(faces).filter(k => faces[k].until <= Date.now()); if (expired.length) { expired.forEach(k => delete faces[k]); placePeople(); }
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
    petTick(dt);
    // sledding: re-render while anyone is on the hill, then land them
    if (Object.keys(sledding).length) {
      for (const id of Object.keys(sledding)) {
        if (now - sledding[id].t0 > 2400) { delete sledding[id]; pos[id] = sledPos(1); if (id === pid) { me.x = pos[id].x; me.y = pos[id].y; track(); } setFace(id, 'laugh', 3000); }
      }
      placePeople();
    }
    // fireworks over the lake
    if (fireworks.length) {
      let html = ''; const live = [];
      for (const f of fireworks) {
        const t = (now - f.t0) / 1000;
        if (t < 1.1) { const y = 650 - (650 - f.top) * (t / 1.1); html += `<circle cx="${f.x}" cy="${y.toFixed(0)}" r="3" fill="#fff"/><path d="M${f.x} ${y.toFixed(0)} L${f.x} ${(y + 30).toFixed(0)}" stroke="#ffd166" stroke-width="2" stroke-opacity=".7"/>`; live.push(f); }
        else if (t < 2.9) {
          if (!f.boomed) { f.boomed = true; boom(); }
          const k = (t - 1.1) / 1.8, r = 20 + 110 * Math.sqrt(k), op = Math.max(0, 1 - k);
          for (let i = 0; i < 18; i++) { const a = f.seed + i * Math.PI * 2 / 18; html += `<circle cx="${(f.x + Math.cos(a) * r).toFixed(0)}" cy="${(f.top + Math.sin(a) * r + 40 * k * k).toFixed(0)}" r="${(4 - 2 * k).toFixed(1)}" fill="${f.color}" fill-opacity="${op.toFixed(2)}"/>`; }
          html += `<circle cx="${f.x}" cy="${f.top}" r="${(r * 0.6).toFixed(0)}" fill="${f.color}" fill-opacity="${(0.12 * op).toFixed(2)}"/>`;
          live.push(f);
        }
      }
      fireworks = live; el.querySelector('.bubbles').insertAdjacentHTML('beforeend', html);
    }
    if (fishAt && now > fishAt) { fishAt = 0; const dur = 8000 + Math.floor(Math.random() * 7000); send({ type: 'fish', dur }); catchAt = now + dur; }
    if (catchAt && now > catchAt) { catchAt = 0; send({ type: 'catch', item: Math.floor(Math.random() * D.CATCHES.length) }); score('fish'); }
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
    cameraTick(dt);
    raf = requestAnimationFrame(tick);
  }
  /* Cold outside, heat inside: warnings, the tonttu's call, freezing, thawing, water. */
  function bodyTick() {
    const now = Date.now(), t = ctx.t;
    const st = coldStage(me);
    if (st !== lastStage) {
      if (st === 1) { ctx.toast(t('coldWarn1')); addLog(`🥶 ${t('coldWarn1')}`); }
      if (st === 3) { ctx.toast(t('youFroze')); addLog(`🧊 ${t('youFroze')}`); addChat({ sys: true, text: `🧊 ${t('frozenMsg').replace('{n}', me.name)}` }); }
      lastStage = st; placePeople();
    }
    if (st >= 2 && now - tonttuCallAt > 45000) { tonttuCallAt = now; tonttuUntil = now + 10000; const line = t('coldWarn2').replace('{n}', me.name); addChat({ sys: true, text: `🧝 ${line}` }); addLog(`🧝 ${line}`); ding(); speak(line.replace(/^[^:]+: /, '')); }
    if (st === 3 && me.outSince && (now - me.outSince) / 1000 * coldRate() > 420) {
      me.zone = 'in'; delete me.x; delete me.y; delete dest[pid]; delete pos[pid]; me.outSince = null; me.inSince = now; rounds++; inSince = now; nudged = false; hotWarned = false; lastStage = 0;
      const line = `🧊 ${me.name} ${t('stumbled')}`; addChat({ sys: true, text: line }); addLog(line); bump('rounds'); track();
      const b = el.querySelector('#coolBtn'); if (b) b.innerHTML = `❄️ ${esc(t('coolOff'))}`;
    }
    if (!hotWarned && isDizzy(me)) { hotWarned = true; const line = t('hotWarn').replace('{n}', me.name); addChat({ sys: true, text: `🥵 ${line}` }); addLog(`🥵 ${line}`); ctx.toast(t('dizzy')); placePeople(); }
    for (const p of people) {
      if (p.id === pid) continue;
      const key = p.id + ':' + (p.outSince || 0);
      if (coldStage(p) === 3 && !warned[key]) { warned[key] = true; const line = t('frozenMsg').replace('{n}', p.name); addChat({ sys: true, text: `🧊 ${line}` }); addLog(`🧊 ${line}`); placePeople(); }
      const hk = p.id + ':hot:' + (p.inSince || 0);
      if (isDizzy(p) && !warned[hk]) { warned[hk] = true; const line = t('hotWarn').replace('{n}', p.name); addChat({ sys: true, text: `🥵 ${line}` }); placePeople(); }
    }
    if (dipAt && now > dipAt) { dipAt = 0; send({ type: 'mood', face: 'wow', emoji: '🧊', note: 'dipped', ms: 4000, mid: pid + '-' + now }); bubbles.push({ id: pid, emoji: '💦', at: now, until: now + 2500 }); bump('dip'); score('dip'); }
    if (angelAt && now > angelAt) { angelAt = 0; send({ type: 'angel', x: me.x, y: me.y }); bump('angel'); score('angel'); }
    imprints = imprints.filter(i => i.until > now);
    const layer = el.querySelector('.imprints'); if (layer) layer.innerHTML = imprints.map(i => `<g transform="translate(${i.x},${i.y - 6})" opacity="${Math.min(1, (i.until - now) / 20000).toFixed(2)}"><ellipse cx="0" cy="0" rx="20" ry="30" fill="#e6eef7" stroke="#b9cde3"/><path d="M-20 -8 Q-58 -2 -60 22 Q-38 14 -20 16 Z M20 -8 Q58 -2 60 22 Q38 14 20 16 Z" fill="#e6eef7" stroke="#b9cde3"/><path d="M-9 30 L-28 54 L28 54 L9 30 Z" fill="#e6eef7" stroke="#b9cde3"/><circle cx="0" cy="-38" r="9" fill="#e6eef7" stroke="#b9cde3"/></g>`).join('');
  }
  function bump(key) {
    counters[key] = (counters[key] || 0) + 1; renderChallenge();
    const ch = todayChallenge();
    if (!hero && ch.key === key && counters[key] >= ch.goal) {
      hero = true; try { localStorage.setItem('saunakaverit.hero', dayKey()); } catch (e) {}
      me.hero = true; track(); score('challenge'); ctx.toast(ctx.t('challengeDone')); addChat({ sys: true, text: `⭐ ${me.name}: ${ctx.t('hero')}` }); addLog(`⭐ ${me.name}: ${ctx.t('hero')}`); ding(); setTimeout(ding, 200);
    }
  }
  function renderStats() {
    const box = el.querySelector('#statsCard'); if (!box) return; const t = ctx.t;
    const parts = [['🔥', 'loyly', 'sLoyly'], ['🧊', 'dips', 'sDips'], ['☃️', 'snow', 'sSnow'], ['🍻', 'cheers', 'sCheers'], ['🎵', 'songs', 'sSongs'], ['😜', 'teases', 'sTeases']].filter(p => stats[p[1]]);
    box.innerHTML = `<b>📊 ${esc(t('stats'))}:</b> ${parts.length ? parts.map(p => `${p[0]} ${stats[p[1]]} ${esc(t(p[2]))}`).join(' · ') : '–'}`;
  }
  /* Shared surprises on a common clock: a power cut, the neighbour, an avalanche off the roof. */
  function eventsTick() {
    const now = Date.now(), t = ctx.t;
    // power cut: every 11 minutes, 12 seconds
    const pc = Math.floor((now + 240000) / 660000), pp = (now + 240000) % 660000, cut = pp < 12000;
    const black = el.querySelector('.blackout'), ember = el.querySelector('.emberGlow');
    if (black) black.style.opacity = cut ? .82 : 0; if (ember) ember.style.opacity = cut ? 1 : 0;
    if (cut && lastPcut !== pc) { lastPcut = pc; addChat({ sys: true, text: `💡 ${t('powerCut')}` }); addLog(`💡 ${t('powerCut')}`); people.forEach(p => setFace(p.id, 'wow', 3000)); speak(t('powerCut')); }
    if (!cut && pcut) { addChat({ sys: true, text: `💡 ${t('powerBack')}` }); addLog(`💡 ${t('powerBack')}`); }
    pcut = cut;
    // neighbour Pentti: every 9 minutes, 50 seconds
    const nc = Math.floor((now + 120000) / 540000), np = (now + 120000) % 540000, nOn = np < 50000;
    if (nOn) {
      if (lastPentti !== nc) { lastPentti = nc; npcStage = 0; npc = { id: 'npc', name: t('pentti'), zone: 'floor', x: 600, y: 545, hat: 'felt', towel: 3, since: now, first: false }; pos.npc = { x: 600, y: 545 }; dest.npc = { x: 1080, y: 565 }; addChat({ sys: true, text: `🚶 ${t('penttiCame')}` }); addLog(`🚶 ${t('penttiCame')}`); placePeople(); }
      const say = (i) => { const line = LP(D.PENTTI[i]); bubbles = bubbles.filter(b => !(b.id === 'npc' && b.text)); bubbles.push({ id: 'npc', text: line.replace(/^[^:]+: /, ''), at: now, until: now + 6000 }); addChat({ sys: true, text: `🧔 ${line}` }); speak(line.replace(/^[^:]+: /, '')); };
      if (np > 4000 && npcStage < 1) { npcStage = 1; say(0); }
      if (np > 12000 && npcStage < 2) { npcStage = 2; say(1); }
      if (np > 20000 && npcStage < 3) { npcStage = 3; say(2); temp = Math.min(109, temp + 4); spawnSteam(26, true); hiss(false); masters[t('pentti')] = (masters[t('pentti')] || 0) + 1; renderMasters(); addLog(`💧 ${t('pentti')} ${t('threw')}`); }
      if (np > 34000 && npcStage < 4) { npcStage = 4; say(3); dest.npc = { x: 560, y: 545 }; }
    } else if (npc) { npc = null; delete pos.npc; delete dest.npc; placePeople(); }
    // avalanche off the roof: every 6 minutes, 4 seconds, hits whoever stands under the eaves
    const ac = Math.floor((now + 300000) / 360000), ap = (now + 300000) % 360000, aOn = ap < 4000;
    const roof = el.querySelector('.roofsnow'); if (roof) roof.style.display = aOn ? '' : 'none';
    if (aOn && lastAval !== ac) {
      lastAval = ac; addChat({ sys: true, text: `🏔 ${t('avalanche')}` }); addLog(`🏔 ${t('avalanche')}`);
      for (const p of people) { const c = findPos(p.id); if (c && p.zone === 'floor' && c.x > 470 && c.x < 660) { setFace(p.id, 'snowhit', 5000); addChat({ sys: true, text: `❄️ ${p.name} ${t('buried')}` }); if (p.id === pid) ctx.toast(t('avalanche')); } }
    }
    // the kiuas gets lonely
    if (lastLoylyAt && now - lastLoylyAt > 180000 && now - lastKiuasLonely > 240000) { lastKiuasLonely = now; kiuasSay('lonely'); }
  }
  function renderChallenge() {
    const box = el.querySelector('#challenge'); if (!box) return;
    const ch = todayChallenge(), n = Math.min(ch.goal, counters[ch.key] || 0);
    box.innerHTML = `<span>⭐ <b>${esc(ctx.t('challenge'))}:</b> ${esc(L(ch))}</span><b>${hero ? '✓ ' + esc(ctx.t('hero')) : n + '/' + ch.goal}</b>`;
  }
  /* The camera follows your own figure unless the picture was dragged or the map tapped recently. */
  function cameraTick(dt) {
    const svg = el.querySelector('#roomSvg'); if (!svg) return;
    if (Date.now() > camHold) {
      const mp = findPos(pid); const target = Math.max(0, Math.min(WORLD_W - VIEW_W, (mp ? mp.x : 1040) - VIEW_W / 2));
      cam += (target - cam) * Math.min(1, dt / 180);
    }
    const vb = `${cam.toFixed(1)} 0 ${VIEW_W} 700`;
    if (svg.getAttribute('viewBox') !== vb) svg.setAttribute('viewBox', vb);
    const v = el.querySelector('#mmView'); if (v) { v.style.left = (cam / WORLD_W * 100) + '%'; v.style.width = (VIEW_W / WORLD_W * 100) + '%'; }
  }
  function renderMinimap() {
    const box = el.querySelector('#mmDots'); if (!box) return;
    box.innerHTML = people.map(p => { const c = findPos(p.id); if (!c) return ''; return `<i style="left:${(c.x / WORLD_W * 100).toFixed(1)}%;background:${TOWELS[(p.towel >= 0 ? p.towel : hash(p.name) % TOWELS.length)]}" class="${p.id === pid ? 'me' : ''}" title="${esc(p.name)}"></i>`; }).join('');
  }
  function walkTo(x, y, quiet) {
    const c = clampFloor(x, y);
    if (coldStage(me) >= 3) { ctx.toast(ctx.t('frozenCantMove')); return; }
    if (me.zone !== 'floor') { const from = findPos(pid); if (from) pos[pid] = clampFloor(from.x, from.y); }
    const outNow = isOutside(c.x);
    if (outNow && !me.outSince) me.outSince = Date.now();
    if (!outNow && me.outSince) { me.outSince = null; me.inSince = Date.now(); inSince = Date.now(); hotWarned = false; lastStage = 0; }
    me.zone = 'floor'; me.x = c.x; me.y = c.y;
    send({ type: 'move', x: c.x, y: c.y }); track();
    const btn = el.querySelector('#coolBtn'); if (btn) btn.innerHTML = isOutside(c.x) ? `🔥 ${esc(ctx.t('backIn'))}` : `❄️ ${esc(ctx.t('coolOff'))}`;
  }
  /* Things seen through the window, on a shared clock so every phone sees them together. */
  function windowTick() {
    const now = Date.now();
    const mc = Math.floor(now / 420000), mp = now % 420000, mooseOn = mp < 14000;
    const moose = el.querySelector('.moose');
    if (moose) { moose.style.opacity = mooseOn ? 1 : 0; if (mooseOn) moose.setAttribute('transform', `translate(${(700 - (mp / 14000) * 800).toFixed(0)},392)`); }
    if (mooseOn && lastMoose !== mc) { lastMoose = mc; addChat({ sys: true, text: `🫎 ${ctx.t('moose')}` }); addLog(`🫎 ${ctx.t('moose')}`); }
    const ac = Math.floor((now + 150000) / 300000), ap = (now + 150000) % 300000, auroraOn = ap < 40000;
    const aurora = el.querySelector('.aurora');
    if (aurora) aurora.style.opacity = auroraOn ? (0.5 + 0.4 * Math.sin(ap / 2500)).toFixed(2) : .22;
    if (auroraOn && lastAurora !== ac) { lastAurora = ac; addChat({ sys: true, text: `🌌 ${ctx.t('aurora')}` }); addLog(`🌌 ${ctx.t('aurora')}`); }
  }
  function findPos(id) {
    if (id === 'cat') return { x: 1690, y: 530 };
    if (id === 'kiuas') return { x: 849, y: 300 };
    if (id === 'thermo') return { x: 1040, y: 150 };
    if (id === 'npc') return (npc && pos.npc) ? clampFloor(pos.npc.x, pos.npc.y) : null;
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
      let Q, ans;
      if (quiz.kind === 'vocab') { const w = D.VOCAB[quiz.q]; Q = [t(quiz.dir ? 'vocabQ2' : 'vocabQ').replace('{w}', quiz.dir ? w[0] : w[1]), quiz.opts.map(i => quiz.dir ? D.VOCAB[i][1] : D.VOCAB[i][0])]; ans = quiz.a; }
      else { const q = D.QUIZ[quiz.q]; Q = L(q); ans = q.a; }
      const left = Math.max(0, Math.ceil((quiz.at + 20000 - now) / 1000));
      box.style.display = '';
      box.innerHTML = `<div class="small muted">${quiz.kind === 'vocab' ? '🔡 ' + esc(t('vocabQuiz')) : '🧠 ' + esc(t('quiz'))} · ${esc(quiz.by)}${quiz.done ? '' : ` · ${left} ${esc(t('secondsLeft'))}`}</div>
        <h3>${esc(Q[0])}</h3>
        <div class="qopts">${Q[1].map((o, i) => `<button class="btn small ${quiz.done ? (i === ans ? '' : 'secondary') : (quiz.mine === i ? '' : 'secondary')}" data-qa="${i}" ${quiz.done || quiz.mine != null ? 'disabled' : ''}>${esc(o)}${quiz.done && i === ans ? ' ✓' : ''}</button>`).join('')}</div>
        ${quiz.done ? `<p class="small"><b>${quiz.winner ? `🏆 ${esc(quiz.winner)} ${esc(t('winner'))}!` : esc(t('nobody'))}</b> · ${esc(t('correctIs'))}: ${esc(Q[1][ans])}</p>` : ''}
        ${quiz.answers.length ? `<div class="small muted">${quiz.answers.map(a => `${a.ok ? '✅' : '❌'} ${esc(a.by)}`).join(' · ')}</div>` : ''}`;
    } else if (snowfight) {
      const left = Math.max(0, Math.ceil((snowfight.at + 30000 - now) / 1000));
      const rows = Object.values(snowfight.tally).sort((a, b) => b.n - a.n);
      box.style.display = '';
      box.innerHTML = `<div class="small muted">❄️ ${esc(t('snowfight'))} · ${esc(snowfight.by)}</div>
        <h3>${snowfight.done ? esc(t('snowfightOver')) : `${esc(t('snowfightLive'))} <b>${left}</b> ${esc(t('secondsLeft'))}`}</h3>
        <div class="small">${rows.length ? rows.map((r, i) => `${i === 0 && snowfight.done ? '👑' : '☃️'} ${esc(r.name)}: <b>${r.n}</b>`).join(' · ') : esc(t('hits')) + ': 0'}</div>
        ${snowfight.done && rows.length ? `<p class="small"><b>🏆 ${esc(rows[0].name)} · ${esc(t('snowKing'))}!</b></p>` : ''}`;
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
          if (rows[0].id === pid) { me.crown = now + 10 * 60000; track(); ctx.toast(ctx.t('youWon')); ding(); score('duel'); }
        }
      }
      if (duel.done && now - (duel.doneAt || now) > 15000) duel = null;
      renderGame();
    }
    if (snowfight) {
      if (!snowfight.done && now - snowfight.at > 30000) {
        snowfight.done = true; snowfight.doneAt = now;
        const rows = Object.values(snowfight.tally).sort((a, b) => b.n - a.n || a.first - b.first);
        if (rows.length) {
          addLog(`👑 ${rows[0].name} · ${ctx.t('snowKing')}`); addChat({ sys: true, text: `👑 ${rows[0].name} · ${ctx.t('snowKing')}` });
          if (rows[0].id === pid) { me.icecrown = now + 10 * 60000; track(); ctx.toast(ctx.t('youWon')); ding(); score('snowfight'); }
        }
      }
      if (snowfight.done && now - (snowfight.doneAt || now) > 15000) snowfight = null;
      renderGame();
    }
  }

  /* ---------- events ---------- */
  function onEvent(ev) {
    const by = ev.by || '?', t = ctx.t, now = Date.now();
    if (ev.type === 'loyly') {
      temp = Math.min(110, temp + (ev.perfect ? 8 : 4)); spawnSteam(ev.perfect ? 50 : 26, true); hiss(!!ev.perfect); throws.push(now); masters[by] = (masters[by] || 0) + 1;
      stats.loyly = (stats.loyly || 0) + 1; lastLoylyAt = now; throwTimes.push(now); throwTimes = throwTimes.filter(x => now - x < 10000);
      if (ev.perfect) { addChat({ sys: true, text: `🎯 ${by} ${t('perfectLoyly')}` }); kiuasSay('perfect'); }
      else if (throwTimes.length >= 3 && now - lastKiuasScold > 30000) { lastKiuasScold = now; kiuasSay('scold'); }
      if (temp >= 110) { temp = 100; kiuasSay('burst'); bubbles.push({ id: 'thermo', emoji: '💥', at: now, until: now + 3000 }); }
      renderStats();
      el.querySelectorAll('.people .bob').forEach(g => { g.classList.remove('shock'); void g.getBBox(); g.classList.add('shock'); });
      if (duel && !duel.done) { const r = duel.tally[ev.id] || (duel.tally[ev.id] = { id: ev.id, name: by, n: 0, first: now }); r.n++; renderGame(); }
      renderMasters(); renderMeter(); addLog(`💧 ${by} ${t('threw')}`); bubbles.push({ id: ev.id, emoji: '💧', at: now, until: now + 3000 });
      el.querySelector('.tempText').textContent = Math.round(temp) + '°'; const l = el.querySelector('.ladle'); if (l) { l.classList.remove('pour'); void l.getBBox(); l.classList.add('pour'); }
    }
    else if (ev.type === 'react') {
      if (ev.target) {
        const vkey = ev.verb === 'hatswap' ? 'hatsSwapped' : ev.verb === 'towelhid' ? 'towelHid' : (ev.verb || 'waved');
        const line = `${ev.emoji} ${by} ${t(vkey)} ${ev.targetName || ''}`; addLog(line); addChat({ sys: true, text: line });
        if (ev.verb === 'tickled') {
          setFace(ev.target, 'laugh', 5000); setFace(ev.id, 'tongue', 2000);
          [0, 600, 1200].forEach(d => setTimeout(() => { if (raf) bubbles.push({ id: ev.target, emoji: '🤭', at: Date.now(), until: Date.now() + 2500 }); }, d));
        } else if (ev.verb === 'hatswap') {
          if (ev.target === pid) { me.hat = ev.hat || 'none'; figure.hat = me.hat; saveFigure(); track(); }
          bubbles.push({ id: ev.target, emoji: '🎩', at: now, until: now + 3000 }); bubbles.push({ id: ev.id, emoji: '🎩', at: now, until: now + 3000 }); setFace(ev.id, 'laugh', 3000);
        } else if (ev.verb === 'towelhid') {
          setFace(ev.target, 'hidden', 8000); setFace(ev.id, 'tongue', 3000); if (ev.target === pid) ctx.toast(t('towelGone'));
        } else if (ev.verb === 'thawed') {
          if (ev.target === pid) { me.outSince = Date.now(); lastStage = 0; track(); }
          setFace(ev.id, 'love', 3000); setFace(ev.target, 'love', 3000); bubbles.push({ id: ev.target, emoji: '🔥', at: now, until: now + 3000 }); ding();
        } else if (ev.verb === 'watered') {
          if (ev.target === pid) { me.inSince = Date.now(); inSince = Date.now(); hotWarned = false; nudged = false; track(); }
          setFace(ev.target, 'relax', 4000); bubbles.push({ id: ev.target, emoji: '💧', at: now, until: now + 3000 });
        } else if (ev.verb === 'cheered') {
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
          if (ev.verb === 'snowed') { setFace(ev.id, 'laugh', 3000); if (snowfight && !snowfight.done) { const r = snowfight.tally[ev.id] || (snowfight.tally[ev.id] = { id: ev.id, name: by, n: 0, first: now }); r.n++; renderGame(); } }
          if (ev.verb === 'whisked2') setFace(ev.id, 'vihta', 3000);
        } else {
          bubbles.push({ id: ev.target, emoji: ev.emoji, at: now, until: now + 3500 });
          setFace(ev.id, 'wave', 2500);
        }
        if (ev.target === pid) { ctx.toast(`${ev.emoji} ${by}`); ding(); }
        if (ev.verb === 'snowed') stats.snow = (stats.snow || 0) + 1; if (ev.verb === 'cheered') stats.cheers = (stats.cheers || 0) + 1; if (ev.verb === 'teased') stats.teases = (stats.teases || 0) + 1; renderStats();
      } else {
        bubbles.push({ id: ev.id, emoji: ev.emoji, at: now, until: now + 3500 });
        if (ev.emoji === '🙏') { addLog(`🙏 ${by}: ${t('greet')}!`); setFace(ev.id, 'relax', 2500); }
        else if (ev.emoji === '🌿') { addLog(`🌿 ${by} ${t('whisked')}`); setFace(ev.id, 'vihta', 3000); }
        else addLog(`${ev.emoji} ${by}`);
      }
    }
    else if (ev.type === 'say') { const text = String(ev.text || '').slice(0, 80); bubbles = bubbles.filter(b => !(b.id === ev.id && b.text)); bubbles.push({ id: ev.id, text, at: now, until: now + 7000 }); addLog(`💬 ${by}: ${text}`); addChat({ id: ev.id, by, text, mid: ev.mid }); if (ev.id !== pid) ding(); ainoHears(ev); }
    else if (ev.type === 'mood') { const face = String(ev.face || ''); setFace(ev.id, face, ev.ms || 9000); if (ev.note === 'dipped') { stats.dips = (stats.dips || 0) + 1; renderStats(); } bubbles = bubbles.filter(b => !(b.id === ev.id && b.emoji)); bubbles.push({ id: ev.id, emoji: ev.emoji, at: now, until: now + 3500 }); if (ev.note) { addLog(`${ev.emoji} ${by} ${t(ev.note)}`); addChat({ sys: true, text: `${ev.emoji} ${by} ${t(ev.note)}` }); } else addChat({ id: ev.id, by, text: ev.emoji, big: true, mid: ev.mid }); if (ev.id !== pid) ding(); }
    else if (ev.type === 'rocket') { fireworks.push({ x: ev.x || 300, top: 150 + Math.floor(Math.random() * 120), t0: now, seed: (ev.seed || 0) % 7, color: FX_COLORS[(ev.seed || 0) % FX_COLORS.length] }); hiss(false); addLog(`🎆 ${by} ${t('fired')}`); addChat({ sys: true, text: `🎆 ${by} ${t('fired')}` }); }
    else if (ev.type === 'sled') {
      const p = people.find(x => x.id === ev.id); if (p) { p.zone = 'floor'; p.x = 90; p.y = 430; }
      pos[ev.id] = { x: 90, y: 430 }; delete dest[ev.id]; sledding[ev.id] = { t0: now }; setFace(ev.id, 'wow', 2400);
      addLog(`🛷 ${by} ${t('sledded')}`); addChat({ sys: true, text: `🛷 ${by} ${t('sledded')}` }); placePeople();
    }
    else if (ev.type === 'fish') { fishing[ev.id] = now + (ev.dur || 10000); setFace(ev.id, 'fish', ev.dur || 10000); addLog(`🎣 ${by} ${t('fishing')}`); addChat({ sys: true, text: `🎣 ${by} ${t('fishing')}` }); }
    else if (ev.type === 'catch') {
      delete fishing[ev.id]; const c = D.CATCHES[(ev.item || 0) % D.CATCHES.length]; const what = ctx.lang() === 'en' ? c[1] : c[0];
      setFace(ev.id, c[2] === '👢' || c[2] === '💤' ? 'wow' : 'laugh', 4000); bubbles.push({ id: ev.id, emoji: c[2], at: now, until: now + 4000 });
      addLog(`🎣 ${by} ${t('caught')} ${what} ${c[2]}`); addChat({ sys: true, text: `🎣 ${by} ${t('caught')} ${what} ${c[2]}` }); if (ev.id !== pid) ding();
    }
    else if (ev.type === 'sing') {
      singers[ev.id] = now + 8000; setFace(ev.id, 'sing', 8000); melody(ev.at || now); stats.songs = (stats.songs || 0) + 1; renderStats();
      addLog(`🎵 ${by} ${t('sang')}`); addChat({ sys: true, text: `🎵 ${by} ${t('sang')}` });
      const n = Object.values(singers).filter(u => u > now).length;
      if (n >= 3 && now - lastChorus > 20000) { lastChorus = now; const line = t('chorus').replace('{n}', n); addChat({ sys: true, text: `🎶 ${line}` }); addLog(`🎶 ${line}`); ctx.toast(line); }
    }
    else if (ev.type === 'angel') { imprints.push({ x: ev.x, y: ev.y, until: now + 150000 }); setFace(ev.id, 'laugh', 3000); bubbles.push({ id: ev.id, emoji: '👼', at: now, until: now + 3000 }); addChat({ sys: true, text: `👼 ${by} ${t('madeAngel')}` }); addLog(`👼 ${by} ${t('madeAngel')}`); }
    else if (ev.type === 'cat') { bubbles.push({ id: 'cat', emoji: '😺', at: now, until: now + 3000 }); addLog(`🐱 ${t('catPurr')}`); if (ev.id === pid) ctx.toast(t('catPurr')); }
    else if (ev.type === 'snowfight') { if (snowfight && !snowfight.done) return; snowfight = { at: ev.at || now, by, tally: {}, done: false }; addLog(`❄️ ${by} ${t('snowfightStarted')}`); addChat({ sys: true, text: `❄️ ${by} ${t('snowfightStarted')}` }); ctx.toast(t('snowfightLive')); ding(); renderGame(); }
    else if (ev.type === 'move') { const p = people.find(x => x.id === ev.id); if (p) { if (p.zone !== 'floor') { const from = findPos(ev.id); if (from) pos[ev.id] = clampFloor(from.x, from.y); } p.zone = 'floor'; p.x = ev.x; p.y = ev.y; } dest[ev.id] = { x: ev.x, y: ev.y }; if (!pos[ev.id]) pos[ev.id] = { x: ev.x, y: ev.y }; placePeople(); }
    else if (ev.type === 'mreact') { const m = chat.find(x => x.mid === ev.mid); if (!m) return; const key = ev.id + ':' + ev.emoji; if (m.who[key]) return; m.who[key] = true; m.reacts[ev.emoji] = (m.reacts[ev.emoji] || 0) + 1; renderChat(); if (m.id === pid && ev.id !== pid) { ctx.toast(`${ev.emoji} ${by}`); } }
    else if (ev.type === 'quiz') {
      if (quiz && !quiz.done) return;
      if (ev.kind === 'vocab') quiz = { kind: 'vocab', q: ev.q % D.VOCAB.length, dir: ev.dir ? 1 : 0, opts: (ev.opts || [ev.q, 0, 1]).map(i => i % D.VOCAB.length), a: ev.a || 0, at: ev.at || now, by, answers: [], mine: null, done: false, winner: null };
      else quiz = { q: ev.q % D.QUIZ.length, at: ev.at || now, by, answers: [], mine: null, done: false, winner: null };
      addLog(`🧠 ${by} ${t('quizStarted')}`); addChat({ sys: true, text: `${ev.kind === 'vocab' ? '🔡' : '🧠'} ${by} ${t('quizStarted')}` }); ding(); renderGame();
      if (ev.kind === 'vocab' && quiz.dir === 0 && practice) speakFi(D.VOCAB[quiz.q][0]);
    }
    else if (ev.type === 'answer') { if (!quiz || ev.q !== quiz.q) return; if (ev.id === pid) quiz.mine = ev.choice; if (!quiz.answers.some(a => a.id === ev.id)) quiz.answers.push({ id: ev.id, by, ok: !!ev.ok }); if (ev.ok && !quiz.winner) { quiz.winner = by; quiz.done = true; quiz.doneAt = now; addLog(`🏆 ${by} ${t('answered')}`); addChat({ sys: true, text: `🏆 ${by} ${t('answered')} · ${t('quiz')}` }); if (ev.id === pid) { bump('quizWin'); score(quiz.kind === 'vocab' ? 'vocab' : 'quiz'); } } renderGame(); }
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
    let heroDay = null; try { heroDay = localStorage.getItem('saunakaverit.hero'); } catch (e) {}
    hero = heroDay === dayKey();
    me = { name, seat: SEATS[hash(pid) % SEATS.length].id, zone: 'in', hat: figure.hat, towel: figure.towel, pet: figure.pet || 'none', crown: 0, icecrown: 0, first: !!prof.firstTimer, since: Date.now(), outSince: null, inSince: Date.now(), hero };
    petPos = {}; fireworks = []; sledding = {}; fishing = {}; fishAt = 0; catchAt = 0;
    counters = {}; imprints = []; warned = {}; snowfight = null; dipAt = 0; angelAt = 0; lastStage = 0; hotWarned = false; tonttuCallAt = 0;
    singers = {}; npc = null; npcStage = -1; stats = {}; ladle = null; throwTimes = []; lastLoylyAt = Date.now(); pcut = false; lastChorus = 0;
    lastPcut = Math.floor((Date.now() + 240000) / 660000); lastPentti = Math.floor((Date.now() + 120000) / 540000); lastAval = Math.floor((Date.now() + 300000) / 360000);
    people = []; steam = []; bubbles = []; log = []; chat = []; masters = {}; temp = 80; throws = []; tonttuUntil = 0; lastStarter = -1; quiz = null; duel = null; person = null; faces = {}; reactBarFor = null; projectiles = []; pos = {}; dest = {};
    lastMoose = Math.floor(Date.now() / 420000); lastAurora = Math.floor((Date.now() + 150000) / 300000);
    enteredAt = Date.now(); inSince = enteredAt; rounds = 1; nudged = false;
    const t = ctx.t, nx = ctx.next;
    el.innerHTML = `<div class="roomRoot">
      <div class="row between" style="margin:4px 0 6px">
        <div><div class="small muted">${esc(t('roomTitle'))}</div><h2 style="margin:0">🧖 ${esc(options.label || t('roomCommon'))}</h2></div>
        <div class="row"><button class="chipbtn ghost" data-act="sound" id="soundBtn" title="${esc(t('sound'))}">${soundOn ? '🔊' : '🔇'}</button><div class="live"><span class="dot"></span> LIVE · <b id="presentCount">1</b> ${esc(t('present'))}</div></div>
      </div>
      <div class="pill-row" style="margin:0 0 8px"><button class="chipbtn" data-act="prog" id="progChip">⭐ 0 ${esc(t('points'))}</button><button class="chipbtn ${practice ? 'active' : ''}" data-act="practice" id="practiceBtn">🇫🇮 ${esc(t('practice'))}</button><button class="chipbtn" data-act="classroom">🏫 ${esc(t('classroom'))}</button></div>
      <div id="practicePanel" style="display:none"></div>
      <div class="roomWrap">${scene(false)}</div>
      <div class="minimap" id="minimap" title="${esc(t('mapHint'))}"><span class="mmArea" style="left:0;width:32%">❄️ ${esc(t('terraceLbl'))}</span><span class="mmArea" style="left:32%;width:40%">🔥 ${esc(t('saunaLbl'))}</span><span class="mmArea" style="left:72%;width:28%">🛋 ${esc(t('loungeLbl'))}</span><div class="mmView" id="mmView"></div><div class="mmDots" id="mmDots"></div></div>
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
      <div class="card challenge row between" id="challenge"></div>
      <div class="card ladleGame" id="ladleGame" style="display:none"></div>
      <div class="small muted" id="statsCard" style="margin:4px 0 8px"></div>
      <p class="small muted" style="margin:4px 0 8px">${esc(t('tapHint'))} · ${esc(t('mapHint'))}</p>
      <span id="coolBtn" hidden></span>
      <div class="actions">
        <button class="btn big" data-act="loyly"><span class="ic">💧</span>${esc(t('actLoyly'))}</button>
        <button class="btn big secondary" data-act="talk"><span class="ic">💬</span>${esc(t('actTalk'))}</button>
        <button class="btn big secondary" data-menu="move"><span class="ic">🚶</span>${esc(t('actMove'))}</button>
        <button class="btn big secondary" data-menu="more"><span class="ic">✨</span>${esc(t('actDo'))}</button>
        <button class="btn big lake" data-menu="games"><span class="ic">🎲</span>${esc(t('actGames'))}</button>
      </div>
      <div class="menu" id="menuBox" style="display:none"></div>
      <div class="card progCard" id="progCard"></div>
      <div class="card figureBar" id="figureBar" style="display:none"></div>
      ${nx ? `<div class="card nextCard" data-open="${esc(nx.id)}"><div><div class="small muted">🔥 ${esc(t('nextSauna'))}</div><b>${esc(nx.text)}</b></div><span class="btn small">${esc(nx.cta)} →</span></div>` : ''}
      <div class="grid2">
        <div class="card" style="margin:6px 0"><h3>${esc(t('loylyMasters'))}</h3><div id="masters"></div></div>
        <div class="card" style="margin:6px 0"><h3>${esc(t('happening'))}</h3><div id="roomLog" class="small muted">${esc(t('quietRoom'))}</div></div>
      </div>
      <p class="small muted">${esc(t('roomRules'))}</p></div>`;
    const root = el.querySelector('.roomRoot');
    el.querySelector('.coolLabel').textContent = t('terraceLbl'); el.querySelector('.loungeLabel').textContent = t('loungeLbl');
    cam = 550; camHold = 0;
    renderChat();
    function updateCoolBtn(){ const b = el.querySelector('#coolBtn'); if (b) b.innerHTML = (me.zone === 'floor' && isOutside(me.x)) ? `🔥 ${esc(t('backIn'))}` : `❄️ ${esc(t('coolOff'))}`; }
    function sitAt(seatId) {
      if (coldStage(me) >= 3) { ctx.toast(t('frozenCantMove')); return; }
      me.seat = seatId; if (me.zone === 'floor' && isOutside(me.x)) { rounds++; inSince = Date.now(); nudged = false; bump('rounds'); score('round'); }
      me.zone = 'in'; delete me.x; delete me.y; delete dest[pid]; delete pos[pid]; me.outSince = null; me.inSince = Date.now(); lastStage = 0; hotWarned = false; updateCoolBtn(); track();
    }
    function renderMenu(kind) {
      const box = el.querySelector('#menuBox');
      if (menuOpen === kind) { menuOpen = null; box.style.display = 'none'; return; }
      menuOpen = kind;
      const out = me.zone === 'floor' && isOutside(me.x), lounge = me.zone === 'floor' && me.x >= LOUNGE_X0, inSauna = !out && !lounge;
      let items = [];
      if (kind === 'move') items = [me.zone !== 'in' && ['sit', '🔥', t('mvBench')], !out && ['cool', '❄️', t('mvTerrace')], !lounge && ['lounge', '🛋', t('mvLounge')], ['avanto', '🧊', t('mvAvanto')], ['sled', '🛷', t('mvSled')]];
      if (kind === 'more') items = [inSauna && ['vihta', '🌿', t('vihta')], ['greet', '🙏', t('greet')], ['sing', '🎵', t('sing')], inSauna && ['ladlegame', '🥄', t('ladleGame')], out && ['angel', '👼', t('angelBtn')], out && ['fish', '🎣', t('fish')], out && ['rocket', '🎆', t('rocket')], lounge && ['beer', '🍺', t('takeBeer')], ['figure', '🎭', t('myFigure')], ['postcard', '📮', t('postcard')]];
      if (kind === 'games') items = [['quiz', '🧠', t('quiz')], ['duel', '💧', t('duel')], ['snowfight', '☃️', t('snowfight')], practice && ['vocab', '🔡', t('vocabQuiz')]];
      items = items.filter(Boolean);
      box.innerHTML = items.map(i => `<button class="btn small ${kind === 'games' ? 'lake' : 'secondary'}" data-act="${i[0]}">${i[1]} ${esc(i[2])}</button>`).join('');
      box.style.display = '';
      el.querySelectorAll('[data-menu]').forEach(b => b.classList.toggle('open', b.dataset.menu === kind));
    }
    // drag the picture to look around
    (function () {
      const svg = el.querySelector('#roomSvg'); let down = false, sx = 0, startCam = 0, moved = false;
      svg.addEventListener('pointerdown', e => { down = true; sx = e.clientX; startCam = cam; moved = false; });
      svg.addEventListener('pointermove', e => { if (!down) return; const dx = (e.clientX - sx) * (VIEW_W / svg.clientWidth); if (Math.abs(e.clientX - sx) > 6) { moved = true; camHold = Date.now() + 4000; cam = Math.max(0, Math.min(WORLD_W - VIEW_W, startCam - dx)); } });
      const up = () => { if (!down) return; down = false; if (moved) { suppressClick = true; setTimeout(() => suppressClick = false, 150); } };
      svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up); svg.addEventListener('pointerleave', up);
    })();
    function showPerson(id, name) {
      person = { id, name };
      const bar = el.querySelector('#personBar'); bar.style.display = '';
      const tp = people.find(x => x.id === id);
      const tTitle = tp && tp.titleIc ? `${tp.titleIc} ` : '';
      const care = `${coldStage(tp) >= 3 ? `<button class="btn small" data-pact="thaw">🔥 ${esc(t('thaw'))}</button>` : ''}${isDizzy(tp) ? `<button class="btn small" data-pact="water">💧 ${esc(t('water'))}</button>` : ''}`;
      bar.innerHTML = `<div class="row between wrap"><b>${tTitle}${esc(name)} · ${esc(t('personActions'))}</b><button class="chipbtn ghost" data-pact="close">✕</button></div>
        ${care ? `<div class="pill-row" style="margin-top:6px">${care}</div>` : ''}
        <div class="grp"><span>${esc(t('grpFun'))}</span><button class="btn small" data-pact="cheers">🍻 ${esc(t('cheers'))}</button><button class="btn small" data-pact="hifive">✋ ${esc(t('hifive'))}</button><button class="btn small secondary" data-pact="wave">👋 ${esc(t('wave'))}</button><button class="btn small secondary" data-pact="tease">😜 ${esc(t('tease'))}</button></div>
        <div class="grp"><span>${esc(t('grpPranks'))}</span><button class="btn small secondary" data-pact="tickle">🤭 ${esc(t('tickle'))}</button><button class="btn small secondary" data-pact="hatswap">🎩 ${esc(t('hatswap'))}</button><button class="btn small secondary" data-pact="hidetowel">🪣 ${esc(t('hidetowel'))}</button><button class="btn small secondary" data-pact="snow">☃️ ${esc(t('snow'))}</button></div>
        <div class="grp"><span>${esc(t('grpOther'))}</span><button class="btn small secondary" data-pact="whisk">🌿 ${esc(t('whisk'))}</button><button class="btn small secondary" data-pact="beer">🍺 ${esc(t('beer'))}</button><button class="btn small secondary" data-pact="ladle">🥄 ${esc(t('ladle'))}</button></div>`;
    }
    function showFigure() {
      const bar = el.querySelector('#figureBar'); const open = bar.style.display === 'none'; bar.style.display = open ? '' : 'none'; if (!open) return;
      bar.innerHTML = `<div class="small muted">${esc(t('hatLabel'))}</div><div class="pill-row" style="margin:4px 0 8px">${Object.keys(D.HATS).filter(h => h !== 'crown').map(h => `<button class="chipbtn ${me.hat === h ? 'active' : ''}" data-hat="${h}">${esc(L(D.HATS[h]))}</button>`).join('')}</div>
        <div class="small muted">${esc(t('towelLabel'))}</div><div class="pill-row" style="margin-top:4px">${TOWELS.map((c, i) => `<button class="swatch ${me.towel === i ? 'on' : ''}" data-towel="${i}" style="background:${c}"></button>`).join('')}</div>
        <div class="small muted" style="margin-top:8px">${esc(t('petLabel'))}</div><div class="pill-row" style="margin-top:4px">${Object.keys(D.PETS).map(k => `<button class="chipbtn ${(me.pet || 'none') === k ? 'active' : ''}" data-pet="${k}">${D.PETS[k].e ? D.PETS[k].e + ' ' : ''}${esc(L(D.PETS[k]))}</button>`).join('')}</div>`;
    }
    function doAct(act, b) {
      if (act === 'loyly') { if (b) { b.disabled = true; b.classList.add('pulse'); setTimeout(() => { b.disabled = false; b.classList.remove('pulse'); }, 1500); } try { navigator.vibrate && navigator.vibrate(30); } catch (e) {} send({ type: 'loyly' }); bump('loyly'); score('loyly'); myThrows++; if (practice) speakFi(`${D.NUMBERS[Math.min(12, myThrows)]} löylyä`); }
      if (act === 'vihta') send({ type: 'react', emoji: '🌿' });
      if (act === 'rocket') score('rocket'); if (act === 'sled') score('sled'); if (act === 'sing') score('song');
      if (act === 'greet') send({ type: 'react', emoji: '🙏' });
      if (act === 'emo') send({ type: 'react', emoji: b.dataset.emo });
      if (act === 'figure') showFigure();
      if (act === 'quiz') { if (quiz && !quiz.done) return; send({ type: 'quiz', q: Math.floor(Math.random() * D.QUIZ.length), at: Date.now() }); }
      if (act === 'duel') { if (duel && !duel.done) return; send({ type: 'duel', at: Date.now() }); }
      if (act === 'sound') { soundOn = !soundOn; try { localStorage.setItem('saunakaverit.sound', soundOn ? 'on' : 'off'); } catch (e) {} el.querySelector('#soundBtn').textContent = soundOn ? '🔊' : '🔇'; if (soundOn) hiss(false); }
      if (act === 'cool') {
        if (me.zone === 'floor' && isOutside(me.x)) { me.zone = 'in'; delete me.x; delete me.y; delete dest[pid]; delete pos[pid]; me.outSince = null; me.inSince = Date.now(); lastStage = 0; hotWarned = false; rounds++; inSince = Date.now(); nudged = false; updateCoolBtn(); addLog(`🔥 ${me.name} ${t('cameIn')}`); bump('rounds'); score('round'); track(); }
        else { walkTo(300 + Math.random() * 80, 590 + Math.random() * 40); addLog(`❄️ ${me.name} ${t('wentOut')}`); }
      }
      if (act === 'lounge') walkTo(1600 + Math.random() * 120, 620 + Math.random() * 30);
      if (act === 'avanto') { if (coldStage(me) >= 3) { ctx.toast(t('frozenCantMove')); return; } const d = findPos(pid); walkTo(330, 612); const dist = d ? Math.hypot(330 - d.x, 612 - Math.max(478, d.y)) : 500; dipAt = Date.now() + dist / 230 * 1000 + 400; }
      if (act === 'angel') { if (coldStage(me) >= 3) { ctx.toast(t('frozenCantMove')); return; } if (me.zone === 'floor' && isOutside(me.x)) angelAt = Date.now() + 100; else { const d = findPos(pid); const tx = 160 + Math.random() * 100, ty = 540 + Math.random() * 60; walkTo(tx, ty); const dist = d ? Math.hypot(tx - d.x, ty - Math.max(478, d.y)) : 600; angelAt = Date.now() + dist / 230 * 1000 + 400; } }
      if (act === 'snowfight') { if (snowfight && !snowfight.done) return; send({ type: 'snowfight', at: Date.now() }); }
      if (act === 'cat') send({ type: 'cat' });
      if (act === 'sing') send({ type: 'sing', at: Date.now() });
      if (act === 'rocket') send({ type: 'rocket', x: 120 + Math.floor(Math.random() * 420), seed: Math.floor(Math.random() * 1000) });
      if (act === 'sled') { if (coldStage(me) >= 3) { ctx.toast(t('frozenCantMove')); return; } me.zone = 'floor'; me.x = 90; me.y = 430; if (!me.outSince) me.outSince = Date.now(); send({ type: 'sled' }); track(); }
      if (act === 'fish') { if (coldStage(me) >= 3) { ctx.toast(t('frozenCantMove')); return; } const d = findPos(pid); walkTo(486, 596); const dist = d ? Math.hypot(486 - d.x, 596 - Math.max(478, d.y)) : 500; fishAt = Date.now() + dist / 230 * 1000 + 300; }
      if (act === 'postcard') makePostcard();
      if (act === 'sit') { const { taken } = layout(people); const free = SEATS.find(s => !taken[s.id]) || SEATS[0]; sitAt(free.id); }
      if (act === 'talk') { const inp = el.querySelector('#sayInput'); if (inp) { inp.scrollIntoView({ behavior: 'smooth', block: 'center' }); inp.focus(); } }
      if (act === 'beer') send({ type: 'mood', face: 'beer', emoji: '🍺', note: 'tookBeer', ms: 15000, mid: pid + '-' + Date.now() });
      if (act === 'prog') { const c = el.querySelector('#progCard'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'center' }); refreshLeaderboard(); }
      if (act === 'practice') { practice = !practice; savePractice(); ctx.toast(t(practice ? 'practiceOn' : 'practiceOff')); el.querySelector('#practiceBtn').classList.toggle('active', practice); renderPractice(); renderLabels(); if (practice) { ainoAt = Date.now() - 140000; } }
      if (act === 'words') { showWords = !showWords; renderLabels(); renderPractice(); }
      if (act === 'phraseListen') speakFi(D.PHRASES[Math.floor(Date.now() / 86400000) % D.PHRASES.length][0]);
      if (act === 'phraseSay') { const ph = D.PHRASES[Math.floor(Date.now() / 86400000) % D.PHRASES.length]; send({ type: 'say', text: ph[0], mid: pid + '-' + Date.now() }); pstats.phrases++; savePractice(); renderPractice(); }
      if (act === 'vocab') {
        if (quiz && !quiz.done) return;
        const q = Math.floor(Math.random() * D.VOCAB.length), dir = Math.random() < 0.5 ? 0 : 1;
        const others = []; while (others.length < 2) { const r = Math.floor(Math.random() * D.VOCAB.length); if (r !== q && !others.includes(r)) others.push(r); }
        const opts = [q, ...others].sort(() => Math.random() - 0.5);
        send({ type: 'quiz', kind: 'vocab', q, dir, opts, a: opts.indexOf(q), at: Date.now() });
      }
      if (act === 'classroom') {
        const name = prompt(t('classroomAsk')); if (!name) return;
        const slug = name.trim().toLowerCase().replace(/[^a-z0-9äöå]+/g, '-').replace(/^-|-$/g, '');
        const link = location.origin + location.pathname + '?room=' + encodeURIComponent(slug);
        try { navigator.clipboard && navigator.clipboard.writeText(link); } catch (e) {}
        if (navigator.share) navigator.share({ title: 'Saunakaverit', text: `${t('classLabel')} ${name}`, url: link }).catch(() => {});
        ctx.toast(t('classroomLink')); addChat({ sys: true, text: `🏫 ${t('classLabel')} ${name}: ${link}` });
      }
      if (act === 'ladlegame') {
        const box = el.querySelector('#ladleGame'); ladle = { start: Date.now() }; box.style.display = '';
        box.innerHTML = `<div class="small muted">🥄 ${esc(t('ladleGame'))} · ${esc(t('ladleHint'))}</div><div class="ladleBar"><div class="zone"></div><div class="marker"></div></div><div class="row" style="margin-top:8px"><button class="btn small" data-act="ladlethrow">💧 ${esc(t('ladleThrow'))}</button><button class="btn small secondary" data-act="ladleclose">✕</button></div>`;
      }
      if (act === 'ladleclose') { ladle = null; el.querySelector('#ladleGame').style.display = 'none'; }
      if (act === 'ladlethrow' && ladle) {
        const phase = ((Date.now() - ladle.start) % 2400) / 2400, q = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
        ladle = null; el.querySelector('#ladleGame').style.display = 'none';
        if (q > 0.84) { send({ type: 'loyly', perfect: true }); bump('loyly'); score('perfect'); }
        else if (q > 0.5) { send({ type: 'loyly' }); bump('loyly'); score('loyly'); addLog(`👌 ${me.name} ${t('goodLoyly')}`); }
        else { bubbles.push({ id: pid, emoji: '💦', at: Date.now(), until: Date.now() + 2500 }); send({ type: 'mood', face: 'wow', emoji: '💦', note: 'splashLoyly', ms: 2500, mid: pid + '-' + Date.now() }); }
      }
    }
    root.addEventListener('click', e => {
      const seat = e.target.closest('[data-seat]');
      if (seat) { sitAt(+seat.dataset.seat); return; }
      const pr = e.target.closest('[data-person]');
      if (pr) { if (pr.dataset.person !== pid) showPerson(pr.dataset.person, pr.dataset.pname); return; }
      const pa = e.target.closest('[data-pact]');
      if (pa && person) {
        const k = pa.dataset.pact;
        if (k === 'close') { el.querySelector('#personBar').style.display = 'none'; person = null; return; }
        const map = { wave: ['👋', 'waved'], whisk: ['🌿', 'whisked2'], beer: ['🍺', 'offered'], snow: ['☃️', 'snowed'], cheers: ['🍻', 'cheered'], tease: ['😜', 'teased'], hifive: ['✋', 'hifived'], ladle: ['🥄', 'gaveLadle'], thaw: ['🔥', 'thawed'], water: ['💧', 'watered'], tickle: ['🤭', 'tickled'], hatswap: ['🎩', 'hatsSwapped'], hidetowel: ['🪣', 'towelHid'] };
        const verb = k === 'hatswap' ? 'hatswap' : k === 'hidetowel' ? 'towelhid' : map[k][1];
        let myHat = me.hat;
        if (k === 'hatswap') { const tp = people.find(x => x.id === person.id); me.hat = (tp && tp.hat) || 'none'; figure.hat = me.hat; saveFigure(); track(); }
        send({ type: 'react', emoji: map[k][0], verb, hat: myHat, target: person.id, targetName: person.name, line: Math.floor(Math.random() * D.TEASES.length), mid: pid + '-' + Date.now() });
        if (k === 'cheers') { bump('cheers'); score('cheers'); } if (k === 'tease') { bump('tease'); score('tease'); } if (k === 'thaw') score('thaw'); if (k === 'water') score('water');
        return;
      }
      if (suppressClick) return;
      const fh = e.target.closest('.floorHit');
      if (fh) {
        const svg = el.querySelector('#roomSvg'); const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
        const m = svg.getScreenCTM(); if (!m) return; const q = pt.matrixTransform(m.inverse());
        const wasOut = me.zone === 'floor' && isOutside(me.x);
        walkTo(q.x, q.y);
        if (wasOut && !isOutside(me.x)) { rounds++; inSince = Date.now(); nudged = false; addLog(`🔥 ${me.name} ${t('cameIn')}`); bump('rounds'); score('round'); }
        return;
      }
      const mm = e.target.closest('#minimap');
      if (mm) { const r = mm.getBoundingClientRect(); camHold = Date.now() + 5000; cam = Math.max(0, Math.min(WORLD_W - VIEW_W, (e.clientX - r.left) / r.width * WORLD_W - VIEW_W / 2)); return; }
      if (e.target.closest('[data-act=beertable]')) { send({ type: 'mood', face: 'beer', emoji: '🍺', note: 'tookBeer', ms: 15000, mid: pid + '-' + Date.now() }); return; }
      const hat = e.target.closest('[data-hat]'); if (hat) { me.hat = hat.dataset.hat; figure.hat = me.hat; saveFigure(); track(); showFigure(); showFigure(); return; }
      const tw = e.target.closest('[data-towel]'); if (tw) { me.towel = +tw.dataset.towel; figure.towel = me.towel; saveFigure(); track(); showFigure(); showFigure(); return; }
      const pt2 = e.target.closest('[data-pet]'); if (pt2 && !pt2.classList.contains('pet')) { me.pet = pt2.dataset.pet; figure.pet = me.pet; saveFigure(); delete petPos[pid]; track(); placePeople(); showFigure(); showFigure(); return; }
      const qa = e.target.closest('[data-qa]'); if (qa && quiz && !quiz.done && quiz.mine == null) { const c = +qa.dataset.qa; const ok = c === (quiz.kind === 'vocab' ? quiz.a : D.QUIZ[quiz.q].a); send({ type: 'answer', q: quiz.q, choice: c, ok }); if (ok && quiz.kind === 'vocab') { pstats.quiz++; savePractice(); renderPractice(); speakFi(D.VOCAB[quiz.q][0]); } return; }
      const wd = e.target.closest('[data-word]'); if (wd) { const w = D.WORDS[+wd.dataset.word]; speakFi(w.fi); ctx.toast(`${w.fi} = ${w.en}`); pstats.words++; savePractice(); renderPractice(); score('word'); return; }
      const ph = e.target.closest('[data-phrase]'); if (ph) { send({ type: 'say', text: ph.dataset.phrase, mid: pid + '-' + Date.now() }); return; }
      const md = e.target.closest('[data-mood]'); if (md) { send({ type: 'mood', face: md.dataset.mood, emoji: md.dataset.emo, mid: pid + '-' + Date.now() }); return; }
      if (e.target.closest('#emojiBtn')) { const g = el.querySelector('#emojiGrid'); g.style.display = g.style.display === 'none' ? '' : 'none'; return; }
      const ins = e.target.closest('[data-ins]'); if (ins) { const inp = el.querySelector('#sayInput'); inp.value = (inp.value + ins.dataset.ins).slice(0, 80); inp.focus(); return; }
      const mr = e.target.closest('[data-mr]'); if (mr) { send({ type: 'mreact', mid: mr.dataset.mid, emoji: mr.dataset.mr }); reactBarFor = null; renderChat(); return; }
      const msg = e.target.closest('.msg[data-mid]'); if (msg && !msg.classList.contains('sys')) { reactBarFor = reactBarFor === msg.dataset.mid ? null : msg.dataset.mid; renderChat(); return; }
      const mb = e.target.closest('[data-menu]'); if (mb) { renderMenu(mb.dataset.menu); return; }
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'loyly') { if (Date.now() - (root._lastLoyly || 0) < 1500) return; root._lastLoyly = Date.now(); }
      doAct(b.dataset.act, b.tagName === 'BUTTON' ? b : el.querySelector('button[data-act=loyly]'));
      if (b.closest('#menuBox') && b.dataset.act !== 'figure') { menuOpen = null; el.querySelector('#menuBox').style.display = 'none'; el.querySelectorAll('[data-menu]').forEach(x => x.classList.remove('open')); }
    });
    el.querySelector('#sayForm').addEventListener('submit', e => {
      e.preventDefault(); const inp = el.querySelector('#sayInput'); const text = inp.value.trim(); if (!text) return; inp.value = ''; el.querySelector('#emojiGrid').style.display = 'none'; send({ type: 'say', text, mid: pid + '-' + Date.now() });
    });

    people = [Object.assign({ id: pid }, me)]; placePeople(); renderChallenge();
    ainoOpen = null; ainoAt = Date.now() - 120000; myThrows = 0; praised = {}; showWords = false; renderLabels(); renderPractice();
    const p0 = ctx.prog && ctx.prog(); if (p0) prog = { points: p0.points || 0, totals: p0.totals || {}, week: p0.week || 0 };
    else { try { prog = Object.assign({ points: 0, totals: {}, week: 0 }, JSON.parse(localStorage.getItem('saunakaverit.prog') || '{}')); } catch (e) {} }
    scoreQueue = {}; menuOpen = null; lb = []; lbAt = 0; const bt0 = bestTitle(prog.totals); me.titleIc = bt0 ? bt0.ic : ''; renderProgress(); refreshLeaderboard();
    lastTick = 0; raf = requestAnimationFrame(tick);
    starterTick();
    if (ctx.client) {
      ch = getChannel(ctx.client, roomId);
      if (subscribed[roomId]) { track(); syncPresence(); }
    }
  }
  function saveFigure(){ try { localStorage.setItem('saunakaverit.figure', JSON.stringify(figure)); } catch (e) {} }

  /* A postcard: the scene as a picture with a greeting, shared or downloaded. */
  function makePostcard() {
    const t = ctx.t;
    try {
      const src = el.querySelector('#roomSvg'); const clone = src.cloneNode(true);
      clone.setAttribute('width', '900'); clone.setAttribute('height', '700'); clone.querySelectorAll('.seatHits').forEach(g => g.remove());
      const xml = new XMLSerializer().serializeToString(clone);
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas'); cv.width = 900; cv.height = 790; const g = cv.getContext('2d');
        g.drawImage(img, 0, 0, 900, 700);
        g.fillStyle = '#f6f1ea'; g.fillRect(0, 700, 900, 90);
        g.fillStyle = '#8c5a35'; g.font = 'bold 30px Outfit, Inter, sans-serif'; g.fillText(`🔥 ${t('postcardText')}`, 24, 742);
        const names = people.map(p => p.name).slice(0, 8).join(', ');
        g.fillStyle = '#5d5249'; g.font = '18px Inter, sans-serif'; g.fillText(`${new Date().toLocaleDateString(ctx.lang() === 'en' ? 'en-GB' : 'fi-FI')} · ${names}`, 24, 772);
        g.fillStyle = '#8c5a35'; g.font = '16px Inter, sans-serif'; g.textAlign = 'right'; g.fillText(location.host + location.pathname, 876, 772);
        cv.toBlob(blob => {
          if (!blob) { ctx.toast(t('postcardFail')); return; }
          const file = new File([blob], 'saunakaverit.png', { type: 'image/png' });
          if (navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: 'Saunakaverit', text: t('postcardText') }).catch(() => {}); }
          else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'saunakaverit.png'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }
          ctx.toast(t('postcardDone'));
        }, 'image/png');
      };
      img.onerror = () => ctx.toast(t('postcardFail'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    } catch (e) { ctx.toast(t('postcardFail')); }
  }

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
    floor.forEach(p => { const c = clampFloor(p.x || 1000, p.y || 560); html += avatar(p, c.x, c.y, floorScale(c.y), false); });
    container.querySelector('.people').innerHTML = html;
  }

  function watch(client, id, cb) {
    if (!client) return;
    pid = pid || deviceId(cb.deviceSuffix || '');
    (watchers[id] = watchers[id] || []).push(cb);
    getChannel(client, id);
    if (counts[id] != null) cb(counts[id], (metasByRoom[id] || []).map(m => m.name), metasByRoom[id] || []);
  }

  return { enter, leave, watch, preview, setProg, isOpen: () => !!raf, count: (id) => counts[id] || 0, metas: (id) => metasByRoom[id] || [], _state: () => ({ me, pos, dest, people, ch, quiz, practice, ainoOpen, prog, lb }) };
})();
