/**
 * 后台管理 · 通用表单（新建 / 编辑 / 保存）
 *
 * ★ 表单长什么样完全由 utils/admin.js 里的 fields 元信息决定，
 *   本页只负责「把元信息渲染出来 + 把输入收回去」——
 *   加字段不用改页面，改元信息即可。
 *
 * ★ 校验是两层的：
 *   1. 前端只做「必填 / 明显填错」的即时提示（省一次网络往返，体验更好）；
 *   2. 真正的校验在云函数里（shared/validate.js，与桌面后台同一份）。
 *   前端校验只是体验，**不能当成防线** —— 服务端那一份才是。
 *
 * ★ Picker 的取值统一收在 fields[i].values 里，
 *   不用 index 去反查（index 会随选项列表变化而错位，是个隐形坑）。
 */

const admin = require('../../../utils/admin');
const params = require('../../../utils/params');

Page({
  data: {
    type: '',
    label: '',
    id: '',
    isEdit: false,

    /** 表单字段（渲染用） */
    fields: [],
    /** 类型说明 */
    note: '',

    loading: true,
    loadError: false,
    errMessage: '',
    fatalMessage: '',
    badType: false,

    /** 提交中（防重复提交） */
    submitting: false
  },

  onLoad(options) {
    const o = options || {};
    const type = params.safeDecode(o.type);
    const id = params.safeDecode(o.id);
    const meta = admin.TYPES[type];

    if (!meta || !meta.editable) {
      this.setData({ badType: true, loading: false });
      wx.setNavigationBarTitle({ title: '后台管理' });
      return;
    }

    this.setData({
      type: type,
      label: meta.label,
      note: meta.note || '',
      id: id || '',
      isEdit: !!id
    });
    wx.setNavigationBarTitle({ title: (id ? '编辑' : '新建') + meta.label });

    this.init();
  },

  async init() {
    this.setData({ loading: true, loadError: false, errMessage: '', fatalMessage: '' });

    const meta = admin.TYPES[this.data.type];
    const id = this.data.id;

    // 1. 有 id 就先取记录
    let row = null;
    if (id) {
      const r = await admin.get(this.data.type, id);
      if (!r.ok) {
        if (admin.isFatal(r.code)) this.setData({ loading: false, fatalMessage: r.message || '没有后台权限' });
        else this.setData({ loading: false, loadError: true, errMessage: r.message || '加载失败' });
        return;
      }
      row = r.row || null;
    }

    // 2. 需要下拉选项的（线路 / 公司）先取选项
    const needOptions = meta.fields.some((f) => !!f.source);
    let optMap = { routes: [], companies: [] };
    if (needOptions) {
      const r2 = await admin.options();
      if (!r2.ok) {
        if (admin.isFatal(r2.code)) this.setData({ loading: false, fatalMessage: r2.message || '没有后台权限' });
        else this.setData({ loading: false, loadError: true, errMessage: r2.message || '选项加载失败' });
        return;
      }
      optMap = { routes: r2.routes || [], companies: r2.companies || [] };
    }

    const form = row ? admin.rowToForm(this.data.type, row) : admin.blankForm(this.data.type);
    this.setData({
      loading: false,
      fields: this.buildFields(meta, form, optMap)
    });
  },

  onRetry() {
    this.init();
  },

  /**
   * 元信息 + 当前值 → 渲染用字段数组
   *
   * @param {object} meta   admin.TYPES[type]
   * @param {object} form   当前值（key → 值）
   * @param {object} optMap { routes:[{id,label}], companies:[{id,label}] }
   */
  buildFields(meta, form, optMap) {
    const out = [];
    meta.fields.forEach((f) => {
      const item = {
        key: f.key,
        label: f.label,
        kind: f.kind,
        placeholder: f.placeholder || '',
        hint: f.hint || '',
        required: !!f.required,
        maxlength: f.maxlength || 0,
        // picker 用
        range: [],
        values: [],
        index: 0,
        // 输入类用
        value: '',
        // 开关用
        checked: false
      };

      if (f.kind === 'picker') {
        const raw = f.options || optMap[f.source] || [];
        const list = raw.map((o) => ({
          v: o.value === undefined ? o.id : o.value,
          l: o.label
        }));
        item.range = list.map((o) => o.l);
        item.values = list.map((o) => o.v);

        const cur = form[f.key];
        const at = cur === '' || cur === null || cur === undefined
          ? -1 : item.values.indexOf(cur);
        item.index = at < 0 ? 0 : at;
        // ★ 选项列表加载慢 / 为空时，index 会落到 0 —— 这时候不能把第 0 项当成用户的选择，
        //   所以只有当原值确实在列表里时才回填 value。
        item.value = at < 0 ? '' : item.values[at];
        out.push(item);
        return;
      }

      if (f.kind === 'switch') {
        item.checked = form[f.key] === true;
        out.push(item);
        return;
      }

      const v = form[f.key];
      item.value = v === null || v === undefined ? '' : String(v);
      out.push(item);
    });
    return out;
  },

  /* ============================================================
   * 输入
   * ============================================================ */

  onInput(e) {
    const i = Number(e.currentTarget.dataset.index);
    const patch = {};
    patch['fields[' + i + '].value'] = e.detail.value || '';
    this.setData(patch);
  },

  onSwitch(e) {
    const i = Number(e.currentTarget.dataset.index);
    const patch = {};
    patch['fields[' + i + '].checked'] = e.detail.value === true;
    this.setData(patch);
  },

  onPickerChange(e) {
    const i = Number(e.currentTarget.dataset.index);
    const at = Number(e.detail.value) || 0;
    const f = this.data.fields[i];
    if (!f) return;
    const patch = {};
    patch['fields[' + i + '].index'] = at;
    patch['fields[' + i + '].value'] = f.values[at] === undefined ? '' : String(f.values[at]);
    this.setData(patch);
  },

  onDateChange(e) {
    const i = Number(e.currentTarget.dataset.index);
    const patch = {};
    patch['fields[' + i + '].value'] = e.detail.value || '';
    this.setData(patch);
  },

  /* ============================================================
   * 提交
   * ============================================================ */

  onSubmit() {
    if (this.data.submitting) return;

    const form = {};
    this.data.fields.forEach((f) => {
      if (f.kind === 'switch') {
        form[f.key] = f.checked;
        return;
      }
      form[f.key] = f.value;
    });

    // 前端必填校验（省一次往返；真校验在服务端）
    const miss = this.data.fields.filter((f) => {
      if (!f.required) return false;
      if (f.kind === 'switch') return false;
      return String(f.value || '').trim() === '';
    });
    if (miss.length) {
      wx.showToast({ title: '请填写' + miss[0].label, icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    this.doSave(admin.formToPayload(this.data.type, form));
  },

  async doSave(payload) {
    const r = await admin.save(this.data.type, this.data.id, payload);
    this.setData({ submitting: false });

    if (!r.ok) {
      // 服务端校验不通过：把第一条错误直接说给人听，而不是「保存失败」
      const errs = r.errors || [];
      if (errs.length) {
        wx.showToast({ title: errs[0].message, icon: 'none' });
      } else {
        wx.showToast({ title: r.message || '保存失败', icon: 'none' });
      }
      return;
    }

    wx.showToast({ title: this.data.isEdit ? '已保存' : '已创建', icon: 'none' });

    // 列表页在 onShow 里会重拉（跳转前它自己打了 needReload 标记）
    setTimeout(() => {
      wx.navigateBack({ delta: 1 });
    }, 400);
  },

  onNote() {
    if (!this.data.note) return;
    wx.showModal({
      title: this.data.label,
      content: this.data.note,
      showCancel: false,
      confirmText: '知道了'
    });
  }
});
