// Cairn 记忆调用面板（DSH Client 插件）。
//
// 注册到 conversation.session.header.actions —— header 里直接渲染的区域（与 agent-preset 同处）。
// 注意：views.actions 那个 slot 的内容会进「More」下拉菜单，不是直接可见，所以不用它。
// 三态用**文字**标明，不只靠颜色：『已过滤』与『未命中』在用户眼里都是「什么都没发生」，
// 但前者说明安全规则在工作，必须读得出来。
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
    // 「面板一闪即逝」就是这么来的——端点早期返回过缺字段的退化形状，详情段
    // 读 usage.injected.length 抛 TypeError）。所以响应必须归一化成字段完备
    // 的对象：对端给什么都绝不抛。
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

    function MemoryUsagePanel() {
      const state = useUsage();
      const usage = state.usage;
      const [open, setOpen] = React.useState(false);
      // usage 尚未到达：渲染等待态 chip（面板必须可见，否则用户无法区分
      // 「插件没装上」和「数据还没到」——第三轮面板排查的核心症状）。
      if (!usage) {
        return h('span', {
          'data-cairn-usage': 'waiting',
          style: {
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            color: '#9e9e9e', border: '1px dashed #bdbdbd',
            borderRadius: '999px', padding: '2px 10px', font: 'inherit',
          },
        }, h('span', { 'aria-hidden': true }, '◌'), h('span', null, state.failed ? '端点不可用' : 'Cairn 记忆面板…'));
      }

      const color = COLOR[usage.status] || COLOR.miss;
      const head = h('button', {
        type: 'button',
        'aria-expanded': open,
        onClick: function () { setOpen(!open); },
        style: {
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          background: 'transparent', border: '1px solid currentColor',
          color: color, borderRadius: '999px', padding: '2px 10px',
          font: 'inherit', cursor: 'pointer',
        },
      }, h('span', { 'aria-hidden': true }, '●'), h('span', null, usage.label));

      if (!open) return h('span', { 'data-cairn-usage': usage.status }, head);

      const rows = [
        ['召回条数', String(usage.candidates)],
        ['命中通道', usage.matchedBy],
        ['预算占用', usage.bytesUsed + ' / ' + usage.bytesBudget + ' B'],
        ['被过滤', String(usage.filteredCount)],
      ];

      return h('div', { 'data-cairn-usage': usage.status, style: { position: 'relative', display: 'inline-block' } },
        head,
        h('div', {
          role: 'dialog',
          'aria-label': '记忆调用详情',
          style: {
            position: 'absolute', right: 0, top: '100%', marginTop: '6px',
            minWidth: '260px', padding: '10px 12px', zIndex: 30,
            background: 'var(--dsw-surface, #fff)', color: 'var(--dsw-text, #111)',
            border: '1px solid rgba(127,127,127,.35)', borderRadius: '8px',
            boxShadow: '0 8px 24px rgba(0,0,0,.16)', fontSize: '12px', lineHeight: 1.6,
          },
        },
          rows.map(function (r) {
            return h('div', { key: r[0] }, h('span', { style: { opacity: .7 } }, r[0] + '：'), r[1]);
          }),
          usage.injected.length
            ? h('div', { style: { marginTop: '6px', borderTop: '1px solid rgba(127,127,127,.25)', paddingTop: '6px' } },
                usage.injected.map(function (m, i) {
                  m = (m && typeof m === 'object') ? m : {};
                  return h('div', { key: m.id || i }, h('code', { style: { opacity: .65 } }, m.kind || '?'), ' ',
                    h('span', { title: m.id }, m.summary || ''));
                }))
            : null,
        ),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.session.header.actions', function () {
          // 注意：这个回调不是在 apply 里同步执行的——slots 服务在之后的全局
          // reconcile tick 里才调它（DSH app-*.log 的 Uncaught 堆栈证实入口是
          // 别人触发的 notifyDeclaration）。所以 try/catch 必须放进回调本体，
          // 放在 apply 外层永远接不住，只会变成 Uncaught Error。
          try {
            return ctx.slots.register(
              {
                name: 'conversation.session.header.actions',
                // list slot 契约（对照 dsh-connect-workbuddy/lib/client.js 实锤）：
                // 缺 id 直接抛 requires options.id；list slot 用 order 排序，
                // 没有 priority 字段。2026-11-02 前写的 key/priority 都不在契约里。
                id: 'cairn-memory-usage',
                order: 20,
                inject: function () { return {}; },
              },
              MemoryUsagePanel,
            );
          } catch (error) {
            // 形状不符、重复注册等：不影响宿主其他功能，但必须让排查者在控制台看到
            console.error('[cairn-dsh-memory] panel slot registration failed:', error);
          }
        });
      },
    };
  },
});
