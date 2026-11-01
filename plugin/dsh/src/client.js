// Cairn 记忆调用面板（DSH Client 插件）。
//
// 注册到 conversation.session.header.views.actions —— 「对话 / 轨迹」这组视图旁的操作区。
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

    function MemoryUsagePanel(props) {
      const usage = props && props.usage;
      const [open, setOpen] = React.useState(false);
      if (!usage) return null;

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
                usage.injected.map(function (m) {
                  return h('div', { key: m.id }, h('code', { style: { opacity: .65 } }, m.kind), ' ',
                    h('span', { title: m.id }, m.summary));
                }))
            : null,
        ),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.session.header.views.actions', function () {
          return ctx.slots.register(
            { name: 'conversation.session.header.views.actions', id: 'cairn-memory-usage', order: 20 },
            MemoryUsagePanel,
          );
        });
      },
    };
  },
});
