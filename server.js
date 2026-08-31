const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://Topamers15-Admin:Korciorze123%40@cluster0.efvy1vd.mongodb.net/?appName=Cluster0";

mongoose.connect(MONGO_URI)
  .then(() => console.log("Połączono z bazą MongoDB Atlas!"))
  .catch(err => console.error("Błąd połączenia z bazą:", err));

const User = mongoose.model('User', new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  pin: { type: String, required: true }
}));

const Room = mongoose.model('Room', new mongoose.Schema({
  roomId: String,
  password: { type: String, default: null },
  players: Array,
  gameState: Object,
  updatedAt: { type: Date, default: Date.now }
}));

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function createDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['9', '10', 'J', 'Q', 'K', 'A'];
  let deck = [];
  for (let s of suits) {
    for (let r of ranks) {
      deck.push({ rank: r, suit: s, symbol: `${r}${s}` });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

async function broadcastRoomList() {
  try {
    const rooms = await Room.find({});
    const roomList = rooms.map(r => ({
      roomId: r.roomId,
      playerCount: r.players.length,
      hasPassword: !!r.password,
      updatedAt: r.updatedAt
    }));
    io.emit('roomListUpdate', roomList);
  } catch(err) {
    console.error("Błąd przy pobieraniu listy pokoi:", err);
  }
}

async function leaveCurrentRoom(socket) {
  if (!socket.roomId || !socket.username) return;

  try {
    let room = await Room.findOne({ roomId: socket.roomId });
    if (room) {
      room.players = room.players.filter(p => p.name !== socket.username);
      room.players.forEach((p, idx) => { p.index = idx; });

      if (room.players.length === 0) {
        room.gameState = { status: 'LOBBY', round: 1, currentTurn: 0 };
      }

      room.updatedAt = new Date();
      room.markModified('players');
      room.markModified('gameState');
      await room.save();

      socket.leave(socket.roomId);
      io.to(socket.roomId).emit('updateState', { room });
      await broadcastRoomList();
    }
    socket.roomId = null;
  } catch (err) {
    console.error("Błąd podczas opuszczania pokoju:", err);
  }
}

setInterval(async () => {
  try {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    const staleRooms = await Room.find({ updatedAt: { $lt: oneMinuteAgo } });
    
    for (let room of staleRooms) {
      if (room.players.length > 0) {
        room.players = [];
        room.gameState = { status: 'LOBBY', round: 1, currentTurn: 0 };
        room.updatedAt = new Date();
        room.markModified('players');
        room.markModified('gameState');
        await room.save();
        io.to(room.roomId).emit('updateState', { room });
      }
    }
    if (staleRooms.length > 0) {
      await broadcastRoomList();
    }
  } catch (err) {
    console.error("Błąd czyszczenia:", err);
  }
}, 15000);

function checkIsAdmin(username, pin) {
  return username === 'SLIWAPARSZYWKADOROTA' && pin === '2597';
}

io.on('connection', (socket) => {
    broadcastRoomList();

    socket.on('authPlayer', async ({ username, pin }, callback) => {
        try {
            const cleanName = username.trim();
            const cleanPin = pin.trim();
            const isAdmin = checkIsAdmin(cleanName, cleanPin);

            let user = await User.findOne({ username: cleanName });
            if (!user) {
                user = new User({ username: cleanName, pin: cleanPin });
                await user.save();
                callback({ success: true, username: user.username, isAdmin });
            } else {
                if (user.pin === cleanPin) {
                    callback({ success: true, username: user.username, isAdmin });
                } else {
                    callback({ success: false, message: "Błędny PIN!" });
                }
            }
        } catch (err) {
            callback({ success: false, message: "Błąd serwera." });
        }
    });

    socket.on('adminResetTimer', async ({ roomId, pin }) => {
        if (!socket.username || !checkIsAdmin(socket.username, pin || '')) {
            return socket.emit('errorMsg', 'Brak uprawnień administratora!');
        }
        try {
            let room = await Room.findOne({ roomId });
            if (room) {
                room.updatedAt = new Date();
                await room.save();
                await broadcastRoomList();
                socket.emit('errorMsg', `⏱️ Zresetowano timer dla ${roomId}!`);
            }
        } catch (err) {
            console.error(err);
        }
    });

    socket.on('resetRoom', async ({ roomId }) => {
        try {
            let room = await Room.findOne({ roomId });
            if (room) {
                room.players = [];
                room.gameState = { status: 'LOBBY', round: 1, currentTurn: 0 };
                room.updatedAt = new Date();
                room.markModified('players');
                room.markModified('gameState');
                await room.save();
                io.to(roomId).emit('updateState', { room });
                await broadcastRoomList();
                socket.emit('errorMsg', `Stół ${roomId} został wyczyszczony!`);
            }
        } catch(err) {
            console.error(err);
        }
    });

    socket.on('joinGame', async ({ roomId, password, username, pin }) => {
        try {
            if (socket.roomId && socket.roomId !== roomId) {
                await leaveCurrentRoom(socket);
            }

            socket.username = username;
            const isAdmin = checkIsAdmin(username, pin);

            let room = await Room.findOne({ roomId });

            if (!room) {
                room = new Room({
                    roomId: roomId,
                    password: password ? password.trim() : null,
                    players: [],
                    gameState: { status: 'LOBBY', round: 1, currentTurn: 0 }
                });
            } else {
                const isReturning = room.players.some(p => p.name === username);
                if (!isReturning && !isAdmin && room.password && room.password !== (password ? password.trim() : "")) {
                    socket.emit('errorMsg', 'Nieprawidłowe hasło!');
                    return;
                }
            }

            let existingPlayer = room.players.find(p => p.name === username);

            if (!existingPlayer) {
                if (room.players.length >= 4 && !isAdmin) {
                    socket.emit('errorMsg', 'Stół jest pełny!');
                    return;
                }
                existingPlayer = {
                    id: socket.id,
                    name: username,
                    index: room.players.length,
                    hand: [],
                    score: 0
                };
                room.players.push(existingPlayer);
            } else {
                existingPlayer.id = socket.id;
            }

            socket.join(roomId);
            socket.roomId = roomId;
            room.updatedAt = new Date();
            room.markModified('players');
            await room.save();

            await broadcastRoomList();
            io.to(roomId).emit('updateState', { room });
        } catch (err) {
            socket.emit('errorMsg', 'Błąd podczas dołączania.');
        }
    });

    socket.on('leaveRoom', async () => {
        await leaveCurrentRoom(socket);
        socket.emit('leftRoomSuccess');
    });

    socket.on('disconnect', async () => {
        if (socket.roomId) {
            await leaveCurrentRoom(socket);
        }
    });

    // START GRY PRZEZ GOSPODARZA - ROZDANIE DLA WSZYSTKICH I PRZEŁĄCZENIE WIDOKU
    socket.on('startGame', async ({ roomId }) => {
        try {
            let room = await Room.findOne({ roomId });
            if (!room || room.players.length < 4) {
                socket.emit('errorMsg', 'Wymaganych jest co najmniej 4 graczy!');
                return;
            }

            const deck = createDeck();
            
            // Rozdanie kart dla 4 graczy
            room.players[0].hand = deck.slice(0, 5);
            room.players[1].hand = deck.slice(5, 10);
            room.players[2].hand = deck.slice(10, 15);
            room.players[3].hand = deck.slice(15, 20);
            
            room.gameState = {
                status: 'BIDDING', // Natychmiastowe przejście do licytacji dla wszystkich
                musik: deck.slice(20, 24),
                currentBid: 100,
                highestBidderIndex: 0,
                currentTurnIndex: 0,
                activeBidders: [0, 1, 2, 3],
                tableCards: [],
                trumpSuit: null,
                declaredMeld: null
            };

            room.updatedAt = new Date();
            room.markModified('players');
            room.markModified('gameState');
            await room.save();

            // Emitujemy do WSZYSTKICH podłączonych graczy w pokoju
            io.to(roomId).emit('updateState', { room });
        } catch (err) {
            console.error("Błąd startu gry:", err);
        }
    });

    // LICYTACJA NA ŻYWO
    socket.on('makeBid', async ({ roomId, action, value }) => {
        try {
            let room = await Room.findOne({ roomId });
            if (!room || room.gameState.status !== 'BIDDING') return;

            const state = room.gameState;
            const playerIndex = room.players.findIndex(p => p.name === socket.username);

            if (playerIndex !== state.currentTurnIndex) return;

            if (action === 'BID') {
                if (value <= state.currentBid || value % 10 !== 0) return;
                state.currentBid = value;
                state.highestBidderIndex = playerIndex;
            } else if (action === 'PASS') {
                state.activeBidders = state.activeBidders.filter(idx => idx !== playerIndex);
            }

            if (state.activeBidders.length === 1) {
                const winnerIndex = state.activeBidders[0];
                state.status = 'PLAYING';
                state.currentTurnIndex = winnerIndex;
                room.players[winnerIndex].hand.push(...state.musik);
            } else {
                let currentIdxInActive = state.activeBidders.indexOf(playerIndex);
                if (action === 'PASS') {
                    if (currentIdxInActive >= state.activeBidders.length) currentIdxInActive = 0;
                } else {
                    currentIdxInActive = (currentIdxInActive + 1) % state.activeBidders.length;
                }
                state.currentTurnIndex = state.activeBidders[currentIdxInActive];
            }

            room.updatedAt = new Date();
            room.markModified('players');
            room.markModified('gameState');
            await room.save();

            io.to(roomId).emit('updateState', { room });
        } catch (err) {
            console.error(err);
        }
    });

    // ZAGRANIE KARTY / MELDUNEK NA ŻYWO
    socket.on('playCard', async ({ roomId, cardSymbol, meldSuit }) => {
        try {
            let room = await Room.findOne({ roomId });
            if (!room || room.gameState.status !== 'PLAYING') return;

            const state = room.gameState;
            const playerIndex = room.players.findIndex(p => p.name === socket.username);

            if (playerIndex !== state.currentTurnIndex) {
                return socket.emit('errorMsg', 'To nie Twoja kolej!');
            }

            const player = room.players[playerIndex];
            const cardIdx = player.hand.findIndex(c => c.symbol === cardSymbol);

            if (cardIdx === -1) return;

            const playedCard = player.hand.splice(cardIdx, 1)[0];

            if (meldSuit) {
                const meldValues = { '♥': 100, '♦': 80, '♣': 60, '♠': 40 };
                state.trumpSuit = meldSuit;
                const points = meldValues[meldSuit] || 0;
                player.score = (player.score || 0) + points;
                state.declaredMeld = `${player.name} zameldował ${meldSuit} (+${points} pkt)! Atut: ${meldSuit}`;
            }

            state.tableCards.push({
                playerIndex: playerIndex,
                playerName: player.name,
                card: playedCard
            });

            if (state.tableCards.length === 4) {
                setTimeout(async () => {
                    let r = await Room.findOne({ roomId });
                    if(r){
                        r.gameState.tableCards = [];
                        r.markModified('gameState');
                        await r.save();
                        io.to(roomId).emit('updateState', { room: r });
                    }
                }, 2000);
            }

            state.currentTurnIndex = (state.currentTurnIndex + 1) % room.players.length;

            room.updatedAt = new Date();
            room.markModified('players');
            room.markModified('gameState');
            await room.save();

            io.to(roomId).emit('updateState', { room });
        } catch (err) {
            console.error(err);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serwer działa na porcie ${PORT}`));
