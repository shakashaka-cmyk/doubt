const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// publicディレクトリの絶対パスを取得
const publicPath = path.join(__dirname, 'public');

// JSONボディパーサーの設定
app.use(express.json());

// 静的ファイルの配信
app.use(express.static(publicPath));

// ルーム状態を保存（メモリ内）
const gameRooms = {};

// ルーム作成API
app.post('/api/rooms/create', (req, res) => {
  const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  gameRooms[roomCode] = {
    code: roomCode,
    players: {},
    gameState: 'lobby',
    createdAt: Date.now(),
    lastActivity: Date.now()
  };
  res.json({ roomCode });
});

// ルーム確認API
app.get('/api/rooms/:roomCode', (req, res) => {
  const { roomCode } = req.params;
  const room = gameRooms[roomCode];
  
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  // 30分以上非アクティブなルームは削除
  if (Date.now() - room.lastActivity > 30 * 60 * 1000) {
    delete gameRooms[roomCode];
    return res.status(404).json({ error: 'Room expired' });
  }
  
  res.json({
    roomCode: room.code,
    playerCount: Object.keys(room.players).length,
    gameState: room.gameState
  });
});

// ルーム状態更新API
app.post('/api/rooms/:roomCode/update', (req, res) => {
  const { roomCode } = req.params;
  const { gameState, players } = req.body;
  
  const room = gameRooms[roomCode];
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  room.gameState = gameState;
  room.players = players;
  room.lastActivity = Date.now();
  
  res.json({ success: true });
});

// ルートにアクセスされたらindex.htmlを返す
app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// 404エラー対応（その他のルートもindex.htmlを返す）
app.get('*', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
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
