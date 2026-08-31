const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname + '/public'));

const SUITS = [
    { symbol: "♣", name: "Trefl", meld: 100, red: false },
    { symbol: "♠", name: "Pik", meld: 80, red: false },
    { symbol: "♥", name: "Kier", meld: 60, red: true },
    { symbol: "♦", name: "Karo", meld: 40, red: true }
];

const RANKS = [
    { rank: "A", value: 11 }, { rank: "10", value: 10 },
    { rank: "K", value: 4 }, { rank: "Q", value: 3 },
    { rank: "J", value: 2 }, { rank: "9", value: 0 }
];

// Baza pokojów
const rooms = {
    "Stół 1": createRoomObject("Stół 1"),
    "Stół 2": createRoomObject("Stół 2")
};

function createRoomObject(name) {
    return {
        name,
        players: [], // { socketId, nick, pin, isHost }
        gameStarted: false,
        round: 1,
        dealer: 0,
        scores: [0, 0],
        phase: "lobby", // lobby, bid, play, next, gameover
        bidder: 1,
        highestBid: 100,
        highestBidder: 0,
        openingBidder: 0,
        passed: [],
        declared: null,
        musik: [],
        trick: [],
        tricks: [],
        roundCardPoints: [0, 0],
        log: [],
        hands: [[], [], [], []]
    };
}

function team(player) { return player % 2; }

function createDeck() {
    const deck = [];
    SUITS.forEach(suit => {
        RANKS.forEach(rank => {
            deck.push({
                id: Math.random().toString(36).substring(2) + Date.now(),
                symbol: suit.symbol, suit: suit.name,
                rank: rank.rank, value: rank.value,
                meld: suit.meld, red: suit.red
            });
        });
    });
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function logAction(room, text) {
    room.log.unshift(text);
    room.log = room.log.slice(0, 20);
}

function dealCards(room) {
    const deck = createDeck();
    room.hands = [[], [], [], []];

    for (let round = 0; round < 4; round++) {
        for (let i = 0; i < 4; i++) {
            const player = (room.dealer + i) % 4;
            room.hands[player].push(deck.pop());
        }
    }
    room.musik = deck.splice(0, 4);
    room.hands.forEach(hand => hand.sort((a, b) => b.value - a.value));

    room.phase = "bid";
    room.openingBidder = room.dealer;
    room.highestBid = 100;
    room.highestBidder = room.openingBidder;
    room.bidder = (room.openingBidder + 1) % 4;
    room.passed = [];
    room.trick = [];
    room.tricks = [];
    room.roundCardPoints = [0, 0];

    logAction(room, `🔨 ${room.players[room.openingBidder].nick} otwiera obowiązkowym 100.`);
}

function getRoomsSummary() {
    const list = [];
    for (const id in rooms) {
        list.push({
            id,
            name: rooms[id].name,
            count: rooms[id].players.length,
            started: rooms[id].gameStarted
        });
    }
    return list;
}

function broadcastRoomsList() {
    io.emit('roomsList', getRoomsSummary());
}

function broadcastGameState(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    room.players.forEach((p, idx) => {
        if (p && p.socketId) {
            const copy = JSON.parse(JSON.stringify(room));
            delete copy.hands;
            delete copy.musik;
            
            copy.myIndex = idx;
            copy.myHand = room.hands[idx] || [];
            copy.playersList = room.players.map(pl => pl ? { nick: pl.nick, isHost: pl.isHost } : null);

            io.to(p.socketId).emit('gameState', copy);
        }
    });
}

io.on('connection', (socket) => {
    let currentRoomId = null;
    let playerNick = "";
    let playerPin = "";

    socket.emit('roomsList', getRoomsSummary());

    socket.on('loginAndJoin', ({ nick, pin, roomId }) => {
        if (!nick || !pin || pin.length !== 4) return socket.emit('errorMsg', 'Wprowadź poprawny Nick i 4-cyfrowy PIN!');
        if (!rooms[roomId]) return socket.emit('errorMsg', 'Wybrany stół nie istnieje!');

        const room = rooms[roomId];
        
        // Sprawdź czy gracz już tu nie siedzi (np. po rozłączeniu)
        let existingIndex = room.players.findIndex(p => p && p.nick === nick && p.pin === pin);

        if (existingIndex !== -1) {
            room.players[existingIndex].socketId = socket.id;
        } else {
            if (room.players.length >= 4) return socket.emit('errorMsg', 'Stół jest już pełny!');
            if (room.gameStarted) return socket.emit('errorMsg', 'Gra na tym stole już trwa!');

            const isHost = room.players.length === 0;
            room.players.push({ socketId: socket.id, nick, pin, isHost });
        }

        currentRoomId = roomId;
        playerNick = nick;
        playerPin = pin;

        socket.join(roomId);
        socket.emit('joinSuccess', { roomId });
        broadcastRoomsList();
        broadcastGameState(roomId);
    });

    socket.on('createRoom', ({ name, nick, pin }) => {
        if (!name || !nick || !pin || pin.length !== 4) return socket.emit('errorMsg', 'Podaj nazwę stołu, nick i 4-cyfrowy PIN!');
        
        const roomId = "Stół " + (Object.keys(rooms).length + 1);
        rooms[roomId] = createRoomObject(name);
        
        rooms[roomId].players.push({ socketId: socket.id, nick, pin, isHost: true });
        
        currentRoomId = roomId;
        playerNick = nick;
        playerPin = pin;

        socket.join(roomId);
        socket.emit('joinSuccess', { roomId });
        broadcastRoomsList();
        broadcastGameState(roomId);
    });

    socket.on('startGame', () => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        const player = room.players.find(p => p && p.socketId === socket.id);

        if (!player || !player.isHost) return socket.emit('errorMsg', 'Tylko gospodarz może rozpocząć grę!');
        if (room.players.length < 4) return socket.emit('errorMsg', 'Wymaganych jest dokładnie 4 graczy!');

        room.gameStarted = true;
        dealCards(room);
        broadcastRoomsList();
        broadcastGameState(currentRoomId);
    });

    socket.on('bid', (amount) => {
        if (!currentRoomId) return;
        const room = rooms[currentRoomId];
        const idx = room.players.findIndex(p => p && p.socketId === socket.id);

        if (idx !== room.bidder || room.phase !== "bid") return;

        if (amount === 0) {
            room.passed.push(idx);
            logAction(room, `🔴 ${room.players[idx].nick} PAS`);
        } else if (amount > room.highestBid) {
            room.highestBid = amount;
            room.highestBidder = idx;
            logAction(room, `🔨 ${room.players[idx].nick}: ${amount}`);
        }

        const active = [0, 1, 2, 3].filter(p => !room.passed.includes(p));
        if (active.length === 1) {
            room.highestBidder = active[0];
            room.declared = room.highestBid;
            room.phase = "play";
            room.leader = room.highestBidder;
        } else {
            let next = (idx + 1) % 4;
            while (room.passed.includes(next)) next = (next + 1) % 4;
            room.bidder = next;
        }
        broadcastGameState(currentRoomId);
    });

    socket.on('playCard', ({ cardId }) => {
        if (!currentRoomId) return;
        const room = rooms[currentRoomId];
        const idx = room.players.findIndex(p => p && p.socketId === socket.id);

        if (idx !== room.leader || room.phase !== "play") return;
        const hand = room.hands[idx];
        const cardIdx = hand.findIndex(c => c.id === cardId);
        if (cardIdx === -1) return;

        const card = hand.splice(cardIdx, 1)[0];
        room.trick.push({ player: idx, card });
        logAction(room, `🃏 ${room.players[idx].nick}: ${card.rank}${card.symbol}`);

        if (room.trick.length === 4) {
            broadcastGameState(currentRoomId);
            setTimeout(() => {
                const leadSuit = room.trick[0].card.suit;
                const winner = room.trick.reduce((best, cur) => {
                    if (cur.card.suit === leadSuit && cur.card.value > best.card.value) return cur;
                    return best;
                }, room.trick[0]);
                
                const pts = room.trick.reduce((sum, p) => sum + p.card.value, 0);
                room.roundCardPoints[team(winner.player)] += pts;
                room.trick = [];
                room.leader = winner.player;
                
                if (room.hands.every(h => h.length === 0)) {
                    room.phase = "next";
                }
                broadcastGameState(currentRoomId);
            }, 1000);
        } else {
            room.leader = (idx + 1) % 4;
            broadcastGameState(currentRoomId);
        }
    });

    socket.on('disconnect', () => {
        if (currentRoomId && rooms[currentRoomId]) {
            const room = rooms[currentRoomId];
            const p = room.players.find(pl => pl && pl.socketId === socket.id);
            if (p) p.socketId = null; // Zachowujemy miejsce na reconnect
            
            // Jeśli pokój jest pusty i gra się nie zaczęła -> usuń dynamiczny pokój
            if (room.players.every(pl => !pl.socketId) && !room.gameStarted && !["Stół 1", "Stół 2"].includes(currentRoomId)) {
                delete rooms[currentRoomId];
            }
            broadcastRoomsList();
            broadcastGameState(currentRoomId);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serwer działa na porcie ${PORT}`));
