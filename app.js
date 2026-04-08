// ═══════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════
const SB_URL = 'https://vepqjryrhvuehwemabqu.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlcHFqcnlyaHZ1ZWh3ZW1hYnF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NjA2MjYsImV4cCI6MjA5MDQzNjYyNn0.8ZWqTUwEQX1zFwTCLx7eqwfocDmw5DId2rrxoxDjrPk';

// ═══════════════════════════════════════════════════════════
//  TAB CONFIG  （由 card_type + domains 推导，不存 tab 字段）
// ═══════════════════════════════════════════════════════════
const TABS = [
  { id:'legends',     label:'传奇',  color:'#c9a84c', domain: null },
  { id:'red',         label:'炽烈',  color:'#e05252', domain:'炽烈' },
  { id:'green',       label:'翠意',  color:'#52b96e', domain:'翠意' },
  { id:'blue',        label:'灵光',  color:'#5b9fe0', domain:'灵光' },
  { id:'orange',      label:'摧破',  color:'#e07d30', domain:'摧破' },
  { id:'purple',      label:'混沌',  color:'#9b6de0', domain:'混沌' },
  { id:'yellow',      label:'序理',  color:'#d4b935', domain:'序理' },
  { id:'battlefield', label:'战场',  color:'#7a8599', domain: null },
];

// Tab 过滤：legend 强制归「传奇」，battlefield 归「战场」，其余按 domains
function getCardsForTab(tabId, cards) {
  const tab = TABS.find(t => t.id === tabId);
  if (!tab) return [];
  if (tabId === 'legends')     return cards.filter(c => c.card_type === 'legend');
  if (tabId === 'battlefield') return cards.filter(c => c.card_type === 'battlefield');
  return cards.filter(c =>
    c.card_type !== 'legend' &&
    c.card_type !== 'battlefield' &&
    Array.isArray(c.domains) && c.domains.includes(tab.domain)
  );
}

// ── 评级档位 ─────────────────────────────────────────────────
const G  = ['S','A','B','C','D'];
const GC = { S:'#c0392b', A:'#d4820a', B:'#1e8449', C:'#1a6fa8', D:'#3d4455' };
const GF = { S:'#fff',    A:'#fff',    B:'#fff',    C:'#fff',    D:'#9aa' };
const GRADE_VALUE = { S:5, A:4, B:3, C:2, D:1 };

// 评级说明：构筑 / 限制 各一套（标题 + 描述分开存，方便侧边栏渲染）
const GL = {
  constructed: {
    S:{ title:'版本定义级', desc:'强度足以主导版本环境，是套牌的绝对核心。会围绕此卡构建策略，大概率受到对手的特殊针对。具备禁限候选潜力。' },
    A:{ title:'主流必备级', desc:'牌效出众，广泛出现于该色组的主流套牌中。使用场景宽泛，几乎没有理由不带。' },
    B:{ title:'功能性用牌', desc:'在特定构筑中担当重要功能角色，包括主流套牌携带的针对性组件，或冷门套路的核心支柱。' },
    C:{ title:'有条件可用', desc:'在极少数情况下有一席之地，但很容易找到更优替代。需要压缩卡位时，优先从此档位裁减。' },
    D:{ title:'不进构筑',   desc:'实战强度不足以支撑任何主流或冷门构筑，理论探索除外。' },
  },
  limited: {
    S:{ title:'选色锚点',   desc:'强度足以主导选色方向，值得为此牌专门囤积对应色组。轮抽中的首抓级别。' },
    A:{ title:'高优先抓取', desc:'优质单卡，色组条件允许时几乎必然选入。同等情况下优先抓取，对套牌强度贡献稳定且直接。' },
    B:{ title:'条件性选入', desc:'在特定套牌结构下价值凸显：能与现有联动体系产生协同，或填补套牌在功能、费用曲线上的空缺。离开对应条件则价值下滑明显。' },
    C:{ title:'填充备选',   desc:'无更优选择时用于补足卡组数量。单卡独立价值有限，优先级靠后。' },
    D:{ title:'不予考虑',   desc:'即便作为填充，也几乎不具备打出价值。' },
  },
};

// 特性 → 颜色映射（用于 ci-tag）
const DOMAIN_COLOR = {
  '炽烈':'#e05252','翠意':'#52b96e','灵光':'#5b9fe0',
  '摧破':'#e07d30','混沌':'#9b6de0','序理':'#d4b935',
};

// ═══════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════
// allCards = [{ id, name, img, pos, set_code, card_number, card_type, domains }]
let allCards  = [];
// sets = { 'UNL': '破限', ... }
let sets      = {};
// grades[card_id][user_id][format] = { grade, comment }
let grades    = {};
// notes[card_id][user_id] = { note }
let notes     = {};
// allUsers = [{ id, display_name }]（从评级数据中收集）
let allUsers  = [];

let activeTab    = 'legends';
let activeFormat = 'constructed';   // 'constructed' | 'limited'
let activeFilter = 'ALL';
let searchQuery  = '';
let commentTimer = null;
let noteTimer    = null;
let realtimeChannel = null;
let isLoading    = true;
let focusedCardId = null;

// ── Auth state ───────────────────────────────────────────────
// currentUser = { id, email, display_name, access_token, refresh_token, expires_at }
let currentUser = null;

// ═══════════════════════════════════════════════════════════
//  SUPABASE HELPERS
// ═══════════════════════════════════════════════════════════
// 登录后用 access_token，否则 fallback 到 anon key
const SB_HDR = () => ({
  'apikey':        SB_KEY,
  'Authorization': 'Bearer ' + (currentUser?.access_token ?? SB_KEY),
  'Content-Type':  'application/json',
  'Prefer':        'return=minimal',
});

async function sbFetch(path, method = 'GET', body = null) {
  const opts = { method, headers: SB_HDR() };
  if (body !== null) opts.body = JSON.stringify(body);
  const r = await fetch(SB_URL + '/rest/v1/' + path, opts);
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  if (r.status === 204 || method === 'DELETE') return null;
  return r.json();
}

// Upsert（通用）：传入表名和行数据（单行或数组）
async function sbUpsert(table, rows) {
  const hdrs = { ...SB_HDR(), 'Prefer': 'resolution=merge-duplicates,return=minimal' };
  const r = await fetch(SB_URL + '/rest/v1/' + table, {
    method: 'POST', headers: hdrs,
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
  });
  if (!r.ok) throw new Error(`upsert(${table}) ${r.status}: ${await r.text()}`);
}


// ═══════════════════════════════════════════════════════════
//  MINIMAL SUPABASE REALTIME CLIENT
//  Speaks the Phoenix/Supabase WebSocket protocol
//  No external dependencies needed
// ═══════════════════════════════════════════════════════════
function createRealtimeClient(supabaseUrl, apiKey) {
  const wsUrl = supabaseUrl.replace(/^https/, 'wss').replace(/^http/, 'ws')
    + '/realtime/v1/websocket?apikey=' + apiKey + '&vsn=1.0.0';

  let ws = null;
  let channels = [];
  let heartbeatTimer = null;
  let ref = 0;
  const nextRef = () => String(++ref);

  function connect() {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ topic:'phoenix', event:'heartbeat', payload:{}, ref: nextRef() }));
        }
      }, 25000);
      channels.forEach(ch => ch._join());
    };

    ws.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      channels.forEach(ch => ch._receive(msg));
    };

    ws.onclose = () => {
      clearInterval(heartbeatTimer);
      channels.forEach(ch => { if (ch._statusCallback) ch._statusCallback('CLOSED'); });
    };

    ws.onerror = () => {
      channels.forEach(ch => { if (ch._statusCallback) ch._statusCallback('CHANNEL_ERROR'); });
    };
  }

  function channel(topic) {
    const fullTopic = 'realtime:' + topic;
    const bindings  = [];
    let   statusCb  = null;

    const ch = {
      _statusCallback: null,

      on(event, filter, callback) {
        bindings.push({ event, filter, callback });
        return ch;
      },

      subscribe(callback) {
        statusCb = callback;
        ch._statusCallback = callback;
        channels.push(ch);
        if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
          connect();
        } else if (ws.readyState === WebSocket.OPEN) {
          ch._join();
        }
        return ch;
      },

      unsubscribe() {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ topic: fullTopic, event: 'phx_leave', payload: {}, ref: nextRef() }));
        }
        channels = channels.filter(c => c !== ch);
      },

      _join() {
        const pgBindings = bindings
          .filter(b => b.event === 'postgres_changes')
          .map(b => ({
            event:  b.filter.event  || '*',
            schema: b.filter.schema || 'public',
            table:  b.filter.table,
            filter: b.filter.filter,
          }));
        ws.send(JSON.stringify({
          topic: fullTopic, event: 'phx_join',
          payload: { config: {
            broadcast: { self: false }, presence: { key: '' },
            postgres_changes: pgBindings,
          }},
          ref: nextRef(),
        }));
      },

      _receive(msg) {
        if (msg.topic !== fullTopic) return;
        if (msg.event === 'phx_reply') {
          const status = msg.payload?.status;
          if (status === 'ok'    && statusCb) statusCb('SUBSCRIBED');
          if (status === 'error' && statusCb) statusCb('CHANNEL_ERROR');
          return;
        }
        if (msg.event === 'postgres_changes') {
          const data = msg.payload?.data || msg.payload;
          bindings.filter(b => b.event === 'postgres_changes').forEach(b => {
            const evType = data.type || data.eventType;
            if (b.filter.event === '*' || b.filter.event === evType) {
              b.callback({
                eventType: evType,
                new: data.record     || data.new || {},
                old: data.old_record || data.old || {},
                table: data.table, schema: data.schema,
              });
            }
          });
          return;
        }
        if (msg.event === 'system' && msg.payload?.message?.includes('subscribed')) {
          if (statusCb) statusCb('SUBSCRIBED');
        }
      },
    };
    return ch;
  }

  return { channel };
}

// ═══════════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════════
const SESSION_KEY = 'rb_session';

function showAuthScreen() {
  document.getElementById('authScreen').style.display = '';
  document.getElementById('mainScreen').style.display = 'none';
}

function showMainScreen() {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('mainScreen').style.display = '';
  const name = currentUser?.display_name || currentUser?.email || '—';
  document.getElementById('userPillName').textContent = name;
}

async function doLogin() {
  const email    = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const errEl    = document.getElementById('authErr');
  const btn      = document.getElementById('authBtn');
  errEl.textContent = '';
  if (!email || !password) { errEl.textContent = '请填写邮箱和密码'; return; }
  btn.classList.add('loading'); btn.textContent = '登录中…';
  try {
    const r = await fetch(SB_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { 'apikey': SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error_description || data.msg || '登录失败');
    applySession(data);
    saveSession(data);
    showMainScreen();
    setSyncState('syncing', '连接中…');
    showSkeleton();
    // 确保自己的 profile 行存在（新用户首次登录时创建）
    sbUpsert('profiles', { id: currentUser.id, display_name: currentUser.display_name }).catch(() => {});
    await loadAll();
    subscribeRealtime();
  } catch(e) {
    errEl.textContent = e.message;
  }
  btn.classList.remove('loading'); btn.textContent = '登录';
}

// script 在 </body> 前加载，DOM 已就绪，无需 DOMContentLoaded 包装
['authEmail','authPassword'].forEach(id => {
  document.getElementById(id)?.addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
});

async function doLogout() {
  try {
    await fetch(SB_URL + '/auth/v1/logout', {
      method: 'POST',
      headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + currentUser.access_token },
    });
  } catch {}
  clearSession();
  realtimeChannel?.unsubscribe();
  realtimeChannel = null;
  currentUser = null;
  allCards = []; grades = {}; notes = {}; allUsers = [];
  isLoading = true;
  showAuthScreen();
  document.getElementById('authPassword').value = '';
  document.getElementById('authErr').textContent = '';
}

// ── 修改昵称（点击右上角用户名触发）────────────────────────────
async function editDisplayName() {
  const current = currentUser.display_name;
  const next = prompt('修改昵称：', current);
  if (!next || next.trim() === current) return;
  const name = next.trim();
  try {
    await sbUpsert('profiles', { id: currentUser.id, display_name: name });
    currentUser.display_name = name;
    document.getElementById('userPillName').textContent = name;
    const self = allUsers.find(u => u.id === currentUser.id);
    if (self) self.display_name = name;
    // 同步更新 localStorage
    try {
      const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}');
      if (saved.user) {
        saved.user.user_metadata = { ...saved.user.user_metadata, display_name: name };
        localStorage.setItem(SESSION_KEY, JSON.stringify(saved));
      }
    } catch {}
    toast('昵称已更新：' + name);
  } catch(e) {
    toast('修改失败：' + e.message);
  }
}

function applySession(data) {
  currentUser = {
    id:            data.user.id,
    email:         data.user.email,
    display_name:  data.user.user_metadata?.display_name || data.user.email.split('@')[0],
    access_token:  data.access_token,
    refresh_token: data.refresh_token,
    expires_at:    Date.now() + (data.expires_in ?? 3600) * 1000,
  };
}

function saveSession(data) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_in:    data.expires_in,
      expires_at:    Date.now() + (data.expires_in ?? 3600) * 1000,  // 存绝对时间戳，确保刷新页面后能正确判断是否过期
      user:          data.user,
    }));
  } catch {}
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

async function restoreSession() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch {}
  if (!saved?.access_token) return false;

  // expires_at 不存在说明是旧格式 session（部署前存的，不含时间戳）
  // 不能用 fallback 猜测，必须强制 refresh，否则过期 token 会被误判为有效
  if (!saved.expires_at) return await refreshSession(saved.refresh_token);

  if (Date.now() < saved.expires_at - 60_000) {
    applySession({ ...saved, expires_in: Math.floor((saved.expires_at - Date.now()) / 1000) });
    return true;
  }
  return await refreshSession(saved.refresh_token);
}

async function refreshSession(refreshToken) {
  if (!refreshToken) return false;
  try {
    const r = await fetch(SB_URL + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { 'apikey': SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!r.ok) { clearSession(); return false; }
    const data = await r.json();

    // applySession 从 JWT user_metadata 读 display_name，管理员建的账号该字段为空，
    // 会被回退成邮箱前缀。先记住已知的正确昵称，续期后补回去。
    const knownName = currentUser?.display_name || null;
    applySession(data);
    if (knownName && !data.user?.user_metadata?.display_name) {
      currentUser.display_name = knownName;
      // 同步写入 localStorage，下次刷新页面也能读到正确昵称
      data.user.user_metadata = { ...data.user.user_metadata, display_name: knownName };
    }
    saveSession(data);

    const delay = ((data.expires_in ?? 3600) - 120) * 1000;
    if (delay > 0) setTimeout(() => refreshSession(currentUser?.refresh_token), delay);
    return true;
  } catch {
    clearSession();
    return false;
  }
}

// ═══════════════════════════════════════════════════════════
//  BOOT & SYNC
// ═══════════════════════════════════════════════════════════
async function boot() {
  const restored = await restoreSession();
  if (!restored) { showAuthScreen(); return; }
  showMainScreen();
  setSyncState('syncing', '连接中…');
  showSkeleton();
  try {
    await loadAll();
    subscribeRealtime();
  } catch(e) {
    console.error('boot error', e);
    setSyncState('err', '连接失败');
    isLoading = false;
    renderAll();
  }
}

// ── 加载全部数据（三张表并发）────────────────────────────────
async function loadAll() {
  setSyncState('syncing', '加载中…');
  try {
    const [cardRows, gradeRows, noteRows, setRows, profileRows] = await Promise.all([
      sbFetch('cards?select=*&order=pos'),
      sbFetch('card_grades?select=*'),
      sbFetch('card_notes?select=*'),
      sbFetch('sets?select=*'),
      sbFetch('profiles?select=*'),
    ]);
    applyCards(cardRows     || []);
    applySets(setRows       || []);
    applyGrades(gradeRows   || []);
    applyNotes(noteRows     || []);
    collectUsers(gradeRows || [], noteRows || [], profileRows || []);
    setSyncState('live', '已同步');
  } catch(e) {
    console.error('load error', e);
    setSyncState('err', '加载失败');
  }
  isLoading = false;
  renderAll();
}

function applyCards(rows) {
  allCards = rows.map(r => ({
    id:          r.id,
    name:        r.name,
    img:         r.img || '',
    pos:         r.pos || 0,
    set_code:    r.set_code    || '',
    card_number: r.card_number ?? null,
    card_type:   r.card_type   || '',
    domains:     Array.isArray(r.domains) ? r.domains : [],
  }));
}

function applySets(rows) {
  sets = {};
  for (const r of rows) sets[r.code] = r.name;
}

function applyGrades(rows) {
  grades = {};
  for (const r of rows) {
    if (!grades[r.card_id]) grades[r.card_id] = {};
    if (!grades[r.card_id][r.user_id]) grades[r.card_id][r.user_id] = {};
    grades[r.card_id][r.user_id][r.format] = {
      grade:   r.grade   || null,
      comment: r.comment || '',
    };
  }
}

function applyNotes(rows) {
  notes = {};
  for (const r of rows) {
    if (!notes[r.card_id]) notes[r.card_id] = {};
    notes[r.card_id][r.user_id] = { note: r.note || '' };
  }
}

// 从 profiles 表和评级/备注数据中建立用户列表
function collectUsers(gradeRows, noteRows, profileRows) {
  // 先建 profiles 查找表 { user_id: display_name }
  const profileMap = {};
  for (const p of profileRows) profileMap[p.id] = p.display_name;

  // 收集所有出现过的 user_id
  const seen = new Set();
  for (const r of [...gradeRows, ...noteRows]) seen.add(r.user_id);
  // 自己也要在列表里
  seen.add(currentUser.id);

  allUsers = [...seen].map(id => ({
    id,
    display_name: profileMap[id] || (id === currentUser.id ? currentUser.display_name : id.slice(0, 6)),
  }));

  // 用 profiles 里的名字更新 currentUser.display_name（以数据库为准）
  if (profileMap[currentUser.id]) {
    currentUser.display_name = profileMap[currentUser.id];
    document.getElementById('userPillName').textContent = currentUser.display_name;
    // 同步回 localStorage，避免下次刷新时 applySession 从 JWT user_metadata 读到旧的邮箱前缀
    try {
      const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}');
      if (saved.user) {
        saved.user.user_metadata = { ...saved.user.user_metadata, display_name: profileMap[currentUser.id] };
        localStorage.setItem(SESSION_KEY, JSON.stringify(saved));
      }
    } catch {}
  }
}

// ── 快捷访问器 ────────────────────────────────────────────────
function myGrade(cardId, format)   { return grades[cardId]?.[currentUser.id]?.[format ?? activeFormat]?.grade   || null; }
function myComment(cardId, format) { return grades[cardId]?.[currentUser.id]?.[format ?? activeFormat]?.comment || ''; }
function myNote(cardId)            { return notes[cardId]?.[currentUser.id]?.note || ''; }

// ═══════════════════════════════════════════════════════════
//  SUPABASE REALTIME  （订阅三张表）
// ═══════════════════════════════════════════════════════════
function subscribeRealtime() {
  const client = createRealtimeClient(SB_URL, SB_KEY);
  const ch = client.channel('riftbound_changes');

  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'cards' },
    p => handleCardsEvent(p));
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'card_grades' },
    p => handleGradesEvent(p));
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'card_notes' },
    p => handleNotesEvent(p));

  ch.subscribe(status => {
    if (status === 'SUBSCRIBED') {
      setSyncState('live', '实时同步');
      realtimeChannel = ch;
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      setSyncState('err', '连接断开');
      setTimeout(() => {
        setSyncState('syncing', '重连中…');
        ch.unsubscribe();
        subscribeRealtime();
      }, 5000);
    } else if (status === 'CLOSED') {
      setSyncState('err', '已断开');
    }
  });
}

function handleCardsEvent({ eventType, new: n, old: o }) {
  if (eventType === 'INSERT') {
    if (allCards.find(c => c.id === n.id)) return;
    allCards.push({
      id: n.id, name: n.name, img: n.img || '', pos: n.pos || 0,
      set_code: n.set_code || '', card_number: n.card_number ?? null,
      card_type: n.card_type || '', domains: Array.isArray(n.domains) ? n.domains : [],
    });
    allCards.sort((a, b) => a.pos - b.pos);
    renderAll();
  } else if (eventType === 'UPDATE') {
    const card = allCards.find(c => c.id === n.id);
    if (!card) return;
    Object.assign(card, {
      name: n.name, img: n.img || '', pos: n.pos || 0,
      set_code: n.set_code || '', card_number: n.card_number ?? null,
      card_type: n.card_type || '', domains: Array.isArray(n.domains) ? n.domains : [],
    });
    patchCardDom(); renderTabs();
  } else if (eventType === 'DELETE') {
    allCards = allCards.filter(c => c.id !== o.id);
    renderAll();
  }
  setSyncState('live', '实时同步');
}

function handleGradesEvent({ eventType, new: n, old: o }) {
  if (eventType === 'DELETE') {
    if (grades[o.card_id]?.[o.user_id]) delete grades[o.card_id][o.user_id][o.format];
  } else {
    if (!grades[n.card_id]) grades[n.card_id] = {};
    if (!grades[n.card_id][n.user_id]) grades[n.card_id][n.user_id] = {};
    grades[n.card_id][n.user_id][n.format] = { grade: n.grade || null, comment: n.comment || '' };
    if (!allUsers.find(u => u.id === n.user_id)) {
      allUsers.push({ id: n.user_id, display_name: n.user_id.slice(0, 6) });
    }
  }
  patchCardDom(); renderTabs(); renderStats(); renderProgress();
  setSyncState('live', '实时同步');
}

function handleNotesEvent({ eventType, new: n, old: o }) {
  if (eventType === 'DELETE') {
    if (notes[o.card_id]?.[o.user_id]) delete notes[o.card_id][o.user_id];
  } else {
    if (!notes[n.card_id]) notes[n.card_id] = {};
    notes[n.card_id][n.user_id] = { note: n.note || '' };
  }
  patchCardDom();
  setSyncState('live', '实时同步');
}

// Smart DOM patch — 更新卡片状态，不销毁正在输入的 textarea
function patchCardDom() {
  const focusedEl = document.activeElement;
  const isFocused = focusedEl?.tagName === 'TEXTAREA';
  const cards     = filteredCards();
  const cardEls   = document.querySelectorAll('#cardGrid .ci');

  cards.forEach((c, idx) => {
    const el = cardEls[idx];
    if (!el) return;
    if (isFocused && el.contains(focusedEl)) return;

    const grade = myGrade(c.id);
    const gc    = grade ? GC[grade] : null;
    const gf    = grade ? GF[grade] : null;

    // Border
    if (gc) { el.dataset.g = grade; el.style.setProperty('--gc', gc); }
    else    { delete el.dataset.g; el.style.removeProperty('--gc'); }

    // Grade ribbon
    const thumb = el.querySelector('.ci-thumb');
    let ribbon = thumb.querySelector('.ci-ribbon');
    if (grade) {
      if (!ribbon) { ribbon = document.createElement('div'); ribbon.className = 'ci-ribbon'; thumb.appendChild(ribbon); }
      ribbon.style.background = gc; ribbon.style.color = gf; ribbon.textContent = grade;
    } else ribbon?.remove();

    // Peer badges
    const peersEl = thumb.querySelector('.ci-peers');
    const newBadges = buildPeerBadges(c.id);
    if (peersEl) peersEl.outerHTML = newBadges;
    else if (newBadges) thumb.insertAdjacentHTML('beforeend', newBadges);

    // Grade buttons
    el.querySelectorAll('.gb').forEach((btn, i) => btn.classList.toggle('sel', G[i] === grade));

    // Textareas（不覆盖当前焦点）
    const commentEl = el.querySelector('.comment-box');
    if (commentEl && commentEl !== focusedEl) commentEl.value = myComment(c.id);
    const noteEl = el.querySelector('.note-box');
    if (noteEl && noteEl !== focusedEl) noteEl.value = myNote(c.id);
  });
}

// ═══════════════════════════════════════════════════════════
//  CARD OPS
// ═══════════════════════════════════════════════════════════
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

async function addCard() {
  const name      = document.getElementById('inName').value.trim();
  const img       = document.getElementById('inImg').value.trim();
  const card_type = document.getElementById('inCardType').value;  // 'legend'|'battlefield'|'spell'
  // domains：从多选 checkbox 收集（只在 card_type 为普通牌时有效）
  const domains   = card_type === 'legend' || card_type === 'battlefield'
    ? []
    : Array.from(document.querySelectorAll('#inDomains input:checked')).map(el => el.value);

  if (!name) { toast('请填入卡牌名称'); return; }
  if (card_type !== 'legend' && card_type !== 'battlefield' && domains.length === 0) {
    toast('请至少选择一个特性，或选择传奇 / 战场类型'); return;
  }
  if (allCards.find(c => c.name === name)) { toast('该卡牌已存在'); return; }

  const card = {
    id: uid(), name, img, pos: allCards.length,
    set_code: '', card_number: null, card_type, domains,
  };
  allCards.push(card);
  document.getElementById('inName').value = '';
  document.getElementById('inImg').value  = '';
  // 重置分类选择
  document.getElementById('inCardType').value = '';
  document.querySelectorAll('#inDomains input').forEach(el => el.checked = false);
  onCardTypeChange();
  renderAll();
  setSyncState('syncing', '同步中…');
  try {
    await sbUpsert('cards', {
      id: card.id, name: card.name, img: card.img || null,
      pos: card.pos, set_code: null, card_number: null,
      card_type: card.card_type || null,
      domains: card.domains.length ? card.domains : null,
    });
    setSyncState('live', '已同步');
    toast('已添加：' + name);
  } catch(e) {
    console.error('addCard error', e); setSyncState('err', '同步失败');
  }
}

// 卡牌类型切换时显示/隐藏特性选择
function onCardTypeChange() {
  const t = document.getElementById('inCardType').value;
  const domainRow = document.getElementById('inDomainsRow');
  if (domainRow) domainRow.style.display =
    (t === 'legend' || t === 'battlefield') ? 'none' : '';
}

async function delCard(id) {
  if (!confirm('确定删除此卡牌？此操作会从 Supabase 永久移除（含所有评级和备注）。')) return;
  allCards = allCards.filter(c => c.id !== id);
  delete grades[id]; delete notes[id];
  renderAll();
  setSyncState('syncing', '同步中…');
  try {
    // card_grades / card_notes 由外键 CASCADE DELETE 自动清除
    await sbFetch(`cards?id=eq.${encodeURIComponent(id)}`, 'DELETE');
    setSyncState('live', '已同步');
  } catch(e) {
    console.error('delCard error', e); setSyncState('err', '删除失败');
  }
}

async function setGrade(id, grade) {
  const current = myGrade(id);
  const next    = current === grade ? null : grade;
  if (!grades[id]) grades[id] = {};
  if (!grades[id][currentUser.id]) grades[id][currentUser.id] = {};
  grades[id][currentUser.id][activeFormat] = {
    grade:   next,
    comment: grades[id][currentUser.id][activeFormat]?.comment || '',
  };
  renderAll();
  await saveGrade(id);
}

function updateComment(id, val) {
  if (!grades[id]) grades[id] = {};
  if (!grades[id][currentUser.id]) grades[id][currentUser.id] = {};
  if (!grades[id][currentUser.id][activeFormat]) grades[id][currentUser.id][activeFormat] = {};
  grades[id][currentUser.id][activeFormat].comment = val;
  clearTimeout(commentTimer);
  commentTimer = setTimeout(() => saveGrade(id), 1500);
}

function updateNote(id, val) {
  if (!notes[id]) notes[id] = {};
  notes[id][currentUser.id] = { note: val };
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => saveNote(id), 1500);
}

async function saveGrade(cardId) {
  const entry = grades[cardId]?.[currentUser.id]?.[activeFormat];
  setSyncState('syncing', '同步中…');
  try {
    if (!entry || (!entry.grade && !entry.comment)) {
      await sbFetch(
        `card_grades?card_id=eq.${encodeURIComponent(cardId)}&user_id=eq.${encodeURIComponent(currentUser.id)}&format=eq.${activeFormat}`,
        'DELETE'
      );
    } else {
      await sbUpsert('card_grades', {
        card_id: cardId, user_id: currentUser.id, format: activeFormat,
        grade: entry.grade || null, comment: entry.comment || '',
      });
    }
    setSyncState('live', '已同步');
  } catch(e) {
    console.error('saveGrade error', e); setSyncState('err', '同步失败');
  }
}

async function saveNote(cardId) {
  const entry = notes[cardId]?.[currentUser.id];
  setSyncState('syncing', '同步中…');
  try {
    if (!entry?.note) {
      await sbFetch(
        `card_notes?card_id=eq.${encodeURIComponent(cardId)}&user_id=eq.${encodeURIComponent(currentUser.id)}`,
        'DELETE'
      );
    } else {
      await sbUpsert('card_notes', { card_id: cardId, user_id: currentUser.id, note: entry.note });
    }
    setSyncState('live', '已同步');
  } catch(e) {
    console.error('saveNote error', e); setSyncState('err', '同步失败');
  }
}

async function saveCardMeta(card) {
  setSyncState('syncing', '同步中…');
  try {
    await sbUpsert('cards', {
      id: card.id, name: card.name, img: card.img || null, pos: card.pos,
      set_code: card.set_code || null, card_number: card.card_number ?? null,
      card_type: card.card_type || null,
      domains: card.domains?.length ? card.domains : null,
    });
    setSyncState('live', '已同步');
  } catch(e) {
    console.error('saveCardMeta error', e); setSyncState('err', '同步失败');
  }
}

async function editImg(id) {
  const c = allCards.find(c => c.id === id);
  if (!c) return;
  const url = prompt(`为「${c.name}」设置图片 URL（留空清除）：`, c.img || '');
  if (url === null) return;
  c.img = url.trim(); renderCards(); await saveCardMeta(c);
}

async function editName(id, el) {
  const c = allCards.find(c => c.id === id);
  if (!c) return;
  const inp = document.createElement('input');
  inp.value = c.name;
  inp.style.cssText = 'width:100%;background:var(--bg-input);border:1px solid var(--gold-dark);border-radius:3px;color:var(--text);font-size:11px;padding:2px 5px;font-family:inherit;outline:none;user-select:text;';
  el.replaceWith(inp); inp.focus(); inp.select();
  const commit = async () => {
    const v = inp.value.trim();
    if (v && v !== c.name) { c.name = v; await saveCardMeta(c); }
    renderAll();
  };
  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') renderAll();
  });
}

async function clearTab() {
  const tab = TABS.find(t => t.id === activeTab);
  if (!confirm(`确定清空「${tab.label}」页的所有卡牌？\n此操作将永久删除所有该页卡牌（含评级和备注）。`)) return;
  const tabCards = getCardsForTab(activeTab, allCards);
  const ids = tabCards.map(c => c.id);
  if (!ids.length) return;
  allCards = allCards.filter(c => !ids.includes(c.id));
  ids.forEach(id => { delete grades[id]; delete notes[id]; });
  renderAll();
  setSyncState('syncing', '同步中…');
  try {
    await sbFetch(`cards?id=in.(${ids.map(i => encodeURIComponent(i)).join(',')})`, 'DELETE');
    setSyncState('live', '已同步');
    toast(`已清空 ${ids.length} 张卡牌`);
  } catch(e) {
    console.error('clearTab error', e); setSyncState('err', '清空失败');
  }
}

function findCard(id) { return allCards.find(c => c.id === id); }

// ═══════════════════════════════════════════════════════════
//  FORMAT SWITCH
// ═══════════════════════════════════════════════════════════
function switchFormat(fmt) {
  activeFormat = fmt;
  document.getElementById('fBtnC').classList.toggle('active', fmt === 'constructed');
  document.getElementById('fBtnL').classList.toggle('active', fmt === 'limited');
  activeFilter = 'ALL';
  renderAll();
}

// ═══════════════════════════════════════════════════════════
//  IMPORT
// ═══════════════════════════════════════════════════════════
let importMode = 'json';

function openImport()  { document.getElementById('importOv').classList.add('open'); }
function closeImport() { document.getElementById('importOv').classList.remove('open'); }

function switchImportMode(mode) {
  importMode = mode;
  document.getElementById('iModeJson').classList.toggle('active', mode === 'json');
  document.getElementById('iModeText').classList.toggle('active', mode === 'text');
  document.getElementById('iPanelJson').classList.toggle('active', mode === 'json');
  document.getElementById('iPanelText').classList.toggle('active', mode === 'text');
}

function previewJson() { document.getElementById('jsonResult').style.display = 'none'; }

async function doJsonImport() {
  const file = document.getElementById('jsonFile').files[0];
  const res  = document.getElementById('jsonResult');
  if (!file) { toast('请先选择 JSON 文件'); return; }
  let parsed;
  try { parsed = JSON.parse(await file.text()); }
  catch {
    res.textContent = '❌ JSON 格式错误';
    res.className = 'import-result err'; res.style.display = 'block'; return;
  }

  // 支持：[{name,img,card_type,domains,...}] 或 { anyKey: [{...}] }
  let total = 0, skipped = 0, added = 0;
  const newCards = [];

  const importItems = (items) => {
    for (const item of items) {
      const cardName = item.name?.trim();
      if (!cardName) continue;
      total++;
      if (allCards.find(c => c.name === cardName)) { skipped++; continue; }
      const card = {
        id: uid(), name: cardName, img: item.img || '', pos: allCards.length + added,
        set_code:    item.set_code    || '',
        card_number: item.card_number ?? null,
        card_type:   item.card_type   || '',
        domains:     Array.isArray(item.domains) ? item.domains : [],
      };
      allCards.push(card); newCards.push(card); added++;
    }
  };

  if (Array.isArray(parsed)) { importItems(parsed); }
  else { for (const items of Object.values(parsed)) { if (Array.isArray(items)) importItems(items); } }

  renderAll();

  if (newCards.length) {
    setSyncState('syncing', '同步中…');
    try {
      const rows = newCards.map(c => ({
        id: c.id, name: c.name, img: c.img || null, pos: c.pos,
        set_code: c.set_code || null, card_number: c.card_number ?? null,
        card_type: c.card_type || null, domains: c.domains?.length ? c.domains : null,
      }));
      for (let i = 0; i < rows.length; i += 200) await sbUpsert('cards', rows.slice(i, i + 200));
      setSyncState('live', '已同步');
    } catch(e) { console.error('import error', e); setSyncState('err', '同步失败'); }
  }

  res.textContent = `✓ 成功导入 ${added} 张，跳过重复 ${skipped} 张（共 ${total} 张）`;
  res.className = 'import-result'; res.style.display = 'block';
  toast(`导入完成：+${added} 张`);
}

async function doBulkImport() {
  const lines = document.getElementById('bulkTxt').value.split('\n').filter(l => l.trim());
  const newCards = [];
  let added = 0;
  for (const line of lines) {
    const t = line.trim();
    let name, img;
    if (t.includes('|'))                                           { [name, img] = t.split('|').map(s => s.trim()); }
    else if (t.startsWith('http://') || t.startsWith('https://')) { img = t; name = ''; }
    else                                                           { name = t; img = ''; }
    const cardName = name || `卡牌 #${allCards.length + added + 1}`;
    if (allCards.find(c => c.name === cardName)) continue;
    const card = {
      id: uid(), name: cardName, img: img || '', pos: allCards.length + added,
      set_code: '', card_number: null, card_type: '', domains: [],
    };
    allCards.push(card); newCards.push(card); added++;
  }
  document.getElementById('bulkTxt').value = '';
  closeImport(); renderAll();
  if (newCards.length) {
    setSyncState('syncing', '同步中…');
    try {
      await sbUpsert('cards', newCards.map(c => ({
        id: c.id, name: c.name, img: c.img || null, pos: c.pos,
        set_code: null, card_number: null, card_type: null, domains: null,
      })));
      setSyncState('live', '已同步');
    } catch(e) { setSyncState('err', '同步失败'); }
  }
  toast(`已导入 ${added} 张卡牌`);
}

// ═══════════════════════════════════════════════════════════
//  COMPARE
// ═══════════════════════════════════════════════════════════
function openCompare() {
  document.getElementById('cmpFormat').value = activeFormat;
  document.getElementById('cmpOv').classList.add('open');
}
function closeCmp() { document.getElementById('cmpOv').classList.remove('open'); }

function startCompare() {
  const fmt = document.getElementById('cmpFormat').value;
  closeCmp();
  document.getElementById('cardArea').style.display = 'none';
  const area = document.getElementById('cmpArea');
  area.style.display = 'flex';

  // 有该赛制评级的用户
  const participants = allUsers.filter(u =>
    allCards.some(c => grades[c.id]?.[u.id]?.[fmt]?.grade)
  );
  if (!participants.length) {
    area.innerHTML = `<div style="padding:40px;color:var(--text-dim);text-align:center">
      暂无「${fmt === 'constructed' ? '构筑' : '限制'}赛」评级数据<br><br>
      <button class="btn btn-ghost btn-sm" onclick="exitCmp()">返回</button>
    </div>`;
    return;
  }

  const colW      = Math.max(60, Math.floor(380 / participants.length));
  const gridCols  = `165px ${participants.map(() => colW + 'px').join(' ')}`;

  let html = `<div style="display:flex;justify-content:space-between;align-items:center">
    <div style="font-family:'Cinzel',serif;font-size:14px;color:var(--gold-light);letter-spacing:.1em">
      评级对比 · ${fmt === 'constructed' ? '构筑赛' : '限制赛'}
    </div>
    <button class="btn btn-ghost btn-sm" onclick="exitCmp()">退出对比</button>
  </div>`;

  for (const tab of TABS) {
    const tabCards = getCardsForTab(tab.id, allCards);
    const rated    = tabCards.filter(c => participants.some(u => grades[c.id]?.[u.id]?.[fmt]?.grade));
    if (!rated.length) continue;

    html += `<div>
      <div class="cmp-tab-label" style="color:${tab.color}">${tab.label}</div>
      <div class="cmp-head" style="grid-template-columns:${gridCols}">
        <div>卡牌</div>
        ${participants.map(u => `<div class="cmp-hl">${u.display_name}</div>`).join('')}
      </div>`;

    for (const c of rated) {
      const userGrades = participants.map(u => grades[c.id]?.[u.id]?.[fmt]?.grade || null);
      const uniq = new Set(userGrades.filter(Boolean));
      const diff = uniq.size > 1;
      html += `<div class="cmp-row ${diff ? 'diff' : ''}" style="grid-template-columns:${gridCols}">
        <div class="cmp-name">
          ${diff ? '<span class="diff-ico">⚡</span>' : '<span style="width:14px;display:inline-block"></span>'}
          ${c.name}
        </div>
        ${participants.map(u => {
          const g       = grades[c.id]?.[u.id]?.[fmt]?.grade;
          const comment = grades[c.id]?.[u.id]?.[fmt]?.comment || '';
          return `<div class="cmp-cell">
            ${g
              ? `<div class="cmp-badge" style="background:${GC[g]};color:${GF[g]}">${g}</div>`
              : `<div class="cmp-badge" style="background:var(--bg-input);color:var(--text-dim);font-size:12px">—</div>`
            }
            ${comment ? `<div class="cmp-note">${comment}</div>` : ''}
          </div>`;
        }).join('')}
      </div>`;
    }
    html += `</div>`;
  }

  area.innerHTML = html;
}

function exitCmp() {
  document.getElementById('cardArea').style.display = '';
  document.getElementById('cmpArea').style.display  = 'none';
}

// ═══════════════════════════════════════════════════════════
//  RENDER
// ═══════════════════════════════════════════════════════════
function renderAll() {
  renderLegend(); renderTabs(); renderFilter();
  renderCards(); renderStats(); renderProgress();
}

// ── 评级说明（按赛制动态切换）────────────────────────────────
function renderLegend() {
  const panel = document.getElementById('legendPanel');
  if (!panel) return;
  const desc = GL[activeFormat];
  panel.innerHTML = G.map(g => `
    <div class="leg-row">
      <div class="leg-badge" style="background:${GC[g]};color:${GF[g]}">${g}</div>
      <div class="leg-text"><b>${desc[g].title}</b>${desc[g].desc}</div>
    </div>`).join('');
}

// ── Tabs ─────────────────────────────────────────────────────
function renderTabs() {
  document.getElementById('tabBar').innerHTML = TABS.map(t => {
    const tabCards = getCardsForTab(t.id, allCards);
    const total    = tabCards.length;
    const graded   = tabCards.filter(c => myGrade(c.id)).length;
    return `<div class="tab ${activeTab === t.id ? 'active' : ''}" style="--ta:${t.color}"
      onclick="switchTab('${t.id}')">
      <div class="tab-pip"></div>${t.label}
      <div class="tab-n">${total}</div>
      ${total && graded === total ? '<span class="tab-prog">✓</span>' : ''}
    </div>`;
  }).join('');
}

function switchTab(id) {
  activeTab = id; activeFilter = 'ALL'; searchQuery = '';
  const sb = document.getElementById('searchBox');
  if (sb) sb.value = '';
  renderAll();
}

// ── Filter bar ───────────────────────────────────────────────
function renderFilter() {
  const items = [
    { k:'ALL',  label:'全部' },
    ...G.map(g => ({ k:g, label:g, grade:true })),
    { k:'NONE', label:'未评' },
  ];
  const filters = items.map(i => {
    const isG = !!i.grade, isActive = activeFilter === i.k;
    const style = isG
      ? `background:${GC[i.k]};color:${GF[i.k]};${isActive ? '' : 'opacity:.42'};border-color:${GC[i.k]}`
      : '';
    return `<div class="fc ${!isG ? 'fc-all' : ''} ${isActive && !isG ? 'active' : ''}"
      style="${style}" onclick="setFilter('${i.k}')">${i.label}</div>`;
  }).join('');

  const cnt   = filteredCards().length;
  const total = getCardsForTab(activeTab, allCards).length;
  const countLabel = cnt < total ? `<span class="card-count">${cnt} / ${total}</span>` : '';

  document.getElementById('filterRow').innerHTML =
    filters + countLabel +
    `<div class="fc-search">
      <span class="fc-search-ico">🔍</span>
      <input id="searchBox" type="text" placeholder="搜索…" value="${searchQuery}"
        oninput="onSearch(this.value)" />
    </div>`;
}

function setFilter(f) { activeFilter = f; renderFilter(); renderCards(); }

function onSearch(v) {
  searchQuery = v.trim(); renderCards();
  const cnt   = filteredCards().length;
  const total = getCardsForTab(activeTab, allCards).length;
  const cl    = document.querySelector('.card-count');
  if (cl) cl.textContent = cnt < total ? `${cnt} / ${total}` : '';
}

function filteredCards() {
  let list = getCardsForTab(activeTab, allCards);
  if (activeFilter === 'NONE')      list = list.filter(c => !myGrade(c.id));
  else if (activeFilter !== 'ALL')  list = list.filter(c => myGrade(c.id) === activeFilter);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(c => c.name.toLowerCase().includes(q));
  }
  return list;
}

// ── Card grid ────────────────────────────────────────────────
function renderCards() {
  const grid = document.getElementById('cardGrid');
  if (isLoading) { showSkeleton(); return; }
  const cards = filteredCards();

  if (!cards.length) {
    const tabTotal = getCardsForTab(activeTab, allCards).length;
    const msg = tabTotal === 0
      ? '此页还没有卡牌<br>在左侧手动添加，或使用「导入卡牌」'
      : '此筛选下无卡牌';
    grid.innerHTML = `<div class="empty"><div class="empty-ico">🃏</div><div class="empty-txt">${msg}</div></div>`;
    return;
  }

  grid.innerHTML = cards.map(c => {
    const grade   = myGrade(c.id);
    const comment = myComment(c.id);
    const note    = myNote(c.id);
    const gc      = grade ? GC[grade] : null;
    const gf      = grade ? GF[grade] : null;

    // 卡牌编号 + 特性标签
    const numTag = (c.set_code && c.card_number != null)
      ? `<span class="ci-tag card-num">${c.set_code}-${c.card_number}</span>` : '';
    const domainTags = (c.domains || []).map(d =>
      `<span class="ci-tag domain" style="--dt:${DOMAIN_COLOR[d] || 'var(--text-dim)'}">${d}</span>`
    ).join('');
    const metaHtml = (numTag || domainTags)
      ? `<div class="ci-meta">${numTag}${domainTags}</div>` : '';

    return `<div class="ci" ${gc ? `data-g="${grade}" style="--gc:${gc}"` : ''}
      ondblclick="editImg('${c.id}')" title="单击放大卡图 · 双击修改图片 URL">
      <button class="ci-del" onclick="delCard('${c.id}')">×</button>
      <div class="ci-thumb">
        ${c.img
          ? `<img src="${c.img}" alt="${c.name}" onclick="openLightbox(event,'${c.id}')" style="cursor:zoom-in"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
             <div class="ci-ph" style="display:none" onclick="openLightbox(event,'${c.id}')" style="cursor:zoom-in">
               <div class="ci-ph-ico">🃏</div><div class="ci-ph-name">${c.name}</div>
             </div>`
          : `<div class="ci-ph" onclick="openLightbox(event,'${c.id}')" style="cursor:zoom-in">
               <div class="ci-ph-ico">🃏</div><div class="ci-ph-name">${c.name}</div>
             </div>`
        }
        ${grade ? `<div class="ci-ribbon" style="background:${gc};color:${gf}">${grade}</div>` : ''}
        ${buildPeerBadges(c.id)}
      </div>
      <div class="ci-body">
        <div class="ci-name" title="点击编辑名称" onclick="editName('${c.id}',this)">${c.name}</div>
        ${metaHtml}
        <div class="gb-row">
          ${G.map(g => `<button class="gb ${g.toLowerCase()} ${grade === g ? 'sel' : ''}"
            onclick="setGrade('${c.id}','${g}')">${g}</button>`).join('')}
        </div>
        <div class="box-label">强度评语</div>
        <textarea class="comment-box" rows="2"
          oninput="updateComment('${c.id}',this.value)">${comment}</textarea>
        <div class="box-label" style="margin-top:4px">使用心得</div>
        <textarea class="note-box" rows="2"
          oninput="updateNote('${c.id}',this.value)">${note}</textarea>
      </div>
    </div>`;
  }).join('');
}

// 构建他人评级角标
function buildPeerBadges(cardId) {
  const others = allUsers.filter(u => u.id !== currentUser?.id);
  const badges = others.map(u => {
    const g = grades[cardId]?.[u.id]?.[activeFormat]?.grade;
    if (!g) return '';
    return `<div class="ci-peer-badge" style="background:${GC[g]};color:${GF[g]}">
      <span class="ci-peer-grade">${g}</span>
      <span class="ci-peer-name">${u.display_name}</span>
    </div>`;
  }).filter(Boolean).join('');
  return badges ? `<div class="ci-peers">${badges}</div>` : '';
}

// ── Stats ─────────────────────────────────────────────────────
function renderStats() {
  const sec = document.getElementById('sbStats');
  const tabCards = getCardsForTab(activeTab, allCards);
  if (!tabCards.length) { sec.innerHTML = ''; return; }
  const total = tabCards.length;
  // 5列网格：S A B C D
  const cells = G.map(g => {
    const n = tabCards.filter(c => myGrade(c.id) === g).length;
    return `<div class="st-cell">
      <div class="st-badge" style="background:${GC[g]};color:${GF[g]}">${g}</div>
      <div class="st-num" style="color:${n ? 'var(--text)' : 'var(--text-dim)'}">${n}</div>
    </div>`;
  }).join('');
  const ur = tabCards.filter(c => !myGrade(c.id)).length;
  sec.innerHTML = `
    <div class="sb-title">当前页统计</div>
    <div class="st-grid">${cells}</div>
    <div class="st-unrated"><span>未评级</span><span>${ur} / ${total}</span></div>`;
}

// ── Progress bar ──────────────────────────────────────────────
function renderProgress() {
  let graded = 0, total = allCards.length;
  for (const c of allCards) { if (myGrade(c.id)) graded++; }
  const pct = total ? Math.round(graded / total * 100) : 0;
  document.getElementById('progFill').style.width = pct + '%';
  document.getElementById('progPct').textContent   = pct + '%';
  document.getElementById('progLabel').textContent = `全局进度 (${graded}/${total})`;
}

// ── Skeleton ──────────────────────────────────────────────────
function showSkeleton() {
  document.getElementById('cardGrid').innerHTML = Array(12).fill(0).map(() =>
    `<div class="skel"><div class="skel-thumb"></div>
      <div class="skel-body">
        <div class="skel-line" style="width:70%"></div>
        <div class="skel-line" style="width:100%;height:14px"></div>
        <div class="skel-line" style="width:100%;height:24px"></div>
      </div></div>`
  ).join('');
}

// ═══════════════════════════════════════════════════════════
//  SYNC STATE UI
// ═══════════════════════════════════════════════════════════
function setSyncState(state, label) {
  document.getElementById('syncDot').className     = 'sync-dot ' + state;
  document.getElementById('syncLabel').textContent = label;
}

// ═══════════════════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════════════════
let toastT;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('on'), 2400);
}

// ═══════════════════════════════════════════════════════════
//  KEY BINDINGS
// ═══════════════════════════════════════════════════════════
document.getElementById('inName').addEventListener('keydown', e => { if (e.key === 'Enter') addCard(); });
document.getElementById('importOv').addEventListener('click', e => { if (e.target === e.currentTarget) closeImport(); });
document.getElementById('cmpOv').addEventListener('click',   e => { if (e.target === e.currentTarget) closeCmp(); });
document.getElementById('setsOv').addEventListener('click',  e => { if (e.target === e.currentTarget) closeSets(); });
document.getElementById('statsOv').addEventListener('click', e => { if (e.target === e.currentTarget) closeStats(); });

// S/A/B/C/D/E → 评级聚焦卡 | Escape → 取消 | ← → → 导航
document.addEventListener('keydown', e => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (document.querySelector('.overlay.open')) return;
  const key = e.key.toUpperCase();
  if (G.includes(key) && focusedCardId) {
    e.preventDefault(); setGrade(focusedCardId, key); return;
  }
  if (e.key === 'Escape' && focusedCardId) {
    // 取消当前聚焦卡评级
    const current = myGrade(focusedCardId);
    if (current) setGrade(focusedCardId, current);  // toggle off
    return;
  }
  if (e.key === 'Escape') { closeLightbox(); return; }
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault(); navigateCard(e.key === 'ArrowRight' ? 1 : -1);
  }
});

function setFocusedCard(id) {
  document.querySelectorAll('.ci.kb-focus').forEach(el => el.classList.remove('kb-focus'));
  focusedCardId = id;
  if (!id) return;
  const cards = filteredCards();
  const idx   = cards.findIndex(c => c.id === id);
  const el    = document.querySelectorAll('#cardGrid .ci')[idx];
  if (el) { el.classList.add('kb-focus'); el.scrollIntoView({ block: 'nearest' }); }
}

function navigateCard(dir) {
  const cards = filteredCards();
  if (!cards.length) return;
  const idx  = focusedCardId ? cards.findIndex(c => c.id === focusedCardId) : -1;
  const next = Math.max(0, Math.min(cards.length - 1, idx + dir));
  setFocusedCard(cards[next].id);
}

document.getElementById('cardGrid').addEventListener('click', e => {
  const ci = e.target.closest('.ci');
  if (!ci) return;
  const delBtn = ci.querySelector('.ci-del');
  if (delBtn) {
    const m = delBtn.getAttribute('onclick').match(/'([^']+)'/);
    if (m) setFocusedCard(m[1]);
  }
});

// ── Lightbox ──────────────────────────────────────────────────
// 当前 lightbox 正在展示的卡牌 id
let lbCardId = null;

function openLightbox(evt, id) {
  evt.stopPropagation();
  const c = findCard(id);
  if (!c) return;
  lbCardId = id;

  const content = document.getElementById('lbContent');
  if (c.img) {
    content.innerHTML = `<img class="lb-img" src="${c.img}" alt="${c.name}"
      onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <div class="lb-ph" style="display:none"><div class="lb-ph-ico">🃏</div></div>`;
  } else {
    content.innerHTML = `<div class="lb-ph"><div class="lb-ph-ico">🃏</div></div>`;
  }

  document.getElementById('lbName').textContent = c.name;
  refreshLbMeta(c);
  populateLbEdit(c);

  // 收起编辑面板（每次重新打开时重置）
  document.getElementById('lbEditPanel').style.display = 'none';
  document.getElementById('lbEditToggle') && (document.querySelector('.lb-edit-toggle').textContent = '✏ 编辑详情');

  document.getElementById('lightbox').classList.add('open');
}

// 刷新 lightbox meta 标签（编辑保存后调用）
function refreshLbMeta(c) {
  const setName = c.set_code ? (sets[c.set_code] ? `${sets[c.set_code]}（${c.set_code}）` : c.set_code) : '';
  const numTag  = (c.set_code && c.card_number != null)
    ? `<span class="ci-tag card-num">${c.set_code}-${c.card_number}</span>` : '';
  const setTag  = setName ? `<span class="ci-tag">${setName}</span>` : '';
  const domTags = (c.domains || []).map(d =>
    `<span class="ci-tag domain" style="--dt:${DOMAIN_COLOR[d] || 'var(--text-dim)'}">${d}</span>`
  ).join('');
  document.getElementById('lbMeta').innerHTML = numTag + setTag + domTags;
}

// 填充编辑面板的表单值
function populateLbEdit(c) {
  // 系列下拉：动态填充当前 sets 表
  const setSelect = document.getElementById('lbSetCode');
  setSelect.innerHTML = '<option value="">— 无 —</option>' +
    Object.entries(sets).sort().map(([code, name]) =>
      `<option value="${code}" ${c.set_code === code ? 'selected' : ''}>${code} · ${name}</option>`
    ).join('');

  // 编号
  const numInput = document.getElementById('lbCardNumber');
  numInput.value = c.card_number != null ? c.card_number : '';

  // 类型
  document.getElementById('lbCardType').value = c.card_type || '';

  // 特性 checkbox
  const domainCbs = document.querySelectorAll('#lbDomains input[type=checkbox]');
  domainCbs.forEach(cb => { cb.checked = (c.domains || []).includes(cb.value); });

  // 特性行显隐：legend/battlefield 隐藏
  const hideD = c.card_type === 'legend' || c.card_type === 'battlefield';
  document.getElementById('lbDomainsRow').style.display = hideD ? 'none' : '';
}

function closeLightbox(evt) {
  if (evt && evt.target !== evt.currentTarget && !evt.target.classList.contains('lb-close')) return;
  document.getElementById('lightbox').classList.remove('open');
  lbCardId = null;
}

// ═══════════════════════════════════════════════════════════
//  LIGHTBOX CARD EDIT
// ═══════════════════════════════════════════════════════════
function toggleLbEdit() {
  const panel  = document.getElementById('lbEditPanel');
  const btn    = document.querySelector('.lb-edit-toggle');
  const hidden = panel.style.display === 'none';
  panel.style.display = hidden ? '' : 'none';
  btn.textContent = hidden ? '▲ 收起详情' : '✏ 编辑详情';
}

// 保存单个字段（set_code / card_number）
async function lbSaveField(field, value) {
  const c = findCard(lbCardId);
  if (!c) return;
  c[field] = value;
  refreshLbMeta(c);
  renderAll();
  await saveCardMeta(c);
}

// 类型变更：同步更新特性行显隐
async function lbSaveCardType(value) {
  const c = findCard(lbCardId);
  if (!c) return;
  c.card_type = value;
  // legend/battlefield 强制清空 domains
  if (value === 'legend' || value === 'battlefield') {
    c.domains = [];
    document.querySelectorAll('#lbDomains input[type=checkbox]').forEach(cb => cb.checked = false);
  }
  document.getElementById('lbDomainsRow').style.display =
    (value === 'legend' || value === 'battlefield') ? 'none' : '';
  refreshLbMeta(c);
  renderAll();
  await saveCardMeta(c);
}

// 特性多选变更
async function lbSaveDomains() {
  const c = findCard(lbCardId);
  if (!c) return;
  c.domains = Array.from(document.querySelectorAll('#lbDomains input[type=checkbox]:checked'))
    .map(cb => cb.value);
  refreshLbMeta(c);
  renderAll();
  await saveCardMeta(c);
}

// ═══════════════════════════════════════════════════════════
//  STATS MODAL
// ═══════════════════════════════════════════════════════════
let statsFormat = 'constructed';

function openStats() {
  statsFormat = activeFormat;
  document.getElementById('stFmtC').classList.toggle('active', statsFormat === 'constructed');
  document.getElementById('stFmtL').classList.toggle('active', statsFormat === 'limited');
  renderStatsModal();
  document.getElementById('statsOv').classList.add('open');
}

function closeStats() {
  document.getElementById('statsOv').classList.remove('open');
}

function switchStatsFormat(fmt) {
  statsFormat = fmt;
  document.getElementById('stFmtC').classList.toggle('active', fmt === 'constructed');
  document.getElementById('stFmtL').classList.toggle('active', fmt === 'limited');
  renderStatsModal();
}

function renderStatsModal() {
  const el = document.getElementById('statsContent');
  const fmt = statsFormat;

  // 有该赛制评级的用户
  const users = allUsers.filter(u =>
    allCards.some(c => grades[c.id]?.[u.id]?.[fmt]?.grade)
  );

  if (!users.length) {
    el.innerHTML = `<div class="stats-empty">暂无「${fmt === 'constructed' ? '构筑' : '限制'}赛」评级数据</div>`;
    return;
  }

  let html = '';

  // ── 区块一：当前 Tab 评级分布（横向堆叠条形图） ──
  const tabCards = getCardsForTab(activeTab, allCards);
  const tabLabel = TABS.find(t => t.id === activeTab)?.label || activeTab;

  if (tabCards.length) {
    // 每位用户在当前 tab 的各档位数量
    const userStats = users.map(u => {
      const counts = {};
      G.forEach(g => { counts[g] = tabCards.filter(c => grades[c.id]?.[u.id]?.[fmt]?.grade === g).length; });
      counts.total = tabCards.filter(c => grades[c.id]?.[u.id]?.[fmt]?.grade).length;
      return { ...u, counts };
    });

    const maxTotal = Math.max(...userStats.map(u => u.counts.total), 1);

    // 用户图例
    const USER_COLORS = ['#5b9fe0','#e07d30','#52b96e','#9b6de0','#d4b935','#e05252'];
    const legendHtml = users.map((u, i) =>
      `<div class="stats-legend-item">
        <div class="stats-legend-dot" style="background:${USER_COLORS[i % USER_COLORS.length]}"></div>
        ${u.display_name}
      </div>`
    ).join('');

    // 每档位一行，每行各用户的条形
    const gridCols = `60px repeat(${users.length}, 1fr)`;
    const barsHtml = G.map(g => {
      const bars = userStats.map((u, i) => {
        const n = u.counts[g];
        const pct = u.counts.total > 0 ? Math.round(n / u.counts.total * 100) : 0;
        const color = USER_COLORS[i % USER_COLORS.length];
        const barPct = maxTotal > 0 ? Math.round(n / maxTotal * 100) : 0;
        const showInside = barPct >= 20;
        return `<div style="position:relative;height:20px;background:var(--border);border-radius:3px;overflow:visible;">
          <div class="stats-bar" style="width:${barPct}%;background:${GC[g]};opacity:${0.55 + i * 0.15};min-width:${n > 0 ? 4 : 0}px;">
            ${showInside && n > 0 ? `<span class="stats-bar-val">${n}</span>` : ''}
          </div>
          ${!showInside && n > 0 ? `<span class="stats-bar-val outside">${n}</span>` : ''}
        </div>`;
      }).join('');
      return `<div class="stats-row" style="grid-template-columns:${gridCols}">
        <div style="display:flex;align-items:center;gap:5px;">
          <div style="width:22px;height:22px;border-radius:3px;background:${GC[g]};color:${GF[g]};
            display:flex;align-items:center;justify-content:center;font-family:'Cinzel',serif;font-size:11px;font-weight:700;">${g}</div>
        </div>
        ${bars}
      </div>`;
    }).join('');

    html += `<div class="stats-section">
      <div class="stats-section-title">${tabLabel} · 档位分布（${fmt === 'constructed' ? '构筑' : '限制'}赛）</div>
      <div class="stats-chart">${barsHtml}</div>
      <div class="stats-legend">${legendHtml}</div>
    </div>`;
  }

  // ── 区块二：全局 Tab 概览表格 ──
  const overviewRows = TABS.map(tab => {
    const tc = getCardsForTab(tab.id, allCards);
    if (!tc.length) return '';
    // 每位用户各档位数
    const cells = users.map(u => {
      const counts = G.map(g => {
        const n = tc.filter(c => grades[c.id]?.[u.id]?.[fmt]?.grade === g).length;
        return n > 0
          ? `<div class="stats-ov-badge" style="background:${GC[g]};color:${GF[g]}">${n}</div>`
          : `<div class="stats-ov-badge" style="background:var(--bg-input);color:var(--text-dim);opacity:.4">·</div>`;
      }).join('');
      const rated = tc.filter(c => grades[c.id]?.[u.id]?.[fmt]?.grade).length;
      return `<td>
        <div class="stats-ov-grades">${counts}</div>
        <div class="stats-ov-total">${rated}/${tc.length}</div>
      </td>`;
    }).join('');

    return `<tr>
      <td class="stats-ov-tab" style="color:${tab.color}">${tab.label}</td>
      ${cells}
    </tr>`;
  }).filter(Boolean).join('');

  const headerCells = users.map(u => `<th>${u.display_name}</th>`).join('');
  html += `<div class="stats-section">
    <div class="stats-section-title">全局 Tab 概览</div>
    <table class="stats-overview">
      <thead><tr><th>Tab</th>${headerCells}</tr></thead>
      <tbody>${overviewRows}</tbody>
    </table>
  </div>`;

  el.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
//  SETS MANAGEMENT
// ═══════════════════════════════════════════════════════════
function openSets() {
  renderSetsTable();
  document.getElementById('setsOv').classList.add('open');
}

function closeSets() {
  document.getElementById('setsOv').classList.remove('open');
}

function renderSetsTable() {
  const wrap = document.getElementById('setsTableWrap');
  const rows = Object.entries(sets).sort((a, b) => a[0].localeCompare(b[0]));

  if (!rows.length) {
    wrap.innerHTML = `<div class="sets-empty">暂无系列，点击「新增系列」添加</div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="sets-table">
      <thead>
        <tr><th>代码</th><th>名称</th><th></th></tr>
      </thead>
      <tbody>
        ${rows.map(([code, name]) => `
          <tr data-code="${code}">
            <td><input class="sets-code-input" value="${code}"
              onchange="updateSetCode('${code}',this)" /></td>
            <td><input class="sets-name-input" value="${name}"
              onblur="saveSetName('${code}',this.value)" /></td>
            <td style="width:48px;text-align:right">
              <button class="btn btn-danger btn-sm" onclick="deleteSet('${code}')">删</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

// 新增一行（临时占位，用户填写后 blur 保存）
function addSetRow() {
  const wrap = document.getElementById('setsTableWrap');

  // 若已有空白 code 输入框则聚焦，不重复添加
  const existing = wrap.querySelector('.sets-code-input[value=""]');
  if (existing) { existing.focus(); return; }

  // 若表格不存在（无数据时），先渲染骨架
  let tbody = wrap.querySelector('tbody');
  if (!tbody) {
    wrap.innerHTML = `
      <table class="sets-table">
        <thead><tr><th>代码</th><th>名称</th><th></th></tr></thead>
        <tbody></tbody>
      </table>`;
    tbody = wrap.querySelector('tbody');
  }

  const tr = document.createElement('tr');
  tr.dataset.code = '';
  tr.innerHTML = `
    <td><input class="sets-code-input" placeholder="UNL" /></td>
    <td><input class="sets-name-input" placeholder="破限" /></td>
    <td style="width:48px;text-align:right">
      <button class="btn btn-danger btn-sm" onclick="this.closest('tr').remove()">删</button>
    </td>`;
  tbody.appendChild(tr);

  const codeInput = tr.querySelector('.sets-code-input');
  const nameInput = tr.querySelector('.sets-name-input');
  // 两个字段都 blur 时尝试保存（只要 code 和 name 都有值）
  codeInput.addEventListener('blur', () => setTimeout(() => saveNewSet(tr, codeInput, nameInput), 80));
  nameInput.addEventListener('blur', () => setTimeout(() => saveNewSet(tr, codeInput, nameInput), 80));
  codeInput.focus();
}

async function saveNewSet(tr, codeInput, nameInput) {
  // 如果焦点刚移到同行另一个输入框，延迟后仍在同行则跳过
  if (tr.contains(document.activeElement)) return;
  const code = codeInput.value.trim().toUpperCase();
  const name = nameInput.value.trim();
  if (!code || !name) return;
  if (sets[code] !== undefined) { toast(`系列代码 ${code} 已存在`); return; }
  try {
    await sbUpsert('sets', { code, name });
    sets[code] = name;
    renderSetsTable();
    toast(`已添加系列：${code} · ${name}`);
  } catch(e) {
    toast('保存失败：' + e.message);
  }
}

async function saveSetName(oldCode, newName) {
  const name = newName.trim();
  if (!name || sets[oldCode] === name) return;
  try {
    await sbUpsert('sets', { code: oldCode, name });
    sets[oldCode] = name;
    toast(`已更新：${oldCode} → ${name}`);
  } catch(e) {
    toast('保存失败：' + e.message);
  }
}

// code 变更（PK 变更：插新 + 删旧）
async function updateSetCode(oldCode, input) {
  const newCode = input.value.trim().toUpperCase();
  input.value = newCode;   // 强制大写回显
  if (!newCode || newCode === oldCode) { input.value = oldCode; return; }
  if (sets[newCode] !== undefined) {
    toast(`代码 ${newCode} 已存在`); input.value = oldCode; return;
  }
  const name = sets[oldCode];
  try {
    await sbUpsert('sets', { code: newCode, name });
    await sbFetch(`sets?code=eq.${encodeURIComponent(oldCode)}`, 'DELETE');
    delete sets[oldCode];
    sets[newCode] = name;
    renderSetsTable();
    toast(`代码已更新：${oldCode} → ${newCode}`);
  } catch(e) {
    toast('更新失败：' + e.message); input.value = oldCode;
  }
}

async function deleteSet(code) {
  if (!confirm(`确定删除系列「${code} · ${sets[code]}」？\n注意：使用此代码的卡牌 set_code 不会自动清空。`)) return;
  try {
    await sbFetch(`sets?code=eq.${encodeURIComponent(code)}`, 'DELETE');
    delete sets[code];
    renderSetsTable();
    toast(`已删除系列：${code}`);
  } catch(e) {
    toast('删除失败：' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════
boot();
