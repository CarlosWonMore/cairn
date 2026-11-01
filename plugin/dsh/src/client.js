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
      };
    }

    function useUsage() {
      const [data, setData] = React.useState(null);
      const [failed, setFailed] = React.useState(false);
      React.useEffect(function () {
        let alive = true;
        function pull() {
          fetch(USAGE_URL, { headers: { accept: 'application/json' } })
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
      }, []);
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

    function MemoryUsageView() {
      const state = useUsage();
      const data = state.data;
      const [filters, setFilters] = React.useState(loadFilters);
      const [persist, setPersistState] = React.useState(null); // null=尚未从 host 取到
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
            font: 'inherit', fontSize: 12, padding: '2px 10px', cursor: 'pointer',
            borderRadius: 999, border: '1px solid ' + (active ? pal.chipActiveBorder : 'rgba(127,127,127,.4)'),
            background: active ? pal.chipActiveBg : 'transparent',
            color: active ? pal.chipActiveColor : 'inherit', opacity: active ? 1 : .62,
          },
        }, labelText);
      }

      return h('div', {
        'data-cairn-usage': data.status,
        style: { padding: '16px 20px', font: 'inherit', color: pal.text, overflow: 'auto' },
      },
        // 状态区
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { 'aria-hidden': true, style: { color, fontSize: 16 } }, '●'),
          h('span', { style: { fontSize: 15, fontWeight: 600 } }, data.label || 'Cairn 记忆')),
        h('div', { style: { marginTop: 12, fontSize: 13, lineHeight: 1.9 } },
          rows.map(function (r) {
            return h('div', { key: r[0] },
              h('span', { style: { opacity: .65, display: 'inline-block', minWidth: 72 } }, r[0]),
              h('span', null, r[1]));
          })),
        data.injected.length
          ? h('div', { style: { marginTop: 14, paddingTop: 10, borderTop: '1px solid rgba(127,127,127,.25)' } },
              h('div', { style: { opacity: .65, fontSize: 12, marginBottom: 6 } }, '本轮注入的记忆'),
              data.injected.map(function (m, i) {
                m = (m && typeof m === 'object') ? m : {};
                return h('div', { key: m.id || i, style: { fontSize: 13, lineHeight: 1.8 } },
                  h('code', { style: { opacity: .65, marginRight: 6 } }, m.kind || '?'),
                  h('span', { title: m.id }, m.summary || ''));
              }))
          : null,

        // 活动记录区：留痕 + 筛选 + 展示程度 + 条数（配置持久化在 localStorage）
        h('div', { style: { marginTop: 20, paddingTop: 10, borderTop: '1px solid rgba(127,127,127,.25)' } },
          h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 8 } }, '活动记录'),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 8 } },
            chip('自动召回', filters.recall, function () { update({ recall: !filters.recall }); }),
            chip('工具调用', filters.tool, function () { update({ tool: !filters.tool }); }),
            h('span', { style: { opacity: .4 } }, '|'),
            chip('简要', filters.detail === 'brief', function () { update({ detail: 'brief' }); }),
            chip('详细', filters.detail === 'full', function () { update({ detail: 'full' }); }),
            h('span', { style: { opacity: .4 } }, '|'),
            [15, 30, 120].map(function (n) {
              return chip(n + '条', filters.limit === n, function () { update({ limit: n }); });
            }),
            h('span', { style: { opacity: .4 } }, '|'),
            // 文字对比度设定（自动=实测背景亮度；白字/黑字=手动覆盖）
            h('span', { style: { fontSize: 12, opacity: .6 } }, '文字:'),
            chip('自动', filters.text === 'auto', function () { update({ text: 'auto' }); }),
            chip('白字', filters.text === 'white', function () { update({ text: 'white' }); }),
            chip('黑字', filters.text === 'black', function () { update({ text: 'black' }); }),
            h('span', { style: { opacity: .4 } }, '|'),
            // 持久化开关：内存（默认）/ 落盘。状态权威在 host（marker 文件），重启保持。
            h('span', { style: { fontSize: 12, opacity: .6 } }, '记录存储:'),
            chip('内存', persist === false, function () { setPersist(false); }),
            chip('落盘', persist === true, function () { setPersist(true); })),
          entries.length === 0
            ? h('div', { style: { fontSize: 12, opacity: .6, padding: '6px 0' } },
                '暂无记录。自动召回随每轮对话产生；agent 显式调用 Cairn 工具（检索/保存等）会记为「工具调用」。')
            : h('div', { style: { fontSize: 12, lineHeight: 1.9 } },
                entries.map(function (e, i) {
                  return h('div', { key: e.t + ':' + i, style: { display: 'flex', gap: 8 } },
                    h('span', { style: { opacity: .5, fontVariantNumeric: 'tabular-nums' } }, hhmmss(e.t)),
                    h('span', { style: { opacity: .75, minWidth: 56 } }, KIND_LABEL[e.kind] || e.kind),
                    h('span', null, filters.detail === 'full' ? (e.summary || '') : ''));
                })),
          h('div', { style: { marginTop: 10, fontSize: 12, opacity: .6, lineHeight: 1.7 } },
            '「自动召回」是插件在每轮对话前注入的记忆；「工具调用」是 agent 显式执行的 Cairn 操作。记录只留摘要，不含正文与参数。',
            h('br'),
            '记录存储＝内存：仅本次 DSH 运行期间有效；＝落盘：写入 ~/.cairn/activity-dsh.jsonl（超 2MB 自动滚动），重启后仍可回看。')),
      );
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
                inject: function () { return {}; },
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
