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
  gameState: Object
}));

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Funkcja pomocnicza do generowania i tasowania talii (24 karty: 9, 10, J, Q, K, A)
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
      hasPassword: !!r.password
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

      // Re-indeksacja graczy przy stole
      room.players.forEach((p, idx) => {
        p.index = idx;
      });

      // Jeśli stół jest pusty, zrestartuj jego stan
      if (room.players.length === 0) {
        room.gameState = { status: 'LOBBY', round: 1, currentTurn: 0 };
      }

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

io.on('connection', (socket) => {
    broadcastRoomList();

    socket.on('authPlayer', async ({ username, pin }, callback) => {
        try {
            let user = await User.findOne({ username: username.trim() });
            if (!user) {
                user = new User({ username: username.trim(), pin: pin.trim() });
                await user.save();
                callback({ success: true, username: user.username });
            } else {
                if (user.pin === pin.trim()) {
                    callback({ success: true, username: user.username });
                } else {
                    callback({ success: false, message: "Błędny PIN!" });
                }
            }
        } catch (err) {
            callback({ success: false, message: "Błąd serwera." });
        }
    });

    socket.on('joinGame', async ({ roomId, password, username }) => {
        try {
            // Jeśli gracz jest już w innym pokoju, usuń go stamtąd
            if (socket.roomId && socket.roomId !== roomId) {
                await leaveCurrentRoom(socket);
            }

            socket.username = username;

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
                if (!isReturning && room.password && room.password !== (password ? password.trim() : "")) {
                    socket.emit('errorMsg', 'Nieprawidłowe hasło!');
                    return;
                }
            }

            let existingPlayer = room.players.find(p => p.name === username);

            if (!existingPlayer) {
                if (room.players.length >= 4) {
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
        // Jeśli rozłączyło gracza (zamknięcie karty/brak internetu)
        await leaveCurrentRoom(socket);
    });

    // Start Rozgrywki przez Gospodarza
    socket.on('startGame', async ({ roomId }) => {
        try {
            let room = await Room.findOne({ roomId });
            if (!room || room.players.length < 4) {
                socket.emit('errorMsg', 'Wymaganych jest 4 graczy do rozpoczęcia!');
                return;
            }

            const deck = createDeck();
            
            // Rozdanie kart (po 5 kart dla każdego gracza + 4 do musika)
            room.players[0].hand = deck.slice(0, 5);
            room.players[1].hand = deck.slice(5, 10);
            room.players[2].hand = deck.slice(10, 15);
            room.players[3].hand = deck.slice(15, 20);
            
            room.gameState = {
                status: 'BIDDING', // Faza licytacji
                musik: deck.slice(20, 24),
                currentBid: 100,
                highestBidder: 0,
                currentTurn: 0
            };

            room.markModified('players');
            room.markModified('gameState');
            await room.save();

            io.to(roomId).emit('updateState', { room });
        } catch (err) {
            console.error("Błąd startu gry:", err);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serwer działa na porcie ${PORT}`));
