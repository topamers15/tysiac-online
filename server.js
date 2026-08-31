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

// Czyszczenie nieaktywnych stołów po 1 minucie
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
    console.error("Błąd podczas czyszczenia starych pokoi:", err);
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
                    hand: []
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

    // START ROZGRYWKI - ROZDANIE KART I START LICYTACJI
    socket.on('startGame', async ({ roomId }) => {
        try {
            let room = await Room.findOne({ roomId });
            if (!room || room.players.length < 4) {
                socket.emit('errorMsg', 'Wymaganych jest 4 graczy!');
                return;
            }

            const deck = createDeck();
            
            room.players[0].hand = deck.slice(0, 5);
            room.players[1].hand = deck.slice(5, 10);
            room.players[2].hand = deck.slice(10, 15);
            room.players[3].hand = deck.slice(15, 20);
            
            room.gameState = {
                status: 'BIDDING',
                musik: deck.slice(20, 24),
                currentBid: 100,
                highestBidderIndex: 0,
                currentTurnIndex: 0,
                activeBidders: [0, 1, 2, 3]
            };

            room.updatedAt = new Date();
            room.markModified('players');
            room.markModified('gameState');
            await room.save();

            io.to(roomId).emit('updateState', { room });
        } catch (err) {
            console.error("Błąd startu gry:", err);
        }
    });

    // AKCJA LICYTACJI (PODBICIE / PAS)
    socket.on('makeBid', async ({ roomId, action, value }) => {
        try {
            let room = await Room.findOne({ roomId });
            if (!room || room.gameState.status !== 'BIDDING') return;

            const state = room.gameState;
            const playerIndex = room.players.findIndex(p => p.name === socket.username);

            if (playerIndex !== state.currentTurnIndex) {
                return socket.emit('errorMsg', 'To nie Twoja kolej na licytację!');
            }

            if (action === 'BID') {
                if (value <= state.currentBid || value % 10 !== 0) {
                    return socket.emit('errorMsg', 'Oferta musi być wyższa i podzielna przez 10!');
                }
                state.currentBid = value;
                state.highestBidderIndex = playerIndex;
            } else if (action === 'PASS') {
                state.activeBidders = state.activeBidders.filter(idx => idx !== playerIndex);
            }

            // Jeśli został tylko 1 licytujący -> Koniec Licytacji
            if (state.activeBidders.length === 1) {
                const winnerIndex = state.activeBidders[0];
                state.status = 'BIDDING_FINISHED';
                state.currentTurnIndex = winnerIndex;
                
                // Zwycięzca otrzymuje karty z Musika
                room.players[winnerIndex].hand.push(...state.musik);
            } else {
                // Przechodzimy do kolejnej aktywnej osoby
                let currentIdxInActive = state.activeBidders.indexOf(playerIndex);
                if (action === 'PASS') {
                    if (currentIdxInActive >= state.activeBidders.length) {
                        currentIdxInActive = 0;
                    }
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
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serwer działa na porcie ${PORT}`));
