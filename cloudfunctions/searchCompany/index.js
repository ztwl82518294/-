// cloudfunctions/searchCompany/index.js
// 公司维度聚合查询（用户端）。
//
// 背景：平台现有数据只有 lines 集合（一条线一个文档、带 companyName 字段），
//   没有独立的 companies 集合。截图里的"查公司"页需要的是"公司视角"：
//   一家公司下面挂若干线路、统计出发/到达城市数、发站到站信息。
//   因此本函数做的是「按公司名聚合 lines」，而不是新增一张表。
//
// 为什么放在云函数而不是前端直查：
//   1. 前端 db 查询单次 limit 上限 20 条，聚合一家公司几十条线要循环多次；
//   2. 公司名模糊匹配需要正则，前端直查不便做"简称也能搜到全称"；
//   3. 聚合统计（去重城市数）在服务端一次算完，省流量也省前端算力。
//
// 入参：
//   action  'search'  —— 按关键词搜公司，返回公司卡片列表
//           'detail'  —— 按公司名取详情，返回完整聚合结果
//   keyword 搜索关键词（公司名片段，如 "齐鲁"）
//   name    公司全名（detail 用）
//   limit   返回公司数上限（默认 20，最多 50）
//
// 出参统一 { ok:true, ... } / { ok:false, error }
//
// 【元信息字段的"可能为空"约定】
//   updateText  相对时间文案（如"3天前"）。由 _id 的 ObjectId 时间戳反推
//               （数据里没有时间字段）。无法推导或超过 90 天时返回 ''。
//   viewCount   该公司线路的累计浏览量（stat_events 的 view 事件计数）。
//               无索引支撑、线路过多时主动放弃，返回 0。
//   **两者都可能为空，前端必须条件渲染（有值才显示整项），不得显示占位符。**

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const PAGE = 100;        // 单次 get 条数（服务端上限 100）
const MAX_LINES = 1000;  // 单公司线路拉取上限（防异常数据拖垮函数）
const MAX_COMPANIES = 50;
const DEFAULT_COMPANIES = 20;

// 转义正则元字符，防止用户输入 "(" 之类导致正则非法
function escapeReg(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// VIP 有效口径，必须与 utils/vip.js 的 effectiveVip 一致：
//   isVip===1 且（无到期时间 或 到期时间在未来）
function effectiveVip(line, now) {
  if (!line || line.isVip !== 1) return false;
  const exp = line.vipExpireAt;
  if (!exp) return true;
  return Number(exp) > now;
}

// 时效文案 → 天数上限（与列表页 parseDays 同一口径，便于展示时统一）
function parseDays(aging) {
  if (!aging) return 0;
  const s = String(aging);
  const m = s.match(/(\d+)\s*(?:-\s*(\d+))?\s*天/);
  if (m) return Number(m[2] || m[1]) || 0;
  if (/次日|当天|当日/.test(s)) return 1;
  if (/隔日/.test(s)) return 2;
  return 0;
}

function isDaily(line) {
  const tags = Array.isArray(line.tags) ? line.tags : [];
  if (tags.some(t => /天天发车|天天走车|每日发车|天天/.test(String(t)))) return true;
  return /天天发车|每日/.test(String(line.lineType || ''));
}

// 是否中转线路：
//   数据里没有独立的 transfer 布尔字段，中转语义写在 lineType（"直达"/"中转"）里。
//   列表页的 searchLine 也会注入 transfer，这里两个来源都认。
function isTransfer(line) {
  if (line.transfer === true) return true;
  if (line.transfer === false) return false;
  return /中转|转线|接力/.test(String(line.lineType || ''));
}

// 归一化城市名（与 searchLine 的 normCity 同口径：去"市/区/县/省"后缀）
function normCity(s) {
  return String(s || '').trim().replace(/(市|区|县|省|自治州|盟|地区)$/, '');
}

// ===== 元信息：更新时间 =====
// 【为何用 _id 反推】线路文档里**没有任何时间字段**（已实测 475 条导入数据 0 命中），
// adminLine 的 FIELD_WHITELIST 也不含 createTime/updateTime。
// 但微信云开发的 _id 是标准 ObjectId：前 4 字节（前 8 位十六进制）= 创建时间（Unix 秒）。
// 这是唯一可靠且零成本的时间来源——云函数 add 写入的文档必然符合此规律。
// 若 _id 不是 24 位十六进制（手工指定过 _id 的历史数据），返回空串，前端整项不渲染。
function idTime(id) {
  const s = String(id || '');
  if (!/^[0-9a-fA-F]{24}$/.test(s)) return 0;
  const sec = parseInt(s.slice(0, 8), 16);
  // 合理性校验：2015-01-01 ~ 2100-01-01，防手工造 id 得出荒谬时间
  if (!(sec > 1420070400 && sec < 4102444800)) return 0;
  return sec * 1000;
}

// 时间戳 → 「3天前」这类相对文案。超过 90 天返回空串（不显示，避免"286天前"这种无意义信息）
function relativeText(ts, now) {
  if (!ts) return '';
  const diff = now - ts;
  if (diff < 0) return '';
  const min = Math.floor(diff / 60000);
  if (min < 60) return min <= 1 ? '刚刚' : min + '分钟前';
  const hour = Math.floor(min / 60);
  if (hour < 24) return hour + '小时前';
  const day = Math.floor(hour / 24);
  if (day === 1) return '昨天';
  if (day < 30) return day + '天前';
  const mon = Math.floor(day / 30);
  if (mon < 3) return mon + '个月前';
  return '';
}

// 取一组线路里最新的「更新时间」文案（_id 时间戳最大值）。
// 返回空串表示无可用时间，前端条件渲染时整项隐藏。
function latestUpdateText(lines, now) {
  let max = 0;
  (lines || []).forEach(l => {
    const t = idTime(l._id);
    if (t > max) max = t;
  });
  return relativeText(max, now);
}

// ===== 元信息：浏览量（尽力而为）=====
// 数据来源：stat_events 集合 type='view' 的事件，key 存的是**线路 id**。
//
// 【为何要 try/catch + 上限】stat_events 只有 month_openid / day_openid / month_type
// 三个索引，没有 type+key 索引；_.in(几十个 id) 会退化成扫描。
// 因此本函数：
//   ① 线路 id 超过 VIEW_ID_LIMIT 个时直接放弃（宁可不显示，不拖慢详情页）；
//   ② 任何异常（集合不存在、超时）都吞掉返回 0，绝不影响主流程。
// 前端拿到 0 就不渲染这一项。
const VIEW_ID_LIMIT = 30;
const VIEW_ACTION = 'view';

async function countViews(lineIds) {
  const ids = (lineIds || []).filter(Boolean).slice(0, VIEW_ID_LIMIT);
  if (!ids.length) return 0;
  try {
    const res = await db.collection('stat_events')
      .where({ type: VIEW_ACTION, key: _.in(ids) })
      .count();
    return (res && res.total) || 0;
  } catch (e) {
    console.warn('[searchCompany] 浏览量统计失败（忽略）：', e && e.errMsg);
    return 0;
  }
}

// 拉取某公司全部线路（分页循环，按 _id 排序保证分页稳定）
async function fetchCompanyLines(companyName) {
  const all = [];
  for (let p = 0; p * PAGE < MAX_LINES; p++) {
    const res = await db.collection('lines')
      .where({ companyName })
      .orderBy('_id', 'asc')
      .skip(p * PAGE)
      .limit(PAGE)
      .get();
    const rows = res.data || [];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

// 关键词 → 公司名列表：用公司名索引做前缀/包含匹配
// 策略：先用「包含」正则取一批公司名，再对每个公司名去重。
//   数据量（475 条线路）远小于阈值，直接取回后内存去重是够用的，
//   且能支持"齐鲁"命中"山东齐鲁快运有限公司"这类简称搜索。
async function searchCompanyNames(keyword, limit) {
  const kw = String(keyword || '').trim();
  const re = db.RegExp({ regexp: escapeReg(kw), options: 'i' });

  const all = [];
  for (let p = 0; p * PAGE < MAX_LINES; p++) {
    const res = await db.collection('lines')
      .where({ companyName: re, status: _.neq(0) })
      .field({ companyName: true })
      .skip(p * PAGE)
      .limit(PAGE)
      .get();
    const rows = res.data || [];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }

  // 去重 + 计数（顺带拿到每家公司线路数，用于公司卡片的"覆盖线路"）
  const counter = {};
  all.forEach(r => {
    const n = r.companyName;
    if (!n) return;
    counter[n] = (counter[n] || 0) + 1;
  });

  // 排序：完全等于关键词的最前，其次前缀命中，最后按线路数降序
  const names = Object.keys(counter).sort((a, b) => {
    const score = n => {
      if (n === kw) return 0;
      if (n.indexOf(kw) === 0) return 1;
      return 2;
    };
    const sa = score(a), sb = score(b);
    if (sa !== sb) return sa - sb;
    return counter[b] - counter[a];
  });

  return names.slice(0, limit).map(n => ({ companyName: n, lineCount: counter[n] }));
}

// 汇总一家公司的展示数据（公司卡片用轻量版，详情用完整版）
function summarize(lines, now) {
  const live = (lines || []).filter(l => l.status !== 0);
  const fromCities = [], toCities = [];

  live.forEach(l => {
    const f = normCity(l.fromCityName) || l.fromCityName || '';
    const t = normCity(l.toCityName) || l.toCityName || '';
    if (f && fromCities.indexOf(f) === -1) fromCities.push(f);
    if (t && toCities.indexOf(t) === -1) toCities.push(t);
  });

  // 认证口径：任一在营线路被标记认证，即视为该公司已核实
  const certified = live.some(l => l.certified === 1);
  const vipCount = live.filter(l => effectiveVip(l, now)).length;

  // 主要经营地：出发城市里出现最多的那个
  const cityCount = {};
  live.forEach(l => {
    const f = normCity(l.fromCityName) || l.fromCityName || '';
    if (f) cityCount[f] = (cityCount[f] || 0) + 1;
  });
  const mainCity = Object.keys(cityCount).sort((a, b) => cityCount[b] - cityCount[a])[0] || '';

  // 规模：按线路数粗分（用于公司卡片的"大型/中型/小型"）
  const total = live.length;
  const scale = total >= 20 ? '大型' : (total >= 8 ? '中型' : '小型');

  return {
    companyName: '',
    lineCount: total,
    fromCityCount: fromCities.length,
    toCityCount: toCities.length,
    certified,
    vipCount,
    mainCity,
    scale,
    fromCities,
    toCities
  };
}

// 公司卡片（列表页）：只带必要字段，减少传输
async function actionSearch(event) {
  const keyword = String(event.keyword || '').trim();
  const limit = Math.min(Number(event.limit) || DEFAULT_COMPANIES, MAX_COMPANIES);
  if (!keyword) return { ok: true, keyword, companies: [], total: 0 };

  const now = Date.now();
  const hits = await searchCompanyNames(keyword, limit);

  const companies = [];
  for (const h of hits) {
    const lines = await fetchCompanyLines(h.companyName);
    const s = summarize(lines, now);
    s.companyName = h.companyName;
    // 列表页需要的额外信息
    s.mainCity = s.mainCity || (lines[0] && (normCity(lines[0].fromCityName) || '')) || '';
    // 更新时间：由 _id 反推，取该公司最新一条线路；空串表示无可用时间（前端不渲染）
    s.updateText = latestUpdateText(lines.filter(l => l.status !== 0), now);
    companies.push(s);
  }

  return { ok: true, keyword, total: companies.length, companies };
}

// 公司详情：完整聚合（发站/到站/简介/统计/覆盖线路）
async function actionDetail(event) {
  const name = String(event.name || '').trim();
  if (!name) return { ok: false, error: '缺少公司名称' };

  const now = Date.now();
  const lines = await fetchCompanyLines(name);
  const live = lines.filter(l => l.status !== 0);
  if (!live.length) return { ok: false, error: '该公司暂无在营线路' };

  const s = summarize(lines, now);
  s.companyName = name;

  // ---- 发站 / 到站信息：取公司所有线路的网点，去重后合并 ----
  // 网点形态不统一（老字段 / fromOutlets 数组 / 字符串），统一走同一套解析
  const fromStations = collectStations(live, 'from');
  const toStations = collectStations(live, 'to');

  // ---- 覆盖线路：按出发城市分组 ----
  const groups = [];
  const groupIndex = {};
  live.forEach(l => {
    const city = normCity(l.fromCityName) || l.fromCityName || '其他';
    if (groupIndex[city] === undefined) {
      groupIndex[city] = groups.length;
      groups.push({ city, label: city, lines: [] });
    }
    groups[groupIndex[city]].lines.push({
      id: l.id || l._id,
      _id: l._id,
      ref: l._id || l.id,
      toCityName: normCity(l.toCityName) || l.toCityName || '',
      transfer: isTransfer(l),
      aging: l.aging || '',
      daily: isDaily(l),
      isVip: effectiveVip(l, now) ? 1 : 0
    });
  });
  // 组内按到达城市排序，组间按线路数降序（主力出发地优先）
  groups.forEach(g => g.lines.sort((a, b) => a.toCityName.localeCompare(b.toCityName, 'zh')));
  groups.sort((a, b) => b.lines.length - a.lines.length);

  // ---- 公司简介：无独立字段，按数据特征拼一句客观描述 ----
  const summary = buildSummary(name, s, groups);

  // ---- 头部元信息：更新时间 + 浏览量 ----
  // 两者都可能为空（0 / ''），前端一律条件渲染，不做占位符。
  // 浏览量统计放在最后：它是最不重要、且最容易慢的一步，不影响主数据返回。
  const updateText = latestUpdateText(live, now);
  const viewCount = await countViews(live.map(l => l.id || l._id));

  return {
    ok: true,
    company: {
      companyName: name,
      certified: s.certified,
      vipCount: s.vipCount,
      mainCity: s.mainCity,
      scale: s.scale,
      lineCount: s.lineCount,
      fromCityCount: s.fromCityCount,
      toCityCount: s.toCityCount,
      fromCities: s.fromCities,
      toCities: s.toCities,
      updateText,
      viewCount,
      summary,
      fromStations,
      toStations,
      groups
    }
  };
}

// 收集某侧的站点（去重：同地址同电话视为同一站点）。
//
// 网点形态不统一，必须三种都认（口径与 utils/outlets.js 的 parseOutlets 对齐）：
//   ① 对象数组 [{addr, phone}]        —— 新版 adminLine save/batchSave 写入
//   ② 整段字符串 "地址 | 电话1,电话2"  —— 旧版云函数批量导入 / 控制台直灌
//   ③ 字符串数组 ["地址|电话", ...]    —— 部分历史数据
//   另外老字段 fromAddress/toAddress + fromPhone/toPhone 独立存放，
//   两者可能同时存在，需要都收进来再去重。
//
// 【v6.2】形态②的直灌数据常是"1 个地址行 + N 个纯电话行"。逐行成站会渲染成
// 「① 地址 / ② 地址未填写 / ③ 地址未填写」，看上去像凭空多出两个没填地址的网点。
// R-13 要求"单地址多电话保持 1 网点挂多号"——读端也必须遵守：
// **纯电话行不各自成站，而是并入同一侧的第一个地址站**；该侧无任何地址时
// 才把电话合并成唯一一站（不造"地址未填写"的空行）。
const ROW_SPLIT = /[\r\n;；]+/;
const CELL_SPLIT = /[|｜\t]+/;
const PHONE_SPLIT = /[,，、;；/\s]+/;
const PHONE_LIKE = /^[0-9+\-()（）\s]{7,}$/;

// 解析"地址 | 电话"单行
function parseStationRow(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const cells = s.split(CELL_SPLIT).map(x => x.trim()).filter(Boolean);
  if (cells.length === 0) return null;
  if (cells.length === 1) {
    // 单列：靠"是否像电话"判断这一列是地址还是电话
    return PHONE_LIKE.test(cells[0]) ? { addr: '', phone: cells[0] } : { addr: cells[0], phone: '' };
  }
  return { addr: cells[0], phone: cells.slice(1).join(',') };
}

function collectStations(lines, side) {
  const out = [];
  const seen = {};
  const addrField = side === 'from' ? 'fromAddress' : 'toAddress';
  const phoneField = side === 'from' ? 'fromPhone' : 'toPhone';
  const outletField = side === 'from' ? 'fromOutlets' : 'toOutlets';

  lines.forEach(l => {
    const found = [];

    // 1) 网点字段（数组 / 整段字符串）
    const raw = l[outletField];
    if (Array.isArray(raw)) {
      raw.forEach(o => {
        if (o && typeof o === 'object') {
          found.push({ addr: String(o.addr || o.address || '').trim(), phone: String(o.phone || o.tel || '').trim() });
        } else if (typeof o === 'string') {
          String(o).split(ROW_SPLIT).forEach(row => {
            const p = parseStationRow(row);
            if (p) found.push(p);
          });
        }
      });
    } else if (typeof raw === 'string' && raw.trim()) {
      // 形态②：整段字符串，可能含多行
      raw.split(ROW_SPLIT).forEach(row => {
        const p = parseStationRow(row);
        if (p) found.push(p);
      });
    }

    // 2) 老字段形态：地址 + 电话（与管理端编辑页写入的形态一致）
    const addr = String(l[addrField] || '').trim();
    const phone = String(l[phoneField] || '').trim();
    if (addr || phone) found.push({ addr, phone });

    // 3) 兜底老字段 phone
    if (!addr && !phone && l.phone) {
      found.push({ addr: '', phone: String(l.phone).trim() });
    }

    // ★ v6.2：同一线路内先把"纯电话行"并入第一个地址行，再跨线路去重。
    // 否则同一条线路的 1 地址 + 3 电话会被当成 4 个独立站点。
    const cityName = normCity(side === 'from' ? l.fromCityName : l.toCityName)
      || (side === 'from' ? l.fromCityName : l.toCityName) || '';
    const normPhoneOf = f => (f.phone ? f.phone.split(PHONE_SPLIT).filter(Boolean).join('、') : '');

    const withAddr = found.filter(f => f.addr);
    const tailPhones = [];
    found.filter(f => !f.addr).forEach(f => {
      normPhoneOf(f).split('、').filter(Boolean).forEach(p => {
        if (tailPhones.indexOf(p) === -1) tailPhones.push(p);
      });
    });

    if (withAddr.length === 0) {
      // 该侧完全没有地址：所有电话合成唯一一站
      if (tailPhones.length) {
        pushStation(out, seen, { addr: '', phone: tailPhones.join('、'), cityName });
      }
    } else {
      withAddr.forEach((f, i) => {
        const ps = normPhoneOf(f).split('、').filter(Boolean);
        // 纯电话并入该侧第一个地址站（"单地址多电话 1 网点挂多号"）
        if (i === 0) tailPhones.forEach(p => { if (ps.indexOf(p) === -1) ps.push(p); });
        pushStation(out, seen, { addr: f.addr, phone: ps.join('、'), cityName });
      });
    }
  });

  return out.slice(0, 20); // 单公司展示上限，避免超长
}

// 按"地址 + 归一化电话"去重后入列
function pushStation(out, seen, s) {
  if (!s.addr && !s.phone) return;
  const key = s.addr + '||' + s.phone;
  if (seen[key]) return;
  seen[key] = true;
  out.push(s);
}

// 公司简介：不编造资质/历史，只描述"能看到的事实"
function buildSummary(name, s, groups) {
  const parts = [];
  const cityText = s.fromCities.slice(0, 3).join('、');
  if (cityText) {
    parts.push(`以${cityText}等地为出发地，共覆盖 ${s.fromCityCount} 个出发城市、${s.toCityCount} 个到达城市。`);
  }
  const main = groups[0];
  if (main && main.lines.length) {
    const directs = main.lines.filter(l => !l.transfer).length;
    parts.push(`${main.city}线路 ${main.lines.length} 条（其中直达 ${directs} 条）。`);
  }
  parts.push('以上信息由公开渠道整理，具体运价与时效请与承运方确认。');
  return parts.join('');
}

exports.main = async (event) => {
  const action = event.action || 'search';
  try {
    if (action === 'detail') return await actionDetail(event);
    return await actionSearch(event);
  } catch (e) {
    console.error('[searchCompany] 失败', action, e);
    return { ok: false, error: '查询失败，请稍后重试' };
  }
};
