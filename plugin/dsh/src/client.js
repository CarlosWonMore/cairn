// Cairn 记忆调用面板（DSH Client 插件）。
//
// 注册为会话内的**独立 tab**（conversation.view，与「轨迹」同款机制）。
// list slot 契约：必须有 id（缺了抛 requires options.id）。
// 注意：slots.inject 的回调在之后的全局 reconcile tick 里才被调（apply 早已
// 返回），try/catch 必须放进回调本体。
// 三态用**文字**标明，不只靠颜色；活动记录只含摘要，正文/参数永不进 UI。
window.__ModuleLoader__.load({
  id: 'cairn-dsh-memory',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // Host 与 Client 分处两个进程，只能走 HTTP。history=1 取完整活动记录。
    const USAGE_URL = '/plugins/cairn-dsh-memory/usage?history=1';
    const PERSIST_URL = '/plugins/cairn-dsh-memory/persist';

    // 宿主 slot 有 crash boundary：组件一抛错整个条目被卸载。响应必须归一化
    // 成字段完备的对象：对端给什么都绝不抛。
    function normalize(d) {
      if (!d || typeof d !== 'object') return null;
      return {
        status: typeof d.status === 'string' ? d.status : 'miss',
        label: typeof d.label === 'string' ? d.label : '',
        candidates: Number(d.candidates) || 0,
        injected: Array.isArray(d.injected) ? d.injected : [],
        matchedBy: typeof d.matchedBy === 'string' ? d.matchedBy : '—',
        bytesUsed: Number(d.bytesUsed) || 0,
        bytesBudget: Number(d.bytesBudget) || 0,
        filteredCount: Number(d.filteredCount) || 0,
        recent: Array.isArray(d.recent) ? d.recent : [],
        persist: d.persist === true,
        // 本会话累计注入（去重）。老宿主没有这个字段 → 退回本轮列表，面板不至于空掉。
        sessionInjected: Array.isArray(d.sessionInjected) ? d.sessionInjected : null,
        session: typeof d.session === 'string' ? d.session : '',
      };
    }

    // sessionId 来自 slot 的 inject(sessionId)：同一个面板组件在不同会话里拿到不同 id，
    // 所以它必须进 effect 依赖——切换会话要重新拉数据，不能沿用上一个会话的那份。
    function useUsage(sessionId) {
      const [data, setData] = React.useState(null);
      const [failed, setFailed] = React.useState(false);
      React.useEffect(function () {
        let alive = true;
        const url = sessionId ? USAGE_URL + '&session=' + encodeURIComponent(sessionId) : USAGE_URL;
        function pull() {
          fetch(url, { headers: { accept: 'application/json' } })
            .then(function (r) {
              if (!r.ok) throw new Error('http ' + r.status);
              return r.json();
            })
            .then(function (d) {
              if (!alive) return;
              setFailed(false);
              setData(normalize(d));
            })
            .catch(function () {
              if (alive) { setFailed(true); setData(null); }
            });
        }
        pull();
        const t = setInterval(pull, 3000);
        return function () { alive = false; clearInterval(t); };
      }, [sessionId]);
      return { data: data, failed: failed };
    }

    // 展示配置（用户要求：可筛选、设定展示内容与时长），localStorage 持久化。
    var FILTER_KEY = 'cairn-memory-tab-filters';
    var FILTER_DEFAULT = { recall: true, tool: true, limit: 30, detail: 'full', text: 'auto' };
    function loadFilters() {
      try {
        var raw = window.localStorage && window.localStorage.getItem(FILTER_KEY);
        if (!raw) return Object.assign({}, FILTER_DEFAULT);
        var saved = JSON.parse(raw);
        return {
          recall: saved.recall !== false,
          tool: saved.tool !== false,
          limit: [15, 30, 120].indexOf(saved.limit) >= 0 ? saved.limit : 30,
          detail: saved.detail === 'brief' ? 'brief' : 'full',
          text: ['auto', 'white', 'black'].indexOf(saved.text) >= 0 ? saved.text : 'auto',
        };
      } catch (e) { return Object.assign({}, FILTER_DEFAULT); }
    }
    function saveFilters(f) {
      try { if (window.localStorage) window.localStorage.setItem(FILTER_KEY, JSON.stringify(f)); } catch (e) { /* 忽略 */ }
    }

    // ——— 栏宽布局（用户要求：可拖拽、记住、可恢复默认）———
    // 只存「左栏占比」一个数：存像素的话换窗口大小就失真。
    // null = 没拖过，交给 flex 自适应（宽了就并排，窄了就堆叠）。
    var LAYOUT_KEY = 'cairn-memory-tab-layout';
    var LEFT_PCT_MIN = 25;
    var LEFT_PCT_MAX = 75;
    function loadLayout() {
      try {
        var raw = window.localStorage && window.localStorage.getItem(LAYOUT_KEY);
        if (!raw) return null;
        var p = Number(JSON.parse(raw).leftPct);
        return p >= LEFT_PCT_MIN && p <= LEFT_PCT_MAX ? p : null;
      } catch (e) { return null; }
    }
    function saveLayout(pct) {
      try {
        if (!window.localStorage) return;
        if (pct === null) window.localStorage.removeItem(LAYOUT_KEY);
        else window.localStorage.setItem(LAYOUT_KEY, JSON.stringify({ leftPct: pct }));
      } catch (e) { /* 忽略 */ }
    }

    // ——— 主题对比度（用户要求：背景黑→白字、背景白→黑字，且可手动设定）———
    // 实测 DSH 深色主题下 --dsw-text 等变量未定义（vars 为空），硬编码回退色
    // 会黑上黑。做法：沿祖先链实测有效背景的 WCAG 相对亮度自动选字色；
    // 「文字：自动|白字|黑字」可手动覆盖（随筛选器持久化）。
    function channelCurve(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    function rgbLuminance(r, g, b) { return 0.2126 * channelCurve(r) + 0.7152 * channelCurve(g) + 0.0722 * channelCurve(b); }

    function bgColorAt(el) {
      // 返回该元素不透明背景的亮度；透明则返回 null 继续向上找
      try {
        var c = window.getComputedStyle(el).backgroundColor;
        var m = c && c.match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        var p = m[1].split(',').map(function (x) { return parseFloat(x); });
        var a = p.length > 3 ? p[3] : 1;
        if (a < 0.85) return null;
        return rgbLuminance(p[0], p[1], p[2]);
      } catch (e) { return null; }
    }

    function bgLuminance() {
      try {
        var el = document.body;
        while (el) {
          var lum = bgColorAt(el);
          if (lum !== null) return lum;
          if (el === document.documentElement) break;
          el = el.parentElement || document.documentElement;
        }
      } catch (e) { /* 落到 prefers-color-scheme */ }
      try {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 0.05 : 0.95;
      } catch (e) { return 0.95; }
    }

    // 深浅两套调色板：正文 4.5:1 以上、状态色醒目、激活 chip 在两种主题下都可读
    function pickPalette(pref) {
      var dark;
      if (pref === 'white') dark = true;
      else if (pref === 'black') dark = false;
      else dark = bgLuminance() < 0.45;
      return dark ? {
        text: '#f3f4f6',
        status: { injected: '#7ddb8a', filtered: '#ffb26b', miss: '#c6cad1' },
        chipActiveBg: 'rgba(96,134,224,.30)',
        chipActiveBorder: '#7d9be8',
        chipActiveColor: '#c3d4ff',
      } : {
        text: '#16181d',
        status: { injected: '#2e7d32', filtered: '#ef6c00', miss: '#757575' },
        chipActiveBg: 'rgba(91,123,213,.12)',
        chipActiveBorder: '#5b7bd5',
        chipActiveColor: '#3a5bbf',
      };
    }

    function hhmmss(iso) {
      try { return new Date(iso).toTimeString().slice(0, 8); } catch (e) { return ''; }
    }

    var KIND_LABEL = { recall: '自动召回', tool: '工具调用' };
    /**
     * 活动条目的稳定键：折叠会刷新 t，所以有 firstT 时用它——否则用户点选高亮后，
     * 下一次轮询的折叠会把键改掉，选中项跳走。
     */
    function entryKey(e) { return String((e && (e.firstT || e.t)) || '') + '|' + String(e && e.kind); }
    /** 旧记录（nothing_new 时代）把「命中但已去重」写成了「注入0」，展示时按新口径重述。 */
    function displaySummary(e) {
      var s = e && typeof e.summary === 'string' ? e.summary : '';
      if (s.indexOf('nothing_new') < 0) return s;
      var out = s.replace(/注入0/g, '已去重').replace(/\s*\(nothing_new\)/g, '');
      return out.indexOf('已去重') >= 0 ? out : out + '（旧记录：已去重）';
    }

    function MemoryUsageView(props) {
      const sessionId = props && typeof props.sessionId === 'string' ? props.sessionId : '';
      const state = useUsage(sessionId);
      const data = state.data;
      const [filters, setFilters] = React.useState(loadFilters);
      const [persist, setPersistState] = React.useState(null); // null=尚未从 host 取到
      // 左栏占比（%）。null = 用户没拖过 → 用 flex 自适应基准宽度。
      const [leftPct, setLeftPct] = React.useState(loadLayout);
      // 拖动过程中的临时量（起始指针 x、左栏起始像素宽、容器宽）。放 ref 里是因为
      // 每次 pointermove 都会 setState 触发重渲染，闭包变量会被重置。
      const dragRef = React.useRef(null);
      // 右侧活动记录的选中项（key = t + 序号）。选中时左侧对应记忆条目高亮。
      const [selectedKey, setSelectedKey] = React.useState(null);
      // host 是持久化状态的权威：轮询数据到达时校准本地 optimistic 状态。
      // ⚠️ 所有 hook 必须全部位于下方 `if (!data) return` 之前——Round-10 曾把
      // 本 effect 放在 return 之后：首渲染（data=null）提前返回少执行一个 hook，
      // 数据到达后 hook 数变多，React 抛 "Rendered more hooks"，宿主 slot
      // crash boundary 把整个面板卸成空白（tab 在、内容全无）。
      React.useEffect(function () {
        if (state.data && typeof state.data.persist === 'boolean') setPersistState(state.data.persist);
      }, [state.data]);
      // 主题对比度：自动实测背景亮度，或按用户设定（文字：自动|白字|黑字）
      var pal = pickPalette(filters.text);
      function update(patch) {
        var next = Object.assign({}, filters, patch);
        setFilters(next);
        saveFilters(next);
      }
      // 持久化开关：host 侧 marker 文件是权威，localStorage 不存它。
      function setPersist(on) {
        setPersistState(on); // 乐观更新，host 应答后校准
        fetch(PERSIST_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled: !!on }),
        })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) { if (d && typeof d.enabled === 'boolean') setPersistState(d.enabled); })
          .catch(function () { /* 网络失败：下轮 3s 轮询的 data.persist 会校准 */ });
      }

      // ——— 拖动分栏 ———
      // pointer capture：move/up 都回到 handle 上，不必挂 window 监听（卸载时也不用摘）。
      function onSplitDown(e) {
        var handle = e.currentTarget;
        var root = handle && handle.parentElement;
        if (!handle || !root || typeof root.getBoundingClientRect !== 'function') return;
        var rect = root.getBoundingClientRect();
        if (!rect.width) return;
        dragRef.current = {
          startX: e.clientX,
          startLeft: handle.getBoundingClientRect().left - rect.left,
          width: rect.width,
          last: leftPct,
        };
        try { handle.setPointerCapture(e.pointerId); } catch (err) { /* 不支持就算了 */ }
        if (e.preventDefault) e.preventDefault(); // 拖的时候别顺带选中文字
      }
      function onSplitMove(e) {
        var d = dragRef.current;
        if (!d) return;
        var pct = ((d.startLeft + (e.clientX - d.startX)) / d.width) * 100;
        var next = Math.max(LEFT_PCT_MIN, Math.min(LEFT_PCT_MAX, pct));
        d.last = next;
        setLeftPct(next);
      }
      function onSplitUp(e) {
        var d = dragRef.current;
        if (!d) return;
        dragRef.current = null;
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (err) { /* 不支持就算了 */ }
        // 松手才落盘：拖动中每一帧都写 localStorage 没有意义。
        if (typeof d.last === 'number') saveLayout(d.last);
      }
      function resetLayout() {
        setLeftPct(null); // 回到 flex 自适应
        saveLayout(null);
      }

      if (!data) {
        return h('div', { 'data-cairn-usage': 'waiting', style: { padding: 24, color: pal.status.miss, font: 'inherit' } },
          state.failed ? 'Cairn 记忆端点不可用（host 插件未注册 usage 路由？）' : 'Cairn 记忆状态加载中…');
      }

      var entries = (data.recent || [])
        .filter(function (e) {
          if (!e || typeof e !== 'object') return false;
          if (e.kind === 'recall') return filters.recall;
          if (e.kind === 'tool') return filters.tool;
          return false;
        })
        .slice(-filters.limit)
        .reverse();

      // 左下＝本会话累计注入（去重）。老宿主没有 sessionInjected 时退回本轮列表，
      // 宁可少一点信息，也不能让面板空掉。
      // 双层兜底：宿主没给 sessionInjected（老版本）→ 退回本轮列表；两个都没有 → 空数组。
      var sessionItems = Array.isArray(data.sessionInjected)
        ? data.sessionInjected
        : (Array.isArray(data.injected) ? data.injected : []);

      // 选中右侧某条记录 → 高亮它当时注入的那几条记忆。
      var selectedEntry = null;
      if (selectedKey) {
        var recentAll = data.recent || [];
        for (var ri = 0; ri < recentAll.length; ri++) {
          if (entryKey(recentAll[ri]) === selectedKey) { selectedEntry = recentAll[ri]; break; }
        }
      }
      var highlight = {};
      if (selectedEntry && Array.isArray(selectedEntry.items)) {
        selectedEntry.items.forEach(function (it) { if (it && it.id) highlight[it.id] = true; });
      }

      // host 是持久化状态的权威（校准 effect 已前移到 early return 之前）
      var persistOn = data.persist;

      var color = pal.status[data.status] || pal.status.miss;
      var rows = [
        ['召回条数', String(data.candidates)],
        ['命中通道', data.matchedBy],
        ['预算占用', data.bytesUsed + ' / ' + data.bytesBudget + ' B'],
        ['被过滤', String(data.filteredCount)],
      ];

      function chip(labelText, active, onClick) {
        return h('button', {
          key: labelText,
          type: 'button',
          onClick: onClick,
          style: {
            font: 'inherit', fontSize: 11, padding: '1px 9px', cursor: 'pointer',
            borderRadius: 999, border: '1px solid ' + (active ? pal.chipActiveBorder : 'rgba(127,127,127,.4)'),
            background: active ? pal.chipActiveBg : 'transparent',
            color: active ? pal.chipActiveColor : 'inherit', opacity: active ? 1 : .62,
            whiteSpace: 'nowrap',
          },
        }, labelText);
      }
      // 一组按钮：整组不拆开换行（组内可换），避免「文字:」标签和它的三个按钮分家。
      function group(children) {
        return h('span', { style: { display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, minWidth: 0 } }, children);
      }
      // 两栏共用的「卡片」外壳：minWidth/minHeight 归零，内部滚动才不会被 flex 撑开。
      function card(children, extra) {
        return h('div', {
          style: Object.assign({
            border: '1px solid rgba(127,127,127,.25)',
            borderRadius: 8,
            padding: '10px 12px',
            boxSizing: 'border-box',
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
          }, extra || {}),
        }, children);
      }

      return h('div', {
        'data-cairn-usage': data.status,
        style: {
          height: '100%',
          boxSizing: 'border-box',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'stretch',
          rowGap: 12,
          columnGap: 0,
          padding: '14px 16px',
          font: 'inherit',
          color: pal.text,
          // 宿主容器没有确定高度时 height:100% 失效 → 退化成一整块可滚动，不裁内容。
          overflow: 'auto',
        },
      },
        // ——— 左栏：上＝状态，下＝本轮注入 ———
        h('div', {
          style: Object.assign(
            { minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12 },
            // 拖过就用固定占比；没拖过交给 flex 基准宽度（窄了自动堆叠）。
            leftPct === null ? { flex: '1 1 320px' } : { flex: '0 0 ' + leftPct + '%' },
          ),
        },
          card([
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
              h('span', { 'aria-hidden': true, style: { color: color, fontSize: 16, flex: 'none' } }, '●'),
              h('span', { style: { fontSize: 15, fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' } }, data.label || 'Cairn 记忆')),
            h('div', {
              style: {
                marginTop: 10, fontSize: 12, lineHeight: 1.9, minWidth: 0,
                display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', columnGap: 10,
              },
            },
              rows.map(function (r) {
                return [
                  h('span', { key: r[0] + '-k', style: { opacity: .65 } }, r[0]),
                  h('span', { key: r[0] + '-v', style: { minWidth: 0, overflowWrap: 'anywhere' } }, r[1]),
                ];
              })),
          ]),
          card([
            h('div', { style: { flex: 'none', display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 } },
              h('span', { style: { opacity: .65, fontSize: 12 } }, '本会话注入的记忆'),
              h('span', { style: { opacity: .45, fontSize: 11 } }, '去重 · 本会话累计')),
            h('div', { style: { flex: '1 1 auto', minHeight: 0, overflow: 'auto', fontSize: 13, lineHeight: 1.8 } },
              sessionItems.length === 0
                ? h('div', { style: { opacity: .55, padding: '2px 0' } }, '本会话还没有注入过记忆。')
                : sessionItems.map(function (m, i) {
                    m = (m && typeof m === 'object') ? m : {};
                    var on = highlight[m.id] === true;
                    return h('div', {
                      key: m.id || i,
                      'data-cairn-hit': on ? '1' : '0',
                      style: {
                        display: 'flex', gap: 6, alignItems: 'baseline',
                        padding: '3px 6px', margin: '0 -6px', borderRadius: 6,
                        borderLeft: '3px solid ' + (on ? pal.chipActiveBorder : 'transparent'),
                        background: on ? pal.chipActiveBg : 'transparent',
                        borderBottom: '1px solid rgba(127,127,127,.12)', minWidth: 0,
                      },
                    },
                      h('code', { style: { flex: 'none', opacity: .65, fontSize: 11 } }, m.kind || '?'),
                      h('span', { title: m.id, style: { minWidth: 0, overflowWrap: 'anywhere' } }, m.summary || ''));
                  })),
            // 口径行：左栏是累计去重集合，右栏是每一步（含折叠后的多次）——两个数字不是一回事。
            h('div', { style: { flex: 'none', marginTop: 6, fontSize: 11, opacity: .55, lineHeight: 1.7 } },
              sessionItems.length + ' 条 · 右栏记录每一步，本栏按去重累计'),
          ], { flex: '1 1 auto' })),

        // ——— 分栏拖拽手柄 ———
        h('div', {
          key: 'split',
          'data-cairn-split': '1',
          role: 'separator',
          'aria-orientation': 'vertical',
          'aria-label': '拖动调整左右栏宽度',
          onPointerDown: onSplitDown,
          onPointerMove: onSplitMove,
          onPointerUp: onSplitUp,
          onPointerCancel: onSplitUp,
          style: {
            flex: '0 0 8px', alignSelf: 'stretch', margin: '0 6px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'col-resize', touchAction: 'none',
          },
        },
          h('span', { 'aria-hidden': true, style: { width: 2, height: '100%', borderRadius: 2, background: 'rgba(127,127,127,.35)' } })),

        // ——— 右栏：活动记录（标题 + 筛选条固定，列表自己滚）———
        h('div', {
          style: Object.assign(
            { minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 0 },
            leftPct === null ? { flex: '1 1 360px' } : { flex: '1 1 0', minWidth: 240 },
          ),
        },
          card([
            h('div', { style: { flex: 'none', fontSize: 13, fontWeight: 600, marginBottom: 8 } }, '活动记录'),
            // 筛选条：整条可换行（自适应宽度），移除「显示多少条」的选择。
            h('div', {
              style: { flex: 'none', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8, minWidth: 0 },
            },
              group([
                chip('自动召回', filters.recall, function () { update({ recall: !filters.recall }); }),
                chip('工具调用', filters.tool, function () { update({ tool: !filters.tool }); }),
              ]),
              group([
                chip('简要', filters.detail === 'brief', function () { update({ detail: 'brief' }); }),
                chip('详细', filters.detail === 'full', function () { update({ detail: 'full' }); }),
              ]),
              group([
                h('span', { style: { fontSize: 11, opacity: .6 } }, '文字:'),
                chip('自动', filters.text === 'auto', function () { update({ text: 'auto' }); }),
                chip('白字', filters.text === 'white', function () { update({ text: 'white' }); }),
                chip('黑字', filters.text === 'black', function () { update({ text: 'black' }); }),
              ]),
              group([
                h('span', { style: { fontSize: 11, opacity: .6 } }, '记录存储:'),
                chip('内存', persist === false, function () { setPersist(false); }),
                chip('落盘', persist === true, function () { setPersist(true); }),
              ])),
            entries.length === 0
              ? h('div', { style: { flex: '1 1 auto', minHeight: 0, overflow: 'auto', fontSize: 12, opacity: .6, padding: '6px 0' } },
                  '暂无记录。自动召回随每轮对话产生；agent 显式调用 Cairn 工具（检索/保存等）会记为「工具调用」。')
              // 活动记录自己带滚动条：宿主在会话进行中把视图区高度放成 auto
              // （host css：[data-phase=active] .viewArea{min-height:auto}），此时 flex 约束失效，
              // 列表会长到撑开整页——整页一起滚，用户就找不到「记录区」的边界。
              // maxHeight 是兜底：容器真给了确定高度时 flex 已经更矮，这个上限不起作用。
              : h('div', { style: { flex: '1 1 auto', minHeight: 0, maxHeight: '56vh', overflow: 'auto', fontSize: 12, lineHeight: 1.75 } },
                  entries.map(function (e, i) {
                    var k = entryKey(e);
                    var count = Number(e.count) > 0 ? Number(e.count) : 1;
                    // 只有「自动召回」带 items，才有可高亮的对象；工具调用行保持纯展示。
                    var selectable = Array.isArray(e.items) && e.items.length > 0;
                    var on = selectable && selectedKey === k;
                    function toggle() { setSelectedKey(on ? null : k); }
                    return h('div', {
                      key: k + ':' + i,
                      role: selectable ? 'button' : undefined,
                      tabIndex: selectable ? 0 : undefined,
                      title: selectable ? '点选高亮左侧对应记忆；再点一次取消' : undefined,
                      onClick: selectable ? toggle : undefined,
                      onKeyDown: selectable
                        ? function (ev) {
                            if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') { ev.preventDefault(); toggle(); }
                          }
                        : undefined,
                      style: {
                        display: 'flex', gap: 8, alignItems: 'baseline',
                        padding: '3px 6px', margin: '0 -6px', borderRadius: 6,
                        borderLeft: '3px solid ' + (on ? pal.chipActiveBorder : 'transparent'),
                        background: on ? pal.chipActiveBg : 'transparent',
                        borderBottom: '1px solid rgba(127,127,127,.12)', minWidth: 0,
                        cursor: selectable ? 'pointer' : 'default',
                      },
                    },
                      h('span', {
                        title: count > 1 && e.firstT
                          ? '首次 ' + hhmmss(e.firstT) + ' · 最近 ' + hhmmss(e.t) + ' · ' + count + ' 次'
                          : undefined,
                        style: { flex: 'none', opacity: .5, fontVariantNumeric: 'tabular-nums', fontSize: 11 },
                      }, hhmmss(e.t)),
                      h('span', { style: { flex: 'none', opacity: .75, minWidth: 52 } }, KIND_LABEL[e.kind] || e.kind),
                      count > 1
                        ? h('span', { style: { flex: 'none', opacity: .6, fontSize: 11, fontVariantNumeric: 'tabular-nums' } }, count + ' 次')
                        : null,
                      filters.detail === 'full'
                        ? h('span', { style: { minWidth: 0, overflowWrap: 'anywhere' } }, displaySummary(e))
                        : null,
                      selectable
                        ? h('span', { 'aria-hidden': true, style: { flex: 'none', opacity: on ? .9 : .35, fontSize: 11 } }, on ? '◉' : '○')
                        : null);
                  })),
            h('div', { style: { flex: 'none', marginTop: 8, fontSize: 11, opacity: .55, lineHeight: 1.7 } },
              '「自动召回」是插件在每轮对话前注入的记忆；「工具调用」是 agent 显式执行的 Cairn 操作。记录只留摘要，不含正文与参数。',
              h('br'),
              '记录存储＝内存：仅本次 DSH 运行期间有效；＝落盘：写入 ~/.cairn/activity-dsh.jsonl（超 2MB 自动滚动），重启后仍可回看。'),
            // 布局恢复：清掉本地占比，回到 flex 自适应（宽了并排、窄了堆叠）。
            h('div', { style: { flex: 'none', marginTop: 6 } },
              h('button', {
                type: 'button',
                onClick: resetLayout,
                title: leftPct === null ? '当前已是默认布局' : '恢复默认的左右自适应宽度',
                style: {
                  font: 'inherit', fontSize: 11, padding: '1px 9px', cursor: 'pointer',
                  borderRadius: 999, border: '1px solid rgba(127,127,127,.4)',
                  background: 'transparent', color: 'inherit', opacity: .72,
                },
              }, '重置布局')),
          ], { flex: '1 1 auto' })));
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.view', function () {
          try {
            return ctx.slots.register(
              {
                name: 'conversation.view',
                id: 'cairn-memory',
                order: 90,
                label: function () { return '记忆'; },
                // slot 的 inject 会收到当前会话 id；组件靠它向 host 要「本会话」的切片。
                inject: function (sessionId) { return { sessionId: sessionId }; },
              },
              MemoryUsageView,
            );
          } catch (error) {
            // 形状不符、重复注册等：不影响宿主其他功能，但必须让排查者在控制台看到
            console.error('[cairn-dsh-memory] view tab registration failed:', error);
          }
        });
      },
    };
  },
});
