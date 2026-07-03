const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const PORT = process.env.PORT || 3000;

const server = http.createServer(app);
const io = new Server(server);

// 静的ファイルの配信
app.use(express.static(path.join(__dirname, 'public')));

// ルートにアクセスされたらindex.htmlを返す
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==============================
// ルーム（部屋）管理
// ==============================
const INITIAL_BANKROLL = 100;
const MAX_PLAYERS = 8;

// roomCode -> room state
const rooms = {};

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

function generateRoomCode() {
  let code;
  do {
    code = Math.random().toString(36).substring(2, 8).toUpperCase();
  } while (rooms[code]);
  return code;
}

function createRoom() {
  return {
    gameState: 'waiting', // waiting -> betting -> reveal
    hostId: null,
    players: {},      // playerId -> player object
    playerOrder: [],  // 参加順のplayerId配列
    round: 1,
    currentPlayerIdx: 0,
    bets: {},
    currentBet: 0,
    claim: '',
    revealed: false,
    isCorrect: null,
    message: '',
    odds: {},
  };
}

function playerList(room) {
  return room.playerOrder
    .map((id) => room.players[id])
    .filter(Boolean);
}

// クライアントへ送るための公開用スナップショット
function publicState(room, roomCode) {
  return {
    roomCode,
    gameState: room.gameState,
    hostId: room.hostId,
    players: room.players,
    playerOrder: room.playerOrder,
    round: room.round,
    currentPlayerIdx: room.currentPlayerIdx,
    bets: room.bets,
    currentBet: room.currentBet,
    claim: room.claim,
    revealed: room.revealed,
    isCorrect: room.isCorrect,
    message: room.message,
    odds: room.odds,
  };
}

function broadcast(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  io.to(roomCode).emit('stateUpdate', publicState(room, roomCode));
}

function calculateOdds(room) {
  const list = playerList(room);
  const totalBet = Object.values(room.bets).reduce((a, b) => a + b, 0);
  const newOdds = {};
  list.forEach((player) => {
    const playerBet = room.bets[player.id] || 0;
    if (playerBet > 0 && totalBet > 0) {
      const ratio = totalBet / playerBet;
      newOdds[player.id] = Math.max(1.2, ratio * 0.5).toFixed(2);
    } else {
      newOdds[player.id] = '-';
    }
  });
  return newOdds;
}

function currentPlayer(room) {
  const list = playerList(room);
  return list[room.currentPlayerIdx];
}

function startGame(room) {
  room.bets = {};
  room.gameState = 'betting';
  room.claim = '';
  room.currentBet = 0;
  room.round = 1;
  room.currentPlayerIdx = 0;
  room.revealed = false;
  room.isCorrect = null;
  room.odds = {};
  room.message = '';
}

function resolveRound(room) {
  const claimIsTrue = Math.random() > 0.5;
  room.isCorrect = claimIsTrue;
  room.revealed = true;
  playerList(room).forEach((p) => {
    let winnings = 0;
    const bet = room.bets[p.id] || 0;
    const oddsValue = parseFloat(room.odds[p.id]) || 1;
    if (bet > 0) {
      winnings = claimIsTrue ? Math.round(bet * oddsValue) : -bet;
    }
    p.bankroll = Math.max(p.bankroll + winnings, 0);
    p.status = p.bankroll <= 0 ? 'broke' : 'active';
  });
  room.message = claimIsTrue
    ? '主張は正しかった！正解した人たちが勝利🎉'
    : '主張はウソだった！ウソを見破られました🔄';
}

function nextRound(room) {
  const activePlayers = playerList(room).filter((p) => p.status === 'active');
  if (activePlayers.length < 2) {
    room.message = 'ゲーム終了！';
    return false;
  }
  room.round += 1;
  room.currentPlayerIdx = (room.round - 1) % playerList(room).length;
  room.bets = {};
  room.revealed = false;
  room.isCorrect = null;
  room.claim = '';
  room.currentBet = 0;
  room.odds = {};
  room.gameState = 'betting';
  room.message = '新しいラウンドが始まります！';
  return true;
}

function addPlayerToRoom(room, name) {
  const playerId = generateId();
  room.players[playerId] = {
    id: playerId,
    name,
    bankroll: INITIAL_BANKROLL,
    status: 'active',
  };
  room.playerOrder.push(playerId);
  if (!room.hostId) room.hostId = playerId;
  return playerId;
}

io.on('connection', (socket) => {
  // 部屋を作る
  socket.on('createRoom', ({ playerName }, callback) => {
    const name = (playerName || '').toString().trim().slice(0, 20);
    if (!name) {
      return callback && callback({ ok: false, error: '名前を入力してください' });
    }
    const roomCode = generateRoomCode();
    const room = createRoom();
    const playerId = addPlayerToRoom(room, name);
    rooms[roomCode] = room;

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.playerId = playerId;

    callback && callback({ ok: true, roomCode, playerId, state: publicState(room, roomCode) });
  });

  // 既存の部屋に参加する
  socket.on('joinRoom', ({ roomCode, playerName }, callback) => {
    const code = (roomCode || '').toString().trim().toUpperCase();
    const name = (playerName || '').toString().trim().slice(0, 20);
    const room = rooms[code];

    if (!name) {
      return callback && callback({ ok: false, error: '名前を入力してください' });
    }
    if (!room) {
      return callback && callback({ ok: false, error: 'そのルームコードは見つかりません' });
    }
    if (room.gameState !== 'waiting') {
      return callback && callback({ ok: false, error: 'このゲームはすでに開始しています' });
    }
    if (playerList(room).length >= MAX_PLAYERS) {
      return callback && callback({ ok: false, error: `満員です（最大${MAX_PLAYERS}人）` });
    }

    const playerId = addPlayerToRoom(room, name);

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = playerId;

    callback && callback({ ok: true, roomCode: code, playerId, state: publicState(room, code) });
    broadcast(code);
  });

  socket.on('startGame', () => {
    const { roomCode } = socket.data;
    const room = rooms[roomCode];
    if (!room) return;
    if (playerList(room).length < 2) return;
    startGame(room);
    broadcast(roomCode);
  });

  socket.on('placeBet', (amount) => {
    const { roomCode, playerId } = socket.data;
    const room = rooms[roomCode];
    if (!room || room.gameState !== 'betting') return;
    const player = currentPlayer(room);
    if (!player || player.id !== playerId) return; // 自分のターンのみ
    const bet = Number(amount);
    if (!bet || bet < 1 || bet > player.bankroll) return;

    room.bets[player.id] = bet;
    room.currentBet = bet;
    room.odds = calculateOdds(room);
    room.message = `${player.name} が $${bet} をベット`;
    broadcast(roomCode);
  });

  socket.on('nextPlayer', () => {
    const { roomCode, playerId } = socket.data;
    const room = rooms[roomCode];
    if (!room || room.gameState !== 'betting') return;
    const list = playerList(room);
    const player = currentPlayer(room);
    if (!player || player.id !== playerId) return;
    if (!room.currentBet) return;

    if (room.currentPlayerIdx < list.length - 1) {
      room.currentPlayerIdx += 1;
      room.currentBet = 0;
      room.message = '';
    } else {
      room.gameState = 'reveal';
      room.message = '';
    }
    broadcast(roomCode);
  });

  socket.on('makeClaim', (claimValue) => {
    const { roomCode } = socket.data;
    const room = rooms[roomCode];
    if (!room || room.gameState !== 'reveal' || room.revealed) return;
    if (claimValue !== '本当' && claimValue !== 'ウソ') return;
    room.claim = claimValue;
    broadcast(roomCode);
  });

  socket.on('reveal', () => {
    const { roomCode } = socket.data;
    const room = rooms[roomCode];
    if (!room || room.gameState !== 'reveal' || room.revealed || !room.claim) return;
    resolveRound(room);
    broadcast(roomCode);
  });

  socket.on('nextRound', () => {
    const { roomCode } = socket.data;
    const room = rooms[roomCode];
    if (!room || !room.revealed) return;
    nextRound(room);
    broadcast(roomCode);
  });

  socket.on('disconnect', () => {
    const { roomCode, playerId } = socket.data;
    const room = rooms[roomCode];
    if (!room || !playerId) return;

    // ロビー待機中の離脱はプレイヤーを削除する（ゲーム中は席を残す）
    if (room.gameState === 'waiting') {
      delete room.players[playerId];
      room.playerOrder = room.playerOrder.filter((id) => id !== playerId);
      if (room.hostId === playerId) {
        room.hostId = room.playerOrder[0] || null;
      }
      if (room.playerOrder.length === 0) {
        delete rooms[roomCode];
        return;
      }
      broadcast(roomCode);
    }
  });
});

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║   🎲 ダウトゲーム with ベッティング                           ║
║   Server running at http://localhost:${PORT}                       ║
║   ブラウザで http://localhost:3000 を開いてください             ║
╚════════════════════════════════════════════════════════════╝
  `);
});
