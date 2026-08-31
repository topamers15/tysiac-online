const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');

// Wklejony Twój link połączeniowy do MongoDB Atlas
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
            callback({ success: false, message: "Błąd serwera przy autoryzacji." });
        }
    });

    socket.on('joinGame', async ({ roomId, password, username }) => {
        try {
            let room = await Room.findOne({ roomId });

            if (!room) {
                room = new Room({
                    roomId: roomId,
                    password: password ? password.trim() : null,
                    players: [],
                    gameState: { round: 1, dealer: 0, scores: [0, 0], phase: "lobby", highestBid: 100 }
                });
            } else {
                const isReturning = room.players.some(p => p.name === username);
                if (!isReturning && room.password && room.password !== (password ? password.trim() : "")) {
                    socket.emit('errorMsg', 'Nieprawidłowe hasło do tego stołu!');
                    return;
                }
            }

            let existingPlayer = room.players.find(p => p.name === username);

            if (!existingPlayer) {
                if (room.players.length >= 4) {
                    socket.emit('errorMsg', 'Ten stół jest już pełny!');
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
            socket.emit('errorMsg', 'Błąd podczas dołączania do pokoju.');
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serwer uruchomiony na porcie ${PORT}`));