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

const PLAYERS_NAMES = ["Gracz 1", "Gracz 2", "Gracz 3", "Gracz 4"];

let roomState = {
    sockets: [null, null, null, null],
    gameStarted: false,
    round: 1,
    dealer: 0,
    scores: [0, 0],
    phase: "waiting",
    bidder: 1,
    highestBid: 100,
    highestBidder: 0,
    openingBidder: 0,
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
    chat: [],
    log: [],
    hands: [[], [], [], []]
};

function team(player) { return player % 2; }

function createDeck() {
    const deck = [];
    SUITS.forEach(suit => {
        RANKS.forEach(rank => {
            deck.push({
                id: Math.random().toString(36).substring(2),
                symbol: suit.symbol, suit: suit.name,
                rank: rank.rank, value: rank.value,
                meld: suit.meld, red: suit.red
            });
        });
    });
    return deck.sort(() => Math.random() - 0.5);
}

function logAction(text) {
    roomState.log.unshift(text);
    roomState.log = roomState.log.slice(0, 20);
}

function chatMessage(text) {
    roomState.chat.push(text);
    roomState.chat = roomState.chat.slice(-40);
}

function dealCards() {
    const deck = createDeck();
    roomState.hands = [[], [], [], []];

    for (let round = 0; round < 5; round++) {
        for (let i = 0; i < 4; i++) {
            const player = (roomState.dealer + i) % 4;
            roomState.hands[player].push(deck.pop());
        }
    }
    roomState.musik = deck.splice(0, 4);
    roomState.hands.forEach(hand => hand.sort((a, b) => b.value - a.value));

    roomState.phase = "bid";
    roomState.openingBidder = roomState.dealer;
    roomState.highestBid = 100;
    roomState.highestBidder = roomState.openingBidder;
    roomState.bidder = (roomState.openingBidder + 1) % 4;
    roomState.passed = [];
    roomState.declared = null;
    roomState.trump = null;
    roomState.trick = [];
    roomState.tricks = [];
    roomState.melds = [0, 0];
    roomState.meldedSuits = [];
    roomState.roundCardPoints = [0, 0];

    chatMessage(`SYSTEM: Rozdanie ${roomState.round}. ${PLAYERS_NAMES[roomState.openingBidder]} otwiera obowiązkowym 100.`);
    logAction(`🔨 ${PLAYERS_NAMES[roomState.openingBidder]} otwiera licytację obowiązkowym 100.`);
    broadcastState();
}

function getCrossMeldCandidate(player) {
    if (roomState.phase !== "play" || roomState.leader !== player || roomState.trick.length === 0) return null;
    const previous = roomState.trick[roomState.trick.length - 1];
    if (!previous || previous.player === player || previous.card.rank !== "Q" || roomState.meldedSuits.includes(previous.card.suit)) return null;
    return roomState.hands[player].find(c => c.rank === "K" && c.suit === previous.card.suit) || null;
}

function canPlay(player, card) {
    if (roomState.trick.length === 0) return true;
    const leadSuit = roomState.trick[0].card.suit;
    const hand = roomState.hands[player];
    const hasLeadSuit = hand.some(c => c.suit === leadSuit);

    if (!hasLeadSuit) return true;
    if (card.suit !== leadSuit) return false;

    const highest = roomState.trick.filter(t => t.card.suit === leadSuit).reduce((best, cur) => cur.card.value > best.card.value ? cur : best);
    const canBeat = hand.some(c => c.suit === leadSuit && c.value > highest.card.value);
    
    if (canBeat && card.value <= highest.card.value) return false;
    return true;
}

function registerMeld(player, suitName, kind) {
    if (roomState.meldedSuits.includes(suitName)) return;
    const suit = SUITS.find(s => s.name === suitName);
    if (!suit) return;

    roomState.meldedSuits.push(suitName);
    roomState.trump = suitName;
    roomState.melds[team(player)] += suit.meld;

    chatMessage(`SYSTEM: 💍 ${PLAYERS_NAMES[player]} melduje ${kind === "cross" ? "królem na damę " : ""}${suit.name} za ${suit.meld} pkt.`);
    logAction(`💍 ${PLAYERS_NAMES[player]} meldunek ${kind === "cross" ? "K na Q " : ""}${suit.name} +${suit.meld}`);
}

function resolveTrick() {
    const leadSuit = roomState.trick[0].card.suit;
    let candidates = (roomState.trump && roomState.trick.some(t => t.card.suit === roomState.trump))
        ? roomState.trick.filter(t => t.card.suit === roomState.trump)
        : roomState.trick.filter(t => t.card.suit === leadSuit);

    const winner = candidates.reduce((best, cur) => cur.card.value > best.card.value ? cur : best);
    const trickPoints = roomState.trick.reduce((sum, p) => sum + p.card.value, 0);
    const winningTeam = team(winner.player);

    roomState.roundCardPoints[winningTeam] += trickPoints;
    roomState.tricks.push({ cards: [...roomState.trick], winner: winner.player, points: trickPoints });

    logAction(`🏆 Lewa: ${PLAYERS_NAMES[winner.player]} +${trickPoints} pkt dla Pary ${winningTeam + 1}`);
    roomState.trick = [];
    roomState.leader = winner.player;

    if (roomState.hands.every(h => h.length === 0)) {
        finishRound();
    }
}

function finishRound() {
    const cardPoints = [...roomState.roundCardPoints];
    const rawPoints = [cardPoints[0] + roomState.melds[0], cardPoints[1] + roomState.melds[1]];
    const biddingTeam = team(roomState.highestBidder);
    const defendingTeam = biddingTeam === 0 ? 1 : 0;
    const contractMade = rawPoints[biddingTeam] >= roomState.declared;

    if (contractMade) {
        roomState.scores[biddingTeam] += roomState.declared;
        logAction(`✅ Para ${biddingTeam + 1} zrealizowała licytację +${roomState.declared}`);
    } else {
        roomState.scores[biddingTeam] -= roomState.declared;
        logAction(`❌ Para ${biddingTeam + 1} nie zrealizowała licytacji -${roomState.declared}`);
    }

    if (roomState.scores[defendingTeam] < 800) {
        roomState.scores[defendingTeam] += rawPoints[defendingTeam];
        logAction(`➕ Para ${defendingTeam + 1} zdobywa +${rawPoints[defendingTeam]} pkt.`);
    }

    roomState.lastRoundSummary = {
        cardPoints, melds: [...roomState.melds], rawPoints,
        biddingTeam, declared: roomState.declared, contractMade
    };

    if (roomState.scores[0] >= 1000 || roomState.scores[1] >= 1000) {
        roomState.phase = "gameover";
    } else {
        roomState.phase = "next";
    }
}

function getSanitizedStateFor(playerIndex) {
    const copy = JSON.parse(JSON.stringify(roomState));
    delete copy.sockets;
    
    copy.myIndex = playerIndex;
    copy.myHand = playerIndex !== null && playerIndex !== undefined ? roomState.hands[playerIndex] : [];
    delete copy.hands;

    if (copy.phase !== "exchange") {
        delete copy.musik;
    }
    return copy;
}

function broadcastState() {
    roomState.sockets.forEach((socId, idx) => {
        if (socId) {
            io.to(socId).emit('gameState', getSanitizedStateFor(idx));
        }
    });
}

io.on('connection', (socket) => {
    let assignedIndex = roomState.sockets.findIndex(s => s === null);
    if (assignedIndex !== -1) {
        roomState.sockets[assignedIndex] = socket.id;
        socket.emit('assignedPlayer', assignedIndex);
        chatMessage(`SYSTEM: ${PLAYERS_NAMES[assignedIndex]} dołączył do stołu.`);
    } else {
        socket.emit('assignedPlayer', -1);
    }

    if (roomState.sockets.filter(Boolean).length === 4 && !roomState.gameStarted) {
        roomState.gameStarted = true;
        dealCards();
    } else {
        broadcastState();
    }

    socket.on('bid', (amount) => {
        if (assignedIndex !== roomState.bidder || roomState.phase !== "bid") return;
        if (amount === 0) {
            roomState.passed.push(assignedIndex);
            logAction(`🔴 ${PLAYERS_NAMES[assignedIndex]} spasował.`);
        } else if (amount > roomState.highestBid) {
            roomState.highestBid = amount;
            roomState.highestBidder = assignedIndex;
            logAction(`🔨 ${PLAYERS_NAMES[assignedIndex]} licytuje ${amount}`);
        }

        const active = [0, 1, 2, 3].filter(p => !roomState.passed.includes(p));
        if (active.length === 1) {
            roomState.highestBidder = active[0];
            roomState.declared = roomState.highestBid;
            roomState.phase = "exchange";
            roomState.bidder = -1;
        } else {
            let next = (assignedIndex + 1) % 4;
            while (roomState.passed.includes(next)) next = (next + 1) % 4;
            roomState.bidder = next;
        }
        broadcastState();
    });

    socket.on('exchange', (payload) => {
        if (assignedIndex !== roomState.highestBidder || roomState.phase !== "exchange") return;
        const { transfers } = payload;
        if (!transfers || transfers.length !== 3) return;

        transfers.forEach(tr => {
            let cardIdx = roomState.hands[assignedIndex].findIndex(c => c.id === tr.cardId);
            let card = null;
            if (cardIdx !== -1) {
                card = roomState.hands[assignedIndex].splice(cardIdx, 1)[0];
            } else {
                cardIdx = roomState.musik.findIndex(c => c.id === tr.cardId);
                if (cardIdx !== -1) card = roomState.musik.splice(cardIdx, 1)[0];
            }
            if (card) {
                roomState.hands[tr.targetPlayer].push(card);
                logAction(`📤 ${PLAYERS_NAMES[assignedIndex]} przekazuje ${card.rank}${card.symbol} → ${PLAYERS_NAMES[tr.targetPlayer]}`);
            }
        });

        roomState.hands[roomState.highestBidder].push(...roomState.musik);
        roomState.musik = [];
        roomState.hands.forEach(h => h.sort((a, b) => b.value - a.value));

        roomState.phase = "play";
        roomState.leader = roomState.highestBidder;
        broadcastState();
    });

    socket.on('playCard', ({ cardId, isCrossMeld }) => {
        if (assignedIndex !== roomState.leader || roomState.phase !== "play") return;
        const hand = roomState.hands[assignedIndex];
        const cardIdx = hand.findIndex(c => c.id === cardId);
        if (cardIdx === -1) return;

        const card = hand[cardIdx];
        const crossCandidate = getCrossMeldCandidate(assignedIndex);
        const isValidCross = isCrossMeld && crossCandidate && crossCandidate.id === cardId;

        if (!isValidCross && !canPlay(assignedIndex, card)) return;

        hand.splice(cardIdx, 1);
        roomState.trick.push({ player: assignedIndex, card });

        if (isCrossMeld) registerMeld(assignedIndex, card.suit, "cross");

        logAction(`🃏 ${PLAYERS_NAMES[assignedIndex]} zagrał ${card.rank}${card.symbol}`);

        if (roomState.trick.length === 4) {
            resolveTrick();
        } else {
            roomState.leader = (assignedIndex + 1) % 4;
        }
        broadcastState();
    });

    socket.on('makeMeld', () => {
        if (roomState.phase !== "play" || roomState.trick.length === 0 || roomState.trick[0].player !== assignedIndex) return;
        const firstCard = roomState.trick[0].card;
        if (firstCard.rank !== "K" && firstCard.rank !== "Q") return;
        
        const counterpart = firstCard.rank === "K" ? "Q" : "K";
        const hasCounterpart = roomState.hands[assignedIndex].some(c => c.suit === firstCard.suit && c.rank === counterpart);
        
        if (hasCounterpart) {
            registerMeld(assignedIndex, firstCard.suit, "self");
            broadcastState();
        }
    });

    socket.on('nextRound', () => {
        if (roomState.phase !== "next") return;
        roomState.round++;
        roomState.dealer = (roomState.dealer + 1) % 4;
        dealCards();
    });

    socket.on('sendChat', (text) => {
        chatMessage(`${PLAYERS_NAMES[assignedIndex] || 'Widz'}: ${text}`);
        broadcastState();
    });

    socket.on('disconnect', () => {
        if (assignedIndex !== -1) {
            roomState.sockets[assignedIndex] = null;
            chatMessage(`SYSTEM: ${PLAYERS_NAMES[assignedIndex]} rozłączył się.`);
            broadcastState();
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serwer działa na porcie ${PORT}`));
