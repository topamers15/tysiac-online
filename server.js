const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

const SUITS = [
    { symbol: "♣", name: "Trefl", meld: 100, red: false },
    { symbol: "♠", name: "Pik", meld: 80, red: false },
    { symbol: "♥", name: "Kier", meld: 60, red: true },
    { symbol: "♦", name: "Karo", meld: 40, red: true }
];

const RANKS = [
    { rank: "A", value: 11 },
    { rank: "10", value: 10 },
    { rank: "K", value: 4 },
    { rank: "Q", value: 3 },
    { rank: "J", value: 2 },
    { rank: "9", value: 0 }
];

let gameState = {
    round: 1,
    dealer: 0,
    scores: [0, 0],
    phase: "waiting", 
    players: [],
    highestBid: 100,
    highestBidder: 0,
    openingBidder: 0,
    bidder: 1,
    passed: [],
    declared: null,
    musik: [],
    trick: [],
    tricks: [],
    trump: null,
    melds: [0, 0],
    meldedSuits: [],
    roundCardPoints: [0, 0],
    lastRoundSummary: null,
    log: [],
    chat: [],
    paused: false
};

function createDeck() {
    const deck = [];
    SUITS.forEach(suit => {
        RANKS.forEach(rank => {
            deck.push({
                id: Math.random().toString(36).substring(2),
                symbol: suit.symbol,
                suit: suit.name,
                rank: rank.rank,
                value: rank.value,
                meld: suit.meld,
                red: suit.red
            });
        });
    });
    return deck.sort(() => Math.random() - 0.5);
}

function team(seat) { return seat % 2; }

function addLog(msg) {
    gameState.log.unshift(msg);
    gameState.log = gameState.log.slice(0, 20);
}

function addChat(text) {
    gameState.chat.push(text);
    gameState.chat = gameState.chat.slice(-40);
}

function updateHosts() {
    const firstHuman = gameState.players.find(p => !p.isBot);
    if (firstHuman) {
        gameState.players.forEach(p => p.isHost = (p.id === firstHuman.id));
    } else if (gameState.players.length > 0) {
        gameState.players.forEach((p, idx) => p.isHost = (idx === 0));
    }
}

function hasFourNines(seat) {
    const hand = gameState.players[seat]?.hand || [];
    return hand.filter(c => c.rank === "9").length === 4;
}

function handleFoldFourNines(seat) {
    if (gameState.paused) return;
    if (!hasFourNines(seat)) return;

    const playerTeam = team(seat);
    const enemyTeam = playerTeam === 0 ? 1 : 0;

    gameState.scores[enemyTeam] += 60;

    const playerName = gameState.players[seat].name;
    addChat(`SYSTEM: 🎴 ${playerName} zgłosił 4 dziewiątki! Rozdanie przerwane. Przeciwnicy otrzymują +60 pkt.`);
    addLog(`🎴 ${playerName}: 4 dziewiątki -> Przeciwnicy +60 pkt`);

    gameState.phase = "next";
    io.emit('stateUpdate', gameState);
    checkBotTurn();
}

function startNewRound() {
    const deck = createDeck();
    gameState.players.forEach(p => p.hand = []);

    for (let round = 0; round < 5; round++) {
        for (let i = 0; i < 4; i++) {
            const playerIndex = (gameState.dealer + i) % 4;
            gameState.players[playerIndex].hand.push(deck.pop());
        }
    }

    gameState.musik = deck.splice(0, 4);
    gameState.players.forEach(p => p.hand.sort((a, b) => b.value - a.value));

    gameState.phase = "bid";
    gameState.openingBidder = gameState.dealer;
    gameState.highestBid = 100;
    gameState.highestBidder = gameState.openingBidder;
    gameState.bidder = (gameState.openingBidder + 1) % 4;
    gameState.passed = [];
    gameState.declared = null;
    gameState.trump = null;
    gameState.trick = [];
    gameState.tricks = [];
    gameState.melds = [0, 0];
    gameState.meldedSuits = [];
    gameState.roundCardPoints = [0, 0];

    addChat(`SYSTEM: Rozdanie ${gameState.round}. ${gameState.players[gameState.openingBidder].name} rozpoczyna od 100.`);
    addLog(`🔨 ${gameState.players[gameState.openingBidder].name} otwiera licytację (100).`);

    io.emit('stateUpdate', gameState);
    checkBotTurn();
}

function canPlayCard(seat, card) {
    if (gameState.trick.length === 0) return true;

    const leadSuit = gameState.trick[0].card.suit;
    const hand = gameState.players[seat].hand;
    const hasLeadSuit = hand.some(c => c.suit === leadSuit);

    if (!hasLeadSuit) {
        if (gameState.trump) {
            const hasTrump = hand.some(c => c.suit === gameState.trump);
            if (hasTrump && card.suit !== gameState.trump) return false;
        }
        return true;
    }

    if (card.suit !== leadSuit) return false;

    const highestInLead = gameState.trick
        .filter(t => t.card.suit === leadSuit)
        .reduce((best, curr) => curr.card.value > best.card.value ? curr : best);

    const canBeat = hand.some(c => c.suit === leadSuit && c.value > highestInLead.card.value);
    if (canBeat && card.value <= highestInLead.card.value) return false;

    return true;
}

function checkBotTurn() {
    if (gameState.paused) return;

    if (gameState.phase === "bid") {
        const currentBidder = gameState.players[gameState.bidder];
        if (currentBidder && currentBidder.isBot && !gameState.passed.includes(currentBidder.seat)) {
            setTimeout(() => botProcessBid(currentBidder.seat), 1000);
        }
    } else if (gameState.phase === "exchange") {
        const bidder = gameState.players[gameState.highestBidder];
        if (bidder && bidder.isBot) {
            setTimeout(() => botProcessExchange(bidder.seat), 1000);
        }
    } else if (gameState.phase === "play") {
        const leader = gameState.players[gameState.leader];
        if (leader && leader.isBot && gameState.trick.length < 4) {
            setTimeout(() => botProcessPlay(leader.seat), 1000);
        }
    } else if (gameState.phase === "next") {
        const anyBot = gameState.players.some(p => p.isBot);
        if (anyBot) {
            setTimeout(() => {
                if (gameState.phase === "next") {
                    gameState.round++;
                    gameState.dealer = (gameState.dealer + 1) % 4;
                    startNewRound();
                }
            }, 2500);
        }
    }
}

function evaluateBotHand(seat) {
    const hand = gameState.players[seat].hand;
    let evalScore = 120;

    SUITS.forEach(s => {
        const hasK = hand.some(c => c.suit === s.name && c.rank === "K");
        const hasQ = hand.some(c => c.suit === s.name && c.rank === "Q");
        if (hasK && hasQ) evalScore += s.meld;
    });

    const aces = hand.filter(c => c.rank === "A").length;
    evalScore += (aces * 10);

    return Math.min(evalScore, 240);
}

function botProcessBid(seat) {
    if (gameState.phase !== "bid" || gameState.bidder !== seat) return;

    if (hasFourNines(seat)) {
        handleFoldFourNines(seat);
        return;
    }

    const maxBid = evaluateBotHand(seat);
    const nextBid = gameState.highestBid + 10;

    if (nextBid <= maxBid && nextBid <= 240) {
        handleBid(seat, nextBid);
    } else {
        handleBid(seat, 0);
    }
}

function botProcessExchange(seat) {
    if (gameState.phase !== "exchange" || gameState.highestBidder !== seat) return;

    const bot = gameState.players[seat];
    bot.hand.sort((a, b) => a.value - b.value);

    const selectedIds = bot.hand.slice(0, 3).map(c => c.id);
    const otherSeats = [0, 1, 2, 3].filter(s => s !== seat);

    handleExchange(seat, selectedIds, otherSeats);
}

function botProcessPlay(seat) {
    if (gameState.phase !== "play" || gameState.leader !== seat) return;

    const hand = gameState.players[seat].hand;
    if (hand.length === 0) return;

    if (gameState.trick.length === 0) {
        for (let suitObj of SUITS) {
            if (!gameState.meldedSuits.includes(suitObj.name)) {
                const k = hand.find(c => c.suit === suitObj.name && c.rank === "K");
                const q = hand.find(c => c.suit === suitObj.name && c.rank === "Q");
                if (k && q) {
                    handlePlayCard(seat, k.id, true);
                    return;
                }
            }
        }
    }

    let validCard = hand.find(c => canPlayCard(seat, c));
    if (!validCard) validCard = hand[0];

    handlePlayCard(seat, validCard.id, false);
}

function handleBid(seat, amount) {
    if (gameState.phase !== "bid" || gameState.bidder !== seat || gameState.passed.includes(seat) || gameState.paused) return;

    if (amount === 0) {
        gameState.passed.push(seat);
        addChat(`${gameState.players[seat].name}: 🔴 PAS`);
        addLog(`🔴 ${gameState.players[seat].name} spasował.`);
    } else {
        if (amount <= gameState.highestBid || amount > 240) return;
        gameState.highestBid = amount;
        gameState.highestBidder = seat;
        addLog(`🔨 ${gameState.players[seat].name} licytuje ${amount}`);
    }

    const active = [0, 1, 2, 3].filter(p => !gameState.passed.includes(p));
    if (active.length === 1) {
        const winner = active[0];
        gameState.highestBidder = winner;
        gameState.declared = gameState.highestBid;
        gameState.bidder = -1;
        
        gameState.phase = "show_musik"; 
        addChat(`SYSTEM: ${gameState.players[winner].name} wygrywa licytację (${gameState.highestBid} pkt). Podgląd musiku przez 10 sekund...`);
        io.emit('stateUpdate', gameState);

        setTimeout(() => {
            if (gameState.phase === "show_musik") {
                gameState.phase = "exchange";
                
                const winnerPlayer = gameState.players[winner];
                winnerPlayer.hand.push(...gameState.musik);
                gameState.musik = [];
                winnerPlayer.hand.sort((a, b) => b.value - a.value);

                addChat(`SYSTEM: Musik trafił do ręki ${winnerPlayer.name}. Wybierz 3 karty do oddania.`);
                io.emit('stateUpdate', gameState);
                checkBotTurn();
            }
        }, 10000);

    } else {
        let next = (seat + 1) % 4;
        while (gameState.passed.includes(next)) {
            next = (next + 1) % 4;
        }
        gameState.bidder = next;
        io.emit('stateUpdate', gameState);
        checkBotTurn();
    }
}

function handleExchange(seat, selectedIds, recipients) {
    if (gameState.phase !== "exchange" || gameState.highestBidder !== seat || gameState.paused) return;
    if (selectedIds.length !== 3) return;

    const p = gameState.players[seat];

    selectedIds.forEach((id, index) => {
        const target = recipients[index];
        let cardIndex = p.hand.findIndex(c => c.id === id);
        
        if (cardIndex >= 0) {
            const card = p.hand.splice(cardIndex, 1)[0];
            gameState.players[target].hand.push(card);
            addLog(`📤 ${p.name} przekazuje ${card.rank}${card.symbol} → ${gameState.players[target].name}`);
        }
    });

    gameState.players.forEach(pl => pl.hand.sort((a, b) => b.value - a.value));

    gameState.phase = "play";
    gameState.leader = gameState.highestBidder;
    addChat(`SYSTEM: Wymiana zakończona. Rozpoczyna ${gameState.players[gameState.leader].name}.`);
    io.emit('stateUpdate', gameState);
    checkBotTurn();
}

function handlePlayCard(seat, cardId, tryMeld = false) {
    if (gameState.phase !== "play" || gameState.leader !== seat || gameState.paused) return;

    const p = gameState.players[seat];
    const cardIndex = p.hand.findIndex(c => c.id === cardId);
    if (cardIndex < 0) return;

    const card = p.hand[cardIndex];

    if (!canPlayCard(seat, card)) return;

    // Przetwarzanie meldunku przy wyjściu
    if (gameState.trick.length === 0 && (card.rank === "K" || card.rank === "Q") && tryMeld) {
        if (!gameState.meldedSuits.includes(card.suit)) {
            const counterpart = card.rank === "K" ? "Q" : "K";
            const hasPair = p.hand.some(c => c.suit === card.suit && c.rank === counterpart);
            if (hasPair) {
                gameState.meldedSuits.push(card.suit);
                gameState.trump = card.suit;
                const suitObj = SUITS.find(s => s.name === card.suit);
                gameState.melds[team(seat)] += suitObj.meld;
                addChat(`SYSTEM: 💍 ${p.name} melduje ${card.suit} za ${suitObj.meld} pkt.`);
                addLog(`💍 ${p.name} meldunek ${card.suit} +${suitObj.meld}`);
            }
        }
    }

    p.hand.splice(cardIndex, 1);
    gameState.trick.push({ player: seat, card });

    addLog(`🃏 ${p.name} zagrał ${card.rank}${card.symbol}`);

    if (gameState.trick.length === 4) {
        io.emit('stateUpdate', gameState);
        setTimeout(resolveTrick, 800);
    } else {
        gameState.leader = (seat + 1) % 4;
        io.emit('stateUpdate', gameState);
        checkBotTurn();
    }
}

io.on('connection', (socket) => {
    socket.on('joinGame', (name) => {
        let existingPlayer = gameState.players.find(p => p.name === name);

        if (existingPlayer) {
            existingPlayer.id = socket.id;
            socket.emit('assignedSeat', existingPlayer.seat);
            addChat(`SYSTEM: ${name} powrócił do gry.`);
            updateHosts();
            io.emit('stateUpdate', gameState);
            return;
        }

        if (gameState.players.length < 4) {
            const seat = gameState.players.length;
            
            const onlyBots = gameState.players.every(p => p.isBot);
            const isHost = gameState.players.length === 0 || onlyBots;

            if (onlyBots) {
                gameState.players.forEach(p => p.isHost = false);
            }

            gameState.players.push({ id: socket.id, name, seat, hand: [], isHost, isBot: false });
            socket.emit('assignedSeat', seat);
            
            addChat(`SYSTEM: Dołączył ${name} (Gracz ${seat + 1})${isHost ? ' [HOST]' : ''}.`);

            updateHosts();

            if (gameState.players.length === 4) {
                startNewRound();
            } else {
                io.emit('stateUpdate', gameState);
            }
        } else {
            socket.emit('fullGame');
        }
    });

    socket.on('addBot', () => {
        const hostPlayer = gameState.players.find(p => p.id === socket.id);
        if (!hostPlayer || !hostPlayer.isHost) return;

        if (gameState.players.length < 4) {
            const seat = gameState.players.length;
            const botName = `Bot_${seat + 1}`;
            gameState.players.push({ id: `bot_${Math.random()}`, name: botName, seat, hand: [], isHost: false, isBot: true });
            addChat(`SYSTEM: 🤖 Dodano ${botName}.`);

            updateHosts();

            if (gameState.players.length === 4) {
                startNewRound();
            } else {
                io.emit('stateUpdate', gameState);
            }
        }
    });

    socket.on('kickPlayer', (targetSeat) => {
        const hostPlayer = gameState.players.find(p => p.id === socket.id);
        if (!hostPlayer || !hostPlayer.isHost) return;

        const kicked = gameState.players[targetSeat];
        if (kicked && targetSeat !== hostPlayer.seat) {
            addChat(`SYSTEM: ⛔ ${kicked.name} został usunięty.`);
            addLog(`⛔ Usunięto: ${kicked.name}`);

            if (!kicked.isBot) {
                io.to(kicked.id).emit('kicked');
            }

            gameState.players.splice(targetSeat, 1);
            gameState.players.forEach((p, idx) => p.seat = idx);
            updateHosts();

            if (gameState.phase !== "waiting") {
                gameState.phase = "waiting";
                gameState.scores = [0, 0];
                addChat(`SYSTEM: Gra została zresetowana.`);
            }

            io.emit('stateUpdate', gameState);
        }
    });

    socket.on('disconnect', () => {
        const playerIndex = gameState.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== -1) {
            const player = gameState.players[playerIndex];
            addChat(`SYSTEM: ${player.name} rozłączył się.`);
            
            if (gameState.phase === "waiting") {
                gameState.players.splice(playerIndex, 1);
                gameState.players.forEach((p, index) => p.seat = index);
            }
            updateHosts();
            io.emit('stateUpdate', gameState);
        }
    });

    socket.on('bid', ({ seat, amount }) => handleBid(seat, amount));
    socket.on('foldFourNines', ({ seat }) => handleFoldFourNines(seat));
    socket.on('exchangeCards', ({ seat, selectedIds, recipients }) => handleExchange(seat, selectedIds, recipients));
    socket.on('playCard', ({ seat, cardId, tryMeld }) => handlePlayCard(seat, cardId, tryMeld));

    socket.on('sendChat', (text) => {
        const player = gameState.players.find(p => p.id === socket.id);
        if (player && text.trim()) {
            addChat(`${player.name}: ${text.trim()}`);
            io.emit('stateUpdate', gameState);
        }
    });

    socket.on('nextRound', () => {
        if (gameState.phase === "next") {
            gameState.round++;
            gameState.dealer = (gameState.dealer + 1) % 4;
            startNewRound();
        }
    });

    socket.on('newGame', () => {
        gameState.round = 1;
        gameState.dealer = 0;
        gameState.scores = [0, 0];
        gameState.lastRoundSummary = null;
        startNewRound();
    });

    socket.on('togglePause', () => {
        gameState.paused = !gameState.paused;
        addChat(`SYSTEM: ${gameState.paused ? '⏸ Gra zapauzowana.' : '▶ Gra wznowiona.'}`);
        io.emit('stateUpdate', gameState);
        checkBotTurn();
    });
});

function resolveTrick() {
    const leadSuit = gameState.trick[0].card.suit;
    let candidates = [];

    if (gameState.trump && gameState.trick.some(t => t.card.suit === gameState.trump)) {
        candidates = gameState.trick.filter(t => t.card.suit === gameState.trump);
    } else {
        candidates = gameState.trick.filter(t => t.card.suit === leadSuit);
    }

    const winner = candidates.reduce((best, curr) => curr.card.value > best.card.value ? curr : best);
    const trickPoints = gameState.trick.reduce((sum, t) => sum + t.card.value, 0);
    const winningTeam = team(winner.player);

    gameState.roundCardPoints[winningTeam] += trickPoints;
    gameState.tricks.push({ cards: [...gameState.trick], winner: winner.player, points: trickPoints });

    addChat(`SYSTEM: 🏆 ${gameState.players[winner.player].name} zdobywa lewę za ${trickPoints} pkt.`);
    addLog(`🏆 Lewa: ${gameState.players[winner.player].name} +${trickPoints} pkt (Para ${winningTeam + 1})`);

    gameState.trick = [];
    gameState.leader = winner.player;

    if (gameState.players.every(p => p.hand.length === 0)) {
        finishRound();
    } else {
        io.emit('stateUpdate', gameState);
        checkBotTurn();
    }
}

function finishRound() {
    const biddingTeam = team(gameState.highestBidder);
    const defendingTeam = biddingTeam === 0 ? 1 : 0;
    const rawPoints = [
        gameState.roundCardPoints[0] + gameState.melds[0],
        gameState.roundCardPoints[1] + gameState.melds[1]
    ];

    const contractMade = rawPoints[biddingTeam] >= gameState.declared;

    if (contractMade) {
        gameState.scores[biddingTeam] += gameState.declared;
        addLog(`✅ Para ${biddingTeam + 1} wygrywa kontrakt +${gameState.declared}`);
    } else {
        gameState.scores[biddingTeam] -= gameState.declared;
        addLog(`❌ Para ${biddingTeam + 1} nie realizuje kontraktu -${gameState.declared}`);
    }

    if (gameState.scores[defendingTeam] < 800) {
        gameState.scores[defendingTeam] += rawPoints[defendingTeam];
        addLog(`➕ Para ${defendingTeam + 1} +${rawPoints[defendingTeam]} pkt.`);
    } else {
        addLog(`⛔ Para ${defendingTeam + 1} ma 800+ pkt — brak punktów.`);
    }

    addChat(`SYSTEM: 📊 Koniec rozdania — Para 1: ${rawPoints[0]} pkt, Para 2: ${rawPoints[1]} pkt.`);

    if (gameState.scores[0] >= 1000 || gameState.scores[1] >= 1000) {
        gameState.phase = "gameover";
    } else {
        gameState.phase = "next";
    }
    io.emit('stateUpdate', gameState);
    checkBotTurn();
}

http.listen(3000, () => console.log('Serwer Tysiąc z RWD uruchomiony na port 3000'));
