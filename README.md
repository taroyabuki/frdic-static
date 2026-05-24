# frdic-static

`../frdic` の辞書を、サーバレスに近い静的ファイル配信だけで動かすプロトタイプです。

## ローカル実行

公開するファイルは `docs/` に置いています。このプロトタイプは `docs/app.js` が `fetch("./words.json")` で辞書を読み込むため、ブラウザで `docs/index.html` を `file://` から直接開くだけでは動かないことがあります。必要なのは PHP や SQLite を動かすアプリサーバではなく、静的ファイルを配るだけの Web サーバです。

```bash
python3 -m http.server 8000 --directory docs
```

ブラウザで `http://127.0.0.1:8000/` を開きます。

将来、ブラウザでファイルを直接開くだけで動かしたい場合は、辞書データを JSON ではなく `window.FRDIC_DATA = {...};` を定義する JavaScript ファイルとして生成し、`<script>` で読み込む形に変更します。

## 辞書 JSON の再生成

現行 DB から、見出し語の正規化キーが `a/b/c/d/e` で始まる語だけを生成:

```bash
python3 tools/build_words_json.py --input-db ../frdic/words.db --output docs/words.json --initials abcde
```

Excel から生成:

```bash
python3 tools/build_words_json.py --input-xlsx ../frdic/words.xlsx --output docs/words.json --initials abcde
```

Excel はヘッダなしで、A=`word`、B=`category`、C=`meaning`、D=`example_fr`、E=`example_ja` を読みます。D/E は空でも構いません。
