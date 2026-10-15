/*  @Moxin1044 2026-10-16
    GitHub 贡献热力图（首页卡片）

    为什么不用 hexo-filter-gitcalendar
    网上流传的那套教程（zsyyblog.com/a29f1c7b.html）依赖 hexo-filter-gitcalendar 插件
    加 akilar 的公共 API，实测两样都有问题：插件最后更新停在 2023-01-02，而
    gitcalendar.akilar.top 已经连不上了（curl 直接 connect 失败）。照抄配不出来。

    换成浏览器端方案
    数据取 github-contributions-api.jogruber.de 的 JSON 接口，它带
    access-control-allow-origin: *，可以跨域直取。渲染全部在浏览器里做，所以不需要装
    任何插件，也不需要重新构建，接口哪天数据变了页面上自动跟着变。

    降级
    这个接口在国外。取不到就退到 ghchart.rshah.org 的 SVG 图（一张静态贡献图）；
    还是失败就把卡片整个拿掉，不留一个空框在那。

    挂在哪儿
    首页 #recent-posts 的第一个位置，也就是文章列表上方。只在首页渲染，
    其他页面（文章页、归档、分类）直接跳过。
*/
(function () {
  'use strict';

  var USER      = 'Moxin1044';                                     // GitHub 用户名
  var API       = 'https://github-contributions-api.jogruber.de/v4/' + USER + '?y=last';
  var FALLBACK  = 'https://ghchart.rshah.org/' + USER;             // 静态 SVG 兜底
  var HTML_URL  = 'https://github.com/' + USER;
  var CARD_ID   = 'gc-card';
  var LS_KEY    = 'gitcalendar_cache_v1';
  var CACHE_MS  = 6 * 60 * 60 * 1000;                              // 6 小时，够避免反复打接口
  var TIMEOUT   = 9000;
  var WEEK_CN   = ['日', '一', '二', '三', '四', '五', '六'];

  /* 本地日期 YYYY-MM-DD。不能用 toISOString，那是 UTC，东八区早上会算成昨天 */
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

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* 卡片骨架，先插进页面，数据到了再填内容 */
  function buildCard() {
    var card = el('div', 'gc-card');
    card.id = CARD_ID;

    var head = el('div', 'gc-head');
    var title = el('div', 'gc-title');
    title.appendChild(el('i', 'fas fa-calendar-check gc-icon'));
    title.appendChild(el('span', null, 'GitHub 贡献'));
    var meta = el('span', 'gc-total', '');
    meta.id = 'gc-total';
    title.appendChild(meta);
    head.appendChild(title);

    var link = el('a', 'gc-link', 'GitHub');
    link.href = HTML_URL;
    link.target = '_blank';
    link.rel = 'noopener';
    head.appendChild(link);
    card.appendChild(head);

    var body = el('div', 'gc-body');
    body.id = 'gc-body';
    body.appendChild(el('div', 'gc-loading', '正在取贡献数据…'));
    card.appendChild(body);

    var tip = el('div', 'gc-tip');
    tip.id = 'gc-tip';
    card.appendChild(tip);

    return card;
  }

  /* 月份标签 + 星期标签 + 格子网格 */
  function render(payload, card) {
    var days = payload.contributions || [];
    if (!days.length) return false;

    var body = card.querySelector('#gc-body');
    body.innerHTML = '';

    var total = payload.total && payload.total.lastYear != null ? payload.total.lastYear : null;
    if (total != null) {
      card.querySelector('#gc-total').textContent = '近一年 ' + total + ' 次';
    }

    /* 首日补空格，让每一列都对齐到周日那一行 */
    var firstDow = new Date(days[0].date + 'T00:00:00').getDay();
    var cells = [];
    var i;
    for (i = 0; i < firstDow; i++) cells.push(null);
    for (i = 0; i < days.length; i++) cells.push(days[i]);
    while (cells.length % 7 !== 0) cells.push(null);

    var weeks = cells.length / 7;

    var wrap = el('div', 'gc-scroll');
    var grid = el('div', 'gc-grid');

    /* 星期标签列 */
    var wk = el('div', 'gc-weekdays');
    for (i = 0; i < 7; i++) {
      var lab = el('div', 'gc-weekday', (i === 1 || i === 3 || i === 5) ? WEEK_CN[i] : '');
      wk.appendChild(lab);
    }
    grid.appendChild(wk);

    var cols = el('div', 'gc-cols');
    /* 月份标签行 */
    var months = el('div', 'gc-months');
    var lastMonth = -1;
    for (var w = 0; w < weeks; w++) {
      var firstOfWeek = cells[w * 7];
      var m = el('div', 'gc-month');
      if (firstOfWeek) {
        var mm = parseInt(firstOfWeek.date.slice(5, 7), 10);
        var dd = parseInt(firstOfWeek.date.slice(8, 10), 10);
        var pv = lastMonth;
        lastMonth = mm;
        /* 一列代表一周，月份变化且该列落在上半月才标，避免密集 */
        if (mm !== pv && dd <= 14) m.textContent = mm + '月';
      }
      months.appendChild(m);
    }
    cols.appendChild(months);

    var gridRows = el('div', 'gc-grid-rows');
    for (var d = 0; d < 7; d++) {
      var row = el('div', 'gc-row');
      for (var ww = 0; ww < weeks; ww++) {
        var day = cells[ww * 7 + d];
        var c = el('div', 'gc-cell');
        if (day) {
          c.classList.add('gc-lv' + day.level);
          c.dataset.date = day.date;
          c.dataset.count = day.count;
          c.setAttribute('aria-label', day.date + ' ' + day.count + ' 次贡献');
        } else {
          c.classList.add('gc-empty');
        }
        row.appendChild(c);
      }
      gridRows.appendChild(row);
    }
    cols.appendChild(gridRows);
    grid.appendChild(cols);
    body.appendChild(wrap);
    wrap.appendChild(grid);

    /* 图例 */
    var legend = el('div', 'gc-legend');
    legend.appendChild(el('span', null, '少'));
    for (var L = 0; L < 5; L++) legend.appendChild(el('span', 'gc-cell gc-lv' + L));
    legend.appendChild(el('span', null, '多'));
    body.appendChild(legend);

    bindTip(card);
    return true;
  }

  function bindTip(card) {
    var tip = card.querySelector('#gc-tip');
    card.querySelectorAll('.gc-cell[data-date]').forEach(function (c) {
      c.addEventListener('mouseenter', function () {
        tip.textContent = c.dataset.date + ' · ' + c.dataset.count + ' 次贡献';
        tip.classList.add('gc-tip-on');
        var r = c.getBoundingClientRect();
        var cr = card.getBoundingClientRect();
        tip.style.left = (r.left - cr.left + r.width / 2) + 'px';
        tip.style.top = (r.top - cr.top - 6) + 'px';
      });
      c.addEventListener('mouseleave', function () {
        tip.classList.remove('gc-tip-on');
      });
    });
  }

  /* SVG 兜底：一张静态贡献图，至少不是空白 */
  function renderFallback(card) {
    var body = card.querySelector('#gc-body');
    body.innerHTML = '';
    var img = el('img', 'gc-fallback');
    img.src = FALLBACK;
    img.alt = USER + ' 的 GitHub 贡献图';
    img.loading = 'lazy';
    img.onerror = function () {
      /* 两条路都断了就别留空框 */
      if (card.parentNode) card.parentNode.removeChild(card);
    };
    body.appendChild(img);
    var note = el('div', 'gc-note', '交互图取不到数据，已退到静态图');
    body.appendChild(note);
  }

  function fetchJSON(url, ms) {
    return new Promise(function (resolve, reject) {
      var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctl) ctl.abort(); reject(new Error('timeout')); }, ms);
      fetch(url, ctl ? { signal: ctl.signal } : {})
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (j) { clearTimeout(timer); resolve(j); })
        .catch(function (e) { clearTimeout(timer); reject(e); });
    });
  }

  function mount() {
    /* 只挂首页：有 #recent-posts 才是首页 */
    var host = document.getElementById('recent-posts');
    if (!host || document.getElementById(CARD_ID)) return;

    var card = buildCard();
    host.insertBefore(card, host.firstChild);

    /* 命中缓存就直接渲染，不打接口 */
    var cached = lsGet(LS_KEY);
    var now = Date.now();
    if (cached && cached.at && (now - cached.at) < CACHE_MS && cached.data) {
      if (render(cached.data, card)) return;
    }

    fetchJSON(API, TIMEOUT)
      .then(function (data) {
        if (render(data, card)) {
          lsSet(LS_KEY, { at: now, data: data });
        } else {
          renderFallback(card);
        }
      })
      .catch(function () {
        renderFallback(card);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
