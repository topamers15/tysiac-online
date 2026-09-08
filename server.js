const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const RANKS = ['9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUES = { '9': 0, 'J': 2, 'Q': 3, 'K': 4, '10': 10, 'A': 11 };
const RANK_POWER  = { '9': 1, 'J': 2, 'Q': 3, 'K': 4, '10': 5, 'A': 6 };

const SUITS = [
    { name: 'karo', symbol: '♦', red: true, value: 40 },
    { name: 'kier', symbol: '♥', red: true, value: 60 },
    { name: 'pik', symbol: '♠', red: false, value: 80 },
    { name: 'trefl', symbol: '♣', red: false, value: 100 }
];

let gameState = createInitialState();

function createInitialState() {
    return {
        phase: 'waiting', // waiting, bid, show_musik, exchange, play, game_over
        round: 1,
        players: [],
        deck: [],
        musik: [],
        trick: [],
        trump: null,
        scores: [0, 0],
        roundMelds: [0, 0],
        roundTricks: [0, 0],
        highestBid: 100,
        highestBidder: null,
        bidder: 0,
        leader: 0,
        givenToSeats: [],
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
    if (gameState.log.length > 25) gameState.log.shift();
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
    gameState.roundMelds = [0, 0];
    gameState.roundTricks = [0, 0];
    gameState.highestBid = 100;
    gameState.highestBidder = null;
    gameState.bidder = (gameState.round - 1) % 4;
    gameState.givenToSeats = [];
    
    gameState.players.forEach((p, idx) => {
        p.hand = gameState.deck.slice(idx * 5, (idx + 1) * 5);
        p.passed = false;
    });
    gameState.musik = gameState.deck.slice(20, 24);

    addLog(`--- ROZDANIE ${gameState.round} ---`);
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
        gameState.phase = 'show_musik';
        const winner = gameState.players[gameState.highestBidder];
        addLog(`${winner.name} wygrywa licytację (${gameState.highestBid} pkt)! Odsłanianie musiku na 10 sekund...`);
        io.emit('stateUpdate', gameState);

        setTimeout(() => {
            if (gameState.phase === 'show_musik') {
                gameState.players[gameState.highestBidder].hand.push(...gameState.musik);
                gameState.phase = 'exchange';
                gameState.givenToSeats = [];
                addLog(`${winner.name} zabiera musik. Przekaż po 1 karcie dla każdego gracza.`);
                io.emit('stateUpdate', gameState);
                checkBotTurn();
            }
        }, 10000);
        return;
    }

    do {
        gameState.bidder = (gameState.bidder + 1) % 4;
    } while (gameState.players[gameState.bidder].passed);

    io.emit('stateUpdate', gameState);
    checkBotTurn();
}

function isPlayLegal(hand, card, leadCard) {
    if (!leadCard) return true;
    const leadSuit = leadCard.suit;
    const hasLeadSuit = hand.some(c => c.suit === leadSuit);
    if (hasLeadSuit) {
        return card.suit === leadSuit;
    }
    return true;
}

function determineTrickWinner(trick, trump) {
    const leadSuit = trick[0].card.suit;
    let winner = trick[0];

    for (let i = 1; i < trick.length; i++) {
        const current = trick[i];
        const currentSuit = current.card.suit;
        const winnerSuit = winner.card.suit;

        if (currentSuit === trump) {
            if (winnerSuit !== trump || RANK_POWER[current.card.rank] > RANK_POWER[winner.card.rank]) {
                winner = current;
            }
        } else if (currentSuit === leadSuit && winnerSuit !== trump) {
            if (RANK_POWER[current.card.rank] > RANK_POWER[winner.card.rank]) {
                winner = current;
            }
        }
    }
    return winner;
}

function executePlayCard(seat, cardId, isMeldAttempt) {
    const player = gameState.players[seat];
    if (!player) return false;

    const cardIdx = player.hand.findIndex(c => c.id === cardId);
    if (cardIdx === -1) return false;

    const card = player.hand[cardIdx];
    const leadCard = gameState.trick[0]?.card;

    if (!isPlayLegal(player.hand, card, leadCard)) {
        return false;
    }

    player.hand.splice(cardIdx, 1);
    const suitData = SUITS.find(s => s.name === card.suit);

    if (isMeldAttempt && (card.rank === 'K' || card.rank === 'Q')) {
        const otherRank = card.rank === 'K' ? 'Q' : 'K';
        
        const hasPairInHand = player.hand.some(c => c.suit === card.suit && c.rank === otherRank);
        const hasPairInTrick = gameState.trick.some(t => t.card.suit === card.suit && t.card.rank === otherRank);

        if ((gameState.trick.length === 0 && hasPairInHand) || (gameState.trick.length > 0 && hasPairInTrick)) {
            gameState.trump = card.suit;
            const teamIdx = seat % 2;
            gameState.roundMelds[teamIdx] += suitData.value;
            
            const meldType = gameState.trick.length > 0 ? 'PRZEMELDOWANIE' : 'MELDUNEK';
            addLog(`👑 ${player.name} zgłasza ${meldType} (${suitData.name.toUpperCase()} - ${suitData.value} pkt)! Atut: ${suitData.symbol}`);
        } else {
            addLog(`⚠️ Brak drugiej karty do meldunku w kolorze ${suitData.name}!`);
        }
    }

    gameState.trick.push({ seat, card });
    addLog(`${player.name} zagrywa ${card.rank}${card.symbol}`);

    if (gameState.trick.length === 4) {
        setTimeout(() => {
            const winningPlay = determineTrickWinner(gameState.trick, gameState.trump);
            const winnerSeat = winningPlay.seat;
            const winnerTeam = winnerSeat % 2;
            
            const trickPoints = gameState.trick.reduce((sum, item) => sum + RANK_VALUES[item.card.rank], 0);
            gameState.roundTricks[winnerTeam] += trickPoints;

            addLog(`Lewę zdobytą przez ${gameState.players[winnerSeat].name} wyceniono na ${trickPoints} pkt.`);

            gameState.trick = [];
            gameState.leader = winnerSeat;

            if (gameState.players.every(p => p.hand.length === 0)) {
                endRound();
            } else {
                io.emit('stateUpdate', gameState);
                checkBotTurn();
            }
        }, 1500);
    } else {
        gameState.leader = (gameState.leader + 1) % 4;
        io.emit('stateUpdate', gameState);
        checkBotTurn();
    }
    return true;
}

function endRound() {
    const bidderTeam = gameState.highestBidder % 2;
    const oppTeam = 1 - bidderTeam;

    const bidderScored = gameState.roundMelds[bidderTeam] + gameState.roundTricks[bidderTeam];
    const oppScored = gameState.roundMelds[oppTeam] + gameState.roundTricks[oppTeam];

    addLog(`--- PODSUMOWANIE ROZDANIA ${gameState.round} ---`);
    addLog(`Para Licytująca zdobyła: ${bidderScored} pkt (zadeklarowano: ${gameState.highestBid})`);
    addLog(`Para Przeciwna zdobyła: ${oppScored} pkt`);

    if (bidderScored >= gameState.highestBid) {
        if (gameState.scores[bidderTeam] >= 800) {
            gameState.scores[bidderTeam] += gameState.highestBid;
            addLog(`Para ${bidderTeam + 1} (na progu 800) wygrała licytację i dopisuje +${gameState.highestBid} pkt.`);
        } else {
            gameState.scores[bidderTeam] += bidderScored;
            addLog(`Para ${bidderTeam + 1} wygrała licytację i dopisuje +${bidderScored} pkt.`);
        }
    } else {
        gameState.scores[bidderTeam] -= gameState.highestBid;
        addLog(`Para ${bidderTeam + 1} NIE ugrała licytacji! Traci -${gameState.highestBid} pkt.`);
    }

    if (gameState.scores[oppTeam] >= 800) {
        addLog(`Para ${oppTeam + 1} znajduje się na progu 800 pkt i nie licytowała — dopisuje 0 pkt.`);
    } else {
        gameState.scores[oppTeam] += oppScored;
        addLog(`Para ${oppTeam + 1} dopisuje +${oppScored} pkt.`);
    }

    if (gameState.scores[0] >= 1000 || gameState.scores[1] >= 1000) {
        const winner = gameState.scores[0] >= 1000 ? 1 : 2;
        addLog(`🎉 GRA ZAKOŃCZONA! Wygrywa Para ${winner}!`);
        gameState.phase = 'game_over';
    } else {
        setTimeout(() => {
            gameState.round++;
            startRound();
        }, 4000);
    }

    io.emit('stateUpdate', gameState);
}

function checkBotTurn() {
    if (gameState.phase === 'bid') {
        const current = gameState.players[gameState.bidder];
        if (current && current.isBot) {
            setTimeout(() => {
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
                const opponents = gameState.players.filter(p => p.seat !== winner.seat);
                opponents.forEach(opponent => {
                    const card = winner.hand.shift();
                    opponent.hand.push(card);
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
                const leadCard = gameState.trick[0]?.card;
                const legalCards = leader.hand.filter(c => isPlayLegal(leader.hand, c, leadCard));
                const cardToPlay = legalCards.length > 0 ? legalCards[0] : leader.hand[0];
                
                executePlayCard(leader.seat, cardToPlay.id, false);
            }, 1000);
        }
    }
}

io.on('connection', (socket) => {
    socket.on('joinGame', (name) => {
        if (gameState.players.length >= 4) return;
        const seat = gameState.players.length;

        gameState.players.push({
            id: socket.id,
            name,
            seat,
            isBot: false,
            isHost: seat === 0,
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
                addChat(`SYSTEM: Gra zresetowana z powodu usunięcia gracza.`);
            }

            io.emit('stateUpdate', gameState);
        }
    });

    socket.on('bid', ({ seat, amount }) => handleBid(seat, amount));

    socket.on('giveCard', ({ seat, cardId, targetSeat }) => {
        if (gameState.phase !== 'exchange' || gameState.highestBidder !== seat) return;
        if (gameState.givenToSeats.includes(targetSeat)) return;

        const sender = gameState.players[seat];
        const receiver = gameState.players[targetSeat];
        const cardIdx = sender.hand.findIndex(c => c.id === cardId);

        if (cardIdx !== -1) {
            const [card] = sender.hand.splice(cardIdx, 1);
            receiver.hand.push(card);
            gameState.givenToSeats.push(targetSeat);
            addLog(`${sender.name} oddał 1 kartę dla ${receiver.name}.`);

            if (gameState.givenToSeats.length === 3) {
                gameState.phase = 'play';
                gameState.leader = seat;
                addLog(`Karty przekazane. Rozpoczyna ${sender.name}!`);
            }

            io.emit('stateUpdate', gameState);
            checkBotTurn();
        }
    });

    socket.on('playCard', ({ seat, cardId, isMeld }) => {
        if (gameState.phase !== 'play' || gameState.leader !== seat) return;
        const success = executePlayCard(seat, cardId, !!isMeld);
        if (!success) {
            socket.emit('invalidMove', 'Musisz dołożyć kartę do koloru lewy!');
        }
    });

    socket.on('chatMessage', (msg) => {
        const player = gameState.players.find(p => p.id === socket.id);
        if (player) {
            addChat(`${player.name}: ${msg}`);
            io.emit('stateUpdate', gameState);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serwer Tysiąca działa na porcie ${PORT}`));
