#!/usr/bin/env node
/**
 * 源码扫描的公共工具：剥注释
 *
 * ★★ 为什么必须剥注释才能扫源码（check-requires.js 踩过两次的坑）：
 *   注释里经常写着「用法示例」或「规则说明」，里面会出现与真实代码一模一样的字符串。
 *   例如 utils/admin.js 的注释写了一句「页面里不允许出现 .collection(」——
 *   不剥注释时，这条**解释禁令的注释**会被当成「违反禁令的代码」，产生假警报。
 *   而**假失败比不检查更糟**：人会开始习惯性忽略整个检查结果。
 *
 * ★★ 剥注释又要保留字符串（同一枚硬币的另一面）：
 *   require('./x') 的路径就写在字符串里。若连字符串一起抹掉，扫描结果会变成 0 处，
 *   检查形同虚设 —— 看起来全绿，其实什么都没查。
 *
 * 实现要点：
 *   1. **状态机逐字符扫描**：字符串内部不判注释（`/*` 出现在字符串里不算注释）
 *   2. 注释替换成**等长空白**（换行保留）⇒ 行号不变，报错能定位到源码
 *   3. 单双引号不跨行（JS 语法约定），反引号模板串可跨行
 *   4. `\` 转义跳两位，避免 `\'`、`\`` 把状态机骗出去
 */

/**
 * @param {string} src 源码原文
 * @returns {string} 注释被替换为空白后的源码（长度与原串完全一致）
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];

    // ---- 字符串：原样输出，内部不判注释 ----
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      while (i < n) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] || '');
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          out += src[i];
          i++;
          break;
        }
        // 单双引号遇到换行（未闭合）就直接结束，避免吃掉后面整个文件
        if (quote !== '`' && src[i] === '\n') break;
        out += src[i];
        i++;
      }
      continue;
    }

    // ---- 注释 ----
    if (c === '/' && src[i + 1] === '/') {
      // 行注释：只吞到行尾
      while (i < n && src[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      // 补掉收尾的 */
      if (i < n) {
        out += '  ';
        i += 2;
      }
      continue;
    }

    out += c;
    i++;
  }
  return out;
}

module.exports = { stripComments };
