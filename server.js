const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// 静的ファイルの配信
app.use(express.static(path.join(__dirname, 'public')));

// ルートにアクセスされたらindex.htmlを返す
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// サーバーのリッスン開始
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║   🎲 ダウトゲーム with ベッティング                           ║
║   Server running at http://localhost:${PORT}                       ║
║   ブラウザで http://localhost:3000 を開いてください             ║
╚════════════════════════════════════════════════════════════╝
  `);
});
