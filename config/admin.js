// config/admin.js
// 管理员 openid 白名单（前端展示用途）
// 【注意】真实权限以云函数侧校验为准（单点配置在数据库 app_config 集合 doc 'admins'）。
// 此文件只控制"我的"页是否显示管理后台入口，改它不会带来任何写权限。
// 云函数侧名单变更请直接改数据库文档，无需发版。

module.exports = {
  ADMIN_OPENIDS: [
    'oxWBc15BpD7x2BR7O5u1O7TjBnGo'
  ]
};