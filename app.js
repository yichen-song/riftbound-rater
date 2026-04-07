// ═══════════════════════════════════════════════════════════
//  CONFIG — fill in your Supabase credentials
// ═══════════════════════════════════════════════════════════
const SB_URL = 'https://vepqjryrhvuehwemabqu.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlcHFqcnlyaHZ1ZWh3ZW1hYnF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NjA2MjYsImV4cCI6MjA5MDQzNjYyNn0.8ZWqTUwEQX1zFwTCLx7eqwfocDmw5DId2rrxoxDjrPk';

// Table schema (create once in Supabase dashboard):
//   cards_v2
//   ├─ id       text  PRIMARY KEY
//   ├─ tab      text
//   ├─ name     text
//   ├─ img      text  nullable
//   ├─ pos      int4
//   ├─ grade_a  text  nullable   ← player A grade
//   ├─ note_a   text  nullable
//   ├─ grade_b  text  nullable   ← player B grade
//   └─ note_b   text  nullable
//
//  RLS: disable or add anon read+write policy

const TABLE = 'cards_v2';

// ═══════════════════════════════════════════════════════════
//  TAB CONFIG
// ═══════════════════════════════════════════════════════════
const TABS = [
  { id:'special', label:'传奇 / 专法', color:'#c9a84c' },
  { id:'red',     label:'红',          color:'#e05252' },
  { id:'green',   label:'绿',          color:'#52b96e' },
  { id:'blue',    label:'蓝',          color:'#5b9fe0' },
  { id:'orange',  label:'橙',          color:'#e07d30' },
  { id:'purple',  label:'紫',          color:'#9b6de0' },
  { id:'yellow',  label:'黄',          color:'#d4b935' },
];

const G  = ['S','A','B','C','D'];
const GC = { S:'#c0392b', A:'#d4820a', B:'#1e8449', C:'#1a6fa8', D:'#3d4455' };
const GF = { S:'#fff', A:'#fff', B:'#fff', C:'#fff', D:'#9aa' };
const GL = { S:'构筑核心', A:'色组首选', B:'联动良好', C:'可用补位', D:'弃用' };

// ═══════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════
// db[tab] = [{ id, name, img, pos, grade_a, note_a, grade_b, note_b }]
let db = {};
TABS.forEach(t => db[t.id] = []);

let activeUser   = 'a';   // 'a' | 'b'
let activeTab    = 'special';
let activeFilter = 'ALL';
let searchQuery  = '';
let noteTimer    = null;
let realtimeChannel = null;   // Supabase Realtime channel
let lastHash     = '';
let isLoading    = true;

// ═══════════════════════════════════════════════════════════
//  SUPABASE HELPERS
// ═══════════════════════════════════════════════════════════
const SB_HDR = () => ({
  'apikey':        SB_KEY,
  'Authorization': 'Bearer ' + SB_KEY,
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

// Upsert: insert or update on conflict of id
async function sbUpsert(rows) {
  const hdrs = { ...SB_HDR(), 'Prefer': 'resolution=merge-duplicates,return=minimal' };
  const r = await fetch(SB_URL + '/rest/v1/' + TABLE, {
    method: 'POST', headers: hdrs, body: JSON.stringify(rows)
  });
  if (!r.ok) throw new Error(`upsert ${r.status}: ${await r.text()}`);
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
      // Start heartbeat every 25s
      heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ topic:'phoenix', event:'heartbeat', payload:{}, ref: nextRef() }));
        }
      }, 25000);
      // Re-subscribe all channels
      channels.forEach(ch => ch._join());
    };

    ws.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      channels.forEach(ch => ch._receive(msg));
    };

    ws.onclose = () => {
      clearInterval(heartbeatTimer);
      // Notify channels
      channels.forEach(ch => {
        if (ch._statusCallback) ch._statusCallback('CLOSED');
      });
    };

    ws.onerror = () => {
      channels.forEach(ch => {
        if (ch._statusCallback) ch._statusCallback('CHANNEL_ERROR');
      });
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
          ws.send(JSON.stringify({
            topic: fullTopic, event: 'phx_leave', payload: {}, ref: nextRef()
          }));
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
          topic: fullTopic,
          event: 'phx_join',
          payload: {
            config: {
              broadcast:  { self: false },
              presence:   { key: '' },
              postgres_changes: pgBindings,
            }
          },
          ref: nextRef(),
        }));
      },

      _receive(msg) {
        if (msg.topic !== fullTopic) return;

        // Connection status
        if (msg.event === 'phx_reply') {
          const status = msg.payload?.status;
          if (status === 'ok' && statusCb) statusCb('SUBSCRIBED');
          if (status === 'error' && statusCb) statusCb('CHANNEL_ERROR');
          return;
        }

        // Postgres change events
        if (msg.event === 'postgres_changes') {
          const data = msg.payload?.data || msg.payload;
          bindings
            .filter(b => b.event === 'postgres_changes')
            .forEach(b => {
              const evType = data.type || data.eventType;
              if (b.filter.event === '*' || b.filter.event === evType) {
                b.callback({
                  eventType: evType,
                  new: data.record    || data.new || {},
                  old: data.old_record|| data.old || {},
                  table: data.table,
                  schema: data.schema,
                });
              }
            });
          return;
        }

        // System messages from newer Realtime versions
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
//  BOOT & SYNC
// ═══════════════════════════════════════════════════════════
async function boot() {
  setSyncState('syncing', '连接中…');
  showSkeleton();
  try {
    await sbFetch(`${TABLE}?limit=1&select=id`);   // connection test
    await loadAll();
    subscribeRealtime();
  } catch(e) {
    console.error('boot error', e);
    setSyncState('err', '连接失败');
    isLoading = false;
    renderAll();
  }
}

async function loadAll() {
  setSyncState('syncing', '加载中…');
  try {
    const rows = await sbFetch(`${TABLE}?select=*&order=tab,pos`);
    applyRows(rows);
    lastHash = hashRows(rows);
    setSyncState('live', '已同步');
  } catch(e) {
    console.error('load error', e);
    setSyncState('err', '加载失败');
  }
  isLoading = false;
  renderAll();
}

function applyRows(rows) {
  TABS.forEach(t => db[t.id] = []);
  for (const r of rows) {
    if (!db[r.tab]) continue;
    db[r.tab].push({
      id: r.id, name: r.name, img: r.img || '', pos: r.pos || 0,
      grade_a: r.grade_a || null, note_a: r.note_a || '',
      grade_b: r.grade_b || null, note_b: r.note_b || '',
    });
  }
}

// ═══════════════════════════════════════════════════════════
//  SUPABASE REALTIME
// ═══════════════════════════════════════════════════════════
function subscribeRealtime() {
  // Uses the Supabase Realtime JS client embedded below
  const client = createRealtimeClient(SB_URL, SB_KEY);

  realtimeChannel = client
    .channel('cards_v2_changes')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: TABLE },
      payload => handleRealtimeEvent(payload)
    )
    .subscribe(status => {
      if (status === 'SUBSCRIBED') {
        setSyncState('live', '实时同步');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setSyncState('err', '连接断开');
        // Fallback: re-attempt after 5s
        setTimeout(() => {
          setSyncState('syncing', '重连中…');
          realtimeChannel?.unsubscribe();
          subscribeRealtime();
        }, 5000);
      } else if (status === 'CLOSED') {
        setSyncState('err', '已断开');
      }
    });
}

function handleRealtimeEvent(payload) {
  const { eventType, new: newRow, old: oldRow } = payload;

  if (eventType === 'INSERT') {
    const tab = newRow.tab;
    if (!db[tab]) return;
    // Avoid duplicate if we just inserted it ourselves
    if (db[tab].find(c => c.id === newRow.id)) return;
    db[tab].push({
      id: newRow.id, name: newRow.name, img: newRow.img || '',
      pos: newRow.pos || 0,
      grade_a: newRow.grade_a || null, note_a: newRow.note_a || '',
      grade_b: newRow.grade_b || null, note_b: newRow.note_b || '',
    });
    // Sort by pos
    db[tab].sort((a, b) => a.pos - b.pos);
    renderAll();
    setSyncState('live', '实时同步');
    return;
  }

  if (eventType === 'DELETE') {
    const id = oldRow.id;
    TABS.forEach(t => { db[t.id] = db[t.id].filter(c => c.id !== id); });
    renderAll();
    setSyncState('live', '实时同步');
    return;
  }

  if (eventType === 'UPDATE') {
    const r = newRow;
    // Find card in db
    let card = null;
    for (const t of TABS) {
      card = db[t.id].find(c => c.id === r.id);
      if (card) break;
    }
    if (!card) return;

    card.grade_a = r.grade_a || null;
    card.note_a  = r.note_a  || '';
    card.grade_b = r.grade_b || null;
    card.note_b  = r.note_b  || '';
    card.name    = r.name;
    card.img     = r.img || '';

    // Smart DOM patch — don't destroy focused textarea
    patchCardDom();
    renderTabs();
    renderStats();
    renderProgress();
    setSyncState('live', '实时同步');
    return;
  }
}

// Patch grade ribbons, border colours, and peer badges in-place
// Skips any card whose textarea currently has focus
function patchCardDom() {
  const gKey  = 'grade_' + activeUser;
  const pgKey = 'grade_' + (activeUser === 'a' ? 'b' : 'a');
  const peerLabel = activeUser === 'a' ? 'B' : 'A';
  const focusedTextarea = document.activeElement?.classList.contains('note-box')
    ? document.activeElement : null;

  const cards = filtered();
  const cardEls = document.querySelectorAll('#cardGrid .ci');

  cards.forEach((c, idx) => {
    const el = cardEls[idx];
    if (!el) return;

    // Skip entirely if this card's textarea is focused
    if (focusedTextarea && el.contains(focusedTextarea)) return;

    const gc = c[gKey] ? GC[c[gKey]] : null;
    const gf = c[gKey] ? GF[c[gKey]] : null;
    const pg = c[pgKey];

    // Border + data-g
    if (gc) {
      el.dataset.g = c[gKey];
      el.style.setProperty('--gc', gc);
    } else {
      delete el.dataset.g;
      el.style.removeProperty('--gc');
    }

    // Grade ribbon
    const thumb = el.querySelector('.ci-thumb');
    let ribbon = thumb.querySelector('.ci-ribbon');
    if (c[gKey]) {
      if (!ribbon) {
        ribbon = document.createElement('div');
        ribbon.className = 'ci-ribbon';
        thumb.appendChild(ribbon);
      }
      ribbon.style.background = gc;
      ribbon.style.color = gf;
      ribbon.textContent = c[gKey];
    } else {
      ribbon?.remove();
    }

    // Peer badge
    let peer = thumb.querySelector('.ci-peer');
    if (pg) {
      if (!peer) {
        peer = document.createElement('div');
        peer.className = 'ci-peer';
        thumb.appendChild(peer);
      }
      peer.innerHTML = `<div class="ci-peer-badge" style="background:${GC[pg]};color:${GF[pg]}">${pg}</div>
        <span class="ci-peer-name">${peerLabel}</span>`;
    } else {
      peer?.remove();
    }

    // Grade buttons
    const gbs = el.querySelectorAll('.gb');
    gbs.forEach((btn, i) => {
      btn.classList.toggle('sel', G[i] === c[gKey]);
    });
  });
}

function hashRows(rows) {
  return JSON.stringify(rows.map(r =>
    `${r.id}:${r.grade_a}:${r.note_a}:${r.grade_b}:${r.note_b}:${r.name}`));
}

// ═══════════════════════════════════════════════════════════
//  CARD OPS
// ═══════════════════════════════════════════════════════════
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,5); }

async function addCard() {
  const name = document.getElementById('inName').value.trim();
  const img  = document.getElementById('inImg').value.trim();
  if (!name && !img) { toast('请至少填入卡名或图片 URL'); return; }
  const list = db[activeTab];
  const cardName = name || `卡牌 #${list.length + 1}`;
  if (list.find(c => c.name === cardName)) { toast('该卡牌已存在'); return; }
  const card = { id: uid(), name: cardName, img, pos: list.length,
    grade_a: null, note_a: '', grade_b: null, note_b: '' };
  list.push(card);
  document.getElementById('inName').value = '';
  document.getElementById('inImg').value  = '';
  document.getElementById('ocrStatus').textContent = '';
  renderAll();
  await saveCard(card);
  toast('已添加：' + cardName);
}

async function delCard(id) {
  if (!confirm('确定删除此卡牌？此操作会从 Supabase 永久移除。')) return;
  TABS.forEach(t => { db[t.id] = db[t.id].filter(c => c.id !== id); });
  renderAll();
  setSyncState('syncing', '同步中…');
  try {
    await sbFetch(`${TABLE}?id=eq.${encodeURIComponent(id)}`, 'DELETE');
    setSyncState('live', '已同步');
  } catch(e) {
    console.error('delete error', e);
    setSyncState('err', '删除失败');
  }
}

async function setGrade(id, grade) {
  const c = findCard(id);
  if (!c) return;
  const key = 'grade_' + activeUser;
  c[key] = c[key] === grade ? null : grade;
  renderAll();
  await saveCard(c);
}

function updateNote(id, val) {
  const c = findCard(id);
  if (!c) return;
  c['note_' + activeUser] = val;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => saveCard(c), 1500);
}

async function saveCard(card) {
  const tab  = findTabOf(card.id) || activeTab;
  const row  = { id: card.id, tab, name: card.name, img: card.img || '', pos: card.pos || 0,
    grade_a: card.grade_a || null, note_a: card.note_a || '',
    grade_b: card.grade_b || null, note_b: card.note_b || '' };
  setSyncState('syncing', '同步中…');
  try {
    await sbUpsert(row);
    setSyncState('live', '已同步');
  } catch(e) {
    console.error('save error', e);
    setSyncState('err', '同步失败');
  }
}

async function editImg(id) {
  const c = findCard(id);
  if (!c) return;
  const url = prompt(`为「${c.name}」设置图片 URL（留空清除）：`, c.img || '');
  if (url === null) return;
  c.img = url.trim();
  renderCards();
  await saveCard(c);
}

async function editName(id, el) {
  const c = findCard(id);
  if (!c) return;
  const inp = document.createElement('input');
  inp.value = c.name;
  inp.style.cssText = 'width:100%;background:var(--bg-input);border:1px solid var(--gold-dark);border-radius:3px;color:var(--text);font-size:11px;padding:2px 5px;font-family:inherit;outline:none;user-select:text;';
  el.replaceWith(inp); inp.focus(); inp.select();
  const commit = async () => {
    const v = inp.value.trim();
    if (v && v !== c.name) { c.name = v; await saveCard(c); }
    renderAll();
  };
  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') renderAll();
  });
}

async function clearTab() {
  const label = TABS.find(t => t.id === activeTab).label;
  if (!confirm(`确定清空「${label}」页的所有卡牌？\n此操作将从 Supabase 永久删除所有该页卡牌。`)) return;
  const ids = db[activeTab].map(c => c.id);
  db[activeTab] = [];
  renderAll();
  if (!ids.length) return;
  setSyncState('syncing', '同步中…');
  try {
    // Delete in batch via IN filter
    const idList = ids.map(i => `"${i}"`).join(',');
    await sbFetch(`${TABLE}?id=in.(${ids.map(i => encodeURIComponent(i)).join(',')})`, 'DELETE');
    setSyncState('live', '已同步');
    toast(`已清空 ${ids.length} 张卡牌`);
  } catch(e) {
    console.error('clearTab error', e);
    setSyncState('err', '清空失败');
  }
}

function findCard(id)   { for(const t of TABS){ const c=db[t.id].find(c=>c.id===id); if(c) return c; } }
function findTabOf(id)  { for(const t of TABS){ if(db[t.id].find(c=>c.id===id)) return t.id; } }

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

function previewJson() {
  const res = document.getElementById('jsonResult');
  res.style.display = 'none';
}

async function doJsonImport() {
  const file   = document.getElementById('jsonFile').files[0];
  const target = document.getElementById('jsonTarget').value;
  const res    = document.getElementById('jsonResult');
  if (!file) { toast('请先选择 JSON 文件'); return; }

  let parsed;
  try {
    const text = await file.text();
    parsed = JSON.parse(text);
  } catch {
    res.textContent = '❌ JSON 格式错误，请检查文件内容';
    res.className = 'import-result err'; res.style.display = 'block';
    return;
  }

  // Accept two formats:
  // 1. Official scrape: { tabId: [{name, img}] }
  // 2. App export (old): { tabId: [{id, name, img, grade, note}] }
  let total = 0, skipped = 0, added = 0;
  const newCards = [];

  const importIntoTab = (tabId, items) => {
    const list = db[tabId];
    if (!list) return;
    for (const item of items) {
      const cardName = item.name || `卡牌 #${list.length + total + 1}`;
      total++;
      if (list.find(c => c.name === cardName)) { skipped++; continue; }
      const card = {
        id: uid(), name: cardName, img: item.img || '', pos: list.length,
        grade_a: null, note_a: '', grade_b: null, note_b: ''
      };
      list.push(card);
      newCards.push({ card, tabId });
      added++;
    }
  };

  if (target === 'all') {
    // Multi-tab JSON: { special: [...], red: [...], ... }
    for (const [key, items] of Object.entries(parsed)) {
      if (!Array.isArray(items)) continue;
      const tabId = key.toLowerCase();
      importIntoTab(tabId, items);
    }
  } else {
    // Force all into selected tab
    let items = [];
    if (Array.isArray(parsed)) {
      items = parsed;
    } else {
      // Flatten all arrays from the JSON
      for (const v of Object.values(parsed)) {
        if (Array.isArray(v)) items.push(...v);
      }
    }
    importIntoTab(target, items);
  }

  renderAll();

  // Batch upsert to Supabase
  if (newCards.length) {
    setSyncState('syncing', '同步中…');
    try {
      const rows = newCards.map(({ card, tabId }) => ({
        id: card.id, tab: tabId, name: card.name, img: card.img || '',
        pos: card.pos, grade_a: null, note_a: '', grade_b: null, note_b: ''
      }));
      // Upsert in chunks of 200
      for (let i = 0; i < rows.length; i += 200) {
        await sbUpsert(rows.slice(i, i + 200));
      }
      setSyncState('live', '已同步');
    } catch(e) {
      console.error('import upsert error', e);
      setSyncState('err', '同步失败');
    }
  }

  res.textContent = `✓ 成功导入 ${added} 张，跳过重复 ${skipped} 张（共 ${total} 张）`;
  res.className = 'import-result'; res.style.display = 'block';
  toast(`导入完成：+${added} 张`);
}

async function doBulkImport() {
  const lines = document.getElementById('bulkTxt').value.split('\n').filter(l => l.trim());
  const list  = db[activeTab];
  const newCards = [];
  let added = 0;
  for (const line of lines) {
    const t = line.trim();
    let name, img;
    if (t.includes('|'))                                      { [name, img] = t.split('|').map(s => s.trim()); }
    else if (t.startsWith('http://') || t.startsWith('https://')) { img = t; name = ''; }
    else                                                          { name = t; img = ''; }
    const cardName = name || `卡牌 #${list.length + added + 1}`;
    if (list.find(c => c.name === cardName)) continue;
    const card = { id: uid(), name: cardName, img: img || '', pos: list.length + added,
      grade_a: null, note_a: '', grade_b: null, note_b: '' };
    list.push(card);
    newCards.push(card);
    added++;
  }
  document.getElementById('bulkTxt').value = '';
  closeImport();
  renderAll();
  if (newCards.length) {
    setSyncState('syncing', '同步中…');
    try {
      const rows = newCards.map(c => ({
        id: c.id, tab: activeTab, name: c.name, img: c.img || '', pos: c.pos,
        grade_a: null, note_a: '', grade_b: null, note_b: ''
      }));
      await sbUpsert(rows);
      setSyncState('live', '已同步');
    } catch(e) { setSyncState('err', '同步失败'); }
  }
  toast(`已导入 ${added} 张卡牌`);
}

// ═══════════════════════════════════════════════════════════
//  USER SWITCH
// ═══════════════════════════════════════════════════════════
function switchUser(u) {
  activeUser = u.toLowerCase();
  document.getElementById('uBtnA').classList.toggle('active', activeUser === 'a');
  document.getElementById('uBtnB').classList.toggle('active', activeUser === 'b');
  renderAll();
}

// ═══════════════════════════════════════════════════════════
//  COMPARE
// ═══════════════════════════════════════════════════════════
function openCompare() { document.getElementById('cmpOv').classList.add('open'); }
function closeCmp()    { document.getElementById('cmpOv').classList.remove('open'); }

function startCompare() {
  closeCmp();
  document.getElementById('cardArea').style.display = 'none';
  const area = document.getElementById('cmpArea');
  area.style.display = 'flex';

  let html = `<div style="display:flex;justify-content:space-between;align-items:center">
    <div style="font-family:'Cinzel',serif;font-size:14px;color:var(--gold-light);letter-spacing:.1em">评级对比</div>
    <button class="btn btn-ghost btn-sm" onclick="exitCmp()">退出对比</button>
  </div>`;

  for (const t of TABS) {
    const cards = db[t.id];
    if (!cards.length) continue;
    html += `<div><div class="cmp-tab-label" style="color:${t.color}">${t.label}</div>
      <div class="cmp-head">
        <div>卡牌</div>
        <div class="cmp-hl" style="color:var(--gold)">玩家 A</div>
        <div class="cmp-hl" style="color:#8ab4e8">玩家 B</div>
      </div>`;
    for (const c of cards) {
      const ga = c.grade_a, gb = c.grade_b, diff = ga !== gb;
      const badge = (g, col) => g
        ? `<div class="cmp-badge" style="background:${GC[g]};color:${GF[g]}">${g}</div>`
        : `<div class="cmp-badge" style="background:var(--bg-input);color:var(--text-dim);font-size:12px">—</div>`;
      html += `<div class="cmp-row ${diff ? 'diff' : ''}">
        <div class="cmp-name">${diff ? '<span class="diff-ico">⚡</span>' : '<span style="width:14px"></span>'}${c.name}</div>
        <div class="cmp-cell">${badge(ga)}${c.note_a ? `<div class="cmp-note">${c.note_a}</div>` : ''}</div>
        <div class="cmp-cell">${badge(gb)}${c.note_b ? `<div class="cmp-note">${c.note_b}</div>` : ''}</div>
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
function renderAll() { renderTabs(); renderFilter(); renderCards(); renderStats(); renderProgress(); }

function renderTabs() {
  document.getElementById('tabBar').innerHTML = TABS.map(t => {
    const list    = db[t.id];
    const graded  = list.filter(c => c['grade_' + activeUser]).length;
    const total   = list.length;
    const pctStr  = total ? `${graded}/${total}` : '';
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
  document.getElementById('searchBox') && (document.getElementById('searchBox').value = '');
  renderAll();
}

function renderFilter() {
  const gKey = 'grade_' + activeUser;
  const items = [
    { k:'ALL', label:'全部' },
    ...G.map(g => ({ k:g, label:g, grade:true })),
    { k:'NONE', label:'未评' }
  ];
  const filters = items.map(i => {
    const isG = !!i.grade, isActive = activeFilter === i.k;
    const style = isG
      ? `background:${GC[i.k]};color:${GF[i.k]};${isActive ? '' : 'opacity:.42'};border-color:${GC[i.k]}`
      : '';
    return `<div class="fc ${!isG ? 'fc-all' : ''} ${isActive && !isG ? 'active' : ''}"
      style="${style}" onclick="setFilter('${i.k}')">${i.label}</div>`;
  }).join('');

  const cnt = filtered().length;
  const total = db[activeTab].length;
  const countLabel = cnt < total
    ? `<span class="card-count">${cnt} / ${total}</span>` : '';

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
  searchQuery = v.trim();
  renderCards();
  // update count label without re-rendering the whole filter row
  const cnt = filtered().length, total = db[activeTab].length;
  const cl = document.querySelector('.card-count');
  if (cl) cl.textContent = cnt < total ? `${cnt} / ${total}` : '';
}

function filtered() {
  const gKey = 'grade_' + activeUser;
  let list = db[activeTab];
  if (activeFilter === 'NONE') list = list.filter(c => !c[gKey]);
  else if (activeFilter !== 'ALL') list = list.filter(c => c[gKey] === activeFilter);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(c => c.name.toLowerCase().includes(q));
  }
  return list;
}

function renderCards() {
  const grid  = document.getElementById('cardGrid');
  if (isLoading) { showSkeleton(); return; }
  const cards = filtered();
  const gKey  = 'grade_' + activeUser;
  const nKey  = 'note_'  + activeUser;
  const pgKey = 'grade_' + (activeUser === 'a' ? 'b' : 'a'); // peer
  const peerLabel = activeUser === 'a' ? 'B' : 'A';

  if (!cards.length) {
    const msg = db[activeTab].length === 0
      ? '此页还没有卡牌<br>在左侧手动添加，或使用「导入卡牌」'
      : '此筛选下无卡牌';
    grid.innerHTML = `<div class="empty"><div class="empty-ico">🃏</div><div class="empty-txt">${msg}</div></div>`;
    return;
  }

  grid.innerHTML = cards.map(c => {
    const gc = c[gKey] ? GC[c[gKey]] : null;
    const gf = c[gKey] ? GF[c[gKey]] : null;
    const pg = c[pgKey];

    return `<div class="ci" ${gc ? `data-g="${c[gKey]}" style="--gc:${gc}"` : ''}
      ondblclick="editImg('${c.id}')" title="单击放大卡图 · 双击修改图片 URL">
      <button class="ci-del" onclick="delCard('${c.id}')">×</button>
      <div class="ci-thumb">
        ${c.img
          ? `<img src="${c.img}" alt="${c.name}" onclick="openLightbox(event,'${c.id}')" style="cursor:zoom-in"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
             <div class="ci-ph" style="display:none" onclick="openLightbox(event,'${c.id}')" style="cursor:zoom-in">
               <div class="ci-ph-ico">🃏</div>
               <div class="ci-ph-name">${c.name}</div>
             </div>`
          : `<div class="ci-ph" onclick="openLightbox(event,'${c.id}')" style="cursor:zoom-in">
               <div class="ci-ph-ico">🃏</div>
               <div class="ci-ph-name">${c.name}</div>
             </div>`
        }
        ${c[gKey] ? `<div class="ci-ribbon" style="background:${gc};color:${gf}">${c[gKey]}</div>` : ''}
        ${pg ? `<div class="ci-peer">
          <div class="ci-peer-badge" style="background:${GC[pg]};color:${GF[pg]}">${pg}</div>
          <span class="ci-peer-name">${peerLabel}</span>
        </div>` : ''}
      </div>
      <div class="ci-body">
        <div class="ci-name" title="点击编辑名称" onclick="editName('${c.id}',this)">${c.name}</div>
        <div class="gb-row">
          ${G.map(g => `<button class="gb ${g.toLowerCase()} ${c[gKey] === g ? 'sel' : ''}"
            onclick="setGrade('${c.id}','${g}')">${g}</button>`).join('')}
        </div>
        <textarea class="note-box" rows="2" placeholder="备注…"
          oninput="updateNote('${c.id}',this.value)">${c[nKey] || ''}</textarea>
      </div>
    </div>`;
  }).join('');
}

function renderStats() {
  const sec  = document.getElementById('sbStats');
  const list = db[activeTab];
  const gKey = 'grade_' + activeUser;
  if (!list.length) { sec.innerHTML = ''; return; }
  const total = list.length;
  let html = `<div class="sb-title">当前页统计</div>`;
  for (const g of G) {
    const n = list.filter(c => c[gKey] === g).length;
    const pct = Math.round(n / total * 100);
    html += `<div class="st-row">
      <div class="st-left">
        <div class="st-badge" style="background:${GC[g]};color:${GF[g]}">${g}</div>
        <span class="st-desc">${GL[g]}</span>
      </div>
      <div class="st-num">${n}</div>
    </div>
    <div class="bar-wrap"><div class="bar-fill" style="width:${pct}%;background:${GC[g]}"></div></div>`;
  }
  const ur = list.filter(c => !c[gKey]).length;
  html += `<div class="st-row" style="margin-top:3px">
    <span class="st-desc">未评级</span>
    <div class="st-num" style="font-size:13px">${ur}</div>
  </div>`;
  sec.innerHTML = html;
}

function renderProgress() {
  const gKey  = 'grade_' + activeUser;
  let graded = 0, total = 0;
  TABS.forEach(t => {
    const list = db[t.id];
    total  += list.length;
    graded += list.filter(c => c[gKey]).length;
  });
  const pct = total ? Math.round(graded / total * 100) : 0;
  document.getElementById('progFill').style.width = pct + '%';
  document.getElementById('progPct').textContent  = pct + '%';
  document.getElementById('progLabel').textContent =
    `全局进度 (${graded}/${total})`;
}

function showSkeleton() {
  const grid = document.getElementById('cardGrid');
  const n = 12;
  grid.innerHTML = Array(n).fill(0).map(() =>
    `<div class="skel"><div class="skel-thumb"></div>
      <div class="skel-body">
        <div class="skel-line" style="width:70%"></div>
        <div class="skel-line" style="width:100%;height:14px"></div>
        <div class="skel-line" style="width:100%;height:24px"></div>
      </div></div>`
  ).join('');
}

// ═══════════════════════════════════════════════════════════
//  OCR
// ═══════════════════════════════════════════════════════════
function onImgInput() {
  const url = document.getElementById('inImg').value.trim();
  document.getElementById('ocrBtn').style.opacity = url ? '1' : '0.4';
}

async function runOCR() {
  const url = document.getElementById('inImg').value.trim();
  if (!url) { toast('请先填入卡图 URL'); return; }
  const btn = document.getElementById('ocrBtn');
  const status = document.getElementById('ocrStatus');
  btn.classList.add('loading'); btn.textContent = '识别中…';
  status.textContent = '正在调用 AI…';
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-calls': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 64,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'url', url } },
          { type: 'text',  text: '这是一张 Riftbound TCG 卡牌。请只回答卡牌名称（中文名），不要任何其他文字。无法识别则回答"未知"。' }
        ]}]
      })
    });
    const data = await resp.json();
    const name = data?.content?.[0]?.text?.trim() || '';
    if (name && name !== '未知') {
      document.getElementById('inName').value = name;
      status.textContent = `✓ ${name}`;
      status.style.color = '#7ecba1';
    } else {
      status.textContent = '无法识别，请手动输入';
      status.style.color = 'var(--text-dim)';
    }
  } catch(e) {
    status.textContent = 'AI 识别失败';
    status.style.color = '#d07070';
  }
  btn.classList.remove('loading'); btn.textContent = '识别';
}

// ═══════════════════════════════════════════════════════════
//  SYNC STATE UI
// ═══════════════════════════════════════════════════════════
function setSyncState(state, label) {
  document.getElementById('syncDot').className  = 'sync-dot ' + state;
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
document.getElementById('inName').addEventListener('keydown', e => { if(e.key==='Enter') addCard(); });
document.getElementById('inImg').addEventListener('keydown',  e => { if(e.key==='Enter') addCard(); });
document.getElementById('importOv').addEventListener('click', e => { if(e.target===e.currentTarget) closeImport(); });
document.getElementById('cmpOv').addEventListener('click',   e => { if(e.target===e.currentTarget) closeCmp(); });

// ── Keyboard shortcuts ────────────────────────────────────────────────────
// S/A/B/C/D → grade focused card | Escape → clear grade | ← → → navigate cards
let focusedCardId = null;

document.addEventListener('keydown', e => {
  // Don't fire when typing in an input / textarea
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  // Don't fire when a modal is open
  if (document.querySelector('.overlay.open')) return;

  const key = e.key.toUpperCase();

  if (G.includes(key) && focusedCardId) {
    e.preventDefault();
    setGrade(focusedCardId, key);
    return;
  }

  if (e.key === 'Escape' && focusedCardId) {
    // Clear grade
    const c = findCard(focusedCardId);
    if (c) { c['grade_' + activeUser] = null; renderAll(); saveCard(c); }
    return;
  }

  if (e.key === 'Escape') { closeLightbox(); return; }

  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    navigateCard(e.key === 'ArrowRight' ? 1 : -1);
  }
});

function setFocusedCard(id) {
  // Remove previous highlight
  document.querySelectorAll('.ci.kb-focus').forEach(el => el.classList.remove('kb-focus'));
  focusedCardId = id;
  if (!id) return;
  const cards = filtered();
  const idx   = cards.findIndex(c => c.id === id);
  const el    = document.querySelectorAll('#cardGrid .ci')[idx];
  if (el) {
    el.classList.add('kb-focus');
    el.scrollIntoView({ block: 'nearest' });
  }
}

function navigateCard(dir) {
  const cards = filtered();
  if (!cards.length) return;
  const idx = focusedCardId ? cards.findIndex(c => c.id === focusedCardId) : -1;
  const next = Math.max(0, Math.min(cards.length - 1, idx + dir));
  setFocusedCard(cards[next].id);
}

// Click on card body sets keyboard focus
document.getElementById('cardGrid').addEventListener('click', e => {
  const ci = e.target.closest('.ci');
  if (ci) {
    // Find card id from delete button or grade buttons
    const delBtn = ci.querySelector('.ci-del');
    if (delBtn) {
      // Extract id from onclick attr
      const m = delBtn.getAttribute('onclick').match(/'([^']+)'/);
      if (m) setFocusedCard(m[1]);
    }
  }
});

// ── Lightbox ─────────────────────────────────────────────────────────────
function openLightbox(evt, id) {
  evt.stopPropagation(); // prevent ondblclick from firing
  const c = findCard(id);
  if (!c) return;
  const content = document.getElementById('lbContent');
  if (c.img) {
    content.innerHTML = `<img class="lb-img" src="${c.img}" alt="${c.name}"
      onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <div class="lb-ph" style="display:none">
        <div class="lb-ph-ico">🃏</div>
      </div>`;
  } else {
    content.innerHTML = `<div class="lb-ph"><div class="lb-ph-ico">🃏</div></div>`;
  }
  document.getElementById('lbName').textContent = c.name;
  document.getElementById('lightbox').classList.add('open');
}

function closeLightbox(evt) {
  if (evt && evt.target !== evt.currentTarget && !evt.target.classList.contains('lb-close')) return;
  document.getElementById('lightbox').classList.remove('open');
}

// ═══════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════
boot();