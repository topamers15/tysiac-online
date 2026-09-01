const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const RANKS = ['9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = [
    { name: 'pik', symbol: '♠', red: false, value: 40 },
    { name: 'trefl', symbol: '♣', red: false, value: 60 },
    { name: 'karo', symbol: '♦', red: true, value: 80 },
    { name: 'kier', symbol: '♥', red: true, value: 100 }
];

let gameState = createInitialState();

function createInitialState() {
    return {
        phase: 'waiting', // waiting, bid, show_musik, exchange, play
        round: 1,
        players: [],
        deck: [],
        musik: [],
        trick: [],
        trump: null,
        scores: [0, 0],
        highestBid: 100,
        highestBidder: null,
        bidder: 0,
        leader: 0,
        log: [],
        chat: []
    };
}

function generateDeck() {
    const deck = [];
    let id = 1;
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            deck.push({ id: id++, rank, suit: suit.name, symbol: suit.symbol, red: suit.red });
        }
    }
    return deck.sort(() => Math.random() - 0.5);
}

function addLog(msg) {
    gameState.log.push(msg);
    if (gameState.log.length > 20) gameState.log.shift();
}

function addChat(msg) {
    gameState.chat.push(msg);
    if (gameState.chat.length > 20) gameState.chat.shift();
}

function startRound() {
    if (gameState.players.length < 4) return;
    
    gameState.phase = 'bid';
    gameState.deck = generateDeck();
    gameState.trump = null;
    gameState.trick = [];
    gameState.highestBid = 100;
    gameState.highestBidder = null;
    gameState.bidder = (gameState.round - 1) % 4;
    
    // Rozdanie kart: 5 dla każdego, 4 do musiku (dla 4 graczy)
    gameState.players.forEach((p, idx) => {
        p.hand = gameState.deck.slice(idx * 5, (idx + 1) * 5);
        p.passed = false;
    });
    gameState.musik = gameState.deck.slice(20, 24);

    addLog(`--- Rozdanie ${gameState.round} ---`);
    addLog(`Licytację rozpoczyna ${gameState.players[gameState.bidder].name}`);
    
    io.emit('stateUpdate', gameState);
    checkBotTurn();
}

function handleBid(seat, amount) {
    if (gameState.phase !== 'bid' || gameState.bidder !== seat) return;
    const player = gameState.players[seat];

    if (amount === 0) {
        player.passed = true;
        addLog(`${player.name} pasuje.`);
    } else if (amount > gameState.highestBid) {
        gameState.highestBid = amount;
        gameState.highestBidder = seat;
        addLog(`${player.name} licytuje ${amount}`);
    }

    const activePlayers = gameState.players.filter(p => !p.passed);
    if (activePlayers.length === 1 && gameState.highestBidder !== null) {
        // Koniec licytacji
        gameState.phase = 'exchange';
        addLog(`${gameState.players[gameState.highestBidder].name} wygrywa licytację (${gameState.highestBid} pkt) i bierze musik!`);
        
        // Dopisanie musiku zwycięzcy
        gameState.players[gameState.highestBidder].hand.push(...gameState.musik);
        io.emit('stateUpdate', gameState);
        checkBotTurn();
        return;
    }

    // Następny licytujący
    do {
        gameState.bidder = (gameState.bidder + 1) % 4;
    } while (gameState.players[gameState.bidder].passed);

    io.emit('stateUpdate', gameState);
    checkBotTurn();
}

function checkBotTurn() {
    if (gameState.phase === 'bid') {
        const current = gameState.players[gameState.bidder];
        if (current && current.isBot) {
            setTimeout(() => {
                // Prosta logika bota: licytuje do 120, potem pasuje
                if (gameState.highestBid < 120 && Math.random() > 0.3) {
                    handleBid(current.seat, gameState.highestBid + 10);
                } else {
                    handleBid(current.seat, 0);
                }
            }, 1000);
        }
    } else if (gameState.phase === 'exchange') {
        const winner = gameState.players[gameState.highestBidder];
        if (winner && winner.isBot) {
            setTimeout(() => {
                // Bot automatycznie odrzuca 2 najniższe karty do przeciwników
                const cardsToGive = winner.hand.slice(0, 2);
                winner.hand = winner.hand.slice(2);
                
                let targetSeats = [(winner.seat + 1) % 4, (winner.seat + 3) % 4];
                cardsToGive.forEach((card, idx) => {
                    gameState.players[targetSeats[idx]].hand.push(card);
                });

                gameState.phase = 'play';
                gameState.leader = winner.seat;
                addLog(`${winner.name} przekazał karty i rozpoczyna grę.`);
                io.emit('stateUpdate', gameState);
                checkBotTurn();
            }, 1500);
        }
    } else if (gameState.phase === 'play') {
        const leader = gameState.players[gameState.leader];
        if (leader && leader.isBot && leader.hand.length > 0) {
            setTimeout(() => {
                const playedCard = leader.hand.pop();
                gameState.trick.push({ seat: leader.seat, card: playedCard });
                addLog(`🤖 ${leader.name} zagrywa ${playedCard.rank}${playedCard.symbol}`);
                
                if (gameState.trick.length === 4) {
                    // Czyścimy stół po lewie
                    setTimeout(() => {
                        gameState.trick = [];
                        gameState.leader = (gameState.leader + 1) % 4;
                        io.emit('stateUpdate', gameState);
                        checkBotTurn();
                    }, 1500);
                } else {
                    gameState.leader = (gameState.leader + 1) % 4;
                }
                io.emit('stateUpdate', gameState);
                checkBotTurn();
            }, 1000);
        }
    }
}

io.on('connection', (socket) => {
    socket.on('joinGame', (name) => {
        if (gameState.players.length >= 4) return;
        const seat = gameState.players.length;
        const isHost = seat === 0;

        gameState.players.push({
            id: socket.id,
            name,
            seat,
            isBot: false,
            isHost,
            connected: true,
            hand: [],
            passed: false
        });

        socket.emit('assignedSeat', seat);
        addChat(`SYSTEM: ${name} dołączył do gry.`);

        if (gameState.players.length === 4 && gameState.phase === 'waiting') {
            startRound();
        } else {
            io.emit('stateUpdate', gameState);
        }
    });

    socket.on('addBot', () => {
        const host = gameState.players.find(p => p.id === socket.id);
        if (!host || !host.isHost || gameState.players.length >= 4) return;

        const seat = gameState.players.length;
        gameState.players.push({
            id: `bot_${Date.now()}_${seat}`,
            name: `Bot_${seat + 1}`,
            seat,
            isBot: true,
            isHost: false,
            connected: true,
            hand: [],
            passed: false
        });

        addChat(`SYSTEM: Dodano bota Bot_${seat + 1}.`);

        if (gameState.players.length === 4 && gameState.phase === 'waiting') {
            startRound();
        } else {
            io.emit('stateUpdate', gameState);
        }
    });

    socket.on('removeBot', (targetSeat) => {
        const host = gameState.players.find(p => p.id === socket.id);
        if (!host || !host.isHost) return;

        const bot = gameState.players[targetSeat];
        if (bot && bot.isBot) {
            addChat(`SYSTEM: Usunięto ${bot.name}.`);
            gameState.players.splice(targetSeat, 1);
            gameState.players.forEach((p, idx) => p.seat = idx);

            if (gameState.phase !== 'waiting') {
                gameState = createInitialState();
                addChat(`SYSTEM: Gra zresetowana.`);
            }

            io.emit('stateUpdate', gameState);
        }
    });

    socket.on('bid', ({ seat, amount }) => handleBid(seat, amount));

    socket.on('exchangeCards', ({ seat, selectedIds, recipients }) => {
        const player = gameState.players[seat];
        if (!player || gameState.phase !== 'exchange') return;

        selectedIds.forEach((id, idx) => {
            const cardIdx = player.hand.findIndex(c => c.id === id);
            if (cardIdx !== -1) {
                const [card] = player.hand.splice(cardIdx, 1);
                gameState.players[recipients[idx]].hand.push(card);
            }
        });

        gameState.phase = 'play';
        gameState.leader = seat;
        addLog(`${player.name} przekazał karty. Rozpoczynamy rozgrywkę!`);
        io.emit('stateUpdate', gameState);
        checkBotTurn();
    });

    socket.on('playCard', ({ seat, cardId }) => {
        if (gameState.phase !== 'play' || gameState.leader !== seat) return;
        const player = gameState.players[seat];
        const cardIdx = player.hand.findIndex(c => c.id === cardId);

        if (cardIdx !== -1) {
            const [card] = player.hand.splice(cardIdx, 1);
            gameState.trick.push({ seat, card });
            addLog(`${player.name} zagrywa ${card.rank}${card.symbol}`);

            if (gameState.trick.length === 4) {
                setTimeout(() => {
                    gameState.trick = [];
                    gameState.leader = (gameState.leader + 1) % 4;
                    io.emit('stateUpdate', gameState);
                    checkBotTurn();
                }, 1500);
            } else {
                gameState.leader = (gameState.leader + 1) % 4;
            }
            io.emit('stateUpdate', gameState);
            checkBotTurn();
        }
    });

    socket.on('chatMessage', (msg) => {
        const player = gameState.players.find(p => p.id === socket.id);
        if (player) {
            addChat(`${player.name}: ${msg}`);
            io.emit('stateUpdate', gameState);
        }
    });

    socket.on('disconnect', () => {
        const player = gameState.players.find(p => p.id === socket.id);
        if (player) {
            player.connected = false;
            addChat(`SYSTEM: ${player.name} rozłączył się.`);
            io.emit('stateUpdate', gameState);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serwer Tysiąca działa na portie ${PORT}`));
