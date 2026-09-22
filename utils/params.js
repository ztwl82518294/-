/**
 * 路由参数解析
 *
 * ★ 为什么需要这个模块（易踩的坑）：
 *   小程序在 onLoad(options) 里给的参数**已经被框架 decode 过一次**。
 *   如果代码里再调用 decodeURIComponent()，就是二次解码：
 *     - 城市名含 % 时直接抛 URIError（如「济南%」是脏数据，页面会白屏）
 *     - 参数里原本是字面量 %25 的会被解成 %，语义被改
 *   正确做法：先判断是否还需要解码，或者用 try/catch 包住。
 *
 * 本模块的 safeDecode 策略：
 *   1. 先用 decodeURIComponent 试一次
 *   2. 抛错（说明已解码过、或含非法百分号）就原样返回
 *   3. 再 decode 一次的结果若与原串不同且能再次成功 decode，说明原来没解干净，
 *      但为避免过度解码，只解一层后即停
 *
 * 结论：safeDecode 保证「宁可少解一次，也不抛错」。
 */

/**
 * 安全解码 URL 参数
 * @param {any} v
 * @returns {string}
 */
function safeDecode(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (!s) return '';

  // 没有百分号，不用解
  if (s.indexOf('%') < 0) return s;

  try {
    return decodeURIComponent(s);
  } catch (e) {
    // 已经解过码、或含非法转义（如单独的 %）→ 原样返回
    return s;
  }
}

/**
 * 从 onLoad 的 options 里取一组参数，全部安全解码
 * @param {object} options
 * @param {string[]} keys
 * @returns {object}
 */
function pick(options, keys) {
  const o = options || {};
  const out = {};
  (keys || []).forEach((k) => {
    out[k] = safeDecode(o[k]);
  });
  return out;
}

module.exports = { safeDecode, pick };
