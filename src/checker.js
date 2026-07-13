// checker.js — magacol 記事チェッカー本体
// WordPress プレビュー画面でブックマークレット経由で読み込まれる

(function () {

  // ホスティング先が決まったら実際の URL に変更する
  var CHECKER_ORIGIN = 'https://ak4n376.github.io/mc-ftp-article-checker';
  var CONFIG_URL = CHECKER_ORIGIN + '/src/config.json';

  // 既存パネルを削除（2回クリックしても重複しないように）
  var existing = document.getElementById('magacol-checker-panel');
  if (existing) existing.parentNode.removeChild(existing);

  // テスト時は window.MAGACOL_CONFIG に設定オブジェクトをセットしておくと fetch をスキップできる
  if (window.MAGACOL_CONFIG) {
    runChecks(window.MAGACOL_CONFIG);
  } else {
    fetch(CONFIG_URL + '?v=' + Date.now())
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (config) { runChecks(config); })
      .catch(function (e) { showErrorPanel('設定ファイルの読み込みに失敗しました。\n' + e.message); });
  }

  // ===== DOM 抽出ユーティリティ =====

  // ページ全体の table から、th テキストが一致する行の td を返す
  function findTdByTh(thText) {
    var ths = document.querySelectorAll('table th');
    for (var i = 0; i < ths.length; i++) {
      if (ths[i].textContent.trim() === thText) {
        return ths[i].parentElement.querySelector('td');
      }
    }
    return null;
  }

  // 指定した table の中で th テキストが一致する行の td を返す
  function findTdInTable(table, thText) {
    var ths = table.querySelectorAll('th');
    for (var i = 0; i < ths.length; i++) {
      if (ths[i].textContent.trim() === thText) {
        return ths[i].parentElement.querySelector('td');
      }
    }
    return null;
  }

  // 「第N段落」テーブルを全て収集する
  function getParagraphTables() {
    var tables = document.querySelectorAll('table');
    var result = [];
    for (var i = 0; i < tables.length; i++) {
      var thead = tables[i].querySelector('thead th[colspan]');
      if (thead && /^第\d+段落$/.test(thead.textContent.trim())) {
        result.push(tables[i]);
      }
    }
    return result;
  }

  // 「関連リンク」テーブルを返す
  function getRelatedLinksTable() {
    var tables = document.querySelectorAll('table');
    for (var i = 0; i < tables.length; i++) {
      var thead = tables[i].querySelector('thead th[colspan]');
      if (thead && thead.textContent.trim() === '関連リンク') {
        return tables[i];
      }
    }
    return null;
  }

  // 関連リンク一覧を [{title, url}] で返す
  function getRelatedLinks() {
    var table = getRelatedLinksTable();
    if (!table) return [];
    var links = [];
    var rows = table.querySelectorAll('tr');
    var currentTitle = null;
    for (var i = 0; i < rows.length; i++) {
      var th = rows[i].querySelector('th');
      var td = rows[i].querySelector('td');
      if (!th || !td) continue;
      var label = th.textContent.trim();
      if (label === 'タイトル') {
        currentTitle = td.textContent.trim();
      } else if (label === 'URL' && currentTitle !== null) {
        var a = td.querySelector('a');
        links.push({ title: currentTitle, url: a ? a.getAttribute('href') : '' });
        currentTitle = null;
      }
    }
    return links;
  }

  // URL からホスト名を取得（正規表現で処理し古い Chrome でも動くようにする）
  function extractHostname(url) {
    var m = String(url).match(/^https?:\/\/([^\/\?#]+)/);
    return m ? m[1] : null;
  }

  // ===== チェックロジック =====

  function clearHighlights() {
    var spans = document.querySelectorAll('span.magacol-hl');
    for (var i = 0; i < spans.length; i++) {
      var s = spans[i];
      if (s.parentNode) s.parentNode.replaceChild(document.createTextNode(s.textContent), s);
    }
  }

  function highlightInEl(el, phrase, bgColor) {
    if (!el || !phrase) return;
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    var nodes = [];
    var node;
    while ((node = walker.nextNode())) nodes.push(node);
    for (var i = 0; i < nodes.length; i++) {
      var text = nodes[i].nodeValue;
      var idx = text.indexOf(phrase);
      if (idx === -1) continue;
      var span = document.createElement('span');
      span.className = 'magacol-hl';
      span.setAttribute('style', 'background:' + bgColor + ';border-radius:2px;padding:0 2px;');
      span.textContent = phrase;
      var parent = nodes[i].parentNode;
      if (!parent) continue;
      if (idx > 0) parent.insertBefore(document.createTextNode(text.substring(0, idx)), nodes[i]);
      parent.insertBefore(span, nodes[i]);
      var after = text.substring(idx + phrase.length);
      if (after) parent.insertBefore(document.createTextNode(after), nodes[i]);
      parent.removeChild(nodes[i]);
    }
  }

  function runChecks(config) {
    clearHighlights();
    var results = [];

    // 記事タイトルを取得
    var titleTd = findTdByTh('タイトル');
    var titleText = titleTd ? titleTd.textContent.trim() : '';

    // タイトル末尾の媒体名を抽出（区切りは全角縦棒 ｜ U+FF5C 固定）
    var mediaMatch = titleText.match(/｜([^｜]+)$/);
    var mediaName = mediaMatch ? mediaMatch[1].trim() : null;
    var expectedDomain = mediaName ? (config.media_mapping[mediaName] || null) : null;

    // ① 媒体名の特定
    if (!mediaName) {
      results.push({ type: 'error', label: '媒体名', message: 'タイトル末尾に媒体名（｜媒体名）が見つかりません', scrollTarget: titleTd });
    } else if (!expectedDomain) {
      results.push({ type: 'error', label: '媒体名', message: '対応ドメインが未定義の媒体名です: ' + mediaName, scrollTarget: titleTd });
    }

    // ② 関連リンク: 件数・▶ 記号・ドメイン整合性
    var relatedLinks = getRelatedLinks();
    var relatedLinksTable = getRelatedLinksTable();
    var expectedCount = config.related_links_count;

    if (relatedLinks.length !== expectedCount) {
      results.push({
        type: 'error',
        label: '関連リンク数',
        message: relatedLinks.length + '本（規定: ' + expectedCount + '本）',
        scrollTarget: relatedLinksTable
      });
    }

    for (var i = 0; i < relatedLinks.length; i++) {
      var link = relatedLinks[i];
      var num = i + 1;

      // ▶ の判定: config の prefix（U+25B6）が先頭にあるか
      // サンプルの ▶︎（U+25B6 + U+FE0F）も indexOf で 0 にマッチするため問題ない
      if (!link.title || link.title.indexOf(config.related_link_prefix) !== 0) {
        results.push({
          type: 'error',
          label: '関連リンク' + num + ' タイトル',
          message: '先頭に▶がありません: ' + link.title.slice(0, 30) + (link.title.length > 30 ? '…' : ''),
          scrollTarget: relatedLinksTable
        });
      }

      // UTMパラメータ検出
      if (link.url && /[?&]utm_/.test(link.url)) {
        results.push({
          type: 'error',
          label: '関連リンク' + num + ' URL',
          message: 'UTMパラメータが含まれています:\n' + link.url,
          scrollTarget: relatedLinksTable
        });
      }

      // ドメイン整合性（媒体が特定できている場合のみ）
      if (expectedDomain) {
        if (!link.url) {
          results.push({ type: 'error', label: '関連リンク' + num + ' URL', message: 'URLが空です', scrollTarget: relatedLinksTable });
        } else {
          var hostname = extractHostname(link.url);
          if (!hostname) {
            results.push({ type: 'error', label: '関連リンク' + num + ' URL', message: '無効なURL: ' + link.url, scrollTarget: relatedLinksTable });
          } else if (hostname !== expectedDomain) {
            results.push({
              type: 'error',
              label: '関連リンク' + num + ' URL',
              message: 'ドメイン不一致（期待: ' + expectedDomain + '）\n' + link.url,
              scrollTarget: relatedLinksTable
            });
          }
        }
      }
    }

    // ③ 画像設定漏れ ＆ 同一画像の重複使用チェック
    var paragraphTables = getParagraphTables();
    var imageSrcMap = {}; // src → [段落名, ...]
    for (var j = 0; j < paragraphTables.length; j++) {
      var ptable = paragraphTables[j];
      var theadTh = ptable.querySelector('thead th');
      var paraName = theadTh ? theadTh.textContent.trim() : '第' + (j + 1) + '段落';
      var imageTd = findTdInTable(ptable, '【画像】ファイル');
      // 【画像】ファイル 行が無い段落は画像チェック対象外
      if (!imageTd) continue;
      var img = imageTd.querySelector('img');
      var src = img ? (img.getAttribute('src') || '') : '';
      // 画像設定漏れ: img自体が無い or src が空 → 要修正
      if (!src) {
        results.push({
          type: 'error',
          label: '画像なし（' + paraName + '）',
          message: 'この段落に画像が設定されていません',
          scrollTarget: ptable
        });
        continue;
      }
      if (!imageSrcMap[src]) imageSrcMap[src] = [];
      imageSrcMap[src].push(paraName);
    }
    for (var src in imageSrcMap) {
      if (imageSrcMap[src].length >= 2) {
        results.push({
          type: 'warn',
          label: '画像重複',
          message: '同じ画像が複数の段落で使われています（' + imageSrcMap[src].join('・') + '）'
        });
      }
    }

    // ④ NGワード検出（本文・タイトル）
    var ngTargets = [{ name: 'タイトル', text: titleText, el: titleTd, scrollEl: titleTd }];
    for (var k = 0; k < paragraphTables.length; k++) {
      var kt = paragraphTables[k];
      var kHead = kt.querySelector('thead th');
      var kName = kHead ? kHead.textContent.trim() : '第' + (k + 1) + '段落';
      var bodyTd = findTdInTable(kt, '本文');
      if (bodyTd) ngTargets.push({ name: kName + ' 本文', text: bodyTd.textContent, el: bodyTd, scrollEl: kt });
    }

    // 要修正ワード（ng_phrases）
    if (config.ng_phrases && config.ng_phrases.length > 0) {
      for (var t = 0; t < ngTargets.length; t++) {
        // まず全マッチを収集してから重複除去する
        var matchedNG = [];
        for (var n = 0; n < config.ng_phrases.length; n++) {
          if (ngTargets[t].text.indexOf(config.ng_phrases[n]) !== -1) {
            matchedNG.push(config.ng_phrases[n]);
          }
        }
        // 他のマッチに部分文字列として含まれる短いフレーズは除外
        // 例: "http" と "https" が両方マッチしたとき "http" を除外する
        var filteredNG = matchedNG.filter(function(phrase) {
          return !matchedNG.some(function(other) {
            return other !== phrase && other.indexOf(phrase) !== -1;
          });
        });
        for (var fn = 0; fn < filteredNG.length; fn++) {
          results.push({
            type: 'error',
            label: 'NGワード（' + ngTargets[t].name + '）',
            message: '「' + filteredNG[fn] + '」が含まれています',
            scrollTarget: ngTargets[t].scrollEl
          });
          highlightInEl(ngTargets[t].el, filteredNG[fn], '#ff6666');
        }
      }
    }

    // 要確認ワード（ng_phrases_warn）
    if (config.ng_phrases_warn && config.ng_phrases_warn.length > 0) {
      for (var t2 = 0; t2 < ngTargets.length; t2++) {
        var matchedWarn = [];
        for (var n2 = 0; n2 < config.ng_phrases_warn.length; n2++) {
          if (ngTargets[t2].text.indexOf(config.ng_phrases_warn[n2]) !== -1) {
            matchedWarn.push(config.ng_phrases_warn[n2]);
          }
        }
        var filteredWarn = matchedWarn.filter(function(phrase) {
          return !matchedWarn.some(function(other) {
            return other !== phrase && other.indexOf(phrase) !== -1;
          });
        });
        for (var fw = 0; fw < filteredWarn.length; fw++) {
          results.push({
            type: 'warn',
            label: '確認ワード（' + ngTargets[t2].name + '）',
            message: '「' + filteredWarn[fw] + '」が含まれています',
            scrollTarget: ngTargets[t2].scrollEl
          });
          highlightInEl(ngTargets[t2].el, filteredWarn[fw], '#ffd000');
        }
      }
    }

    // ④-b 電話番号パターン検出
    // リストでは網羅できないため正規表現で検出する
    for (var tp = 0; tp < ngTargets.length; tp++) {
      var phones = findPhoneNumbers(ngTargets[tp].text);
      for (var ph = 0; ph < phones.length; ph++) {
        results.push({
          type: 'error',
          label: '電話番号（' + ngTargets[tp].name + '）',
          message: '電話番号と思われる記述があります: 「' + phones[ph] + '」'
        });
      }
    }

    // ⑤ 重複行検出（全段落の本文を横断）
    var dupeLines = findDuplicateLines(paragraphTables);
    for (var d = 0; d < dupeLines.length; d++) {
      var dl = dupeLines[d];
      results.push({
        type: 'warn',
        label: '重複テキスト',
        message: '同じ文が複数箇所に含まれています:\n「' + dl.text.slice(0, 50) + (dl.text.length > 50 ? '…' : '') + '」',
        scrollTarget: dl.firstTable
      });
      // 全段落の本文でハイライト
      for (var dh = 0; dh < paragraphTables.length; dh++) {
        var dhTd = findTdInTable(paragraphTables[dh], '本文');
        if (dhTd) highlightInEl(dhTd, dl.text, '#ffd000');
      }
    }

    // ⑥ PR記事チェック（allorigins.win 経由で非同期取得）
    var prConfig = config.pr_check;
    if (prConfig && prConfig.enabled && relatedLinks.length > 0) {
      // 同期チェック結果を先に表示し「PR確認中」ローディング行を付ける
      showPanel(results, mediaName, expectedDomain, true);
      checkPRArticles(relatedLinks, prConfig, relatedLinksTable).then(function(prResults) {
        for (var p = 0; p < prResults.length; p++) results.push(prResults[p]);
        showPanel(results, mediaName, expectedDomain, false);
      }).catch(function() {
        results.push({ type: 'warn', label: 'PR記事チェック', message: '通信エラーのためチェックできませんでした' });
        showPanel(results, mediaName, expectedDomain, false);
      });
    } else {
      showPanel(results, mediaName, expectedDomain, false);
    }
  }

  // 関連リンクのPR記事チェック＋配信日チェック（CORS プロキシ経由・全プロキシ並列試行）
  function checkPRArticles(links, prConfig, linksTable) {
    var proxyUrls = prConfig.proxy_urls || (prConfig.proxy_url ? [prConfig.proxy_url] : []);
    var selector = prConfig.pr_selector;
    var fetchFn = window._MAGACOL_FETCH || fetch;

    // 古い記事の閾値日付を計算
    var oldMonths = prConfig.old_article_months || 18;
    var limitDate = new Date();
    limitDate.setMonth(limitDate.getMonth() - oldMonths);

    // HTMLを解析してPR判定と配信日を同時に取得する
    function analyzeHTML(html, articleUrl) {
      var result = { isPR: false, pubDate: null };
      if (!html) return result;

      // ドメイン検証: プロキシのエラーページを弾く
      if (articleUrl) {
        var domain = extractHostname(articleUrl);
        if (domain && html.indexOf(domain) === -1) return result;
      }

      var parser = new DOMParser();
      var doc = parser.parseFromString(html, 'text/html');

      // ① CSSセレクタ要素内テキストでPR判定
      if (selector) {
        var prEl = doc.querySelector(selector);
        if (prEl) {
          var elText = prEl.textContent.trim();
          var prLabels = ['PR', 'Sponsored', 'タイアップ広告', 'advertorial'];
          for (var ei = 0; ei < prLabels.length; ei++) {
            if (elText.indexOf(prLabels[ei]) !== -1) { result.isPR = true; break; }
          }
        }
      }

      // ② script / style / noscript を除去してから全文照合
      if (!result.isPR) {
        var toRemove = doc.querySelectorAll('script, style, noscript');
        for (var si = 0; si < toRemove.length; si++) {
          if (toRemove[si].parentNode) toRemove[si].parentNode.removeChild(toRemove[si]);
        }
        var content = doc.documentElement ? doc.documentElement.innerHTML : '';
        var texts = prConfig.pr_texts || [];
        for (var ti = 0; ti < texts.length; ti++) {
          if (content.indexOf(texts[ti]) !== -1) { result.isPR = true; break; }
        }
        if (!result.isPR) {
          var regexes = prConfig.pr_regexes || [];
          for (var ri = 0; ri < regexes.length; ri++) {
            if (new RegExp(regexes[ri]).test(content)) { result.isPR = true; break; }
          }
        }
      }

      // ③ 配信日を取得（標準メタタグ → time[datetime] の順）
      var dateAttrs = [
        'meta[property="article:published_time"]',
        'meta[name="pubdate"]',
        'meta[itemprop="datePublished"]',
        'meta[name="date"]',
        'time[datetime]'
      ];
      for (var di = 0; di < dateAttrs.length; di++) {
        var dateEl = doc.querySelector(dateAttrs[di]);
        if (!dateEl) continue;
        var dateStr = dateEl.getAttribute('content') || dateEl.getAttribute('datetime') || '';
        if (!dateStr) continue;
        var d = new Date(dateStr);
        if (!isNaN(d.getTime())) { result.pubDate = d; break; }
      }
      // メタタグに無い場合は JSON-LD の datePublished をフォールバックで使う（美ST等）
      if (!result.pubDate) {
        var jm = html.match(/"datePublished"\s*:\s*"([^"]+)"/);
        if (jm) {
          var jd = new Date(jm[1]);
          if (!isNaN(jd.getTime())) result.pubDate = jd;
        }
      }

      return result;
    }

    // レスポンスが「記事の完全なHTML」と言えるかを検証する
    // 部分ページ・bot ブロックページ・プロキシのエラーページを「PRなし」の根拠にしないため
    // 単なる長さ＋ドメイン一致では不十分（過去バグの原因）。閉じタグまで揃っていることを要求する
    function isCompleteHTML(html, articleUrl) {
      if (!html || html === '__timeout__' || html === '__error__') return false;
      if (html.length < 1500) return false;
      var domain = extractHostname(articleUrl);
      if (domain && html.indexOf(domain) === -1) return false;
      // 完全なページなら body/html の閉じタグが存在する（途中で切れた応答を弾く）
      if (html.indexOf('</body>') === -1 && html.indexOf('</html>') === -1) return false;
      return true;
    }

    // 1回分のfetch（10秒タイムアウト付き）。失敗時はセンチネル文字列を返す
    function fetchHTML(proxyUrl) {
      var timerId;
      var timeoutP = new Promise(function(res) {
        timerId = setTimeout(function() { res('__timeout__'); }, 10000);
      });
      return Promise.race([
        fetchFn(proxyUrl)
          .then(function(r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.text();
          })
          .catch(function() { return '__error__'; }),
        timeoutP
      ]).then(function(html) {
        clearTimeout(timerId);
        return html;
      });
    }

    // 1プロキシを最大2回試し、完全なHTMLが得られたら返す（無料プロキシの一時的失敗対策）
    // キャッシュバスターは付けない: プロキシのキャッシュを潰すと低速化・レート制限を招くため
    function attemptProxy(link, proxyBase) {
      var proxyUrl = proxyBase + encodeURIComponent(link.url);
      return fetchHTML(proxyUrl).then(function(html) {
        if (isCompleteHTML(html, link.url)) return html;
        return fetchHTML(proxyUrl).then(function(html2) {
          return isCompleteHTML(html2, link.url) ? html2 : null;
        });
      });
    }

    // 全プロキシを並列（各自リトライ付き）で試す。判定方針は「速さより正しさ」「PR陽性優先」:
    //   - 完全なHTMLを返したプロキシのうち1つでもPRを検出したらPR確定
    //   - 完全なHTMLが1つも得られなければ status:'unchecked'（無言でOKにしない）
    function checkLink(link) {
      if (!link.url || proxyUrls.length === 0) {
        return Promise.resolve({ status: 'unchecked', isPR: false, pubDate: null });
      }
      var attempts = proxyUrls.map(function(proxyBase) {
        return attemptProxy(link, proxyBase);
      });
      return Promise.all(attempts).then(function(htmls) {
        var anyComplete = false;
        var isPR = false;
        var pubDate = null;
        for (var i = 0; i < htmls.length; i++) {
          if (!htmls[i]) continue;
          anyComplete = true;
          var a = analyzeHTML(htmls[i], link.url);
          if (a.isPR) isPR = true;
          if (a.pubDate && !pubDate) pubDate = a.pubDate;
        }
        if (!anyComplete) return { status: 'unchecked', isPR: false, pubDate: null };
        return { status: 'ok', isPR: isPR, pubDate: pubDate };
      });
    }

    var promises = links.map(function(link) {
      return checkLink(link);
    });

    return Promise.all(promises).then(function(checked) {
      var prResults = [];
      var uncheckedCount = 0;
      for (var i = 0; i < checked.length; i++) {
        var c = checked[i];
        var num = i + 1;
        if (c.status === 'unchecked') uncheckedCount++;
        if (c.isPR) {
          prResults.push({
            type: 'error',
            label: '関連リンク' + num + ' PR記事',
            message: 'PR記事が含まれています:\n' + links[i].url,
            scrollTarget: linksTable
          });
        }
        if (c.pubDate && c.pubDate < limitDate) {
          var y = c.pubDate.getFullYear();
          var m = ('0' + (c.pubDate.getMonth() + 1)).slice(-2);
          var d = ('0' + c.pubDate.getDate()).slice(-2);
          prResults.push({
            type: 'warn',
            label: '関連リンク' + num + ' 配信日',
            message: '配信日が' + oldMonths + 'ヶ月以上前です（' + y + '/' + m + '/' + d + '）:\n' + links[i].url,
            scrollTarget: linksTable
          });
        }
      }
      // 通信失敗で自動チェックできなかったリンクがあれば、まとめて1件だけ通知する
      // （リンクごとに警告を出すと通信障害時に画面が埋まり実用的でないため）
      if (uncheckedCount > 0) {
        prResults.push({
          type: 'warn',
          label: 'PR・配信日チェック',
          message: '通信状況により ' + uncheckedCount + '件 のリンクを自動チェックできませんでした。'
            + '時間をおいて再実行するか、PR記事・配信日を手動で確認してください。',
          scrollTarget: linksTable
        });
      }
      return prResults;
    });
  }

  // 電話番号パターンを検出して文字列の配列で返す
  // 全角数字・全角ハイフン類・全角括弧を先に半角へ正規化してからマッチする
  function findPhoneNumbers(text) {
    var normalized = text
      .replace(/[０-９]/g, function(c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[－‐–—ー−]/g, '-')
      .replace(/（/g, '(')
      .replace(/）/g, ')');

    var found = [];
    // パターンA: 0 始まりの市外局番 + ハイフン/スペース区切り
    //   03-1234-5678 / 090-1234-5678 / 0120-123-456 / 03 1234 5678 など
    // パターンA: ハイフン/スペース区切り（最も一般的な形式）
    //   03-1234-5678 / 090-1234-5678 / 0120-123-456 / 03 1234 5678 など
    var reA = /0\d{1,4}[-\s]\d{1,4}[-\s]\d{3,4}/g;
    // パターンB: 市外局番部分が括弧で区切られた局番
    //   03(1234)5678 / 0120(123)456 など
    var reB = /0\d{1,4}\(\d{1,4}\)\d{3,4}/g;
    // パターンC: 先頭が括弧付き市外局番
    //   (03)1234-5678 / (0120)123-456 など
    var reC = /\(0\d{1,4}\)\d{1,4}[-\s]\d{3,4}/g;
    // パターンD: ハイフンなし連続数字（特定プレフィックスのみ・誤検知を抑制）
    //   フリーダイヤル: 0120XXXXXX / 0800XXXXXXX
    //   ナビダイヤル:   0570XXXXXX
    //   その他特番:     0990XXXXXX / 0180XXXXXX
    //   携帯:           090/080/070 + 8桁
    //   市外局番:       0[1-9] から始まる10桁（03XXXXXXXX / 06XXXXXXXX 等）
    //   \b で前後に別の数字が続かないことを保証する
    var reD = /\b(?:0120\d{6}|0800\d{7}|0570\d{6}|0990\d{6}|0180\d{6}|(?:070|080|090)\d{8}|0[1-9]\d{8})\b/g;

    var m;
    while ((m = reA.exec(normalized)) !== null) found.push(m[0]);
    while ((m = reB.exec(normalized)) !== null) found.push(m[0]);
    while ((m = reC.exec(normalized)) !== null) found.push(m[0]);
    while ((m = reD.exec(normalized)) !== null) found.push(m[0]);

    // 重複除去（同じ文字列が複数パターンにマッチした場合）
    var unique = [];
    var seen = {};
    for (var i = 0; i < found.length; i++) {
      if (!seen[found[i]]) { seen[found[i]] = true; unique.push(found[i]); }
    }
    return unique;
  }

  // 全段落の本文から重複している行を返す
  // 戻り値: [{text, firstTable}] — firstTable は最初に出現した段落テーブル
  function findDuplicateLines(paragraphTables) {
    var allLines = []; // {text, bodyTd, table}
    for (var i = 0; i < paragraphTables.length; i++) {
      var bodyTd = findTdInTable(paragraphTables[i], '本文');
      if (!bodyTd) continue;
      var clone = bodyTd.cloneNode(true);
      var brs = clone.querySelectorAll('br');
      for (var b = 0; b < brs.length; b++) {
        brs[b].parentNode.replaceChild(document.createTextNode('\n'), brs[b]);
      }
      var lines = clone.textContent.split('\n');
      for (var j = 0; j < lines.length; j++) {
        var line = lines[j].trim();
        if (line.length >= 4) allLines.push({ text: line, bodyTd: bodyTd, table: paragraphTables[i] });
      }
    }

    var counts = {};
    for (var k = 0; k < allLines.length; k++) {
      var t = allLines[k].text;
      counts[t] = (counts[t] || 0) + 1;
    }

    var seen = {};
    var dupes = [];
    for (var l = 0; l < allLines.length; l++) {
      var item = allLines[l];
      if (counts[item.text] >= 2 && !seen[item.text]) {
        seen[item.text] = true;
        dupes.push({ text: item.text, firstTable: item.table });
      }
    }
    return dupes;
  }

  // ===== 結果パネル表示 =====

  function showPanel(results, mediaName, expectedDomain, loadingPR) {
    var old = document.getElementById('magacol-checker-panel');
    if (old) old.parentNode.removeChild(old);

    var errors = [];
    var warns = [];
    for (var i = 0; i < results.length; i++) {
      if (results[i].type === 'error') errors.push(results[i]);
      else warns.push(results[i]);
    }

    var headerColor = errors.length > 0 ? '#990033' : (warns.length > 0 ? '#b35c00' : (loadingPR ? '#888' : '#1a7f37'));
    var statusText = errors.length > 0
      ? ('要修正 ' + errors.length + '件' + (warns.length > 0 ? ' / 要確認 ' + warns.length + '件' : ''))
      : (warns.length > 0 ? '要確認 ' + warns.length + '件' : (loadingPR ? '確認中...' : 'OK ✓'));

    var panel = document.createElement('div');
    panel.id = 'magacol-checker-panel';
    panel.setAttribute('style', [
      'position:fixed', 'top:0', 'right:0', 'width:360px', 'max-height:100vh',
      'overflow-y:auto', 'background:#fff', 'border-left:4px solid ' + headerColor,
      'box-shadow:-2px 0 12px rgba(0,0,0,0.25)', 'z-index:2147483647',
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif',
      'font-size:13px', 'line-height:1.5', 'color:#333'
    ].join(';'));

    var html = '';

    // ヘッダー
    html += '<div style="background:' + headerColor + ';color:#fff;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;">';
    html += '<span style="font-weight:bold;">記事チェッカー</span>';
    html += '<span>' + statusText + '</span>';
    html += '<button id="mcc-close" style="background:none;border:none;color:#fff;font-size:20px;line-height:1;cursor:pointer;padding:0 0 0 10px;margin:0;">×</button>';
    html += '</div>';

    // 媒体情報バー（媒体が特定できた場合のみ）
    if (mediaName) {
      html += '<div style="padding:5px 14px;background:#f0f0f0;border-bottom:1px solid #ddd;font-size:12px;">';
      html += '媒体: <strong>' + escHtml(mediaName) + '</strong>';
      if (expectedDomain) {
        html += '　ドメイン: <strong>' + escHtml(expectedDomain) + '</strong>';
      } else {
        html += '　<span style="color:#990033;">ドメイン未定義</span>';
      }
      html += '</div>';
    }

    // 問題なし
    if (results.length === 0 && !loadingPR) {
      html += '<div style="padding:32px 14px;text-align:center;">';
      html += '<div style="font-size:44px;line-height:1;margin-bottom:10px;">✅</div>';
      html += '<div style="font-size:16px;font-weight:bold;color:#1a7f37;">チェック完了</div>';
      html += '<div style="font-size:12px;color:#888;margin-top:6px;">問題は見つかりませんでした</div>';
      html += '</div>';
    }

    // 各結果行（scrollTarget があれば data-idx を付けてクリック可能にする）
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      var isErr = r.type === 'error';
      var hasScroll = !!r.scrollTarget;
      html += '<div class="mcc-row" data-idx="' + i + '" style="padding:9px 14px;background:' + (isErr ? '#fff5f5' : '#fffbf0') + ';border-bottom:1px solid #eee;' + (hasScroll ? 'cursor:pointer;' : '') + '">';
      html += '<div style="margin-bottom:3px;">';
      html += '<span style="background:' + (isErr ? '#990033' : '#b35c00') + ';color:#fff;border-radius:2px;padding:1px 5px;font-size:11px;margin-right:6px;">' + (isErr ? '要修正' : '要確認') + '</span>';
      html += '<strong style="font-size:12px;">' + escHtml(r.label) + '</strong>';
      if (hasScroll) html += '<span style="font-size:11px;color:#aaa;margin-left:6px;">↩ クリックで移動</span>';
      html += '</div>';
      html += '<div style="color:#555;font-size:12px;white-space:pre-wrap;">' + escHtml(r.message) + '</div>';
      html += '</div>';
    }

    // PR記事チェック中ローディング行
    if (loadingPR) {
      html += '<div style="padding:9px 14px;background:#f5f5f5;border-bottom:1px solid #eee;color:#888;font-size:12px;">⏳ PR記事チェック確認中...</div>';
    }

    // フッター
    html += '<div style="padding:7px 14px;color:#aaa;font-size:11px;border-top:1px solid #eee;text-align:right;">magacol 記事チェッカー</div>';

    panel.innerHTML = html;
    document.body.appendChild(panel);

    // 結果行クリック → 該当箇所へスクロール
    var rows = panel.querySelectorAll('.mcc-row');
    for (var ri = 0; ri < rows.length; ri++) {
      (function(idx) {
        rows[idx].addEventListener('click', function() {
          var target = results[idx].scrollTarget;
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      })(ri);
    }

    document.getElementById('mcc-close').addEventListener('click', function () {
      clearHighlights();
      var p = document.getElementById('magacol-checker-panel');
      if (p) p.parentNode.removeChild(p);
    });
  }

  function showErrorPanel(msg) {
    var panel = document.createElement('div');
    panel.id = 'magacol-checker-panel';
    panel.setAttribute('style', [
      'position:fixed', 'top:0', 'right:0', 'width:360px', 'background:#fff',
      'border-left:4px solid #990033', 'z-index:2147483647',
      'font-family:sans-serif', 'padding:16px',
      'box-shadow:-2px 0 12px rgba(0,0,0,0.25)'
    ].join(';'));
    panel.innerHTML = '<strong style="color:#990033;">チェッカーエラー</strong>'
      + '<p style="margin:8px 0 0;font-size:13px;white-space:pre-wrap;">' + escHtml(msg) + '</p>';
    document.body.appendChild(panel);
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

}());
