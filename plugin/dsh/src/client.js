// Cairn 记忆调用面板（DSH Client 插件）。
//
// 2026-11-02 起注册为会话内的**独立 tab**（conversation.view，与「轨迹」同款
// 机制：slots.inject(name, () => slots.register({name, id, order, label,
// inject}, Component))），替代原 header chip——用户明确要求 tab 形态。
// list slot 契约：必须有 id（缺了抛 requires options.id）；children/select 是
// 其他槽型的字段，不要混用。
// 注意：slots.inject 的回调在之后的全局 reconcile tick 里才被调（apply 早已
// 返回），try/catch 必须放进回调本体。
// 三态用**文字**标明，不只靠颜色：『已过滤』与『未命中』在用户眼里都是
// 「什么都没发生」，但前者说明安全规则在工作，必须读得出来。
window.__ModuleLoader__.load({
  id: 'cairn-dsh-memory',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const COLOR = {
      injected: '#2e7d32',
      filtered: '#ef6c00',
      miss: '#757575',
    };

    // 数据来自 Host 注册的 /plugins/cairn-dsh-memory/usage。
    // Host 与 Client 分处两个进程，内存状态无法直接共享，只能走 HTTP。
    const USAGE_URL = '/plugins/cairn-dsh-memory/usage';

    // 宿主 slot 有 crash boundary：组件一抛错，整个条目被卸载（2026-11-02 的
    // 「面板一闪即逝」就是这么来的——端点早期返回过缺字段的退化形状）。所以
    // 响应必须归一化成字段完备的对象：对端给什么都绝不抛。
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
      };
    }

    function useUsage() {
      const [usage, setUsage] = React.useState(null);
      const [failed, setFailed] = React.useState(false);
      React.useEffect(function () {
        let alive = true;
        function pull() {
          fetch(USAGE_URL, { headers: { accept: 'application/json' } })
            .then(function (r) {
              if (!r.ok) throw new Error('http ' + r.status);
              return r.ok ? r.json() : null;
            })
            .then(function (d) {
              if (!alive) return;
              setFailed(false);
              setUsage(normalize(d));
            })
            .catch(function () {
              if (alive) { setFailed(true); setUsage(null); }
            });
        }
        pull();
        const t = setInterval(pull, 3000);
        return function () { alive = false; clearInterval(t); };
      }, []);
      return { usage: usage, failed: failed };
    }

    // tab 整页视图：状态 + 明细常驻，无需弹层。
    function MemoryUsageView() {
      const state = useUsage();
      const usage = state.usage;

      if (!usage) {
        return h('div', { 'data-cairn-usage': 'waiting', style: { padding: 24, color: '#9e9e9e', font: 'inherit' } },
          state.failed ? 'Cairn 记忆端点不可用（host 插件未注册 usage 路由？）' : 'Cairn 记忆状态加载中…');
      }

      const color = COLOR[usage.status] || COLOR.miss;
      const rows = [
        ['召回条数', String(usage.candidates)],
        ['命中通道', usage.matchedBy],
        ['预算占用', usage.bytesUsed + ' / ' + usage.bytesBudget + ' B'],
        ['被过滤', String(usage.filteredCount)],
      ];

      return h('div', {
        'data-cairn-usage': usage.status,
        style: { padding: '16px 20px', font: 'inherit', color: 'var(--dsw-text, #111)', overflow: 'auto' },
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { 'aria-hidden': true, style: { color, fontSize: 16 } }, '●'),
          h('span', { style: { fontSize: 15, fontWeight: 600 } }, usage.label || 'Cairn 记忆'),
        ),
        h('div', { style: { marginTop: 12, fontSize: 13, lineHeight: 1.9 } },
          rows.map(function (r) {
            return h('div', { key: r[0] },
              h('span', { style: { opacity: .65, display: 'inline-block', minWidth: 72 } }, r[0]),
              h('span', null, r[1]));
          })),
        usage.injected.length
          ? h('div', { style: { marginTop: 14, paddingTop: 10, borderTop: '1px solid rgba(127,127,127,.25)' } },
              h('div', { style: { opacity: .65, fontSize: 12, marginBottom: 6 } }, '本轮注入的记忆'),
              usage.injected.map(function (m, i) {
                m = (m && typeof m === 'object') ? m : {};
                return h('div', { key: m.id || i, style: { fontSize: 13, lineHeight: 1.8 } },
                  h('code', { style: { opacity: .65, marginRight: 6 } }, m.kind || '?'),
                  h('span', { title: m.id }, m.summary || ''));
              }))
          : null,
        h('div', { style: { marginTop: 18, paddingTop: 10, borderTop: '1px solid rgba(127,127,127,.2)', fontSize: 12, opacity: .6, lineHeight: 1.7 } },
          '这里统计的是插件在每轮对话前自动召回并注入的记忆。',
          h('br'),
          'Agent 在对话里显式调用 Cairn 工具（检索/保存/更正）的完整记录请看「轨迹」tab。'),
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
