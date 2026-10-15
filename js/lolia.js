/*  @Moxin1044 2026-10-15
    Lolia 二次元：博客壁纸（每天一张）+ 缺省文章封面（每次刷新一张）

    设计要点
    1. 全部在浏览器端完成。改一次配置之后每天自动换，不需要重新构建博客，
       也不依赖你有没有发新文章。
    2. 脚本挂在 <head> 里同步执行：一进来就用 localStorage 里当天的地址注入样式，
       所以当天第二次以后的访问是零闪烁的。取新图和换封面放到 DOMContentLoaded。
    3. Lolia 的 CDN 会用 200 状态码返回 HTML 错误页（实测 988 字节 text/html），
       所以取图必须校验 content-type 和体积，只看状态码会被骗。
    4. 服务端还有两三成的偶发失败率，所以取图都带重试。
    5. 壁纸按「本地日期」缓存，当天只取一次；封面不加缓存，每次刷新都换新的。
*/
(function () {
  'use strict';

  var WALLPAPER_EP = 'https://www.loliapi.com/acg/pc/';  // 壁纸走横屏接口
  var COVER_EP     = 'https://www.loliapi.com/acg/';     // 封面走自适应接口
  var MARK         = 'lolia-cover';                      // 占位图文件名的一部分
  var LS_KEY       = 'lolia_wallpaper_v1';
  var CSS_ID       = 'lolia-bg-style';
  var RETRY        = 5;
  var MIN_BYTES    = 10000;                              // 小于这个体积肯定不是正常图

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

  /* 用一个独立的 <style> 元素承载壁纸，避免和主题行内样式的优先级打架 */
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
    cssNode().textContent =
      '#web_bg{background-image:url("' + url + '")!important;' +
      'background-size:cover!important;' +
      'background-position:center center!important;' +
      'background-repeat:no-repeat!important;}';
  }

  /* 取一张真图：校验类型和体积，失败重试，最后把**重定向后的真实地址**回调出去 */
  function pickImage(ep, onDone, tries) {
    tries = tries || 0;
    fetch(ep, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.blob().then(function (b) {
          if (!/^image\//.test(b.type) || b.size < MIN_BYTES) {
            throw new Error('坏响应 ' + b.type + ' ' + b.size);
          }
          return r.url;
        });
      })
      .then(onDone)
      .catch(function () {
        if (tries < RETRY) {
          setTimeout(function () { pickImage(ep, onDone, tries + 1); }, 400);
        }
      });
  }

  /* ============ 第一阶段：<head> 里立刻执行 ============ */
  (function earlyWallpaper() {
    var c = lsGet(LS_KEY);
    if (c && c.day === todayKey() && c.url) {
      paintWallpaper(c.url);              // 先拿当天的旧图顶上，零闪烁
    } else {
      cssNode();                          // 建好节点，等下面取到新图再填
    }
  })();

  /* ============ 第二阶段：DOM 就绪后 ============ */
  function refreshWallpaper() {
    pickImage(WALLPAPER_EP, function (url) {
      lsSet(LS_KEY, { day: todayKey(), url: url });
      paintWallpaper(url);
    });
  }

  /* 封面：没有封面的文章，每次刷新换一张。

     主题开了 vanilla-lazyload（data_src 配的是 'lazy-src'），
     真实地址落在 data-lazy-src 上，src 只是个 1x1 透明占位 GIF，
     所以两个属性都要写，否则会被懒加载库覆盖回去。

     这里走 fetch + blob 而不是直接塞 img.src，是为了能校验：
     CDN 会用 200 状态码返回 HTML 错误页，只看状态码会被骗；
     顺便还能把过大的图重抽掉，免得首页挂一张 4MB 的封面。 */
  var MAX_COVER_BYTES = 3000000;

  function swapOneCover(img, tries) {
    if (tries > 5) return;                 // 一直失败就保留占位图，别把页面搞乱
    fetch(COVER_EP + '?_=' + Math.random().toString(36).slice(2), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.blob();
      })
      .then(function (b) {
        if (!/^image\//.test(b.type) || b.size < MIN_BYTES) throw new Error('坏响应');
        if (b.size > MAX_COVER_BYTES) throw new Error('图太大');   // 重抽一张
        var u = URL.createObjectURL(b);
        img.onerror = null;                // 关掉主题内联的 404 占位逻辑
        img.setAttribute('data-lazy-src', u);
        img.src = u;
      })
      .catch(function () {
        setTimeout(function () { swapOneCover(img, tries + 1); }, 350);
      });
  }

  function bootCovers() {
    // 懒加载还没跑时匹配 data-lazy-src，已经跑过时匹配 src，两边都兜住
    var imgs = document.querySelectorAll(
      'img[data-lazy-src*="' + MARK + '"], img[src*="' + MARK + '"]'
    );
    for (var i = 0; i < imgs.length; i++) {
      swapOneCover(imgs[i], 0);
    }
  }

  function boot() {
    var c = lsGet(LS_KEY);
    // 当天已经有图了就不再去取，免得每次翻页都白下载一整张
    if (!(c && c.day === todayKey() && c.url)) {
      refreshWallpaper();
    }
    bootCovers();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
