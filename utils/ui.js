// utils/ui.js
// 统一的反馈与错误态处理。
// 背景：此前各页面错误提示方式不一致——有的 toast、有的 modal；
//       wx.showToast 中文约 14 字就会被截断成 "..."，长文案（如"请先部署云函数"）
//       用 toast 根本看不全。这里按长度自动选择展示方式，并统一文案与时长。

// toast 中文上限：单行 7 字左右、两行约 14 字，超出会被截断
const TOAST_MAX = 14;

/** 成功提示（短） */
function success(msg) {
  wx.showToast({ title: msg || '成功', icon: 'success', duration: 1500 });
}

/**
 * 失败/错误提示。
 * 文案短 → toast；文案长 → modal，避免被截断后用户看不懂。
 * @param {string} msg 错误文案，应说明"发生了什么 + 用户能做什么"
 */
function error(msg) {
  const text = String(msg || '操作失败，请重试');
  if (text.length <= TOAST_MAX) {
    wx.showToast({ title: text, icon: 'none', duration: 2000 });
  } else {
    wx.showModal({
      title: '出错了',
      content: text,
      showCancel: false,
      confirmText: '我知道了'
    });
  }
}

/** 中性提示（非成功非失败，如"已复制"） */
function info(msg) {
  wx.showToast({ title: msg || '', icon: 'none', duration: 1500 });
}

/**
 * 重复点击保护（操作锁）。
 * 典型场景：连点"核销"会重复核销一条码、连点"查询"会打开两个列表页、
 * 连点"上下架"会把状态翻两次回到原值。
 *
 * 用法：
 *   onSave() {
 *     if (!ui.lock(this, 'save')) return;   // 上一次还没结束，直接忽略
 *     doSomething().then(..., ...).then(() => ui.unlock(this, 'save'));
 *   }
 *
 * @param {Object} page 页面/组件实例
 * @param {string} key  锁名（同一实例内区分不同操作）
 * @param {string|false} tip 被拦截时的提示；传 false 表示静默忽略（如跳转类操作）
 * @returns {boolean} true=抢到锁，可以执行
 */
function lock(page, key, tip) {
  const k = '_lock_' + key;
  if (page[k]) {
    if (tip !== false) {
      wx.showToast({ title: tip || '正在处理中', icon: 'none', duration: 1000 });
    }
    return false;
  }
  page[k] = true;
  return true;
}

/** 释放 ui.lock 加的锁 */
function unlock(page, key) {
  page['_lock_' + key] = false;
}

/**
 * 云函数未部署等需要用户动手处理的错误，统一文案。
 * @param {string} fnName 云函数名
 */
function notDeployed(fnName) {
  error(`调用失败：${fnName} 云函数可能尚未部署。请在开发者工具中右键 cloudfunctions/${fnName}，选择"上传并部署：云端安装依赖"后重试。`);
}

module.exports = { success, error, info, notDeployed, lock, unlock, TOAST_MAX };
