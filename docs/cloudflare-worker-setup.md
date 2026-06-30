# Cloudflare Worker（専用CORSプロキシ）セットアップ手順

記事チェッカーのPR記事・配信日チェックは、関連リンク記事のHTMLを外部から取得する必要がある。
ブラウザのCORS制限のため直接取得できず、従来は無料の公開プロキシ（allorigins等）を使っていたが、
これらは不安定で「通信状況によりチェックできませんでした」が頻発した。

そこで自前の Cloudflare Worker をプロキシとして使う。無料・安定・媒体ドメイン限定で安全。

---

## 所要時間

初回のみ約10分。以降はメンテ不要。

## 必要なもの

- メールアドレス（Cloudflareアカウント用。無料）
- このリポジトリの `worker/proxy.js`

---

## 手順

### 1. Cloudflareアカウントを作る（持っていれば飛ばす）

1. https://dash.cloudflare.com/sign-up にアクセス
2. メールアドレスとパスワードを登録 → メール認証を済ませる

### 2. Worker を作成する

1. ダッシュボード左メニューの **「Workers & Pages」** をクリック
2. **「Create application」**（アプリケーションを作成）→ **「Create Worker」** を選択
3. 名前を **`magacol-proxy`** に変更（任意。この名前がURLの一部になる）
4. **「Deploy」**（デプロイ）をクリック（この時点では雛形コードのまま）

### 3. コードを差し替える

1. デプロイ後の画面で **「Edit code」**（コードを編集）をクリック
2. エディタの中身を**全部消す**
3. このリポジトリの **`worker/proxy.js` の中身を全文コピーして貼り付け**
4. 右上の **「Deploy」** をクリック

### 4. URLを確認して共有する

デプロイ後、Workerのトップ画面に次の形式のURLが表示される：

```
https://magacol-proxy.<あなたのアカウント名>.workers.dev
```

この **URL を Claude に伝える**。`config.json` のプロキシ設定をこのURLに差し替える。

### 5. 動作確認（任意）

ブラウザで以下を開き、HTMLが返ればOK：

```
https://magacol-proxy.<アカウント名>.workers.dev/?url=https://storyweb.jp/
```

許可外ドメインで `domain not allowed` が出れば、ドメイン制限も正しく効いている：

```
https://magacol-proxy.<アカウント名>.workers.dev/?url=https://example.com/
```

---

## 媒体を追加・変更したとき

`worker/proxy.js` の `ALLOWED_DOMAINS` に媒体ドメインを追記し、
手順3と同じ要領で Worker のコードを貼り直して再デプロイする。
（`config.json` の `media_mapping` と必ず一致させること）

---

## 補足

- **無料枠**: 1日10万リクエスト。関連リンク5本×チェック回数なのでまず到達しない。
- **安全性**: `ALLOWED_DOMAINS` 以外のURLは 403 で拒否するため、第三者の踏み台にされない。
- **障害切り分け**: チェックできない場合、上記「動作確認」のURLを直接ブラウザで開くと、
  Worker側の問題か媒体サイト側の問題か切り分けられる。
