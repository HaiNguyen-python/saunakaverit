/* Saunakaverit v0.2 - app logic. Online: shared sessions through SK_API (Supabase).
   Offline / no backend: seed sessions and local-only state, so the app always works. */
(function () {
  const D = window.SK_DATA, API = window.SK_API || { enabled: false, deviceSuffix: '' };
  const $ = (s, el=document) => el.querySelector(s);
  const $$ = (s, el=document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  /* ---------- state ---------- */
  const KEY = 'saunakaverit.v1' + (API.deviceSuffix || '');
  const defaults = () => ({
    lang: 'fi', theme: 'auto',
    profile: { name:'', city:'Helsinki', langs:['fi'], firstTimer:false, buddy:false },
    sessions: [],            // offline: user-created sessions
    joins: {},               // sessionId -> true (offline) | 'going' | 'waitlist' (online)
    stamps: [],              // {saunaId, date}
    hosted: 0, hostedIds: [],
    removedSeeds: [],
    filter: { city:'Kaikki', theme:'' },
  });
  let S = load();
  let online = false, remote = [], connecting = API.enabled, sheetSession = null, roomCount = 0, currentRoom = { id: 'yhteinen', label: '' };
  const ROOM = window.SK_ROOM;
  function load(){ try { const raw = localStorage.getItem(KEY); return raw ? Object.assign(defaults(), JSON.parse(raw)) : defaults(); } catch(e){ return defaults(); } }
  function save(){ try { localStorage.setItem(KEY, JSON.stringify(S)); } catch(e){} }

  const t = (k) => (D.UI[S.lang] && D.UI[S.lang][k]) ?? D.UI.fi[k] ?? k;
  const L = (obj) => (obj && typeof obj === 'object') ? (obj[S.lang] ?? obj.fi) : obj;

  /* ---------- backend sync ---------- */
  async function refresh(){
    if (!API.enabled) return;
    try {
      let r = await API.load();
      if (!r.me && S.profile.name) { await API.saveProfile(S.profile); r = await API.load(); }
      remote = r.sessions;
      if (r.me) {
        const p = r.me.profile;
        S.profile = { name: p.name, city: p.city, langs: p.langs || ['fi'], firstTimer: !!p.first_timer, buddy: !!p.buddy };
        S.joins = {}; (r.me.joins || []).forEach(j => S.joins[j.session_id] = j.status);
        S.stamps = (r.me.stamps || []).map(s => ({ saunaId: s.sauna_id, date: s.date }));
        S.hosted = r.me.hosted || 0; S.hostedIds = r.me.hosted_ids || [];
      }
      online = true; connecting = false; save(); renderAll();
      if (sheetSession) openSession(sheetSession);
    } catch (e) {
      console.warn('Saunakaverit: backend unavailable, using local mode', e);
      online = false; connecting = false; renderAll();
    }
  }
  let refreshTimer;
  const refreshSoon = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 400); };
  function errMsg(e){
    const m = (e && e.message) || '';
    if (/name required|no profile/.test(m)) return t('nameNeeded');
    if (/start in past/.test(m)) return t('errPast');
    if (/too many/.test(m)) return t('errLimit');
    return t('errGeneric');
  }
  const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

  /* ---------- sessions ---------- */
  function allSessions(){
    const now = new Date();
    let list;
    if (online) list = remote.map(s => Object.assign({}, s, { sauna: D.SAUNAS.find(x => x.id === s.saunaId) })).filter(s => s.sauna);
    else list = D.seedSessions(now).filter(s => !S.removedSeeds.includes(s.id)).concat(S.sessions).map(normalizeLocal);
    return list.filter(s => new Date(s.start).getTime() > now.getTime() - 3*3600e3).sort((a,b) => new Date(a.start) - new Date(b.start));
  }
  function normalizeLocal(s){
    const me = S.profile.name;
    const attendees = (s.attendees || []).slice(), waitlist = (s.waitlist || []).slice();
    if (me && S.joins[s.id] && !attendees.includes(me) && !waitlist.includes(me)) { if (attendees.length < s.cap) attendees.push(me); else waitlist.push(me); }
    return Object.assign({}, s, { attendees, waitlist, sauna: D.SAUNAS.find(x => x.id === s.saunaId) });
  }
  function findSession(id){ return allSessions().find(s => s.id === id); }
  function myStatus(s){
    const me = S.profile.name;
    if (online) return S.joins[s.id] || null;
    if (!me) return null;
    return s.attendees.includes(me) ? 'going' : s.waitlist.includes(me) ? 'waitlist' : null;
  }
  const isMine = (s) => online ? S.hostedIds.includes(s.id) : S.sessions.some(x => x.id === s.id);

  /* ---------- date helpers ---------- */
  const pad = n => String(n).padStart(2,'0');
  function fmtDate(iso){
    const d = new Date(iso), now = new Date();
    const wd = t('weekdays')[d.getDay()];
    const sameDay = (a,b) => a.toDateString() === b.toDateString();
    const tmr = new Date(now); tmr.setDate(now.getDate()+1);
    let day = `${wd} ${d.getDate()}.${d.getMonth()+1}.`;
    if (sameDay(d, now)) day = t('today'); else if (sameDay(d, tmr)) day = t('tomorrow');
    return `${day} ${t('clock')} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function isThisWeek(iso){
    const d = new Date(iso), now = new Date();
    const end = new Date(now); end.setDate(now.getDate() + (7 - now.getDay()) % 7 + 1); end.setHours(0,0,0,0);
    if (end - now < 2*86400e3) end.setDate(end.getDate()+7);
    return d < end;
  }
  function inSeason(season, now){
    const m = now.getMonth()+1, dd = now.getDate();
    const [fm, fd] = season.from, [tm, td] = season.to;
    const a = fm*100+fd, b = tm*100+td, x = m*100+dd;
    return a <= b ? (x >= a && x <= b) : (x >= a || x <= b);
  }
  function nextSeason(now){
    const x = (now.getMonth()+1)*100 + now.getDate();
    const up = D.SEASONS.filter(s => !inSeason(s, now)).map(s => { const a = s.from[0]*100+s.from[1]; return { s, dist: a >= x ? a - x : a + 1300 - x }; });
    up.sort((p,q) => p.dist - q.dist);
    return up[0] && up[0].s;
  }

  /* ---------- ui helpers ---------- */
  let toastTimer;
  function toast(msg){ const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2200); }
  function openSheet(html){ $('#sheet').innerHTML = '<div class="handle"></div>' + html; $('#sheetBg').classList.add('open'); document.body.style.overflow = 'hidden'; }
  function closeSheet(){ $('#sheetBg').classList.remove('open'); document.body.style.overflow = ''; sheetSession = null; }
  $('#sheetBg').addEventListener('click', e => { if (e.target.id === 'sheetBg') closeSheet(); });

  function themeTag(theme){ const th = D.THEMES[theme]; return th ? `<span class="tag">${th.ic} ${esc(L(th))}</span>` : ''; }
  function kindTag(kind){ const k = D.KINDS[kind]; return k ? `<span class="tag kind">${esc(L(k.short))}</span>` : ''; }
  function priceTag(p){ const free = /ilmainen|free/i.test(p); return `<span class="tag ${free?'free':''}">${esc(p)}</span>`; }
  function mapsUrl(sauna){ return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(sauna.name + ', ' + sauna.address); }
  function statusLine(){
    if (connecting) return `<div class="small muted" style="text-align:center;padding:4px">⏳ ${esc(t('loading'))}</div>`;
    if (API.enabled && !online) return `<div class="card moss small">📴 ${esc(t('offlineNote'))}</div>`;
    return '';
  }

  /* ---------- views ---------- */
  function sessionCard(s){
    const d = new Date(s.start);
    const freeN = Math.max(0, s.cap - s.attendees.length);
    const st = myStatus(s);
    return `<div class="card session" data-open="${esc(s.id)}">
      <div class="when"><b>${pad(d.getHours())}:${pad(d.getMinutes())}</b><span>${esc(fmtDate(s.start).split(' '+t('clock'))[0])}</span></div>
      <div>
        <h3>${D.THEMES[s.theme]?.ic || '🔥'} ${esc(L(D.THEMES[s.theme]) || s.theme)}</h3>
        <div class="small muted">${esc(s.sauna?.name)} · ${esc(s.sauna?.area)}, ${esc(s.sauna?.city)}</div>
        <div>${kindTag(s.kind)}${priceTag(s.price)}${s.after?`<span class="tag">☕ ${esc(t('after').split(' ')[0])}</span>`:''}${st==='going'?`<span class="tag kind">✓ ${esc(t('joined'))}</span>`:st==='waitlist'?`<span class="tag">⏳ ${esc(t('onWaitlist'))}</span>`:''}</div>
      </div>
      <div class="spots"><b>${s.attendees.length}/${s.cap}</b>${freeN ? `${freeN} ${esc(t('free'))}` : `<span class="tag full">${esc(t('full'))}</span>`}</div>
    </div>`;
  }

  function renderHome(){
    const now = new Date();
    const all = allSessions();
    const sessions = all.filter(s => S.filter.city === 'Kaikki' || s.sauna?.city === S.filter.city).filter(s => !S.filter.theme || s.theme === S.filter.theme);
    const sunday = all.find(s => s.recurring);
    const season = D.SEASONS.find(s => inSeason(s, now));
    const next = nextSeason(now);
    const week = sessions.filter(s => isThisWeek(s.start));
    const later = sessions.filter(s => !isThisWeek(s.start));
    const nameBanner = !S.profile.name && !connecting ? `<div class="card moss row between"><span>${esc(t('welcome'))}</span><button class="btn small" data-go="profile">${esc(t('setName'))}</button></div>` : '';
    const themeChips = ['', ...Object.keys(D.THEMES)].map(k => `<button class="chipbtn ${S.filter.theme===k?'active':''}" data-theme="${k}">${k?D.THEMES[k].ic+' '+esc(L(D.THEMES[k])):esc(t('all'))}</button>`).join('');
    const cityChips = ['Kaikki', ...D.CITIES].map(c => `<button class="chipbtn ${S.filter.city===c?'active':''}" data-city="${c}">${c==='Kaikki'?esc(t('all')):c}</button>`).join('');
    const sundaySt = sunday && myStatus(sunday);

    $('#view-home').innerHTML = `
      ${statusLine()}
      ${nameBanner}
      <div class="card roomCard">
        <div><div class="small muted">🔴 LIVE · <b id="roomCount">${roomCount}</b> ${esc(t('nowPresent'))}</div><h3 style="margin:2px 0">🧖 ${esc(t('roomCommon'))}</h3><div class="small muted">${esc(t('roomLead'))}</div></div>
        <button class="btn" data-room="yhteinen">${esc(t('enterRoom'))}</button>
      </div>
      ${sunday ? `<div class="card hero"><div class="steam"></div>
        <div class="small muted">${esc(t('nextSunday'))} · ${esc(fmtDate(sunday.start))}</div>
        <h2>🔥 ${esc(sunday.sauna.name)}</h2>
        <p class="muted">${esc(t('sundayLead'))}</p>
        <div class="row between wrap" style="margin-top:10px"><span>${sunday.attendees.length}/${sunday.cap} · ${esc(L(D.KINDS[sunday.kind]))}</span><button class="btn" data-open="${sunday.id}">${sundaySt==='going' ? '✓ ' + esc(t('joined')) : sundaySt==='waitlist' ? '⏳ ' + esc(t('onWaitlist')) : esc(t('join'))}</button></div>
      </div>` : ''}
      ${season ? `<div class="card season"><div class="small muted">${esc(t('seasonNow'))}</div><h3>${season.ic} ${esc(L(season)[0])}</h3><p class="small">${esc(L(season)[1])}</p></div>` : ''}
      <div class="filters">${cityChips}</div>
      <div class="filters">${themeChips}</div>
      <h2>${esc(t('thisWeek'))}</h2>
      ${week.length ? week.map(sessionCard).join('') : `<div class="empty"><div class="ic">🧖</div>${esc(connecting ? t('loading') : t('noSessions'))}</div>`}
      ${later.length ? `<h2>${esc(t('later'))}</h2>${later.map(sessionCard).join('')}` : ''}
      <button class="btn full" data-go="host" style="margin-top:8px">➕ ${esc(t('hostCta'))}</button>
      ${next ? `<div class="card ${season?'':'season'}" style="margin-top:16px"><div class="small muted">${esc(t('seasonNext'))}</div><h3>${next.ic} ${esc(L(next)[0])}</h3><p class="small muted">${esc(L(next)[1])}</p></div>` : ''}
    `;
  }

  function renderSaunas(){
    const list = D.SAUNAS.filter(s => S.filter.city === 'Kaikki' || s.city === S.filter.city);
    const cityChips = ['Kaikki', ...D.CITIES].map(c => `<button class="chipbtn ${S.filter.city===c?'active':''}" data-city="${c}">${c==='Kaikki'?esc(t('all')):c}</button>`).join('');
    $('#view-saunas').innerHTML = `
      <h1>${esc(t('saunasTitle'))}</h1><p class="muted small">${esc(t('saunasLead'))}</p>
      <div class="filters">${cityChips}</div>
      ${list.map(sa => {
        const stamped = S.stamps.some(st => st.saunaId === sa.id);
        return `<div class="card sauna">
          <div>
            <h3>${esc(sa.name)}</h3>
            <div class="small muted">${esc(sa.area)}, ${esc(sa.city)} · ${esc(sa.price)}</div>
            <p class="small">${esc(L(sa.note))}</p>
            <div class="facts">
              <span class="tag">${sa.heating==='savu'?'🌫️':sa.heating==='puu'?'🪵':'⚡'} ${esc(L(D.HEATING[sa.heating]))}</span>
              <span class="tag kind">${esc(L(D.KINDS[sa.policy].short))}</span>
              ${sa.avanto?`<span class="tag free">🌊 ${esc(t('avanto'))}</span>`:''}
              ${sa.terrace?`<span class="tag">☕ ${esc(t('terrace'))}</span>`:''}
            </div>
            <div class="row wrap" style="margin-top:8px">
              <a class="btn small secondary" href="${mapsUrl(sa)}" target="_blank" rel="noopener">📍 ${esc(t('directions'))}</a>
              <a class="btn small secondary" href="${esc(sa.url)}" target="_blank" rel="noopener">🔗 ${esc(t('website'))}</a>
            </div>
          </div>
          <div class="stamp ${stamped?'done':''}" data-stamp="${sa.id}" title="${esc(stamped?t('stamped'):t('stamp'))}">${stamped?'🔥':'＋'}</div>
        </div>`;
      }).join('')}`;
  }

  function stats(){
    return { stamps: S.stamps, hosted: online ? S.hosted : S.sessions.length, joined: Object.keys(S.joins).filter(id => S.joins[id]).length };
  }

  function renderPassport(){
    const st = stats();
    const stampList = S.stamps.slice().sort((a,b) => new Date(b.date) - new Date(a.date));
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    $('#view-passport').innerHTML = `
      <h1>${esc(t('passportTitle'))}</h1><p class="muted small">${esc(t('passportLead'))}</p>
      <div class="stat"><div><b>${st.stamps.length}</b><small>${esc(t('stamps'))}</small></div><div><b>${st.joined}</b><small>${esc(t('joinedN'))}</small></div><div><b>${st.hosted}</b><small>${esc(t('hosted'))}</small></div></div>
      <h2 style="margin-top:16px">${esc(t('badges'))}</h2>
      <div class="badges">${D.BADGES.map(b => { const e = b.test(st); return `<div class="badge ${e?'earned':''}"><div class="ic">${b.ic}</div><b>${esc(L(b)[0])}</b><small>${esc(L(b)[1])}</small></div>`; }).join('')}</div>
      <h2 style="margin-top:16px">${esc(cap(t('stamps')))}</h2>
      ${stampList.length ? stampList.map(s => { const sa = D.SAUNAS.find(x => x.id === s.saunaId); const d = new Date(s.date); return `<div class="card row between"><span>🔥 <b>${esc(sa?.name || s.saunaId)}</b> <span class="muted small">${esc(sa?.city || '')}</span></span><span class="muted small">${d.getDate()}.${d.getMonth()+1}.${d.getFullYear()}</span></div>`; }).join('') : `<div class="empty"><div class="ic">📖</div>${esc(t('noStamps'))}</div>`}
    `;
  }

  function renderEtiquette(){
    $('#view-etiquette').innerHTML = `
      <h1>${esc(t('etiquetteTitle'))}</h1><p class="muted small">${esc(t('etiquetteLead'))}</p>
      ${D.ETIQUETTE.map((e,i) => `<div class="card etq"><div class="ic">${e.ic}</div><div><h3>${i+1}. ${esc(L(e)[0])}</h3><p class="small">${esc(L(e)[1])}</p></div></div>`).join('')}
    `;
  }

  function renderProfile(){
    const p = S.profile;
    $('#view-profile').innerHTML = `
      <h1>${esc(t('profileTitle'))}</h1><p class="muted small">${esc(t('profileLead'))}</p>
      <form class="card form" id="profileForm">
        <label>${esc(t('yourName'))}</label><input name="name" maxlength="24" value="${esc(p.name)}" placeholder="Hai, Mikko, Anna…" required>
        <label>${esc(t('yourCity'))}</label><select name="city">${D.CITIES.map(c => `<option ${p.city===c?'selected':''}>${c}</option>`).join('')}</select>
        <label>${esc(t('yourLangs'))}</label>
        <div class="checks">${Object.entries(D.LANGS).map(([k,v]) => `<label class="${p.langs.includes(k)?'on':''}"><input type="checkbox" name="langs" value="${k}" ${p.langs.includes(k)?'checked':''}>${v}</label>`).join('')}</div>
        <div class="checks" style="margin-top:12px">
          <label class="${p.firstTimer?'on':''}"><input type="checkbox" name="firstTimer" ${p.firstTimer?'checked':''}>🙋 ${esc(t('firstTimer'))}</label>
          <label class="${p.buddy?'on':''}"><input type="checkbox" name="buddy" ${p.buddy?'checked':''}>🤝 ${esc(t('buddy'))}</label>
        </div>
        <p class="small muted" style="margin-top:8px">${esc(t('buddyLead'))}</p>
        <button class="btn full" type="submit" style="margin-top:12px">${esc(t('save'))}</button>
      </form>
      <p class="small muted" style="text-align:center">${esc(online ? t('versionOnline') : t('version'))}</p>
      <div style="text-align:center"><button class="btn small danger" id="resetBtn">${esc(t('resetData'))}</button></div>
    `;
    $('#profileForm').addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const p = { name: (f.get('name')||'').trim(), city: f.get('city'), langs: f.getAll('langs'), firstTimer: !!f.get('firstTimer'), buddy: !!f.get('buddy') };
      if (!p.name) return;
      if (S.filter.city === 'Kaikki' && p.city) S.filter.city = p.city;
      if (API.enabled) {
        try { await API.saveProfile(p); S.profile = p; save(); toast(t('saved')); await refresh(); } catch (err) { toast(errMsg(err)); }
      } else { S.profile = p; save(); toast(t('saved')); renderAll(); }
    });
    $('#profileForm').addEventListener('change', e => { if (e.target.type === 'checkbox') e.target.closest('label').classList.toggle('on', e.target.checked); });
    $('#resetBtn').addEventListener('click', () => { if (confirm(t('confirmReset'))) { try { localStorage.removeItem('saunakaverit.token' + (API.deviceSuffix||'')); } catch(e){} S = defaults(); save(); toast(t('resetDone')); location.reload(); } });
  }

  /* ---------- session detail ---------- */
  function openSession(id){
    const s = findSession(id); if (!s) { closeSheet(); return; }
    sheetSession = id;
    const me = S.profile.name;
    const st = myStatus(s);
    const going = st === 'going', waiting = st === 'waitlist';
    const full = s.attendees.length >= s.cap;
    const past = new Date(s.start) < new Date();
    const stamped = S.stamps.some(x => x.saunaId === s.saunaId && new Date(x.date).toDateString() === new Date(s.start).toDateString());
    const mine = isMine(s);
    let action;
    if (going) action = `<button class="btn full danger" data-leave="${s.id}">${esc(t('leave'))}</button>`;
    else if (waiting) action = `<button class="btn full danger" data-leave="${s.id}">${esc(t('onWaitlist'))} · ${esc(t('leave'))}</button>`;
    else if (full) action = `<button class="btn full lake" data-join="${s.id}">${esc(t('waitlist'))}</button>`;
    else action = `<button class="btn full" data-join="${s.id}">${esc(t('join'))}</button>`;

    openSheet(`
      <div class="small muted">${esc(fmtDate(s.start))}</div>
      <h2>${D.THEMES[s.theme]?.ic || '🔥'} ${esc(L(D.THEMES[s.theme]) || s.theme)}</h2>
      <h3 class="muted" style="font-weight:500">${esc(s.sauna.name)} · ${esc(s.sauna.area)}, ${esc(s.sauna.city)}</h3>
      <div>${kindTag(s.kind)}${priceTag(s.price)}${s.after?`<span class="tag">☕ ${esc(t('after'))}</span>`:''}${(s.langs||[]).map(l => `<span class="tag">${esc(D.LANGS[l]||l)}</span>`).join('')}</div>
      <hr class="soft">
      <div class="kv">
        <span>${esc(t('host'))}</span><span>★ ${esc(s.host)}</span>
        <span>${esc(t('where'))}</span><span>${esc(s.sauna.address)} · <a href="${mapsUrl(s.sauna)}" target="_blank" rel="noopener">${esc(t('directions'))}</a></span>
        <span>${esc(t('kind'))}</span><span>${esc(L(D.KINDS[s.kind]))}</span>
      </div>
      ${s.note ? `<p style="margin-top:10px">${esc(L(s.note))}</p>` : ''}
      ${s.kind === 'erilliset' ? `<p class="small muted">${esc(t('meetPoint'))}</p>` : ''}
      ${s.theme === 'hiljainen' ? `<p class="small muted">${esc(t('quietNote'))}</p>` : ''}
      <p class="small muted">🧺 ${esc(t('bringTowel'))}</p>
      <hr class="soft">
      <div class="small muted">${esc(t('attendees'))} ${s.attendees.length}/${s.cap}${s.waitlist.length ? ` · ${esc(t('waiting'))} ${s.waitlist.length}` : ''}</div>
      <div class="attendees">${s.attendees.map(a => `<span class="att ${a===s.host?'host':''} ${a===me&&going?'me':''}">${esc(a)}</span>`).join('')}${s.waitlist.map(a => `<span class="att wait ${a===me&&waiting?'me':''}">${esc(a)}</span>`).join('')}</div>
      ${action}
      ${going ? `<button class="btn full lake" style="margin-top:8px" data-room="session:${esc(s.id)}" data-room-label="${esc(L(D.THEMES[s.theme]) || s.theme)} · ${esc(s.sauna.name)}">🧖 ${esc(t('sessionRoom'))}</button>` : ''}
      <div class="row" style="margin-top:8px">
        <button class="btn secondary small" data-share="${s.id}">📲 ${esc(t('share'))}</button>
        ${(going || past) ? `<button class="btn secondary small" data-stamp-session="${s.id}" ${stamped?'disabled':''}>🔥 ${esc(stamped?t('stamped'):t('stamp'))}</button>` : ''}
        ${mine && !s.recurring ? `<button class="btn danger small" data-remove="${s.id}" style="margin-left:auto">${esc(t('remove'))}</button>` : ''}
      </div>
    `);
  }

  function shareText(s){
    const fi = S.lang === 'fi';
    const lines = fi
      ? [`🔥 Tule saunaan! ${L(D.THEMES[s.theme])}`, `${s.sauna.name}, ${s.sauna.address}`, `${fmtDate(s.start)}`, `${L(D.KINDS[s.kind])} · ${s.price}`, s.after ? 'Jälkeen terassilla ☕' : '', `Isäntä: ${s.host}. Vapaita paikkoja: ${Math.max(0, s.cap - s.attendees.length)}`, 'Muista pyyhe ja pefletti. Hyvät löylyt!']
      : [`🔥 Come to the sauna! ${L(D.THEMES[s.theme])}`, `${s.sauna.name}, ${s.sauna.address}`, `${fmtDate(s.start)}`, `${L(D.KINDS[s.kind])} · ${s.price}`, s.after ? 'Terrace afterwards ☕' : '', `Host: ${s.host}. Free spots: ${Math.max(0, s.cap - s.attendees.length)}`, 'Bring a towel and a seat cover. Hyvät löylyt!'];
    return lines.filter(Boolean).join('\n');
  }

  /* ---------- host form ---------- */
  function openHost(){
    const p = S.profile;
    sheetSession = null;
    const now = new Date(); now.setDate(now.getDate()+1);
    const d = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
    const saunas = D.SAUNAS.slice().sort((a,b) => (a.city===p.city?0:1) - (b.city===p.city?0:1));
    openSheet(`
      <h2>${esc(t('hostTitle'))}</h2><p class="small muted">${esc(t('hostLead'))}</p>
      ${!p.name ? `<div class="card moss small">${esc(t('nameNeeded'))}</div>` : ''}
      <form class="form" id="hostForm">
        <label>${esc(t('hSauna'))}</label>
        <select name="saunaId" id="hSauna">${saunas.map(sa => `<option value="${sa.id}" data-price="${esc(sa.price)}" data-policy="${sa.policy}">${esc(sa.name)} · ${esc(sa.city)}</option>`).join('')}</select>
        <div class="grid2">
          <div><label>${esc(t('hDate'))}</label><input type="date" name="date" value="${d}" min="${d}" required></div>
          <div><label>${esc(t('hTime'))}</label><input type="time" name="time" value="18:00" required></div>
        </div>
        <label>${esc(t('hTheme'))}</label>
        <select name="theme">${Object.keys(D.THEMES).filter(k => k!=='sunnuntai').map(k => `<option value="${k}">${D.THEMES[k].ic} ${esc(L(D.THEMES[k]))}</option>`).join('')}</select>
        <label>${esc(t('hKind'))}</label>
        <select name="kind" id="hKind">${Object.keys(D.KINDS).map(k => `<option value="${k}">${esc(L(D.KINDS[k]))}</option>`).join('')}</select>
        <label>${esc(t('hCap'))} <span class="muted">· ${esc(t('capHint'))}</span></label>
        <div class="range"><input type="range" name="cap" min="4" max="8" value="6" oninput="this.nextElementSibling.value=this.value"><output>6</output></div>
        <label>${esc(t('hPrice'))}</label><input name="price" id="hPrice" maxlength="40" value="${esc(saunas[0].price)}">
        <label>${esc(t('hLangs'))}</label>
        <div class="checks">${Object.entries(D.LANGS).map(([k,v]) => `<label class="${p.langs.includes(k)?'on':''}"><input type="checkbox" name="langs" value="${k}" ${p.langs.includes(k)?'checked':''}>${v}</label>`).join('')}</div>
        <div class="checks" style="margin-top:12px"><label class="on"><input type="checkbox" name="after" checked>☕ ${esc(t('hAfter'))}</label></div>
        <label>${esc(t('hNote'))}</label><textarea name="note" maxlength="500" placeholder="${esc(t('hNotePh'))}"></textarea>
        <div class="row" style="margin-top:14px"><button class="btn secondary" type="button" id="hostCancel">${esc(t('cancel'))}</button><button class="btn" type="submit" id="hostSubmit" style="flex:1" ${!p.name?'disabled':''}>${esc(t('publish'))}</button></div>
      </form>
    `);
    const sel = $('#hSauna');
    sel.addEventListener('change', () => { const o = sel.selectedOptions[0]; $('#hPrice').value = o.dataset.price; $('#hKind').value = o.dataset.policy; });
    $('#hKind').value = sel.selectedOptions[0].dataset.policy;
    $('#hostForm').addEventListener('change', e => { if (e.target.type === 'checkbox') e.target.closest('label').classList.toggle('on', e.target.checked); });
    $('#hostCancel').addEventListener('click', closeSheet);
    $('#hostForm').addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const start = new Date(`${f.get('date')}T${f.get('time')}:00`);
      const obj = { saunaId: f.get('saunaId'), host: p.name, start: start.toISOString(), theme: f.get('theme'), kind: f.get('kind'), cap: +f.get('cap'),
        price: (f.get('price')||'').trim() || '–', after: !!f.get('after'), langs: f.getAll('langs'), note: (f.get('note')||'').trim(), attendees: [p.name], waitlist: [] };
      if (online) {
        const btn = $('#hostSubmit'); btn.disabled = true;
        try { const r = await API.createSession(obj); closeSheet(); toast(t('published')); await refresh(); showView('home'); openSession(r.id); }
        catch (err) { btn.disabled = false; toast(errMsg(err)); }
      } else {
        obj.id = 'u' + Date.now().toString(36); S.sessions.push(obj);
        save(); closeSheet(); toast(t('published')); renderAll(); showView('home'); openSession(obj.id);
      }
    });
  }

  /* ---------- actions ---------- */
  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-open],[data-join],[data-leave],[data-share],[data-stamp],[data-stamp-session],[data-remove],[data-go],[data-city],[data-theme],[data-room]');
    if (!el) return;
    const d = el.dataset;
    if (d.room) { currentRoom = { id: d.room, label: d.roomLabel || '' }; closeSheet(); return showView('room'); }
    if (d.open) return openSession(d.open);
    if (d.go) { if (d.go === 'host') return openHost(); return showView(d.go); }
    if (d.city) { S.filter.city = d.city; save(); renderHome(); renderSaunas(); return; }
    if (d.theme !== undefined) { S.filter.theme = d.theme; save(); renderHome(); return; }
    if (d.join) {
      if (!S.profile.name) { toast(t('nameNeeded')); closeSheet(); showView('profile'); return; }
      const s = findSession(d.join); if (!s) return;
      el.disabled = true;
      if (online) {
        try { const st = await API.join(d.join); toast(st === 'waitlist' ? t('youWait') : t('youJoined')); await refresh(); }
        catch (err) { toast(errMsg(err)); el.disabled = false; }
      } else {
        const full = s.attendees.length >= s.cap;
        S.joins[d.join] = true; save(); toast(full ? t('youWait') : t('youJoined')); renderAll(); openSession(d.join);
      }
      return;
    }
    if (d.leave) {
      el.disabled = true;
      if (online) { try { await API.leave(d.leave); toast(t('youLeft')); await refresh(); } catch (err) { toast(errMsg(err)); el.disabled = false; } }
      else { delete S.joins[d.leave]; const own = S.sessions.find(x => x.id === d.leave); if (own) own.attendees = own.attendees.filter(a => a !== S.profile.name); save(); toast(t('youLeft')); renderAll(); openSession(d.leave); }
      return;
    }
    if (d.share) {
      const s = findSession(d.share); if (!s) return; const text = shareText(s);
      if (navigator.share) { navigator.share({ title:'Saunakaverit', text }).catch(()=>{}); }
      else { navigator.clipboard?.writeText(text).then(() => toast(t('copied'))); window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener'); }
      return;
    }
    if (d.stamp) { await addStamp(d.stamp, new Date()); return; }
    if (d.stampSession) { const s = findSession(d.stampSession); if (!s) return; await addStamp(s.saunaId, new Date(s.start)); return; }
    if (d.remove) {
      if (online) { try { await API.removeSession(d.remove); closeSheet(); toast(t('removed')); await refresh(); } catch (err) { toast(errMsg(err)); } }
      else { S.sessions = S.sessions.filter(x => x.id !== d.remove); delete S.joins[d.remove]; save(); closeSheet(); toast(t('removed')); renderAll(); }
      return;
    }
  });
  async function addStamp(saunaId, date){
    const sameDay = S.stamps.some(st => st.saunaId === saunaId && new Date(st.date).toDateString() === date.toDateString());
    if (sameDay) { toast(t('stamped')); return; }
    if (online) {
      if (!S.profile.name) { toast(t('nameNeeded')); showView('profile'); return; }
      try { await API.stamp(saunaId, dateStr(date)); toast(t('stampDone')); await refresh(); } catch (err) { toast(errMsg(err)); }
    } else {
      S.stamps.push({ saunaId, date: date.toISOString() }); save(); toast(t('stampDone')); renderAll(); if (sheetSession) openSession(sheetSession);
    }
  }

  /* ---------- navigation, language, theme ---------- */
  function showView(name){
    if (name === 'host') return openHost();
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    $$('nav.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    window.scrollTo({ top: 0 });
    if (name === 'room') {
      ROOM.enter($('#view-room'), currentRoom.id, {
        client: API.enabled ? API.client : null, deviceSuffix: API.deviceSuffix || '', t, label: currentRoom.label,
        profile: () => S.profile, toast,
      });
    } else if (ROOM.isOpen()) { ROOM.leave(); $('#view-room').innerHTML = ''; }
  }
  $$('nav.tabs button').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
  $('#brandHome').addEventListener('click', e => { e.preventDefault(); showView('home'); });
  $('#langBtn').addEventListener('click', () => { S.lang = S.lang === 'fi' ? 'en' : 'fi'; save(); renderAll(); if (sheetSession) openSession(sheetSession); });
  $('#themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme;
    const dark = cur ? cur === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    S.theme = dark ? 'light' : 'dark'; save(); applyTheme();
  });
  function applyTheme(){ if (S.theme === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = S.theme; }

  function renderAll(){
    document.documentElement.lang = S.lang;
    $('#langBtn').textContent = S.lang === 'fi' ? 'EN' : 'FI';
    $$('[data-i18n]').forEach(el => el.textContent = t(el.dataset.i18n));
    renderHome(); renderSaunas(); renderPassport(); renderEtiquette(); renderProfile();
  }

  applyTheme(); renderAll();
  if (API.enabled) {
    refresh();
    API.subscribe(refreshSoon);
    const onCount = (n) => { roomCount = n; const el = $('#roomCount'); if (el) el.textContent = n; };
    onCount.deviceSuffix = API.deviceSuffix || '';
    ROOM.watch(API.client, 'yhteinen', onCount);
    setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  }
})();
