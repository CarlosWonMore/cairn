/**
 * 前端渲染器（design D7）。
 *
 * 同一份脚本服务两种形态：
 * - 工作台：数据来自 /api/*，可执行审批与同步；
 * - 静态导出：数据来自内联 <script type="application/json">，只读。
 *
 * 写成 TS 字符串常量而不是 .js 文件：tsc 不复制非 TS 资源，漏拷时构建不报错、
 * 运行时才表现为"按钮点了没反应"。编译进 dist 就不可能漏。
 *
 * 刻意不用框架：为一个 7 视图界面引入前端栈，会把安装体积与审计面一次抬上去，
 * 而这里需要的东西（DOM 构造、fetch、URL 状态）浏览器原生就有。
 */

import { URL_STATE_SRC } from './url-state.js';

export const UI_JS = String.raw`
(function () {
  'use strict';
` + URL_STATE_SRC + String.raw`

  var STATIC = document.body.getAttribute('data-static') === '1';
  var TOKEN = '';
  var m = /[?&]t=([0-9a-f]+)/.exec(location.search);
  if (m) {
    TOKEN = m[1];
    try { sessionStorage.setItem('cairn.token', TOKEN); } catch (e) {}
    // 只摘掉令牌参数本身。早先这里清的是整个 query，结果 view/drawer/q/scope
    // 一起被抹掉——分享出去的链接打开永远回到概览，抽屉也打不开。
    // 令牌进 sessionStorage 之后地址栏不需要它，剩下的状态必须原样留着。
    var keep = new URLSearchParams(location.search.slice(1));
    keep.delete('t');
    var rest = keep.toString();
    history.replaceState(null, '', location.pathname + (rest ? '?' + rest : ''));
  } else {
    try { TOKEN = sessionStorage.getItem('cairn.token') || ''; } catch (e) {}
  }

  var MODE_KEY = 'cairn.mode';
  var THEME_KEY = 'cairn.theme';
  var BRIEF_CHARS = 240;

  var state = {
    view: 'overview',
    q: '',
    scope: '',
    status: '',
    kind: '',
    mode: 'brief',
    batch: '',
    plan: '',
    drawer: '',
    item: '',
    reveal: {},
    itemsCache: {},
    plans: [],
    model: null,
    policies: [],
    policy: '',
    aiReviews: {},
    picks: {},
    annotationStatus: 'open',
    annotationDisposition: ''
  };

  // ---------------------------------------------------------------- 基础工具
  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function chip(text, kind) { return el('span', { 'class': 'chip ' + (kind || 'muted') }, text); }
  function card(k, v, kind) {
    var c = el('div', { 'class': 'card' + (kind ? ' ' + kind : '') });
    c.appendChild(el('div', { 'class': 'k' }, k));
    c.appendChild(el('div', { 'class': 'v' }, v));
    return c;
  }
  function short(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n) + '…' : s;
  }
  function fmtTime(s) { return s ? String(s).replace('T', ' ').replace(/\..*$/, '') : '—'; }
  function fmtBytes(n) {
    if (n == null) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }
  function pct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0; }

  var ACTION_LABEL = {
    promote: '晋升', merge: '合并', keep_both: '都保留', skip: '跳过', needs_human: '需人判断'
  };
  var ACTION_CHIP = {
    promote: 'ok', merge: 'pending', keep_both: 'info', skip: 'muted', needs_human: 'warn'
  };
  var STATUS_CHIP = {
    active: 'ok', candidate: 'pending', conflicted: 'danger', superseded: 'muted',
    archived: 'muted', tombstoned: 'danger'
  };
  var BATCH_CHIP = { awaiting_approval: 'warn', approved: 'pending', applied: 'ok', expired: 'muted', invalidated: 'danger', rejected: 'danger', draft: 'info' };
  var DISPOSITION_LABEL = {
    needs_edit: '需要修改', needs_merge: '需要合并', can_delete: '可以删除',
    uncertain: '存疑待查', no_action: '无需处理', pending_forget: '标记待删'
  };
  var DISPOSITION_CHIP = {
    needs_edit: 'warn', needs_merge: 'pending', can_delete: 'danger',
    uncertain: 'info', no_action: 'muted', pending_forget: 'danger'
  };
  var ANN_STATUS_LABEL = { open: '待处理', resolved: '已处置', ignored: '已忽略' };

  function toast(msg, isErr) {
    var t = el('div', { 'class': 'warnbar' }, msg);
    if (!isErr) { t.style.borderColor = 'var(--ok)'; t.style.color = 'var(--ok)'; }
    var s = document.getElementById('view');
    s.insertBefore(t, s.firstChild);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 7000);
  }

  // ---------------------------------------------------------------- 数据访问
  function api(path, opts) {
    opts = opts || {};
    var headers = { 'x-cairn-token': TOKEN };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    return fetch(path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: 'omit',
      cache: 'no-store'
    }).then(function (r) {
      return r.text().then(function (txt) {
        var j = null;
        try { j = JSON.parse(txt); } catch (e) { j = null; }
        if (!r.ok || !j || j.ok === false) {
          var msg = (j && j.error && j.error.message) || ('HTTP ' + r.status);
          var e2 = new Error(msg);
          e2.code = j && j.error && j.error.code;
          e2.status = r.status;
          e2.details = j && j.error && j.error.details;
          throw e2;
        }
        return j.data;
      });
    });
  }

  function qs(extra) {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.scope) p.set('scope', state.scope);
    if (state.status) p.set('status', state.status);
    if (state.kind) p.set('kind', state.kind);
    p.set('mode', state.mode);
    if (extra) Object.keys(extra).forEach(function (k) { if (extra[k]) p.set(k, extra[k]); });
    return p.toString();
  }

  function staticModel() {
    if (state.model == null) {
      var node = document.getElementById('cairn-model');
      state.model = node ? JSON.parse(node.textContent) : {
        generatedAt: '', home: '', schemaVersion: 0, mode: 'full', redacted: false,
        filter: {}, counts: {}, scopes: [], memories: [], archives: [], batches: [],
        plans: [], approvals: [], outbox: { byStatus: {}, pending: [] },
        sync: { configured: false, blockers: [] }, imports: { rows: [], groups: [] }, items: [], notes: []
      };
    }
    return state.model;
  }

  function localFilter(list, opts) {
    var out = list.slice();
    if (state.q) {
      var needle = state.q.toLowerCase();
      out = out.filter(function (x) {
        var t = (x.content && x.content.text) || '';
        return t.toLowerCase().indexOf(needle) >= 0;
      });
    }
    if (opts && opts.scope) out = out.filter(function (x) { return x.scopeId === opts.scope; });
    if (opts && opts.status) out = out.filter(function (x) { return x.status === opts.status; });
    if (opts && opts.kind) out = out.filter(function (x) { return x.kind === opts.kind; });
    return out;
  }

  // ---------------------------------------------------------------- URL 状态
  function readUrl() {
    var saved = null;
    try { saved = localStorage.getItem(MODE_KEY); } catch (e) {}
    var got = decodeState(location.search, saved);
    state.view = got.view;
    state.q = got.q || '';
    state.scope = got.scope || '';
    state.status = got.status || '';
    state.kind = got.kind || '';
    state.batch = got.batch || '';
    state.plan = got.plan || '';
    state.drawer = got.drawer || '';
    state.item = got.item || '';
    state.mode = got.mode;
  }

  function writeUrl(push) {
    // file:// 下改地址会抛异常，且静态页本来就该是一份可转发的快照：
    // 状态留在内存里，地址不动。
    if (STATIC) return;
    var q = encodeState(state);
    var url = location.pathname + (q ? '?' + q : '');
    if (push) history.pushState(null, '', url);
    else history.replaceState(null, '', url);
  }

  // ---------------------------------------------------------------- 视图骨架
  var VIEWS = [
    { id: 'overview', label: '概览' },
    { id: 'memories', label: '记忆' },
    { id: 'annotations', label: '批注' },
    { id: 'imports', label: '导入' },
    { id: 'approvals', label: '审批' },
    { id: 'sync', label: '同步' }
  ];

  function renderNav() {
    var nav = document.getElementById('nav');
    clear(nav);
    // 静态预览也要能切视图：浏览是只读动作，没有理由关掉它。
    // （写入口才受 STATIC 约束，见各视图里的 if (!STATIC)。）
    VIEWS.forEach(function (v, i) {
      var b = el('button', { type: 'button', 'aria-current': String(state.view === v.id), 'data-view': v.id, title: '快捷键 ' + (i + 1) }, (i + 1) + '  ' + v.label);
      b.addEventListener('click', function () { go(v.id, true); });
      nav.appendChild(b);
    });
  }

  function go(view, push) {
    // 切视图必须先把抽屉收掉：抽屉是盖在整页上的遮罩，留在原地会挡住导航，
    // 用户点哪儿都没反应（"确认生成计划后跳审批"就卡在这一步）。
    // 并且 state.drawer 属于原视图，跟着走会把旧参数写进新视图的地址。
    if (view !== state.view) {
      state.drawer = '';
      state.item = '';
      closeDrawer();
    }
    state.view = view;
    if (push) writeUrl(true);
    renderNav();
    render();
  }

  function render() {
    var host = document.getElementById('view');
    var banners = Array.prototype.slice.call(host.querySelectorAll ? host.children : []).filter(function (n) {
      return n.className && String(n.className).indexOf('warnbar') === 0;
    });
    var keep = banners.map(function (b) { return b.cloneNode(true); });
    clear(host);
    keep.forEach(function (b) { host.appendChild(b); });
    var body = el('div');
    host.appendChild(body);
    if (STATIC && state.view === 'overview') return renderOverview(body);
    if (state.view === 'overview') return renderOverview(body);
    if (state.view === 'memories') return renderMemories(body);
    if (state.view === 'annotations') return renderAnnotations(body);
    if (state.view === 'imports') return renderImports(body);
    if (state.view === 'approvals') return renderApprovals(body);
    if (state.view === 'sync') return renderSync(body);
    return renderOverview(body);
  }

  function loading(host) { host.appendChild(el('div', { 'class': 'empty' }, '加载中…')); }
  function fail(host, e) {
    var d = el('div', { 'class': 'warnbar' }, '加载失败：' + (e && e.message ? e.message : String(e)));
    if (e && e.code) d.textContent += '（' + e.code + '）';
    host.appendChild(d);
  }
  function empty(host, text) { host.appendChild(el('div', { 'class': 'empty' }, text)); }

  function toolbar(host, opts) {
    var bar = el('div', { 'class': 'toolbar' });
    var search = el('input', { type: 'search', placeholder: '检索内容（/）', value: state.q });
    search.addEventListener('change', function () { state.q = search.value; writeUrl(false); render(); });
    bar.appendChild(search);
    if (opts && opts.scopeSelect) {
      var sel = el('select', { 'class': 'action' });
      sel.style.cssText = 'background:var(--surface-2);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:7px 10px;';
      sel.appendChild(el('option', { value: '' }, '全部层级'));
      opts.scopes.forEach(function (s) {
        var o = el('option', { value: s.id }, s.preset + (s.counts && s.counts.total ? ' · ' + s.counts.total : ''));
        if (s.id === state.scope) o.setAttribute('selected', 'selected');
        sel.appendChild(o);
      });
      sel.addEventListener('change', function () { state.scope = sel.value; writeUrl(false); render(); });
      bar.appendChild(sel);
    }
    if (opts && opts.statusSelect) {
      var ss = el('select', { 'class': 'action' });
      ss.style.cssText = sel ? sel.style.cssText : '';
      ss.appendChild(el('option', { value: '' }, '全部状态'));
      (opts.statuses || []).forEach(function (v) {
        var o = el('option', { value: v }, v);
        if (v === state.status) o.setAttribute('selected', 'selected');
        ss.appendChild(o);
      });
      ss.addEventListener('change', function () { state.status = ss.value; writeUrl(false); render(); });
      bar.appendChild(ss);
    }
    var modeBtn = el('button', { type: 'button', 'class': 'action', 'data-action': 'mode', title: '切换摘要/全文（M）' }, state.mode === 'full' ? '显示摘要' : '显示全文');
    modeBtn.addEventListener('click', toggleMode);
    bar.appendChild(modeBtn);
    host.appendChild(bar);
  }

  function toggleMode() {
    state.mode = state.mode === 'full' ? 'brief' : 'full';
    try { localStorage.setItem(MODE_KEY, state.mode); } catch (e) {}
    writeUrl(false);
    render();
  }

  // ---------------------------------------------------------------- 概览
  function renderOverview(host) {
    function paint(model) {
      var counts = model.counts || {};
      var cards = el('div', { 'class': 'cards' });
      var pending = (counts.items && counts.items.remaining) || 0;
      cards.appendChild(card('记忆', (counts.memoriesTotal != null ? counts.memoriesTotal : 0), ''));
      cards.appendChild(card('待晋升条目', pending, pending > 0 ? 'warn' : 'ok'));
      cards.appendChild(card('快照档案', counts.archives || 0));
      cards.appendChild(card('批次', counts.batches || 0));
      cards.appendChild(card('待签批', counts.approvalsLive || 0, (counts.approvalsLive || 0) > 0 ? 'warn' : 'ok'));
      cards.appendChild(card('blocked', (counts.items && counts.items.blocked) || 0, ((counts.items && counts.items.blocked) || 0) > 0 ? 'pending' : 'ok'));
      host.appendChild(cards);

      if (model.notes && model.notes.length) {
        model.notes.forEach(function (n) { host.appendChild(el('div', { 'class': 'empty' }, n)); });
      }

      var layer = el('div');
      layer.appendChild(el('h2', { style: 'font-size:13px;letter-spacing:.06em;color:var(--text-dim);text-transform:uppercase;margin:0 0 8px' }, '作用域层级'));
      if (!model.scopes.length) {
        empty(layer, '还没有任何作用域层。新增第一条记忆后这里会出现 personal-global / device-local 等层级。');
      } else {
        var table = el('table');
        var head = el('tr');
        ['层级', '类型', '同步策略', '记忆数', '状态分布'].forEach(function (h) { head.appendChild(el('th', null, h)); });
        table.appendChild(head);
        model.scopes.forEach(function (s) {
          var tr = el('tr');
          tr.appendChild(el('td', null, s.preset));
          tr.appendChild(el('td', null, s.scopeKind));
          var td2 = el('td'); td2.appendChild(chip(s.syncPolicy, s.syncPolicy === 'local_only' ? 'muted' : 'info')); tr.appendChild(td2);
          tr.appendChild(el('td', null, s.counts.total));
          var td3 = el('td');
          Object.keys(s.counts.byStatus).forEach(function (st) {
            td3.appendChild(chip(st + ' ' + s.counts.byStatus[st], STATUS_CHIP[st] || 'muted'));
            td3.appendChild(document.createTextNode(' '));
          });
          tr.appendChild(td3);
          table.appendChild(tr);
        });
        layer.appendChild(table);
      }
      host.appendChild(layer);

      var sync = el('div', { style: 'margin-top:20px' });
      sync.appendChild(el('h2', { style: 'font-size:13px;letter-spacing:.06em;color:var(--text-dim);text-transform:uppercase;margin:0 0 8px' }, '同步'));
      var s = model.sync || {};
      if (!s.configured) empty(sync, '未配置云端：全部内容只在本地。需要时用 cairn vault init-remote 配置。');
      else {
        var line = el('div');
        line.appendChild(chip(s.provider, 'info'));
        line.appendChild(document.createTextNode(' 上次成功 ' + fmtTime(s.lastOkAt) + ' '));
        if (s.blockers && s.blockers.length) line.appendChild(chip(s.blockers.join('；'), 'warn'));
        sync.appendChild(line);
      }
      host.appendChild(sync);
    }

    if (STATIC) { paint(staticModel()); return; }
    loading(host);
    api('/api/status').then(function (data) {
      clear(host);
      paint({ counts: data.counts, scopes: [], notes: data.notes, sync: data.sync });
      return api('/api/scopes').then(function (scopes) { paintScopes(scopes); });
    }).catch(function (e) { clear(host); fail(host, e); });

    function paintScopes(scopes) {
      var old = host.querySelector('div[data-scopes]');
      if (old) old.parentNode.removeChild(old);
      var box = el('div', { 'data-scopes': '1' });
      box.appendChild(el('h2', { style: 'font-size:13px;letter-spacing:.06em;color:var(--text-dim);text-transform:uppercase;margin:0 0 8px' }, '作用域层级'));
      if (!scopes.length) { empty(box, '还没有任何作用域层。'); }
      else {
        var table = el('table');
        var head = el('tr');
        ['层级', '类型', '同步策略', '记忆数', '状态分布'].forEach(function (h) { head.appendChild(el('th', null, h)); });
        table.appendChild(head);
        scopes.forEach(function (s) {
          var tr = el('tr');
          tr.appendChild(el('td', null, s.preset));
          tr.appendChild(el('td', null, s.scopeKind));
          var td2 = el('td'); td2.appendChild(chip(s.syncPolicy, s.syncPolicy === 'local_only' ? 'muted' : 'info')); tr.appendChild(td2);
          tr.appendChild(el('td', null, s.counts.total));
          var td3 = el('td');
          Object.keys(s.counts.byStatus || {}).forEach(function (st) {
            td3.appendChild(chip(st + ' ' + s.counts.byStatus[st], STATUS_CHIP[st] || 'muted'));
            td3.appendChild(document.createTextNode(' '));
          });
          tr.appendChild(td3);
          table.appendChild(tr);
        });
        box.appendChild(table);
      }
      host.appendChild(box);
    }
  }

  // ---------------------------------------------------------------- 记忆
  function contentNode(c) {
    if (!c) return el('span', { 'class': 'empty' }, '—');
    if (c.masked) {
      var d = el('span', { 'class': 'mono' }, '••••••');
      d.appendChild(document.createTextNode(' (' + c.length + ' 字符, #' + c.hashPrefix + ')'));
      d.setAttribute('title', '已掩码：点击"揭示"可读原文');
      return d;
    }
    if (c.text == null) return el('span', { 'class': 'empty' }, '(正文因体积降级未包含，' + c.length + ' 字符)');
    var pre = el('pre', { style: 'margin:0;white-space:pre-wrap;word-break:break-word;font-size:12.5px' }, c.text);
    if (c.truncated) pre.appendChild(el('span', { 'class': 'empty' }, ' …(' + c.length + ' 字符)'));
    return pre;
  }

  function renderMemories(host) {
    if (STATIC) {
      var model = staticModel();
      toolbar(host, { scopes: model.scopes, scopeSelect: true, statuses: ['active', 'candidate', 'conflicted', 'archived', 'tombstoned'] });
      var list = localFilter(model.memories, { scope: state.scope, status: state.status });
      paintMemories(host, list, list.length);
      return;
    }
    loading(host);
    api('/api/memories?' + qs()).then(function (data) {
      clear(host);
      toolbar(host, { scopes: data.scopes, scopeSelect: true, statuses: ['active', 'candidate', 'conflicted', 'archived', 'tombstoned'] });
      paintMemories(host, data.memories, data.total);
    }).catch(function (e) { clear(host); fail(host, e); });
  }

  function paintMemories(host, list, total) {
    host.appendChild(el('div', { 'class': 'empty', style: 'padding:0 0 10px' }, '命中 ' + total + ' 条，已展示 ' + list.length + ' 条 · 模式 ' + state.mode));
    if (!STATIC) host.appendChild(annotationBar());
    if (!list.length) { empty(host, '没有匹配的记忆。'); return; }
    list.forEach(function (mem) {
      var box = el('div', { 'class': 'card', style: 'margin-bottom:10px' });
      var head = el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px' });
      if (!STATIC) {
        var pick = el('input', { type: 'checkbox', 'data-pick': mem.id, title: '选中以批量标记' });
        if (state.picks[mem.id]) pick.checked = true;
        pick.addEventListener('change', function () {
          if (pick.checked) state.picks[mem.id] = true;
          else delete state.picks[mem.id];
          refreshPickCount();
        });
        head.appendChild(pick);
      }
      head.appendChild(chip(mem.kind, 'info'));
      head.appendChild(chip(mem.status, STATUS_CHIP[mem.status] || 'muted'));
      head.appendChild(chip(mem.authority, mem.authority === 'imported_unverified' ? 'warn' : 'muted'));
      if (mem.sensitivity === 'sensitive') head.appendChild(chip('sensitive', 'danger'));
      if (mem.openConflicts > 0) head.appendChild(chip('冲突 ' + mem.openConflicts, 'danger'));
      head.appendChild(el('span', { 'class': 'mono', style: 'color:var(--text-dim);font-size:11.5px' }, mem.id.slice(0, 8)));
      head.appendChild(el('span', { 'class': 'empty', style: 'padding:0;font-size:11.5px' }, '修订 ' + mem.revisionCount + ' · 证据 ' + mem.evidenceCount + ' · ' + fmtTime(mem.updatedAt)));
      if (mem.content.masked) {
        var rev = el('button', { type: 'button', 'class': 'action' }, '揭示');
        rev.addEventListener('click', function () {
          state.reveal[mem.id] = true;
          if (STATIC) { toast('静态导出中无法揭示：掩码内容没有写进文件', true); return; }
          api('/api/memories/' + encodeURIComponent(mem.id) + '?mode=full&redact=0').then(function (d) {
            mem.content = d.memory.content;
            render();
          }).catch(function (e) { toast('揭示失败：' + e.message, true); });
        });
        head.appendChild(rev);
      }
      box.appendChild(head);
      box.appendChild(contentNode(mem.content));
      if (!STATIC) {
        var link = el('div', { style: 'margin-top:8px' });
        var b = el('button', { type: 'button', 'class': 'action' }, '详情 / 修订史');
        b.addEventListener('click', function () { state.plan = ''; openDetail(mem.id); });
        link.appendChild(b);
        box.appendChild(link);
      }
      host.appendChild(box);
    });
  }

  // ---------------------------------------------------------------- 批注
  function pickCount() { return Object.keys(state.picks).length; }
  function refreshPickCount() {
    var n = document.querySelector('[data-pick-count]');
    if (n) n.textContent = '已选 ' + pickCount() + ' 条';
  }

  /** 记忆列表上方的批量标记条：只写批注，不动记忆。 */
  function annotationBar() {
    var bar = el('div', { 'class': 'toolbar', 'data-batch-annotation': '1' });
    bar.appendChild(el('span', { 'class': 'empty', style: 'padding:0;font-size:12px', 'data-pick-count': '1' }, '已选 ' + pickCount() + ' 条'));
    var sel = el('select', { 'class': 'action', 'data-batch-disposition': '1' });
    sel.style.cssText = 'background:var(--surface-2);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:7px 10px;';
    sel.appendChild(el('option', { value: '' }, '选择处置类别…'));
    Object.keys(DISPOSITION_LABEL).forEach(function (k) {
      sel.appendChild(el('option', { value: k }, DISPOSITION_LABEL[k]));
    });
    bar.appendChild(sel);
    var note = el('input', { type: 'text', 'data-batch-note': '1', placeholder: '意见（可选，不能含秘密）' });
    bar.appendChild(note);
    var apply = el('button', { type: 'button', 'class': 'action primary', 'data-batch-apply': '1' }, '批量标记');
    apply.addEventListener('click', function () {
      var ids = Object.keys(state.picks);
      if (!ids.length) { toast('先勾选至少一条记忆', true); return; }
      if (!sel.value) { toast('先选择处置类别', true); return; }
      apply.disabled = true;
      api('/api/annotations', { method: 'POST', body: { memoryIds: ids, disposition: sel.value, note: note.value } })
        .then(function (r) {
          apply.disabled = false;
          toast('已标记 ' + r.succeeded + ' 条' + (r.failed.length ? '，失败 ' + r.failed.length + ' 条' : ''), r.failed.length > 0);
          state.picks = {};
          render();
        })
        .catch(function (e) { apply.disabled = false; toast('标记失败：' + e.message, true); });
    });
    bar.appendChild(apply);
    var clearBtn = el('button', { type: 'button', 'class': 'action' }, '清除选择');
    clearBtn.addEventListener('click', function () { state.picks = {}; render(); });
    bar.appendChild(clearBtn);
    return bar;
  }

  function annotationCard(a) {
    // 陈旧只灰显、不隐藏：意见仍是人的判断，只是可能已过时。
    var c = el('div', {
      'class': 'card', 'data-annotation-id': a.id, 'data-stale': a.stale ? '1' : '0',
      style: 'margin-bottom:8px' + (a.stale ? ';opacity:.55' : '')
    });
    var h = el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px' });
    h.appendChild(chip(DISPOSITION_LABEL[a.disposition] || a.disposition, DISPOSITION_CHIP[a.disposition] || 'muted'));
    h.appendChild(chip(ANN_STATUS_LABEL[a.status] || a.status, a.status === 'open' ? 'warn' : 'muted'));
    if (a.stale) h.appendChild(chip('意见可能已过时', 'warn'));
    if (a.memoryStatus === 'tombstoned') h.appendChild(chip('记忆已遗忘', 'muted'));
    h.appendChild(el('span', { 'class': 'mono', style: 'color:var(--text-dim);font-size:11.5px' }, String(a.memoryId).slice(0, 8)));
    if (a.memoryExcerpt) h.appendChild(el('span', { 'class': 'empty', style: 'padding:0;font-size:11.5px' }, short(a.memoryExcerpt, 46)));
    c.appendChild(h);
    if (a.note) c.appendChild(el('div', { style: 'white-space:pre-wrap;word-break:break-word;font-size:12.5px' }, a.note));
    c.appendChild(el('div', { 'class': 'empty', style: 'padding:4px 0 0;font-size:11.5px' },
      '标注于 ' + fmtTime(a.createdAt) + (a.resolvedAt ? ' · ' + (a.resolvedBy || '') + ' 于 ' + fmtTime(a.resolvedAt) : '')));
    if (a.disposition === 'pending_forget' && a.status === 'open') {
      c.appendChild(el('div', { 'class': 'warnbar', style: 'margin-top:8px' },
        '仍为活动状态，尚未删除。真正删除需要终端执行 cairn forget --pending（会先列出清单再逐条确认）。'));
    }
    return c;
  }

  function annotationForm(memoryId, onSaved) {
    var box = el('div', { 'class': 'card', style: 'margin-top:10px' });
    var sel = el('select', { 'class': 'action', 'data-annotation-disposition': '1' });
    sel.style.cssText = 'background:var(--surface-2);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:7px 10px;';
    sel.appendChild(el('option', { value: '' }, '选择处置类别…'));
    Object.keys(DISPOSITION_LABEL).forEach(function (k) {
      sel.appendChild(el('option', { value: k }, DISPOSITION_LABEL[k]));
    });
    box.appendChild(sel);
    var ta = el('textarea', { rows: '3', 'data-annotation-note': '1', placeholder: '这条记忆该怎么处理？（不能含秘密；批注不会修改记忆）' });
    ta.style.cssText = 'display:block;width:100%;margin-top:8px;box-sizing:border-box;background:var(--surface-2);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font:inherit;font-size:12.5px';
    box.appendChild(ta);
    var btn = el('button', { type: 'button', 'class': 'action primary', 'data-annotation-save': '1', style: 'margin-top:8px' }, '保存批注');
    btn.addEventListener('click', function () {
      if (!sel.value) { toast('先选择处置类别', true); return; }
      btn.disabled = true;
      api('/api/annotations', { method: 'POST', body: { memoryId: memoryId, disposition: sel.value, note: ta.value } })
        .then(function () {
          btn.disabled = false;
          ta.value = '';
          toast('批注已保存（记忆未改动）');
          if (onSaved) onSaved();
        })
        .catch(function (e) { btn.disabled = false; toast('保存失败：' + e.message, true); });
    });
    box.appendChild(btn);
    return box;
  }

  function loadAnnotationCards(memoryId, host) {
    api('/api/annotations?memory=' + encodeURIComponent(memoryId)).then(function (d) {
      clear(host);
      if (!d.items.length) { empty(host, '这条记忆还没有批注。'); return; }
      d.items.forEach(function (a) { host.appendChild(annotationCard(a)); });
    }).catch(function (e) { clear(host); fail(host, e); });
  }

  function renderAnnotations(host) {
    if (STATIC) {
      empty(host, '静态导出不含批注：批注是本机私有数据，不参与导出、也不参与云同步。');
      return;
    }
    var bar = el('div', { 'class': 'toolbar' });
    var st = el('select', { 'class': 'action', 'data-ann-status': '1' });
    st.style.cssText = 'background:var(--surface-2);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:7px 10px;';
    [['', '全部状态'], ['open', '待处理'], ['resolved', '已处置'], ['ignored', '已忽略']].forEach(function (v) {
      var o = el('option', { value: v[0] }, v[1]);
      if (v[0] === state.annotationStatus) o.setAttribute('selected', 'selected');
      st.appendChild(o);
    });
    bar.appendChild(st);
    var dp = el('select', { 'class': 'action', 'data-ann-disposition': '1' });
    dp.style.cssText = st.style.cssText;
    dp.appendChild(el('option', { value: '' }, '全部类别'));
    Object.keys(DISPOSITION_LABEL).forEach(function (k) {
      var o = el('option', { value: k }, DISPOSITION_LABEL[k]);
      if (k === state.annotationDisposition) o.setAttribute('selected', 'selected');
      dp.appendChild(o);
    });
    bar.appendChild(dp);
    var refresh = el('button', { type: 'button', 'class': 'action' }, '刷新');
    bar.appendChild(refresh);
    host.appendChild(bar);

    var listHost = el('div');
    host.appendChild(listHost);

    function load() {
      state.annotationStatus = st.value;
      state.annotationDisposition = dp.value;
      clear(listHost);
      loading(listHost);
      api('/api/annotations?status=' + encodeURIComponent(st.value) + '&disposition=' + encodeURIComponent(dp.value) + '&limit=500')
        .then(function (d) {
          clear(listHost);
          var staleN = d.items.filter(function (a) { return a.stale; }).length;
          listHost.appendChild(el('div', { 'class': 'empty', style: 'padding:0 0 10px' },
            '共 ' + d.total + ' 条' + (staleN ? ' · 陈旧 ' + staleN + ' 条（灰显）' : '') +
            ' · 批注只在本机，删除批注文件不影响任何记忆'));
          if (!d.items.length) { empty(listHost, '没有匹配的批注。'); return; }
          d.items.forEach(function (a) { listHost.appendChild(annotationCard(a)); });
        })
        .catch(function (e) { clear(listHost); fail(listHost, e); });
    }
    st.addEventListener('change', load);
    dp.addEventListener('change', load);
    refresh.addEventListener('click', load);
    load();
  }

  function openDetail(id) {
    var host = document.getElementById('view');
    api('/api/memories/' + encodeURIComponent(id) + '?mode=' + state.mode + '&redact=0').then(function (d) {
      clear(host);
      var back = el('button', { type: 'button', 'class': 'action' }, '← 返回列表');
      back.addEventListener('click', function () { render(); });
      host.appendChild(back);
      var box = el('div', { 'class': 'card', style: 'margin-top:12px' });
      box.appendChild(el('div', { 'class': 'mono', style: 'color:var(--text-dim);font-size:11.5px;margin-bottom:8px' }, d.memory.id));
      box.appendChild(contentNode(d.memory.content));
      host.appendChild(box);

      var meta = el('table', { style: 'margin-top:16px' });
      [['kind', d.memory.kind], ['status', d.memory.status], ['authority', d.memory.authority],
       ['sensitivity', d.memory.sensitivity], ['scope', d.scope ? d.scope.preset + ' / ' + d.scope.syncPolicy : '—'],
       ['createdAt', fmtTime(d.memory.createdAt)], ['updatedAt', fmtTime(d.memory.updatedAt)],
       ['contentHash', d.memory.contentHash]].forEach(function (pair) {
        var tr = el('tr');
        tr.appendChild(el('th', null, pair[0]));
        tr.appendChild(el('td', { 'class': 'mono' }, pair[1]));
        meta.appendChild(tr);
      });
      host.appendChild(meta);

      if (!STATIC) {
        host.appendChild(el('h2', { style: 'font-size:13px;color:var(--text-dim);margin:18px 0 8px' }, '写下意见（不修改记忆）'));
        var annHost = el('div', { 'data-memory-annotations': '1' });
        host.appendChild(annotationForm(d.memory.id, function () { loadAnnotationCards(d.memory.id, annHost); }));
        host.appendChild(annHost);
        loadAnnotationCards(d.memory.id, annHost);
      }

      host.appendChild(el('h2', { style: 'font-size:13px;color:var(--text-dim);margin:18px 0 8px' }, '修订史（' + d.revisions.length + '）'));
      d.revisions.forEach(function (r) {
        var rv = el('div', { 'class': 'card', style: 'margin-bottom:8px' });
        var h = el('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:6px' });
        h.appendChild(chip('seq ' + r.seq, 'info'));
        h.appendChild(el('span', { 'class': 'empty', style: 'padding:0;font-size:11.5px' }, r.author + ' · ' + fmtTime(r.createdAt) + (r.reason ? ' · ' + r.reason : '')));
        rv.appendChild(h);
        rv.appendChild(contentNode(r.content));
        host.appendChild(rv);
      });

      if (d.tombstone) {
        host.appendChild(el('div', { 'class': 'warnbar', style: 'margin-top:14px' },
          '已遗忘：' + (d.tombstone.reason || '(无理由)') + ' · ' + d.tombstone.forgottenBy + ' · ' + fmtTime(d.tombstone.forgottenAt)));
      }
      if (d.evidence.length) {
        host.appendChild(el('h2', { style: 'font-size:13px;color:var(--text-dim);margin:18px 0 8px' }, '证据（' + d.evidence.length + '）'));
        var et = el('table');
        d.evidence.forEach(function (e) {
          var tr = el('tr');
          tr.appendChild(el('td', null, e.evidenceKind));
          tr.appendChild(el('td', null, e.trustLevel));
          tr.appendChild(el('td', { 'class': 'mono' }, e.locator || '—'));
          tr.appendChild(el('td', null, fmtTime(e.createdAt)));
          et.appendChild(tr);
        });
        host.appendChild(et);
      }
      if (d.conflicts.length) {
        host.appendChild(el('h2', { style: 'font-size:13px;color:var(--text-dim);margin:18px 0 8px' }, '冲突（' + d.conflicts.length + '）'));
        d.conflicts.forEach(function (c) {
          host.appendChild(el('div', { 'class': 'empty' }, c.status + ' · 检测于 ' + fmtTime(c.detectedAt)));
        });
      }
    }).catch(function (e) { toast('读取详情失败：' + e.message, true); });
  }

  // ---------------------------------------------------------------- 导入工作台
  // 一条来源的一次导入 = 一行。同源重复导入折叠进 details 而不是合并成一行：
  // 合并会把"这次又导进来 40 条"这个数字抹掉，而用户常常正是要看它。
  // 决策收在抽屉里——列表只回答"我还有多少东西没处理"，不回答"该怎么办"。
  function renderImports(host) {
    var data = null;

    function paint() {
      clear(host);
      var rows = data.rows || [];
      var groups = data.groups || [];
      var agg = { total: 0, clean: 0, blocked: 0, promoted: 0, skipped: 0, remaining: 0 };
      rows.forEach(function (r) {
        agg.total += r.items.total;
        agg.clean += r.items.clean;
        agg.blocked += r.items.blocked;
        agg.promoted += r.items.promoted;
        agg.skipped += r.items.skipped;
        agg.remaining += r.items.remaining;
      });

      var cards = el('div', { 'class': 'cards' });
      cards.appendChild(card('来源', groups.length));
      cards.appendChild(card('导入次数', rows.length));
      cards.appendChild(card('待处理条目', agg.remaining, agg.remaining > 0 ? 'warn' : 'ok'));
      cards.appendChild(card('已晋升', agg.promoted));
      cards.appendChild(card('已跳过', agg.skipped));
      cards.appendChild(card('blocked', agg.blocked, agg.blocked > 0 ? 'pending' : 'ok'));
      host.appendChild(cards);

      if (!STATIC) host.appendChild(autoBar());
      else host.appendChild(el('div', { 'class': 'empty', style: 'padding:0 0 12px' },
        '静态导出是只读快照：看得到每次导入的条目与状态，但自动整理与撤销要在 cairn ui 工作台里做。'));
      if (!rows.length) {
        empty(host, '还没有导入任何内容。用 cairn import 导入记忆文件后，这里会出现一行一条来源。');
        return;
      }

      var table = el('table');
      var head = el('tr');
      ['来源', '最近导入', '条目', 'clean', 'blocked', '已晋升', '已跳过', '剩余', '自动整理', ''].forEach(function (h) {
        head.appendChild(el('th', null, h));
      });
      table.appendChild(head);

      var byId = {};
      rows.forEach(function (r) { byId[r.id] = r; });
      groups.forEach(function (g) {
        var latest = byId[g.rowIds[0]];
        if (!latest) return;
        table.appendChild(rowTr(latest, g));
        if (g.rowIds.length > 1) {
          var histTr = el('tr');
          var td = el('td', { colspan: '10', style: 'padding:0 10px 8px' });
          var det = el('details');
          det.appendChild(el('summary', { style: 'cursor:pointer;font-size:12px;color:var(--text-dim)' },
            '历史导入 ' + (g.rowIds.length - 1) + ' 次（同源，默认折叠）'));
          var ht = el('table', { style: 'margin-top:6px' });
          g.rowIds.slice(1).forEach(function (id) {
            var r = byId[id];
            if (!r) return;
            var tr = el('tr', { style: 'cursor:pointer' });
            tr.appendChild(el('td', null, short(r.sourceLabel || r.id.slice(0, 8), 40)));
            tr.appendChild(el('td', null, fmtTime(r.importedAt)));
            tr.appendChild(el('td', null, r.items.total));
            tr.appendChild(el('td', null, r.items.clean));
            var tb = el('td'); tb.appendChild(chip(r.items.blocked, r.items.blocked > 0 ? 'warn' : 'muted')); tr.appendChild(tb);
            tr.appendChild(el('td', null, r.items.promoted));
            tr.appendChild(el('td', null, r.items.skipped));
            var trem = el('td'); trem.appendChild(chip(r.items.remaining, r.items.remaining > 0 ? 'warn' : 'ok')); tr.appendChild(trem);
            tr.appendChild(el('td', { colspan: '3' }, ''));
            tr.addEventListener('click', function () { openRow(r); });
            ht.appendChild(tr);
          });
          det.appendChild(ht);
          td.appendChild(det);
          histTr.appendChild(td);
          table.appendChild(histTr);
        }
      });
      host.appendChild(table);

      // 地址里带 drawer 时还原抽屉：刷新与分享必须回到同一屏。
      if (state.drawer) {
        var target = byId[state.drawer];
        if (target) openRow(target);
      }
    }

    function rowTr(r, g) {
      var tr = el('tr', { style: 'cursor:pointer' });
      var td0 = el('td');
      td0.appendChild(el('span', null, short(r.sourceLabel || r.id.slice(0, 8), 40)));
      if (g.importCount > 1) {
        td0.appendChild(document.createTextNode(' '));
        td0.appendChild(chip('共 ' + g.importCount + ' 次', 'info'));
      }
      if (r.isLatestOfSource === false) td0.appendChild(chip('历史', 'muted'));
      tr.appendChild(td0);
      tr.appendChild(el('td', null, fmtTime(r.importedAt || r.discoveredAt)));
      tr.appendChild(el('td', null, r.items.total));
      tr.appendChild(el('td', null, r.items.clean));
      var tb = el('td'); tb.appendChild(chip(r.items.blocked, r.items.blocked > 0 ? 'warn' : 'muted')); tr.appendChild(tb);
      tr.appendChild(el('td', null, r.items.promoted));
      tr.appendChild(el('td', null, r.items.skipped));
      var trem = el('td'); trem.appendChild(chip(r.items.remaining, r.items.remaining > 0 ? 'warn' : 'ok')); tr.appendChild(trem);

      var ta = el('td');
      var run = r.autoRun;
      if (!run) {
        ta.appendChild(el('span', { 'class': 'empty', style: 'padding:0;font-size:12px' }, '未整理'));
      } else if (run.revokedAt) {
        ta.appendChild(chip('已撤销 ' + (run.revokedCount == null ? '' : run.revokedCount), 'muted'));
      } else {
        ta.appendChild(chip('策略 ' + short(run.policyId, 14) + ' · 写入 ' + run.applied, 'ok'));
        if (run.manual > 0) ta.appendChild(document.createTextNode(' '));
        if (run.liveMemories === 0 && run.applied > 0) {
          ta.appendChild(chip('产物已清空', 'warn'));
        }
      }
      tr.appendChild(ta);

      var tact = el('td');
      var open = el('button', { type: 'button', 'class': 'action' }, '查看');
      open.addEventListener('click', function (ev) { ev.stopPropagation(); openRow(r); });
      tact.appendChild(open);
      if (!STATIC && r.autoRun && !r.autoRun.revokedAt && r.autoRun.applied > 0) {
        var rv = el('button', { type: 'button', 'class': 'action', style: 'margin-left:6px' }, '按策略撤销');
        rv.addEventListener('click', function (ev) {
          ev.stopPropagation();
          revokeRun(r);
        });
        tact.appendChild(rv);
      }
      tr.appendChild(tact);

      tr.addEventListener('click', function () { openRow(r); });
      return tr;
    }

    /** 顶部自动整理入口：只让你选一把**已经签好**的钥匙，页面不能自己配钥匙。 */
    function autoBar() {
      var bar = el('div', { 'class': 'toolbar' });
      var sel = el('select', { 'class': 'action' });
      sel.style.cssText = 'background:var(--surface-2);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:7px 10px;';
      sel.appendChild(el('option', { value: '' }, '选择已签发的策略…'));
      (state.policies || []).forEach(function (p) {
        if (p.revoked) return;
        var o = el('option', { value: p.id }, p.id + ' · ' + p.policyHashPrefix + (p.note ? ' · ' + p.note : ''));
        sel.appendChild(o);
      });
      // 预演之后会重绘整块，若不记住选择就会跳回"请选择"——用户接着点真跑
      // 只会得到"先选一个策略"，看起来像按钮坏了。
      if (state.policy) sel.value = state.policy;
      sel.addEventListener('change', function () { state.policy = sel.value; });
      bar.appendChild(sel);

      var dry = el('input', { type: 'checkbox' });
      var dryLabel = el('label', { style: 'display:flex;gap:6px;align-items:center;font-size:12.5px;color:var(--text-dim)' });
      dryLabel.appendChild(dry);
      dryLabel.appendChild(document.createTextNode('只预演（不写库）'));
      bar.appendChild(dryLabel);

      var goBtn = el('button', { type: 'button', 'class': 'action primary' }, '自动整理');
      goBtn.addEventListener('click', function () {
        if (!sel.value) { toast('先选一个策略；没有策略就用 cairn policy sign 签发', true); return; }
        goBtn.disabled = true;
        var isDry = dry.checked;
        api('/api/onboarding/auto', { method: 'POST', body: { policyId: sel.value, dryRun: isDry } })
          .then(function (s) {
            goBtn.disabled = false;
            var msg = (isDry ? '预演：' : '已应用：') + '自动 ' + s.auto + ' / 需人 ' + s.manual +
              '，应用 ' + s.applied + '，跳过 ' + s.skipped + '，失败 ' + s.failed;
            if (s.manualByCondition) {
              var parts = [];
              Object.keys(s.manualByCondition).forEach(function (k) { parts.push(k + ' ' + s.manualByCondition[k]); });
              if (parts.length) msg += '（' + parts.join('，') + '）';
            }
            toast(msg, s.failed > 0);
            load();
          })
          .catch(function (e) { goBtn.disabled = false; toast('自动整理失败：' + e.message, true); });
      });
      bar.appendChild(goBtn);

      var onlyHuman = el('button', { type: 'button', 'class': 'action' }, '刷新');
      onlyHuman.addEventListener('click', load);
      bar.appendChild(onlyHuman);
      return bar;
    }

    function revokeRun(r) {
      var run = r.autoRun;
      if (!run) return;
      if (!window.confirm('按策略 ' + run.policyId + ' 撤销这批自动整理结果？\n记忆不会真的消失：转成墓碑，来源与理由都留在审计里。')) return;
      api('/api/onboarding/revoke', { method: 'POST', body: { policyId: run.policyId, batchId: r.batchId } })
        .then(function (o) { toast('已撤销 ' + o.tombstoned + ' 条'); load(); })
        .catch(function (e) { toast('撤销失败：' + e.message, true); });
    }

    // ------------------------------------------------------------ 抽屉
    function openRow(r) {
      state.drawer = r.id;
      state.item = '';
      writeUrl(false);
      var body = el('div');
      var title = short(r.sourceLabel || r.id.slice(0, 12), 56);
      openDrawer(title, body, function () { state.drawer = ''; state.item = ''; writeUrl(false); });

      var meta = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px' });
      meta.appendChild(chip(r.sourceKind, 'info'));
      meta.appendChild(chip(r.parser, 'muted'));
      meta.appendChild(chip(r.redactionState.replace('scanned_', ''), r.redactionState === 'scanned_blocked' ? 'warn' : 'ok'));
      meta.appendChild(chip(fmtBytes(r.byteSize), 'muted'));
      meta.appendChild(chip('导入 ' + fmtTime(r.importedAt), 'muted'));
      if (r.importCount > 1) meta.appendChild(chip('同源 ' + r.importCount + ' 次导入', 'pending'));
      body.appendChild(meta);

      var counts = el('div', { 'class': 'cards' });
      counts.appendChild(card('条目', r.items.total));
      counts.appendChild(card('clean', r.items.clean));
      counts.appendChild(card('blocked', r.items.blocked, r.items.blocked > 0 ? 'warn' : 'ok'));
      counts.appendChild(card('已晋升', r.items.promoted));
      counts.appendChild(card('已跳过', r.items.skipped));
      counts.appendChild(card('剩余', r.items.remaining, r.items.remaining > 0 ? 'warn' : 'ok'));
      body.appendChild(counts);

      if (r.autoRun) {
        var run = r.autoRun;
        var box = el('div', { 'class': 'card', style: 'margin-bottom:12px' });
        var h = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' });
        h.appendChild(chip(run.revokedAt ? '已撤销' : '已自动整理', run.revokedAt ? 'muted' : 'ok'));
        h.appendChild(el('span', { 'class': 'mono', style: 'font-size:11.5px' }, run.policyId + ' · ' + (run.policyHashPrefix || '')));
        box.appendChild(h);
        box.appendChild(el('div', { 'class': 'empty', style: 'padding:6px 0 0;font-size:12.5px' },
          fmtTime(run.at) + ' 应用 ' + run.applied + ' · 跳过 ' + run.skipped + ' · 失败 ' + run.failed +
          ' · 现存记忆 ' + run.liveMemories + (run.revokedAt ? ' · 撤销于 ' + fmtTime(run.revokedAt) : '')));
        body.appendChild(box);
      }

      var acts = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px' });
      var bulk = el('button', { type: 'button', 'class': 'action primary' }, '按建议全部处理');
      bulk.addEventListener('click', function () { bulkHandle(r, body); });
      if (!STATIC && r.batchId && r.items.remaining > 0) acts.appendChild(bulk);
      var itemsBtn = el('button', { type: 'button', 'class': 'action' }, '看全部条目（' + r.items.total + '）');
      itemsBtn.addEventListener('click', function () { loadItems(r, body); });
      acts.appendChild(itemsBtn);
      body.appendChild(acts);

      var itemsHost = el('div');
      body.appendChild(itemsHost);
      loadItems(r, itemsHost);
    }

    function loadItems(r, box) {
      clear(box);
      box.appendChild(el('div', { 'class': 'empty' }, '加载中…'));
      if (STATIC) {
        var all = (staticModel().items || []).filter(function (i) { return i.archiveId === r.id; });
        paintItems(box, r, all, all.length);
        return;
      }
      api('/api/archives/' + encodeURIComponent(r.id) + '/items?mode=' + state.mode + '&limit=500')
        .then(function (d) { clear(box); paintItems(box, r, d.items, d.total); })
        .catch(function (e) { clear(box); fail(box, e); });
    }

    function paintItems(box, r, items, total) {
      box.appendChild(el('h2', { style: 'font-size:12.5px;color:var(--text-dim);letter-spacing:.06em;text-transform:uppercase;margin:12px 0 8px' },
        '条目 · 显示 ' + items.length + ' / 共 ' + total));
      if (!items.length) { empty(box, '该档案没有条目。'); return; }
      items.forEach(function (it) {
        var c = el('div', { 'class': 'card', style: 'margin-bottom:8px' + (it.id === state.item ? ';border-color:var(--layer)' : '') });
        var h = el('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap' });
        h.appendChild(chip('#' + (it.itemIndex + 1), 'muted'));
        h.appendChild(chip(it.scanState, it.scanState === 'blocked' ? 'warn' : 'ok'));
        if (it.contentAvailable === false) h.appendChild(chip('原文未入库', 'danger'));
        h.appendChild(el('span', { 'class': 'mono', style: 'color:var(--text-dim);font-size:11px' }, it.contentHash.slice(0, 12)));
        c.appendChild(h);
        c.appendChild(contentNode(it.content));
        box.appendChild(c);
      });
    }

    /**
     * 抽屉内批量处理（任务 4.5）：先摊开"会发生什么"，再让人按确认。
     * 不预选、不默认执行——这里只是把逐条点击省掉，判断仍然在规则层。
     */
    function bulkHandle(r, body) {
      if (!r.batchId) { toast('该导入还没有批次号，先 cairn import 分批', true); return; }
      var box = el('div', { 'class': 'card', style: 'margin-bottom:12px;border-color:var(--layer)' });
      body.insertBefore(box, body.firstChild.nextSibling);
      clear(box);
      box.appendChild(el('div', { 'class': 'empty' }, '正在读取批次建议…'));
      api('/api/batches/' + encodeURIComponent(r.batchId)).then(function (d) {
        clear(box);
        var sug = (d.suggestions && d.suggestions.items) || [];
        var usable = sug.filter(function (s) { return s.action !== 'needs_human'; });
        var human = sug.filter(function (s) { return s.action === 'needs_human'; });
        var dist = {};
        usable.forEach(function (s) { dist[s.action] = (dist[s.action] || 0) + 1; });

        var h = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:6px' });
        h.appendChild(el('span', { style: 'font-weight:600' }, '按建议全部处理'));
        h.appendChild(el('span', { 'class': 'empty', style: 'padding:0;font-size:12px' }, '批次 ' + d.batchId.slice(0, 8) + ' · 建议 ' + sug.length + ' 条'));
        box.appendChild(h);

        var line = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px' });
        Object.keys(dist).forEach(function (a) {
          line.appendChild(chip(ACTION_LABEL[a] + ' ' + dist[a], ACTION_CHIP[a]));
        });
        if (human.length) line.appendChild(chip('需人判断 ' + human.length + '（不纳入）', 'warn'));
        box.appendChild(line);

        if (human.length) {
          var det = el('details');
          det.appendChild(el('summary', { style: 'cursor:pointer;font-size:12px' }, '这 ' + human.length + ' 条为什么没纳入'));
          human.forEach(function (s) {
            det.appendChild(el('div', { 'class': 'empty', style: 'padding:4px 0;font-size:12px' },
              short(s.itemId.slice(0, 8), 8) + ' · ' + (s.reason || '规则层未给出建议')));
          });
          box.appendChild(det);
        }

        var foot = el('div', { style: 'display:flex;gap:8px;margin-top:8px;flex-wrap:wrap' });
        var ok = el('button', { type: 'button', 'class': 'action primary' }, '确认生成计划（' + usable.length + ' 项）');
        ok.disabled = usable.length === 0;
        ok.addEventListener('click', function () {
          ok.disabled = true;
          var items = usable.map(function (s) {
            return {
              itemId: s.itemId,
              opType: s.action,
              targetMemoryId: s.action === 'merge' ? s.targetMemoryId : null,
              targetExpectedRevision: null,
              content: null,
              reason: 'webui 批量采纳：' + s.ruleId
            };
          });
          api('/api/plans', { method: 'POST', body: { batchId: r.batchId, items: items } }).then(function (o) {
            toast('已创建计划 ' + o.plan.id.slice(0, 8) + '（接受 ' + o.accepted + '，拒绝 ' + o.rejected.length + '）');
            go('approvals', true);
          }).catch(function (e) { ok.disabled = false; toast('生成计划失败：' + e.message, true); });
        });
        foot.appendChild(ok);
        var cancel = el('button', { type: 'button', 'class': 'action' }, '取消');
        cancel.addEventListener('click', function () { if (box.parentNode) box.parentNode.removeChild(box); });
        foot.appendChild(cancel);
        box.appendChild(foot);
      }).catch(function (e) { clear(box); fail(box, e); });
    }

    function load() {
      if (STATIC) { data = staticModel().imports || { rows: [], groups: [] }; paint(); return; }
      loading(host);
      api('/api/imports').then(function (d) {
        data = d;
        return api('/api/policies').then(function (pols) { state.policies = pols; });
      }).then(function () { paint(); }).catch(function (e) { clear(host); fail(host, e); });
    }

    load();
  }

  /**
   * 右侧覆盖面板（任务 4.3）。三个关闭入口共用同一段逻辑，避免"Esc 关了但焦点没还"。
   * 焦点归还到打开前的元素：抽屉是从某一行点开的，关掉之后键盘用户必须回到那一行。
   */
  var drawerCloser = null;
  function closeDrawer() {
    if (drawerCloser) drawerCloser();
  }
  function openDrawer(title, body, onClose) {
    closeDrawer();
    var prev = document.activeElement;
    var mask = el('div', { 'class': 'drawer-mask' });
    var panel = el('aside', { 'class': 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    var head = el('div', { 'class': 'drawer-head' });
    head.appendChild(el('span', { style: 'font-weight:600' }, title));
    var x = el('button', { type: 'button', 'class': 'action close' }, '关闭');
    head.appendChild(x);
    var scroller = el('div', { 'class': 'drawer-body' });
    scroller.appendChild(body);
    panel.appendChild(head);
    panel.appendChild(scroller);
    mask.appendChild(panel);
    document.body.appendChild(mask);

    function onKey(ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); close(); }
    }
    function close() {
      document.removeEventListener('keydown', onKey);
      if (mask.parentNode) mask.parentNode.removeChild(mask);
      drawerCloser = null;
      if (onClose) onClose();
      if (prev && prev.focus) { try { prev.focus(); } catch (e) {} }
    }
    drawerCloser = close;
    x.addEventListener('click', close);
    mask.addEventListener('click', function (ev) { if (ev.target === mask) close(); });
    document.addEventListener('keydown', onKey);
    x.focus();
    return close;
  }

  // ---------------------------------------------------------------- 审批
  function renderApprovals(host) {
    function paint(plans) {
      state.plans = plans;
      if (!plans.length) { empty(host, '还没有治理计划。在"待处理"里采纳若干建议即可生成。'); return; }
      plans.forEach(function (p) {
        var box = el('div', { 'class': 'card', style: 'margin-bottom:12px' });
        var head = el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px' });
        head.appendChild(chip(p.status, BATCH_CHIP[p.status] || 'muted'));
        head.appendChild(el('span', { style: 'font-weight:600' }, '计划 ' + p.planHashPrefix));
        head.appendChild(el('span', { 'class': 'empty', style: 'padding:0;font-size:11.5px' },
          p.itemCount + ' 项 · add ' + p.ops.add + ' / merge ' + p.ops.merge + ' / keep_both ' + p.ops.keepBoth + ' / skip ' + p.ops.skip + ' · ' + fmtTime(p.createdAt)));
        box.appendChild(head);

        (p.approvals || []).forEach(function (a) {
          var line = el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px' });
          line.appendChild(chip(a.live ? '审批有效' : (a.revokedAt ? '已撤销' : '已失效'), a.live ? 'ok' : 'muted'));
          line.appendChild(el('span', { 'class': 'mono', style: 'font-size:11.5px' }, a.id.slice(0, 16)));
          line.appendChild(el('span', { 'class': 'empty', style: 'padding:0;font-size:11.5px' }, '通道 ' + a.channel + ' · 到期 ' + fmtTime(a.expiresAt) + ' · 已用 ' + a.uses + '/' + a.maxUses));
          box.appendChild(line);
        });

        if (!STATIC) {
          var acts = el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px' });
          if (p.status === 'awaiting_approval') {
            var hint = el('span', { 'class': 'empty', style: 'padding:0;font-size:12px' }, '签发审批需要重抄哈希前 8 位：');
            acts.appendChild(hint);
            var inp = el('input', { type: 'text', placeholder: p.planHashPrefix, style: 'min-width:120px' });
            acts.appendChild(inp);
            var b = el('button', { type: 'button', 'class': 'action primary' }, '签发一次性审批');
            b.addEventListener('click', function () {
              if (inp.value.trim().toLowerCase() !== p.planHashPrefix.toLowerCase()) {
                toast('哈希前缀不匹配，请核对后再签', true);
                return;
              }
              api('/api/plans/' + encodeURIComponent(p.id) + '/approve', { method: 'POST', body: { planHashPrefix: inp.value.trim() } })
                .then(function (r) { toast('已签发，审批 ' + r.approvalId.slice(0, 16) + '，30 分钟内有效'); render(); })
                .catch(function (e) { toast('签发失败：' + e.message, true); });
            });
            acts.appendChild(b);
          }
          (p.approvals || []).filter(function (a) { return a.live; }).forEach(function (a) {
            var b2 = el('button', { type: 'button', 'class': 'action' }, '应用计划');
            b2.addEventListener('click', function () {
              api('/api/plans/' + encodeURIComponent(p.id) + '/apply', { method: 'POST', body: { approvalId: a.id } })
                .then(function (r) { toast('已应用：' + (r.report && r.report.results ? r.report.results.length : 0) + ' 个操作'); render(); })
                .catch(function (e) { toast('应用失败：' + e.message, true); });
            });
            acts.appendChild(b2);
          });
          box.appendChild(acts);
        }
        host.appendChild(box);
      });
    }

    if (STATIC) { paint(staticModel().plans); return; }
    loading(host);
    api('/api/plans').then(function (d) { clear(host); paint(d.plans); }).catch(function (e) { clear(host); fail(host, e); });
  }

  // ---------------------------------------------------------------- 同步
  function renderSync(host) {
    function paint(s) {
      var box = el('div', { 'class': 'card' });
      var rows = [
        ['已配置', s.configured ? '是' : '否'],
        ['provider', s.provider || '—'],
        ['vaultId', s.vaultId || '—'],
        ['密钥存在', s.keysPresent ? '是' : '否'],
        ['上次成功', fmtTime(s.lastOkAt)]
      ];
      var t = el('table');
      rows.forEach(function (r) {
        var tr = el('tr');
        tr.appendChild(el('th', { style: 'width:140px' }, r[0]));
        tr.appendChild(el('td', { 'class': 'mono' }, r[1]));
        t.appendChild(tr);
      });
      box.appendChild(t);
      if (s.blockers && s.blockers.length) {
        box.appendChild(el('div', { 'class': 'warnbar', style: 'margin-top:12px' }, '当前不可同步：' + s.blockers.join('；')));
      }
      host.appendChild(box);

      if (!STATIC) {
        var acts = el('div', { 'class': 'toolbar', style: 'margin-top:14px' });
        var disabled = !s.configured || (s.blockers && s.blockers.length > 0);
        ['push', 'pull'].forEach(function (dir) {
          var b = el('button', { type: 'button', 'class': 'action' }, dir === 'push' ? '上行 push' : '下行 pull');
          if (disabled) { b.setAttribute('disabled', 'disabled'); b.title = s.configured ? '缺少环境变量或密钥' : '未配置云端'; }
          b.addEventListener('click', function () {
            if (disabled) { toast('当前不可同步：' + (s.blockers || []).join('；'), true); return; }
            b.setAttribute('disabled', 'disabled');
            api('/api/sync/' + dir, { method: 'POST', body: {} })
              .then(function () { toast(dir + ' 完成'); render(); })
              .catch(function (e) { toast(dir + ' 失败：' + e.message, true); render(); });
          });
          acts.appendChild(b);
        });
        host.appendChild(acts);
      } else {
        empty(host, '静态导出不含同步能力。');
      }
    }
    if (STATIC) { paint(staticModel().sync); return; }
    loading(host);
    api('/api/sync/status').then(function (s) { clear(host); paint(s); }).catch(function (e) { clear(host); fail(host, e); });
  }

  // ---------------------------------------------------------------- 键盘与主题
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
  }

  function toggleTheme() {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  }

  document.addEventListener('keydown', function (ev) {
    var tag = (ev.target && ev.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      if (ev.key === 'Escape') ev.target.blur();
      return;
    }
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key >= '1' && ev.key <= '7') {
      var v = VIEWS[Number(ev.key) - 1];
      if (v) { ev.preventDefault(); go(v.id, true); }
      return;
    }
    if (ev.key === '/') {
      ev.preventDefault();
      var s = document.querySelector('input[type="search"]');
      if (s) s.focus();
      return;
    }
    if (ev.key === 'p' || ev.key === 'P') { ev.preventDefault(); go('imports', true); return; }
    if (ev.key === 't' || ev.key === 'T') { ev.preventDefault(); toggleTheme(); return; }
    if (ev.key === 'm' || ev.key === 'M') { ev.preventDefault(); toggleMode(); return; }
    if (ev.key === '?') { ev.preventDefault(); toast('快捷键：1-6 切视图 · / 检索 · P 导入 · M 摘要/全文 · T 主题 · Esc 关闭抽屉', false); }
  });

  window.addEventListener('popstate', function () { readUrl(); renderNav(); render(); });

  // ---------------------------------------------------------------- 启动
  var savedTheme = null;
  try { savedTheme = localStorage.getItem(THEME_KEY); } catch (e) {}
  if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
  readUrl();
  renderNav();
  render();
  document.documentElement.setAttribute('data-token-ready', '1');
})();
`;
