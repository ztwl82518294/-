// components/region-picker/index.js
// 地区选择半屏弹层（省市县三级，面包屑导航）。
//
// 设计要点（对应需求"选择目的地（省/市/区县）"）：
//   1. 不是一次性选三列，而是"逐级下钻"：省 → 市 → 区县，面包屑可点击回退；
//   2. 「不选具体区县，点确定表示全市」—— 这是货主最常用的语义，
//      货主往往只关心"到南充"而不是"到南充市高坪区"；
//   3. 只做选择、不发请求：确定后通过 event 把结果抛给页面，
//      由页面决定是查专线还是查公司（保持组件无业务耦合）。
//
// 数据来源：utils/region-data.js（由云函数 regionData.js 自动同步生成），
//   保证展示的地区树与搜索匹配用的行政区划表是同一份，不会漂移。

const region = require('../../utils/region-data.js');

const { MUNICIPALITIES, PROVINCE_CITIES, CITY_COUNTIES, displayName } = region;

// 直辖市在"省"一级不叫省，但仍作为一个可点选的顶层项
const MUNICIPALITY_KEYS = Object.keys(MUNICIPALITIES);

Component({
  options: {
    // 允许外部页面通过 class 传入样式，同时保持样式隔离
    addGlobalClass: true
  },

  properties: {
    show: { type: Boolean, value: false },
    // 弹层标题，如 "选择目的地（省/市/区县）"
    title: { type: String, value: '选择地区' },
    // 已选值，用于回显（形如 { province, city, county }）
    value: { type: Object, value: null }
  },

  data: {
    // 导航层级：0=省，1=市，2=区县
    level: 0,
    province: '',
    city: '',
    county: '',
    // 当前层级要展示的列表（每项 { name, label, hasChild }）
    list: [],
    // 面包屑（省 / 市 / 区县），未选到的不出现
    crumbs: []
  },

  observers: {
    'show': function (show) {
      if (show) this.reset();
    }
  },

  methods: {
    // 每次打开都从"省"这一级重新开始，但已选值作为初始路径回显
    reset() {
      const v = this.data.value || {};
      if (v.province) {
        this.setData({ level: 0, province: '', city: '', county: '' });
        // 逐级走一遍，把已选路径铺开
        this.pickProvince(v.province, true);
        if (v.city) {
          this.pickCity(v.city, true);
          if (v.county) this.pickCounty(v.county, true);
        }
      } else {
        this.setData({ level: 0, province: '', city: '', county: '' });
        this.renderLevel();
      }
    },

    // ---- 列表渲染 ----
    // 当前层级 -> 列表数据
    renderLevel() {
      const { level, province, city } = this.data;
      let names = [];
      let childrenOf = null;

      if (level === 0) {
        // 省一级 = 直辖市 + 省份
        names = MUNICIPALITY_KEYS.concat(Object.keys(PROVINCE_CITIES));
        // 直辖市名与省份名理论上不重名；去重兜底
        names = names.filter((n, i) => names.indexOf(n) === i);
        childrenOf = n => (MUNICIPALITIES[n] ? MUNICIPALITIES[n] : PROVINCE_CITIES[n]);
      } else if (level === 1) {
        names = PROVINCE_CITIES[province] || MUNICIPALITIES[province] || [];
        childrenOf = n => CITY_COUNTIES[n];
      } else {
        names = CITY_COUNTIES[city] || [];
        childrenOf = () => null;
      }

      const list = names.map(n => {
        const kids = childrenOf(n);
        return {
          name: n,
          label: this.decorate(n),
          hasChild: !!(kids && kids.length)
        };
      });

      this.setData({ list });
      this.renderCrumbs();
    },

    // 展示名：省名补"省"，市/区县走 displayName
    decorate(name) {
      const { level } = this.data;
      if (level === 0) {
        if (MUNICIPALITY_KEYS.indexOf(name) !== -1) return name; // 北京/天津/上海/重庆
        return name + '省';
      }
      return displayName(name);
    },

    renderCrumbs() {
      const { level, province, city, county } = this.data;
      const crumbs = [];
      if (province) crumbs.push({ name: province, level: 0 });
      // 直辖市的"市"一级就是它自己，不再重复显示
      if (city && city !== province) crumbs.push({ name: city, level: 1 });
      if (county) crumbs.push({ name: county, level: 2 });
      this.setData({ crumbs });
    },

    // ---- 逐级选择 ----
    pickProvince(name, silent) {
      const isMuni = MUNICIPALITY_KEYS.indexOf(name) !== -1;
      this.setData({ province: name, city: '', county: '', level: 1 });
      // 直辖市没有中间层：区县直接挂在它下面，但要先看它有没有子项
      if (isMuni) {
        const kids = MUNICIPALITIES[name] || [];
        if (!kids.length) {
          // 极少数没有子表的直辖市（当前数据里不存在），停留并可确定
          this.setData({ level: 0 });
          this.renderLevel();
          return;
        }
      }
      this.renderLevel();
      if (!silent) this.emitChange();
    },

    pickCity(name, silent) {
      this.setData({ city: name, county: '', level: 2 });
      this.renderLevel();
      if (!silent) this.emitChange();
    },

    pickCounty(name, silent) {
      this.setData({ county: name, level: 2 });
      this.renderCrumbs();
      if (!silent) this.emitChange();
    },

    // 列表项点击：按当前层级决定落到哪一级
    onItemTap(e) {
      const name = e.currentTarget.dataset.name;
      const { level } = this.data;
      if (level === 0) {
        this.pickProvince(name);
      } else if (level === 1) {
        if (this.data.list.find(i => i.name === name && i.hasChild)) {
          this.pickCity(name);
        } else {
          // 没有下级（如济源、嘉峪关），当前项即为最终选择
          this.setData({ county: '', level: 1 });
          this.renderCrumbs();
          this.emitChange();
        }
      } else {
        this.pickCounty(name);
      }
    },

    // 面包屑回退：点"四川省"回到市那一级
    onCrumbTap(e) {
      const lv = Number(e.currentTarget.dataset.level);
      if (lv === 0) {
        this.setData({ level: 0, province: '', city: '', county: '' });
      } else if (lv === 1) {
        this.setData({ level: 1, city: '', county: '' });
      }
      this.renderLevel();
    },

    // 把当前选择抛给页面；页面决定"查专线"还是"查公司"
    emitChange() {
      const { province, city, county } = this.data;
      const isMuni = MUNICIPALITY_KEYS.indexOf(province) !== -1;
      // 展示文本：优先区县 > 市 > 省
      const text = county ? displayName(county) : (city ? displayName(city) : province);
      // 查询用的城市字段：区县存在时用其所属市（搜索索引是市级),
      // 否则用市名，再否则用省名（省名走"全境"匹配由云函数处理）
      const queryCity = city || (isMuni ? county : province);
      this.triggerEvent('change', {
        province,
        city,
        county,
        text,
        queryCity: queryCity || '',
        isMunicipality: isMuni
      });
    },

    // ---- 外部动作 ----
    onCancel() {
      this.triggerEvent('cancel');
    },

    // 「确定」：不选具体区县也合法，表示"全市"
    onConfirm() {
      const { province, city, county } = this.data;
      if (!province) {
        wx.showToast({ title: '请先选择省份', icon: 'none' });
        return;
      }
      // 省一级还没往下走：语义是"全省"，提示一下避免误操作
      if (!city && !county) {
        this.emitChange();
        this.triggerEvent('confirm');
        return;
      }
      this.emitChange();
      this.triggerEvent('confirm');
    },

    // 遮罩点击 = 取消
    onMaskTap() {
      this.triggerEvent('cancel');
    },

    // 阻止弹层内部点击穿透到遮罩
    noop() {}
  }
});
