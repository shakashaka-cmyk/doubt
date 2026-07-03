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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==============================
// ルーム（部屋）＆ゲームロジック
// ==============================
const INITIAL_BANKROLL = 100;
const MAX_BET = 100;
const MAX_PLAYERS = 8;
const SIDES = ['本当', 'ウソ'];

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
    gameState: 'waiting', // waiting -> claim -> betting -> reveal -> claim ... -> ended
    hostId: null,
    players: {},       // playerId -> { id, name, bankroll, status }
    playerOrder: [],   // 参加順のplayerId配列
    round: 1,
    storytellerId: null,
    claim: '',         // トークプレイヤーが入力した「本当/ウソ」の真実（reveal前は非公開）
    bets: {},          // bettorId -> { side, amount }
    odds: {},          // { '本当': '2.10', 'ウソ': '-' }
    message: '',
  };
}

function playerList(room) {
  return room.playerOrder.map((id) => room.players[id]).filter(Boolean);
}

function activePlayers(room) {
  return playerList(room).filter((p) => p.status === 'active');
}

// トークプレイヤーを除く、その回にベットできるプレイヤー
function bettors(room) {
  return activePlayers(room).filter((p) => p.id !== room.storytellerId);
}

function nextStorytellerId(room) {
  const active = room.playerOrder.filter((id) => room.players[id] && room.players[id].status === 'active');
  if (active.length === 0) return null;
  const curIdx = active.indexOf(room.storytellerId);
  return active[(curIdx + 1) % active.length];
}

function calculateOdds(room) {
  const totals = { '本当': 0, 'ウソ': 0 };
  Object.values(room.bets).forEach((b) => {
    totals[b.side] += b.amount;
  });
  const totalPot = totals['本当'] + totals['ウソ'];
  const odds = {};
  SIDES.forEach((side) => {
    odds[side] = totals[side] > 0 && totalPot > 0 ? (totalPot / totals[side]).toFixed(2) : '-';
  });
  return odds;
}

function startGame(room) {
  room.round = 1;
  room.storytellerId = nextStorytellerId(room);
  room.bets = {};
  room.claim = '';
  room.odds = {};
  room.gameState = 'claim';
  const teller = room.players[room.storytellerId];
  room.message = `${teller ? teller.name : ''}さんの番です。エピソードを話してください`;
}

function submitClaim(room, playerId, value) {
  if (room.gameState !== 'claim') return false;
  if (playerId !== room.storytellerId) return false;
  if (SIDES.indexOf(value) === -1) return false;
  room.claim = value;
  room.gameState = 'betting';
  room.odds = calculateOdds(room);
  const teller = room.players[room.storytellerId];
  room.message = `${teller ? teller.name : ''}さんの話を聞いて、本当かウソかにベットしてください！`;
  return true;
}

function placeBet(room, playerId, side, amount) {
  if (room.gameState !== 'betting') return false;
  if (playerId === room.storytellerId) return false;
  const player = room.players[playerId];
  if (!player || player.status !== 'active') return false;
  if (SIDES.indexOf(side) === -1) return false;
  const bet = Number(amount);
  const cap = Math.min(player.bankroll, MAX_BET);
  if (!bet || bet < 1 || bet > cap) return false;

  room.bets[playerId] = { side, amount: bet };
  room.odds = calculateOdds(room);

  const stillWaiting = bettors(room).filter((p) => !room.bets[p.id]);
  if (stillWaiting.length === 0) {
    resolveRound(room);
  }
  return true;
}

function resolveRound(room) {
  room.odds = calculateOdds(room);
  const winSide = room.claim;
  const winOdds = parseFloat(room.odds[winSide]) || 1;

  Object.entries(room.bets).forEach(([pid, bet]) => {
    const p = room.players[pid];
    if (!p) return;
    let winnings;
    if (bet.side === winSide) {
      winnings = Math.round(bet.amount * winOdds);
    } else {
      winnings = -bet.amount;
    }
    p.bankroll = Math.max(p.bankroll + winnings, 0);
    p.status = p.bankroll <= 0 ? 'broke' : 'active';
  });

  room.gameState = 'reveal';
  room.message = winSide === '本当'
    ? '🎉 エピソードは本当だった！'
    : '🔄 エピソードはウソだった！';
}

function nextRound(room) {
  if (room.gameState !== 'reveal') return false;
  const active = activePlayers(room);
  if (active.length < 2) {
    room.gameState = 'ended';
    room.message = 'ゲーム終了！';
    return false;
  }
  room.round += 1;
  room.storytellerId = nextStorytellerId(room);
  room.bets = {};
  room.claim = '';
  room.odds = {};
  room.gameState = 'claim';
  const teller = room.players[room.storytellerId];
  room.message = `${teller ? teller.name : ''}さんの番です。エピソードを話してください`;
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

// クライアントごとにベットの中身（他人のside/amount）を隠した状態を作る
function personalizedState(room, roomCode, viewerId) {
  const isReveal = room.gameState === 'reveal' || room.gameState === 'ended';
  const bets = {};
  Object.entries(room.bets).forEach(([pid, bet]) => {
    if (isReveal || pid === viewerId) {
      bets[pid] = { side: bet.side, amount: bet.amount, submitted: true };
    } else {
      bets[pid] = { submitted: true };
    }
  });

  return {
    roomCode,
    gameState: room.gameState,
    hostId: room.hostId,
    players: room.players,
    playerOrder: room.playerOrder,
    round: room.round,
    storytellerId: room.storytellerId,
    claim: isReveal || viewerId === room.storytellerId ? room.claim : '',
    bets,
    odds: room.odds,
    message: room.message,
  };
}

function broadcastPersonalized(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  const socketIds = io.sockets.adapter.rooms.get(roomCode);
  if (!socketIds) return;
  socketIds.forEach((socketId) => {
    const s = io.sockets.sockets.get(socketId);
    if (!s) return;
    s.emit('stateUpdate', personalizedState(room, roomCode, s.data.playerId));
  });
}

io.on('connection', (socket) => {
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

    callback && callback({ ok: true, roomCode, playerId, state: personalizedState(room, roomCode, playerId) });
  });

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

    callback && callback({ ok: true, roomCode: code, playerId, state: personalizedState(room, code, playerId) });
    broadcastPersonalized(code);
  });

  socket.on('startGame', () => {
    const { roomCode, playerId } = socket.data;
    const room = rooms[roomCode];
    if (!room || room.gameState !== 'waiting') return;
    if (room.hostId !== playerId) return; // ホストのみ開始できる
    if (playerList(room).length < 2) return;
    startGame(room);
    broadcastPersonalized(roomCode);
  });

  // トークプレイヤーが「本当/ウソ」を入力（他プレイヤーには非公開）
  socket.on('submitClaim', (value) => {
    const { roomCode, playerId } = socket.data;
    const room = rooms[roomCode];
    if (!room) return;
    if (submitClaim(room, playerId, value)) {
      broadcastPersonalized(roomCode);
    }
  });

  // ベットプレイヤーが本当/ウソ側に金額を賭ける（各自好きなタイミングで同時に）
  socket.on('placeBet', ({ side, amount } = {}) => {
    const { roomCode, playerId } = socket.data;
    const room = rooms[roomCode];
    if (!room) return;
    if (placeBet(room, playerId, side, amount)) {
      broadcastPersonalized(roomCode);
    }
  });

  socket.on('nextRound', () => {
    const { roomCode } = socket.data;
    const room = rooms[roomCode];
    if (!room) return;
    nextRound(room);
    broadcastPersonalized(roomCode);
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
      broadcastPersonalized(roomCode);
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
