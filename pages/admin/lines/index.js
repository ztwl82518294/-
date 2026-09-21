// pages/admin/lines/index.js
// 专线管理列表页：分页展示所有专线（滚动翻页），支持编辑/上下架/删除
//
// 【万股级架构】（S1 改造）：
// 旧版一次拉全量（limit 1000）+ 客户端关键词过滤，超 1000 条后新线路不可见。
// 现改为服务端分页（每页 50）+ 服务端正则搜索；导出仅覆盖已加载部分。

const vip = require('../../../utils/vip.js');
const ui = require('../../../utils/ui.js');

const PAGE_SIZE = 50;      // 每页条数，与云函数默认一致
const IMPORT_CHUNK = 200;  // 批量导入分批大小（云函数单次请求体/超时限制）

Page({
  data: {
    lines: [],        // 当前已加载的专线列表
    keyword: '',      // 搜索关键词（服务端搜索）
    total: 0,         // 后端统计总数
    loadedCount: 0,   // 已加载条数
    hasMore: false,   // 是否还有下一页
    loading: false,   // 加载状态（防重复请求）
    searched: false   // 是否处于搜索结果态
  },

  // 页面每次显示时重新加载，保证数据最新
  onShow() {
    this.load(true);
  },

  // 加载一页数据；reset=true 时回到第 1 页
  load(reset) {
    if (this.data.loading) return;
    // 翻页时页码必须 +1：原来取 this.data.page 会一直停在 1，
    // 导致上拉加载反复拉第 1 页并 concat，列表出现重复项且永远翻不到第 2 页
    const page = reset ? 1 : (this.data.page || 1) + 1;
    this.setData({ loading: true });
    if (reset) wx.showLoading({ title: '加载中...' });

    wx.cloud.callFunction({
      name: 'adminLine',
      data: {
        action: 'list',
        data: { page, pageSize: PAGE_SIZE, keyword: this.data.keyword.trim() }
      }
    })
      .then(res => {
        wx.hideLoading();
        const r = res.result || {};
        if (r.error) {
          this.setData({ loading: false });
          return wx.showToast({ title: r.error, icon: 'none' });
        }
        if (r.data) {
          const items = r.data.map(l => {
            l.vipText = vip.vipStatusText(l);
            return l;
          });
          const lines = reset ? items : this.data.lines.concat(items);
          this.setData({
            lines,
            total: r.total || 0,
            loadedCount: lines.length,
            hasMore: !!r.hasMore,
            page,
            loading: false,
            searched: !!this.data.keyword.trim()
          });
        } else {
          this.setData({ loading: false });
          wx.showToast({ title: '加载失败', icon: 'none' });
        }
      })
      .catch(err => {
        wx.hideLoading();
        this.setData({ loading: false });
        console.error('加载专线失败', err);
        wx.showToast({ title: '加载失败', icon: 'none' });
      });
  },

  // 滚动到底部加载下一页
  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.load(false);
    }
  },

  // 搜索输入：服务端搜索，防抖 400ms
  onSearchInput(e) {
    const keyword = e.detail.value;
    this.setData({ keyword });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.load(true), 400);
  },

  // 清空搜索
  clearSearch() {
    this.setData({ keyword: '' });
    this.load(true);
  },

  // 新增专线：跳到编辑页（不带参数=新增）
  addLine() {
    wx.navigateTo({ url: '/pages/admin/line-edit/index' });
  },

  // 导出：把已加载的专线写成 .json 临时文件，转发到微信；不支持时兜底复制到剪贴板
  // 注：万股量级下云函数单次响应有大小限制，导出覆盖"已加载的线路"
  exportLines() {
    const all = this.data.lines || [];
    if (all.length === 0) {
      return wx.showToast({ title: '暂无专线可导出', icon: 'none' });
    }
    // 连点会重复写文件并弹出多次分享面板
    if (!ui.lock(this, 'export')) return;
    const finish = () => ui.unlock(this, 'export');

    // 去掉数据库内部字段，导出干净数据便于再次导入
    const clean = all.map(item => {
      const o = Object.assign({}, item);
      delete o._id;
      delete o._openid;
      return o;
    });
    const json = JSON.stringify(clean, null, 2);

    // 兜底：复制到剪贴板（模拟器 / 不支持转发文件时可用）
    const copyToClipboard = () => {
      wx.setClipboardData({
        data: json,
        success: () => wx.showModal({
          title: '已复制到剪贴板',
          content: `${clean.length} 条专线数据已复制，可粘贴保存为 .json 文件后再导入`,
          showCancel: false,
          complete: finish
        }),
        fail: finish
      });
    };

    const fs = wx.getFileSystemManager();
    const filePath = `${wx.env.USER_DATA_PATH}/lines_export_${Date.now()}.json`;

    // 同步写文件：shareFileMessage 必须在用户 TAP 手势的同步调用栈内触发，
    // 若用异步 writeFile 的 success 回调再 share，会丢失手势导致 fail
    try {
      fs.writeFileSync(filePath, json, 'utf8');
    } catch (err) {
      console.error('写入导出文件失败，改用剪贴板', err);
      copyToClipboard();
      return;
    }

    // 真机：转发文件到微信好友 / 文件传输助手（openDocument 不支持 json）
    if (wx.shareFileMessage) {
      wx.shareFileMessage({
        filePath,
        fileName: `专线导出_${clean.length}条.json`,
        success: () => console.log('已转发导出文件'),
        fail: err => {
          console.error('转发导出文件失败，改用剪贴板', err);
          copyToClipboard();
        },
        complete: finish
      });
    } else {
      copyToClipboard();
      finish();
    }
  },

  // 导入：从聊天里选择 .json 文件 -> 读取解析 -> 分批入库
  importLines() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['json'],
      success: res => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        if (!/\.json$/i.test(file.name || file.path || '')) {
          return wx.showToast({ title: '请选择 .json 文件', icon: 'none' });
        }
        const fs = wx.getFileSystemManager();
        fs.readFile({
          filePath: file.path,
          encoding: 'utf8',
          success: r => this.parseAndImport(r.data),
          fail: () => wx.showToast({ title: '读取文件失败', icon: 'none' })
        });
      },
      fail: () => {} // 用户取消，不提示
    });
  },

  // 解析 JSON 并二次确认后分批导入（每批 IMPORT_CHUNK 条，防止请求体超限/超时）
  parseAndImport(text) {
    let list;
    try {
      list = JSON.parse(text);
    } catch (e) {
      return wx.showToast({ title: '文件格式错误', icon: 'none' });
    }
    if (!Array.isArray(list) || list.length === 0) {
      return wx.showToast({ title: '文件内没有专线数据', icon: 'none' });
    }
    // 只保留有基本字段的记录，防止导入脏数据
    const valid = list.filter(x => x && x.title && x.fromCityName && x.toCityName);
    if (valid.length === 0) {
      return wx.showToast({ title: '没有有效的专线数据', icon: 'none' });
    }

    wx.showModal({
      title: '确认导入',
      content: `将新增导入 ${valid.length} 条专线（原有数据保留）。确定继续？`,
      success: m => {
        if (!m.confirm) return;
        // 分批顺序上传，实时提示进度
        const chunks = [];
        for (let i = 0; i < valid.length; i += IMPORT_CHUNK) {
          chunks.push(valid.slice(i, i + IMPORT_CHUNK));
        }
        let success = 0, failed = 0;
        const uploadNext = idx => {
          if (idx >= chunks.length) {
            wx.hideLoading();
            wx.showModal({
              title: '导入完成',
              content: `成功 ${success} 条，失败 ${failed} 条`,
              showCancel: false
            });
            this.load(true); // 回到第 1 页刷新
            return;
          }
          wx.showLoading({ title: `导入中 ${Math.min((idx + 1) * IMPORT_CHUNK, valid.length)}/${valid.length}` });
          wx.cloud.callFunction({
            name: 'adminLine',
            data: { action: 'batchSave', data: chunks[idx] }
          })
            .then(res => {
              const r = res.result || {};
              success += r.success || 0;
              failed += r.failed || 0;
              uploadNext(idx + 1);
            })
            .catch(err => {
              console.error('导入失败', err);
              failed += chunks[idx].length;
              uploadNext(idx + 1);
            });
        };
        uploadNext(0);
      }
    });
  },

  // 编辑专线：跳到编辑页并带上专线键（_id 主键，缺 id 的老数据同样可编辑）
  editLine(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return wx.showToast({ title: '缺少线路标识', icon: 'none' });
    wx.navigateTo({ url: `/pages/admin/line-edit/index?lineId=${id}` });
  },

  // 上下架切换
  toggleLine(e) {
    const item = e.currentTarget.dataset.item;
    // 当前是上架(1)就改成下架(0)，反之亦然
    const newStatus = item.status === 1 ? 0 : 1;

    // 连点会提交两次，状态被翻转回原值且列表重复刷新
    if (!ui.lock(this, 'toggle')) return;

    wx.cloud.callFunction({
      name: 'adminLine',
      data: { action: 'toggle', data: { _id: item._id, status: newStatus } }
    }).then((res) => {
      ui.unlock(this, 'toggle');
      if (res.result && res.result.error) return wx.showToast({ title: res.result.error, icon: 'none' });
      this.load(true);   // 刷新列表
    }).catch(() => {
      ui.unlock(this, 'toggle');
      wx.showToast({ title: '操作失败', icon: 'none' });
    });
  },

  // 删除专线
  deleteLine(e) {
    const item = e.currentTarget.dataset.item;
    wx.showModal({
      title: '提示',
      content: `确定删除【${item.title}】？删除后不可恢复`,
      success: res => {
        if (res.confirm) {
          wx.cloud.callFunction({
            name: 'adminLine',
            data: { action: 'remove', data: { _id: item._id } }
          }).then((r) => {
            if (r.result && r.result.error) return wx.showToast({ title: r.result.error, icon: 'none' });
            this.load(true);   // 刷新列表
          }).catch(() => wx.showToast({ title: '删除失败', icon: 'none' }));
        }
      }
    });
  }
});
