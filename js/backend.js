/* Saunakaverit backend client (Supabase). Each device holds a secret token; the server hashes it
   and maps it to a profile. No email, no password: the token is the identity of this phone.
   Add ?device=2 to the URL to act as a second phone on the same browser (for testing). */
window.SK_API = (function () {
  const cfg = window.SK_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const dev = (params.get('device') || '').replace(/[^a-z0-9]/gi, '');
  const deviceSuffix = dev ? '.' + dev : '';
  const enabled = !!(cfg.url && cfg.key && window.supabase && window.supabase.createClient);
  let client = null, token = null, channel = null;

  function getToken() {
    const k = 'saunakaverit.token' + deviceSuffix;
    let t = null;
    try { t = localStorage.getItem(k); } catch (e) {}
    if (!t) {
      const rnd = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
      t = rnd + '-' + Date.now().toString(36);
      try { localStorage.setItem(k, t); } catch (e) {}
    }
    return t;
  }

  if (enabled) {
    client = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    token = getToken();
  }

  async function rpc(fn, args) {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw error;
    return data;
  }

  async function load() {
    try { await rpc('sk_ensure_sunday', {}); } catch (e) { /* not fatal */ }
    const [s, a, me] = await Promise.all([
      client.from('sessions_public').select('*').order('start_at'),
      client.from('attendees_public').select('*').order('created_at'),
      rpc('sk_me', { p_token: token }),
    ]);
    if (s.error) throw s.error;
    if (a.error) throw a.error;
    const by = {};
    for (const row of a.data) {
      const b = by[row.session_id] || (by[row.session_id] = { going: [], waitlist: [] });
      (row.status === 'going' ? b.going : b.waitlist).push(row.name);
    }
    const sessions = s.data.map(r => ({
      id: r.id, saunaId: r.sauna_id, host: r.host, start: r.start_at, theme: r.theme, kind: r.kind, cap: r.cap,
      price: r.price, after: r.after_terrace, langs: r.langs || [], note: r.note || '', recurring: r.recurring,
      attendees: (by[r.id] || {}).going || [], waitlist: (by[r.id] || {}).waitlist || [],
    }));
    return { sessions, me };
  }

  function saveProfile(p) {
    return rpc('sk_upsert_profile', { p_token: token, p_name: p.name, p_city: p.city, p_langs: p.langs, p_first_timer: !!p.firstTimer, p_buddy: !!p.buddy });
  }
  function createSession(s) {
    return rpc('sk_create_session', { p_token: token, p_sauna_id: s.saunaId, p_start: s.start, p_theme: s.theme, p_kind: s.kind, p_cap: s.cap, p_price: s.price, p_after: !!s.after, p_langs: s.langs, p_note: s.note || '' });
  }
  const removeSession = (id) => rpc('sk_remove_session', { p_token: token, p_session_id: id });
  const join = (id) => rpc('sk_join', { p_token: token, p_session_id: id });
  const leave = (id) => rpc('sk_leave', { p_token: token, p_session_id: id });
  const stamp = (saunaId, dateStr) => rpc('sk_stamp', { p_token: token, p_sauna_id: saunaId, p_date: dateStr });
  const addPoints = (kind, n) => rpc('sk_add_points', { p_token: token, p_kind: kind, p_amount: n || 1 });
  async function leaderboard() { const { data, error } = await client.from('leaderboard').select('name, points, week, totals').order('week', { ascending: false }).limit(50); if (error) throw error; return data; }

  function subscribe(cb) {
    if (!enabled || channel) return;
    channel = client.channel('saunakaverit')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendees' }, cb)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, cb)
      .subscribe();
  }

  return { enabled, deviceSuffix, load, saveProfile, createSession, removeSession, join, leave, stamp, addPoints, leaderboard, subscribe, get client(){ return client; } };
})();
