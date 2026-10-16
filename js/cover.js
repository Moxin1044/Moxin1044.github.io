/*  @Moxin1044 2026-10-16
    文章封面：没有写 cover 的文章，每次刷新换一张随机封面。

    壁纸不在这里，见 bing-wallpaper.js —— 之前壁纸和封面合在一个文件里用的是同一个
    图源，现在壁纸改回 Bing 每日一图，这里只管封面。

    为什么走 fetch + blob 而不是直接塞 img.src：
    Lolia 的 CDN 会用 200 状态码返回 HTML 错误页（实测 988 字节 text/html），
    只看状态码会被骗，所以必须校验 content-type 和体积；顺便还能把过大的图重抽掉，
    免得首页挂一张几 MB 的封面。

    懒加载的坑：主题开了 vanilla-lazyload（data_src 配的是 'lazy-src'），真实地址
    落在 data-lazy-src 上，src 只是个 1x1 透明占位 GIF。所以两个属性都要写，
    否则会被懒加载库按 data-lazy-src 覆盖回去。
*/
(function () {
  'use strict';

  var COVER_EP = 'https://www.loliapi.com/acg/';   // 封面走自适应接口
  var MARK = 'lolia-cover';                        // 占位图文件名的一部分
  var MIN_BYTES = 10000;                           // 小于这个体积肯定不是正常图
  var MAX_COVER_BYTES = 3000000;                   // 大于这个就重抽
  var MAX_TRIES = 5;

  function swapOneCover(img, tries) {
    if (tries > MAX_TRIES) return;                 // 一直失败就保留占位图，别把页面搞乱
    fetch(COVER_EP + '?_=' + Math.random().toString(36).slice(2), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.blob();
      })
      .then(function (b) {
        if (!/^image\//.test(b.type) || b.size < MIN_BYTES) throw new Error('坏响应');
        if (b.size > MAX_COVER_BYTES) throw new Error('图太大');
        var u = URL.createObjectURL(b);
        img.onerror = null;                        // 关掉主题内联的 404 占位逻辑
        img.setAttribute('data-lazy-src', u);
        img.src = u;
      })
      .catch(function () {
        setTimeout(function () { swapOneCover(img, tries + 1); }, 350);
      });
  }

  function boot() {
    // 懒加载还没跑时匹配 data-lazy-src，已经跑过时匹配 src，两边都兜住
    var imgs = document.querySelectorAll(
      'img[data-lazy-src*="' + MARK + '"], img[src*="' + MARK + '"]'
    );
    for (var i = 0; i < imgs.length; i++) {
      swapOneCover(imgs[i], 0);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
