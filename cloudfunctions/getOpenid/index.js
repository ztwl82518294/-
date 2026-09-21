// cloudfunctions/getOpenid/index.js
// 云函数：获取当前调用者的 openid（微信身份）

// 引入微信服务端 SDK
const cloud = require('wx-server-sdk');

// 初始化云环境，使用当前环境
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 云函数入口函数
exports.main = async (event, context) => {
  // 获取微信调用上下文，里面包含调用者的身份信息
  const wxContext = cloud.getWXContext();

  // 返回调用者的 openid
  return {
    openid: wxContext.OPENID,
    appId: wxContext.APPID
  };
};