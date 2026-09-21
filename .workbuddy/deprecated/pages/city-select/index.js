// pages/city-select/index.js
// 城市选择页：从云数据库读取城市

// 获取云数据库对象
const db = wx.cloud.database();

Page({
  data: {
    hotCities: [],
    cityList: []
  },

  selectType: 'from',

  onLoad(options) {
    this.selectType = options.type || 'from';
    // 从云端加载城市
    this.loadCities();
  },

  /**
   * 从云数据库读取所有城市
   */
  loadCities() {
    wx.showLoading({ title: '加载中...' });

    // 【修复】小程序端 collection.get() 默认且最大只返回 20 条，limit(1000) 无效，
    // 城市超过 20 个会被静默截断。改为按 20 条/页循环拉全（与 utils/storage.getFavorites 同口径）。
    const PAGE = 20;
    const MAX = 1000;
    const fetchPage = skip => db.collection('cities')
      .orderBy('id', 'asc')
      .skip(skip)
      .limit(PAGE)
      .get();

    fetchPage(0).then(function loop(res) {
      const all = (loop.all = loop.all || []).concat(res.data);
      if (res.data.length < PAGE || all.length >= MAX) return all;
      return fetchPage(all.length).then(loop);
    })
      .then(cities => {
        wx.hideLoading();
        // 过滤出热门城市
        const hotCities = cities.filter(c => c.isHot);
        this.setData({ hotCities, cityList: cities });
      })
      .catch(err => {
        wx.hideLoading();
        console.error('城市加载失败', err);
        wx.showToast({ title: '加载失败', icon: 'none' });
      });
  },

  /**
   * 点击选择城市，返回上一页并传值
   */
  onCityTap(event) {
    const city = event.currentTarget.dataset.city;

    const pages = getCurrentPages();
    const prevPage = pages[pages.length - 2];

    if (prevPage) {
      const prevRoute = prevPage.route;

      if (prevRoute === 'pages/index/index') {
        if (this.selectType === 'from') {
          prevPage.setData({ fromCity: city });
        } else {
          prevPage.setData({ toCity: city });
        }
      }

      wx.navigateBack();
    }
  }
});