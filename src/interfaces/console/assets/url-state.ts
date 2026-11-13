/**
 * URL ↔ 视图状态编解码（design D4/D7，任务 4.4/4.5/4.7）。
 *
 * 以**源码字符串**形式存在，被 ui-js 原样嵌进页面；测试用同一个字符串
 * 在沙箱里实例化后断言往返一致。这样"页面里跑的"和"测过的"是同一段代码，
 * 不会出现"测试绿了、页面另写一份"的双实现漂移。
 */

export const URL_STATE_KEYS = ['view', 'q', 'scope', 'status', 'kind', 'batch', 'plan', 'drawer', 'item', 'mem'] as const;

export const URL_STATE_SRC = String.raw`
  var DEFAULT_VIEW = 'overview';
  /** 唯一键表：encode / decode 都从这里读，加键只改这一处。 */
  var KEYS = ['view', 'q', 'scope', 'status', 'kind', 'batch', 'plan', 'drawer', 'item', 'mem'];

  /** 只认白名单键；未给出的键不写，避免把 undefined 写成字符串 "undefined"。 */
  function encodeState(st) {
    var p = new URLSearchParams();
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i];
      // view 的默认值不进地址：没参数就是概览，地址干净且分享出去不会多一个噪声参数。
      if (k === 'view' && (!st.view || st.view === DEFAULT_VIEW)) continue;
      if (st[k]) p.set(k, st[k]);
    }
    p.set('mode', st.mode === 'full' ? 'full' : 'brief');
    return p.toString();
  }

  /**
   * URL 优先于 localStorage：刷新 / 粘贴链接必须复现同一屏；
   * 只有 URL 未带 mode 时才回落到上次选择。
   */
  function decodeState(search, savedMode) {
    var p = new URLSearchParams(search || '');
    var out = {};
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i];
      var v = p.get(k);
      if (v !== null && v !== '') out[k] = v;
    }
    if (out.view == null) out.view = DEFAULT_VIEW;
    var urlMode = p.get('mode');
    out.mode = urlMode === 'full' || urlMode === 'brief' ? urlMode : (savedMode === 'full' ? 'full' : 'brief');
    return out;
  }
`;
