// magacol 記事チェッカー — 専用CORSプロキシ（Cloudflare Worker）
//
// 役割: ブラウザから直接取得できない（CORS制限）関連リンク記事のHTMLを
//       サーバ側で取得し、CORSヘッダを付けて返す。
//
// 安全対策: 取得先を媒体7ドメインに限定（第三者による踏み台利用を防止）。
//
// デプロイ手順は docs/cloudflare-worker-setup.md を参照。

// 取得を許可する媒体ドメイン（config.json の media_mapping と一致させること）
const ALLOWED_DOMAINS = [
  'jj-jj.net',
  'veryweb.jp',
  'classy-online.jp',
  'storyweb.jp',
  'bisweb.jp',
  'mart-magazine.com',
  'be-story.jp'
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*'
};

export default {
  async fetch(request) {
    // プリフライト（CORS）対応
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const reqUrl = new URL(request.url);
    const target = reqUrl.searchParams.get('url');
    if (!target) {
      return text('missing url param', 400);
    }

    // 取得先URLの検証
    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch (e) {
      return text('invalid url', 400);
    }
    if (targetUrl.protocol !== 'https:' && targetUrl.protocol !== 'http:') {
      return text('unsupported protocol', 400);
    }

    // ドメイン許可リスト（踏み台利用防止）
    const host = targetUrl.hostname.replace(/^www\./, '');
    const allowed = ALLOWED_DOMAINS.some(function (d) {
      return host === d || host.endsWith('.' + d);
    });
    if (!allowed) {
      return text('domain not allowed: ' + host, 403);
    }

    // サーバ側で取得して中身をそのまま返す
    try {
      const upstream = await fetch(targetUrl.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MagacolChecker/1.0; +https://github.com/ak4n376/mc-ftp-article-checker)',
          'Accept': 'text/html,application/xhtml+xml'
        },
        redirect: 'follow'
      });
      const body = await upstream.text();
      return new Response(body, {
        status: upstream.status,
        headers: Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, CORS_HEADERS)
      });
    } catch (e) {
      return text('fetch failed: ' + (e && e.message ? e.message : 'unknown'), 502);
    }
  }
};

function text(msg, status) {
  return new Response(msg, {
    status: status,
    headers: Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, CORS_HEADERS)
  });
}
