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
    phase: "waiting", // waiting, bid, exchange, play, next, gameover
    players: [], // { id, name, hand, seat }
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
    log: [],
    chat: []
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

function team(seat) {
    return seat % 2;
}

function startNewRound() {
    const deck = createDeck();
    gameState.players.forEach(p => p.hand = []);

    // Deal 5 cards each
    for (let round = 0; round < 5; round++) {
        for (let i = 0; i < 4; i++) {
            const playerIndex = (gameState.dealer + i) % 4;
            gameState.players[playerIndex].hand.push(deck.pop());
        }
    }

    // 4 cards to musik
    gameState.musik = deck.splice(0, 4);

    gameState.players.forEach(p => {
        p.hand.sort((a, b) => b.value - a.value);
    });

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

    addLog(`🔨 Gracz ${gameState.players[gameState.openingBidder].name} otwiera licytację obowiązkowym 100.`);
    io.emit('stateUpdate', gameState);
}

function addLog(msg) {
    gameState.log.unshift(msg);
    gameState.log = gameState.log.slice(0, 20);
}

function canPlayCard(seat, card) {
    if (gameState.trick.length === 0) return true;

    const leadSuit = gameState.trick[0].card.suit;
    const hand = gameState.players[seat].hand;
    const hasLeadSuit = hand.some(c => c.suit === leadSuit);

    if (!hasLeadSuit) return true;
    if (card.suit !== leadSuit) return false;

    const highest = gameState.trick
        .filter(t => t.card.suit === leadSuit)
        .reduce((best, curr) => curr.card.value > best.card.value ? curr : best);

    const canBeat = hand.some(c => c.suit === leadSuit && c.value > highest.card.value);
    if (canBeat && card.value <= highest.card.value) return false;

    return true;
}

io.on('connection', (socket) => {
    socket.on('joinGame', (name) => {
        if (gameState.players.length < 4) {
            const seat = gameState.players.length;
            gameState.players.push({ id: socket.id, name, seat, hand: [] });
            socket.emit('assignedSeat', seat);
            if (gameState.players.length === 4) {
                startNewRound();
            } else {
                io.emit('stateUpdate', gameState);
            }
        }
    });

    socket.on('bid', ({ seat, amount }) => {
        if (gameState.phase !== "bid" || gameState.bidder !== seat || gameState.passed.includes(seat)) return;

        if (amount === 0) {
            gameState.passed.push(seat);
            addLog(`🔴 ${gameState.players[seat].name} spasował.`);
        } else {
            if (amount <= gameState.highestBid) return;
            gameState.highestBid = amount;
            gameState.highestBidder = seat;
            addLog(`🔨 ${gameState.players[seat].name} licytuje ${amount}`);
        }

        const active = [0, 1, 2, 3].filter(p => !gameState.passed.includes(p));
        if (active.length === 1) {
            const winner = active[0];
            gameState.highestBidder = winner;
            gameState.declared = gameState.highestBid;
            gameState.phase = "exchange";
            gameState.bidder = -1;
            addLog(`🎉 Licytację wygrywa ${gameState.players[winner].name} za ${gameState.highestBid}.`);
        } else {
            let next = (seat + 1) % 4;
            while (gameState.passed.includes(next)) {
                next = (next + 1) % 4;
            }
            gameState.bidder = next;
        }
        io.emit('stateUpdate', gameState);
    });

    socket.on('exchangeCards', ({ seat, selectedIds, recipients }) => {
        if (gameState.phase !== "exchange" || gameState.highestBidder !== seat) return;
        if (selectedIds.length !== 3) return;

        const p = gameState.players[seat];
        selectedIds.forEach((id, index) => {
            let cardIndex = p.hand.findIndex(c => c.id === id);
            let card = null;
            if (cardIndex >= 0) {
                card = p.hand.splice(cardIndex, 1)[0];
            } else {
                let mIndex = gameState.musik.findIndex(c => c.id === id);
                if (mIndex >= 0) card = gameState.musik.splice(mIndex, 1)[0];
            }
            if (card) {
                const target = recipients[index];
                gameState.players[target].hand.push(card);
            }
        });

        p.hand.push(...gameState.musik);
        gameState.musik = [];
        gameState.players.forEach(pl => pl.hand.sort((a, b) => b.value - a.value));

        gameState.phase = "play";
        gameState.leader = gameState.highestBidder;
        addLog(`📤 Wymiana zakończona. Gracz ${gameState.players[gameState.leader].name} rozpoczyna grę.`);
        io.emit('stateUpdate', gameState);
    });

    socket.on('playCard', ({ seat, cardId, crossMeld }) => {
        if (gameState.phase !== "play" || gameState.leader !== seat) return;

        const p = gameState.players[seat];
        const cardIndex = p.hand.findIndex(c => c.id === cardId);
        if (cardIndex < 0) return;

        const card = p.hand[cardIndex];

        if (!crossMeld && !canPlayCard(seat, card)) return;

        p.hand.splice(cardIndex, 1);
        gameState.trick.push({ player: seat, card });

        if (crossMeld) {
            gameState.meldedSuits.push(card.suit);
            gameState.trump = card.suit;
            const suitObj = SUITS.find(s => s.name === card.suit);
            gameState.melds[team(seat)] += suitObj.meld;
            addLog(`💍 ${p.name} przemeldowuje Królem na Damę w kolorze ${card.suit} (+${suitObj.meld} pkt)`);
        }

        addLog(`🃏 ${p.name} zagrał ${card.rank} ${card.symbol}`);

        if (gameState.trick.length === 4) {
            setTimeout(resolveTrick, 1000);
        } else {
            gameState.leader = (seat + 1) % 4;
        }
        io.emit('stateUpdate', gameState);
    });

    socket.on('makeMeld', ({ seat }) => {
        if (gameState.phase !== "play" || gameState.trick.length === 0 || gameState.trick[0].player !== seat) return;
        const firstCard = gameState.trick[0].card;
        if (firstCard.rank !== "K" && firstCard.rank !== "Q") return;
        if (gameState.meldedSuits.includes(firstCard.suit)) return;

        const counterpart = firstCard.rank === "K" ? "Q" : "K";
        const hasPair = gameState.players[seat].hand.some(c => c.suit === firstCard.suit && c.rank === counterpart);

        if (hasPair) {
            gameState.meldedSuits.push(firstCard.suit);
            gameState.trump = firstCard.suit;
            const suitObj = SUITS.find(s => s.name === firstCard.suit);
            gameState.melds[team(seat)] += suitObj.meld;
            addLog(`💍 ${gameState.players[seat].name} melduje ${firstCard.suit} (+${suitObj.meld} pkt)`);
            io.emit('stateUpdate', gameState);
        }
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
    addLog(`🏆 ${gameState.players[winner.player].name} bierze lewę (${trickPoints} pkt).`);

    gameState.trick = [];
    gameState.leader = winner.player;

    if (gameState.players.every(p => p.hand.length === 0)) {
        finishRound();
    } else {
        io.emit('stateUpdate', gameState);
    }
}

function finishRound() {
    const biddingTeam = team(gameState.highestBidder);
    const defendingTeam = biddingTeam === 0 ? 1 : 0;
    const rawPoints = [
        gameState.roundCardPoints[0] + gameState.melds[0],
        gameState.roundCardPoints[1] + gameState.melds[1]
    ];

    if (rawPoints[biddingTeam] >= gameState.declared) {
        gameState.scores[biddingTeam] += gameState.declared;
        addLog(`✅ Para ${biddingTeam + 1} ugrała kontrakt ${gameState.declared}`);
    } else {
        gameState.scores[biddingTeam] -= gameState.declared;
        addLog(`❌ Para ${biddingTeam + 1} spadła o ${gameState.declared}`);
    }

    if (gameState.scores[defendingTeam] < 800) {
        gameState.scores[defendingTeam] += rawPoints[defendingTeam];
        addLog(`➕ Para ${defendingTeam + 1} zdobywa ${rawPoints[defendingTeam]} pkt.`);
    } else {
        addLog(`⛔ Para ${defendingTeam + 1} ma 800+ pkt — brak punktów z lew.`);
    }

    if (gameState.scores[0] >= 1000 || gameState.scores[1] >= 1000) {
        gameState.phase = "gameover";
    } else {
        gameState.phase = "next";
    }
    io.emit('stateUpdate', gameState);
}

http.listen(3000, () => console.log('Server running on port 3000'));
