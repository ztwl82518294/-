#!/usr/bin/env node
/**
 * 两套后台的护栏测试
 *
 * 为什么单独立一套：
 *   项目现在有**两个写入口** —— 桌面后台写「本地副本」、小程序后台「直接写云端」。
 *   二者的数据会在某一次「把本地副本导入云端」时被静默对冲：
 *   手机上的改动**整批消失，且不报错、不可恢复**，是当前最严重的一类运营事故。
 *
 * 而这件事的防线是**分散的**：文档写着、导出脚本打印着、后台首页挂着一张常驻提醒卡。
 * 分散的好处是绕不过去；坏处是把任何一处当冗余删掉，防线就悄悄破了。
 * 这套测试的作用就是：把这三处的存在钉成契约，删了就红。
 *
 * ★ 它不是在测功能逻辑，是在测「护栏还在不在」—— 这正是需要自动化的那类东西，
 *   因为人工永远会在某次清理时顺手删掉「看起来是注释」的东西。
 */

const fs = require('fs');
const path = require('path');
const { describe, test, eq, ok, summary, settle } = require('../framework');
const { stripComments } = require('../../scripts/lib/src-scan');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/**
 * 读源码且**剥掉注释**后再静态扫描
 *
 * ★★ 必须剥注释：utils/admin.js 的注释里写着「页面里不允许出现 .collection(」，
 *    不剥注释时，这句解释禁令的话会被当成违反禁令的代码 ⇒ 假警报。
 *    本项目这条规矩是踩过两次踩出来的（见 scripts/lib/src-scan.js 头注释）。
 */
const readSrc = (rel) => stripComments(read(rel));
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const ADMIN_PAGES = ['index', 'list', 'edit', 'quality', 'import'];

/* ============================================================
 * 文档：风险必须写在明面上
 * ============================================================ */

describe('两套后台的文档', () => {
  test('小程序后台说明文档存在', () => {
    ok(exists('docs/小程序后台使用说明.md'), '缺少 docs/小程序后台使用说明.md');
  });

  test('文档里写明了「别用本地副本覆盖云端」这条铁律', () => {
    const s = read('docs/小程序后台使用说明.md');
    ok(s.indexOf('覆盖云端') > 0, '缺少「覆盖云端」的警示章节');
    ok(s.indexOf('--admin-only') > 0, '没有给出安全替代命令 --admin-only');
  });

  test('文档里写明了怎么开通：ADMIN_OPENIDS', () => {
    ok(read('docs/小程序后台使用说明.md').indexOf('ADMIN_OPENIDS') > 0, '没写 ADMIN_OPENIDS 的配置方式');
  });

  /*
   * ★ 这条守的是一个已经踩过的坑（用户反馈「首页底部没有管理这项」）：
   *   入口设计为「只有管理员才渲染」，于是「必须先是管理员才能看到入口」和
   *   「得先用 openid 才能成为管理员」互相锁死 —— 文档第一版还在教人从入口进去，
   *   照着做根本绕不出来。破局点是：后台首页对非管理员也显示 openid，
   *   用开发者工具的编译模式把它设为启动页直接打开即可。
   *   这段话一旦被「精简」掉，下一个人又会卡在同一处。
   */
  test('文档给出了首次开通的破局路径（绕开隐藏入口）', () => {
    const s = read('docs/小程序后台使用说明.md');
    ok(s.indexOf('pages/admin/index/index') > 0, '没写用启动页面 pages/admin/index/index 直接进去');
    ok(s.indexOf('编译模式') > 0, '没提到「添加编译模式」这个入口');
  });

  test('桌面后台文档也标出了同一条冲突', () => {
    const s = read('docs/管理后台使用说明.md');
    ok(s.indexOf('本地副本不等于云端') > 0, '桌面后台文档缺少第三条硬规矩');
    ok(s.indexOf('小程序后台使用说明.md') > 0, '桌面后台文档没有指向小程序后台文档的链接');
  });
});

/* ============================================================
 * 脚本：危险的导入路径必须有警告
 * ============================================================ */

describe('export-seed 的覆盖云端警告', () => {
  test('存在 warnCloudOverwrite，且在产出导入数据前被调用', () => {
    const s = read('scripts/export-seed.js');
    ok(s.indexOf('function warnCloudOverwrite') > 0, '缺少 warnCloudOverwrite 函数');
    // 调用点必须在这条分支之前：stdoutOnly 分支会直接 return
    const callAt = s.indexOf('warnCloudOverwrite()');
    const branchAt = s.indexOf('if (stdoutOnly)');
    ok(callAt > 0, '定义了函数却没调用');
    ok(callAt < branchAt, '警告必须在 stdoutOnly 分支之前发出，否则只打印不走 write 的那条路就漏了');
  });

  test('警告文案说清了后果与安全替选', () => {
    const s = read('scripts/export-seed.js');
    ok(s.indexOf('整表覆盖') > 0, '没说明是整表覆盖而非增量合并');
    ok(s.indexOf('--admin-only') > 0, '没给出安全替选 --admin-only');
  });
});

/* ============================================================
 * 页面：提醒卡必须常驻
 * ============================================================ */

describe('小程序后台首页的常驻提醒卡', () => {
  test('提醒卡仍在（这条防线不能靠文档单打独斗）', () => {
    const s = read('pages/admin/index/index.wxml');
    ok(s.indexOf('桌面后台的本地副本会就此过期') > 0, '提醒卡文案被删改了');
  });
});

describe('首页隐藏入口的可诊断性', () => {
  /*
   * ★ 这条守的是「能不能定位」而不是「能不能用」：
   *   入口不出现的成因有四种（云函数没部署 / 白名单空 / 填错 openid / 换号），
   *   界面表现却完全一致。没有这条日志时，连我们自己都被卡住过。
   *   它只在开发者工具 Console 可见，删掉不会有任何测试变红 —— 所以要专门钉住。
   */
  test('checkAdmin 对失败原因写明了可查的解释', () => {
    const s = readSrc('pages/index/index.js');
    ok(s.indexOf('checkAdmin') > 0, '找不到 checkAdmin');
    ['NO_FUNC', 'NOT_CONFIGURED', 'NOT_ADMIN'].forEach((code) => {
      ok(s.indexOf(code) > 0, '缺少 ' + code + ' 这句人话解释');
    });
  });
});

/* ============================================================
 * 通道：任何一条旁路都会架空服务端鉴权
 * ============================================================ */

describe('小程序后台的数据通道', () => {
  test('utils/admin.js 走云函数 adminApi', () => {
    const s = readSrc('utils/admin.js');
    ok(s.indexOf("callFunction") > 0, '没有调用云函数');
    ok(s.indexOf("'adminApi'") > 0 || s.indexOf('"adminApi"') > 0, '调用的不是 adminApi');
  });

  test('后台页不直连数据库', () => {
    const s = readSrc('utils/admin.js');
    eq(s.indexOf('.collection(') < 0, true, 'utils/admin.js 里出现了 .collection(');
  });

  ADMIN_PAGES.forEach((p) => {
    test('pages/admin/' + p + ' 走 utils/admin 且不碰集合', () => {
      const s = readSrc('pages/admin/' + p + '/index.js');
      ok(/require\(['"][^'"]*utils\/admin['"]\)/.test(s), '没有 require utils/admin');
      eq(s.indexOf('.collection(') < 0, true, '页面里出现了 .collection(');
    });
  });
});

/* ============================================================
 * 鉴权白名单
 * ============================================================ */

describe('管理员白名单', () => {
  test('adminApi 留出可测的 ADMIN_OPENIDS 出口且是数组', () => {
    const s = read('cloudfunctions/adminApi/index.js');
    ok(s.indexOf('module.exports.ADMIN_OPENIDS') > 0, '没有导出 ADMIN_OPENIDS（测试无法注入）');
    ok(/const\s+ADMIN_OPENIDS\s*=\s*\[/.test(s), 'ADMIN_OPENIDS 不是数组字面量');
  });

  test('白名单为空时必须拒绝，不能放行', () => {
    const s = read('cloudfunctions/adminApi/index.js');
    const i = s.indexOf('if (!ADMIN_OPENIDS.length)');
    ok(i > 0, '缺少白名单为空的分支');
    const seg = s.slice(i, i + 200);
    ok(seg.indexOf('NOT_CONFIGURED') > 0, '白名单为空应返回 NOT_CONFIGURED，而不是放行');
  });
});

settle().then(() => {
  process.exit(summary('two-backends') ? 0 : 1);
});
