// bookmarklet.js — ブックマークレットのローダー（ソースコード）
//
// 【ブックマーク登録手順】
// install.html を開いてブックマークバーにドラッグするか、コードをコピーして手動登録する
//
// 【更新方法】
// checker.js / config.json を GitHub Pages に push するだけで外注全員に即反映される。
// ブックマークの再登録は不要。

// ========== ブックマーク登録用コード（ここから） ==========

// javascript:(function(){var s=document.createElement('script');s.src='https://ak4n376.github.io/magacol-check-tool/src/checker.js?v='+Date.now();document.head.appendChild(s);})();

// ========== ここまで ==========

// --- 以下は読みやすい展開版 ---

(function () {
  var CHECKER_URL = 'https://ak4n376.github.io/magacol-check-tool/src/checker.js';
  var s = document.createElement('script');
  s.src = CHECKER_URL + '?v=' + Date.now();
  document.head.appendChild(s);
}());
