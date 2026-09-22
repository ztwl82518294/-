/**
 * 出发地 / 目的地选择器（半屏弹层，两级：城市 → 区县）
 *
 * PRD 模块 02：「出发地 + 目的地两级选择器（省 → 市逐级选，也可直接输关键字）」
 * 2026-09-22 扩展：第二级由「市」下沉到「区县」，补上直辖市以下的缺口。
 *
 * 交互：
 *   一级：热门城市 + 按省分组的城市网格，顶部可搜索
 *   二级：点城市进入 —— 顶部「全市（不限区县）」，下面是该城市的区县网格
 *   搜索：城市与区县一起搜（输入「朝阳」能出「朝阳区 · 北京」），
 *         点区县直接选定，点城市进二级
 *
 * ★★ 关键约定：本组件**只负责选地方，不负责查线路**。
 *   它抛出的 detail 里 city 是查询用的城市、area 只是展示用的细化。
 *   专线库是按城市收录的，不存在「济南-朝阳区」这种线路，
 *   所以宿主页面必须**用 city 去查**，不能拿 area 去查 —— 否则永远查不到。
 *
 * 为什么不用 picker mode="region"：
 *   微信原生 region picker 是三列滚轮，本项目只需要两级，
 *   且滚轮找城市效率很低（山东 16 地市要滚半天）。自研弹层可以搜、可以列热门。
 */

const { CITIES, HOT_CITIES } = require('../../data/cities');
const area = require('../../utils/area');

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    /** 标题，如「选择出发地」 */
    title: {
      type: String,
      value: '选择城市'
    },
    /** 当前已选城市（用于高亮） */
    currentCity: {
      type: String,
      value: ''
    },
    /** 当前已选区县（用于高亮，可为空表示全市） */
    currentArea: {
      type: String,
      value: ''
    }
  },

  data: {
    keyword: '',
    hotCities: [],
    /** 按省分组：[{ province, cities: [...] }] */
    groups: [],
    /** 搜索命中结果（城市 + 区县混合） */
    results: [],
    searching: false,

    /** 当前层级：1 = 城市，2 = 区县 */
    level: 1,
    /** 二级时所在的城市 */
    curCity: '',
    /** 二级时所在城市的省（展示用） */
    curProvince: '',
    /** 二级的区县列表 */
    areas: []
  },

  lifetimes: {
    attached() {
      this.buildGroups();
    }
  },

  methods: {
    /** 按省分组构建完整城市列表（只算一次，缓存在 data） */
    buildGroups() {
      const map = {};
      const order = [];
      CITIES.forEach((c) => {
        if (!map[c.province]) {
          map[c.province] = [];
          order.push(c.province);
        }
        map[c.province].push(c);
      });
      const groups = order.map((p) => ({
        province: p,
        cities: map[p].slice().sort((a, b) => (a.sortOrder || 999) - (b.sortOrder || 999))
      }));
      this.setData({
        groups,
        hotCities: HOT_CITIES.slice().sort((a, b) => (a.sortOrder || 999) - (b.sortOrder || 999))
      });
    },

    onInput(e) {
      const kw = String((e.detail && e.detail.value) || '').trim();
      if (!kw) {
        this.setData({ keyword: '', results: [], searching: false });
        return;
      }
      const results = area.searchPlaces(kw, 40);
      this.setData({ keyword: kw, results, searching: true });
    },

    onClear() {
      this.setData({ keyword: '', results: [], searching: false });
    },

    /**
     * 一级：点城市
     * 该城市有区县 → 进二级；没有区县 → 直接按全市选定（不多此一举）
     */
    onPickCity(e) {
      const name = e.currentTarget.dataset.name;
      if (!name) return;
      this.enterCity(name);
    },

    /** 搜索结果点击：区县直接选定，城市进二级 */
    onPickResult(e) {
      const idx = Number(e.currentTarget.dataset.index);
      const it = this.data.results[idx];
      if (!it) return;
      if (it.type === 'area') {
        this.emit(it.city, it.area);
        return;
      }
      this.enterCity(it.city);
    },

    /** 进入某城市的区县二级页 */
    enterCity(city) {
      const list = area.areasOf(city);
      if (!list.length) {
        // 该城市没有区县数据：直接按全市选定，不要弹一个空白的二级页
        this.emit(city, '');
        return;
      }
      let province = '';
      CITIES.forEach((c) => { if (c.name === city) province = c.province || ''; });
      this.setData({
        level: 2,
        curCity: city,
        curProvince: province,
        areas: list,
        keyword: '',
        results: [],
        searching: false
      });
    },

    /** 二级：选「全市」 */
    onPickWhole() {
      if (!this.data.curCity) return;
      this.emit(this.data.curCity, '');
    },

    /** 二级：选某个区县 */
    onPickArea(e) {
      const a = e.currentTarget.dataset.name;
      if (!a || !this.data.curCity) return;
      this.emit(this.data.curCity, a);
    },

    /** 二级返回一级 */
    onBack() {
      this.setData({ level: 1, curCity: '', curProvince: '', areas: [] });
    },

    /**
     * 抛出选中结果
     * @param {string} city 城市（★ 宿主页面应拿这个去查线路）
     * @param {string} a    区县（可空，只用于展示）
     */
    emit(city, a) {
      const label = area.formatPlace(city, a);
      this.reset();
      this.triggerEvent('select', {
        city: city,
        area: a || '',
        name: label,
        label: label
      });
    },

    /** 关闭并复位（下次打开回到一级，不残留上次的位置） */
    onClose() {
      this.reset();
      this.triggerEvent('close');
    },

    reset() {
      this.setData({
        keyword: '',
        results: [],
        searching: false,
        level: 1,
        curCity: '',
        curProvince: '',
        areas: []
      });
    },

    noop() {}
  }
});
