/**
 * 城市选择器（半屏弹层）
 *
 * PRD 模块 02：「出发地 + 目的地两级选择器（省 → 市逐级选，也可直接输关键字）」
 *
 * 交互设计：
 *   - 顶部有输入框，输入关键字直接搜城市（命中即显示，不用先选省）
 *   - 未输入时显示「热门城市」+ 按省分组的全部城市
 *   - 选中城市后抛出 select 事件，由宿主页面决定是填「出发地」还是「目的地」
 *
 * 为什么不用 picker mode="region"：
 *   微信原生 region picker 是三列滚轮（省/市/区），本场景只需要两级，
 *   且滚轮找城市效率很低（山东16地市要滚半天）。自研弹层可以搜、可以列热门。
 */

const { CITIES, HOT_CITIES } = require('../../data/cities');
const { searchCities, scoreCity } = require('../../utils/search');

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
    /** 当前已选城市名，用于高亮 */
    current: {
      type: String,
      value: ''
    }
  },

  data: {
    keyword: '',
    hotCities: [],
    /** 按省分组：[{ province, cities: [...] }] */
    groups: [],
    /** 搜索命中结果 */
    results: [],
    /** 是否处于搜索结果模式 */
    searching: false
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
      // 省份按其在 CITIES 中的首次出现顺序（山东在前的数据组织已保证排序合理）
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
      const results = searchCities(CITIES, kw).slice(0, 40);
      this.setData({ keyword: kw, results, searching: true });
    },

    onClear() {
      this.setData({ keyword: '', results: [], searching: false });
    },

    /** 选中城市 */
    onPick(e) {
      const name = e.currentTarget.dataset.name;
      if (!name) return;
      const city = CITIES.filter((c) => c.name === name)[0] || null;
      this.triggerEvent('select', { name: name, city: city });
      this.setData({ keyword: '', results: [], searching: false });
    },

    /** 关闭 */
    onClose() {
      this.setData({ keyword: '', results: [], searching: false });
      this.triggerEvent('close');
    },

    noop() {}
  }
});
