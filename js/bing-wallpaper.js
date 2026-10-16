/*  @Moxin1044 2026-10-16
    Bing 每日壁纸：每天一张，不依赖「有没有发新文章」，也不需要重新构建。

    数据源
    Bing 官方的 HPImageArchive 接口不带 access-control-allow-origin，浏览器跨域取不到；
    但它的图片 CDN（www.bing.com/th?id=...）是带 CORS 的。所以走一个能跨域取 JSON 的
    包装接口拿到当天的图片直链，再把这个直链塞给 CSS。

    两级降级
    1. 先取 JSON，拿 url 字段（带日期，当天固定）
    2. JSON 不通就直接把「直出图片」的接口地址当背景——CSS 背景不受跨域限制，
       浏览器自己会跟着 302 走
    两级都不通就保持主题配的渐变底色，不会是白屏

    安全
    图片地址来自第三方，最终要拼进 CSS 的 url("...")。不校验就等于允许对方往
    你页面里注入 CSS（一个带引号和分号的地址就能闭合 url()）。所以这里用严格白名单
    正则过一遍，只接受无引号无括号的 https 地址，不合格就整条丢弃。

    零闪烁
    脚本挂 <head> 里同步执行：当天第二次以后的访问直接从 localStorage 拿地址渲染，
    不发任何请求。取新图放到 DOMContentLoaded。
*/
(function () {
  'use strict';

  var API_EP = 'https://bing.biturl.top/?resolution=1920&format=json&mkt=zh-CN';
  var IMG_EP = 'https://bing.biturl.top/?resolution=1920&format=image&mkt=zh-CN';
  var LS_KEY = 'bing_wallpaper_v1';
  var CSS_ID = 'bing-bg-style';
  var TIMEOUT = 9000;

  /* 第三方地址白名单：https、无空白、无引号、无括号、无反斜杠 */
  var SAFE_URL = /^https:\/\/[A-Za-z0-9._\-]+\/[^\s"'()\\<>]*$/;

  /* 取本地日期 YYYY-MM-DD。不能用 toISOString，那是 UTC，跨时区会差一天 */
  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' +
           ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
           ('0' + d.getDate()).slice(-2);
  }

  function lsGet(k) {
    try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 隐私模式忽略 */ }
  }

  /* 用一个独立的 <style> 元素承载壁纸。主题把 #web_bg 渲染成行内样式，
     而样式表里的 !important 能盖过行内样式，所以走这条路而不是去改行内 style */
  function cssNode() {
    var s = document.getElementById(CSS_ID);
    if (!s) {
      s = document.createElement('style');
      s.id = CSS_ID;
      (document.head || document.documentElement).appendChild(s);
    }
    return s;
  }

  function paintWallpaper(url) {
    if (!SAFE_URL.test(url)) return;                    // 不合格的地址一律不用
    cssNode().textContent =
      '#web_bg{background-image:url("' + url + '")!important;' +
      'background-size:cover!important;' +
      'background-position:center center!important;' +
      'background-repeat:no-repeat!important;}';
  }

  function fetchJSON(url, ms) {
    return new Promise(function (resolve, reject) {
      var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctl) ctl.abort(); reject(new Error('timeout')); }, ms);
      fetch(url, ctl ? { signal: ctl.signal, cache: 'no-store' } : { cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('http ' + r.status);
          return r.json();
        })
        .then(function (j) { clearTimeout(timer); resolve(j); })
        .catch(function (e) { clearTimeout(timer); reject(e); });
    });
  }

  /* ============ 第一阶段：<head> 里立刻执行 ============ */
  (function early() {
    var c = lsGet(LS_KEY);
    if (c && c.day === todayKey() && c.url) {
      paintWallpaper(c.url);            // 当天已取过，直接顶上，零请求零闪烁
    } else {
      cssNode();                        // 先建好节点，等下面拿到新图再填
    }
  })();

  /* ============ 第二阶段：DOM 就绪后 ============ */
  function refresh() {
    fetchJSON(API_EP, TIMEOUT)
      .then(function (j) {
        var url = j && j.url;
        if (url && SAFE_URL.test(url)) {
          lsSet(LS_KEY, { day: todayKey(), url: url });
          paintWallpaper(url);
          return;
        }
        throw new Error('url 字段不可用');
      })
      .catch(function () {
        // 降级：直出图片的接口地址。CSS 背景不跨域，浏览器会自己跟 302
        paintWallpaper(IMG_EP);
      });
  }

  function boot() {
    var c = lsGet(LS_KEY);
    if (!(c && c.day === todayKey() && c.url)) refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
