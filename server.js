const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

const publicPath = path.join(__dirname, 'public');

app.use(express.json());
app.use(express.static(publicPath));

const gameRooms = {};
const INITIAL_BANKROLL = 100;

// ルーム作成API
app.post('/api/rooms/create', (req, res) => {
  const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  gameRooms[roomCode] = {
    code: roomCode,
    players: {},
    gameState: 'lobby',
    hostId: null,
    currentSpeakerIdx: 0,
    speakers: [],
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

// ルーム状態取得API
app.get('/api/rooms/:roomCode/state', (req, res) => {
  const { roomCode } = req.params;
  const room = gameRooms[roomCode];
  
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  res.json({
    roomCode: room.code,
    gameState: room.gameState,
    players: room.players,
    hostId: room.hostId,
    currentSpeakerIdx: room.currentSpeakerIdx,
    speakers: room.speakers,
    speakerClaim: room.speakerClaim || null
  });
});

// ルーム状態更新API
app.post('/api/rooms/:roomCode/update', (req, res) => {
  const { roomCode } = req.params;
  const { gameState, players, currentSpeakerIdx, speakerClaim } = req.body;
  
  const room = gameRooms[roomCode];
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  room.gameState = gameState;
  room.players = players;
  room.currentSpeakerIdx = currentSpeakerIdx;
  if (speakerClaim !== undefined) {
    room.speakerClaim = speakerClaim;
  }
  room.lastActivity = Date.now();
  
  res.json({ success: true });
});

// プレイヤー参加API
app.post('/api/rooms/:roomCode/join', (req, res) => {
  const { roomCode } = req.params;
  const { playerName } = req.body;
  
  const room = gameRooms[roomCode];
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  if (room.gameState !== 'waiting' && room.gameState !== 'lobby') {
    return res.status(400).json({ error: 'Game already started' });
  }
  
  const playerId = Math.random().toString(36).substring(7);
  
  if (!room.hostId) {
    room.hostId = playerId;
  }
  
  room.players[playerId] = {
    id: playerId,
    name: playerName,
    bankroll: INITIAL_BANKROLL,
    status: 'active',
    earnings: 0
  };
  
  room.lastActivity = Date.now();
  
  res.json({
    playerId,
    isHost: playerId === room.hostId,
    players: room.players,
    hostId: room.hostId
  });
});

// ルートとキャッチオール
app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║   🎲 ダウトゲーム with ベッティング                           ║
║   Server running at http://localhost:${PORT}                       ║
║   ブラウザで http://localhost:3000 を開いてください             ║
╚════════════════════════════════════════════════════════════╝
  `);
});
