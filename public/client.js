const socket = io();

let mySeat = null;
let gameState = null;
let selectedCardId = null;

const loginScreen = document.getElementById('login-screen');
const gameScreen = document.getElementById('game-screen');
const playerNameInput = document.getElementById('player-name');
const joinBtn = document.getElementById('join-btn');

joinBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    if (name) {
        socket.emit('joinGame', name);
    }
});

socket.on('assignedSeat', (seat) => {
    mySeat = seat;
    loginScreen.style.display = 'none';
    gameScreen.style.display = 'block';
});

socket.on('fullGame', () => {
    alert('Gra jest pełna!');
});

socket.on('kicked', () => {
    alert('Zostałeś usunięty z gry przez hosta.');
    location.reload();
});

socket.on('stateUpdate', (state) => {
    gameState = state;
    renderUI();
});

function renderUI() {
    if (!gameState) return;

    renderHeader();
    renderPlayers();
    renderTable();
    renderMyHand();
    renderActions();
    renderLogAndChat();
}

function renderHeader() {
    document.getElementById('round-info').innerText = `Rozdanie: ${gameState.round}`;
    document.getElementById('score-info').innerText = `Para 1: ${gameState.scores[0]} | Para 2: ${gameState.scores[1]}`;
    
    let trumpText = gameState.trump ? `${gameState.trump}` : 'Brak';
    document.getElementById('trump-info').innerText = `Atut: ${trumpText}`;
}

function renderPlayers() {
    const playersContainer = document.getElementById('players-container');
    playersContainer.innerHTML = '';

    gameState.players.forEach((p, idx) => {
        const div = document.createElement('div');
        div.className = `player-card ${gameState.leader === idx ? 'active' : ''}`;
        
        let role = idx % 2 === 0 ? 'Para 1' : 'Para 2';
        let hostBadge = p.isHost ? ' 👑' : '';
        let botBadge = p.isBot ? ' 🤖' : '';

        div.innerHTML = `
            <strong>${p.name}${hostBadge}${botBadge}</strong><br>
            <small>${role}</small><br>
            Karty: ${p.hand ? p.hand.length : 0}
        `;

        if (gameState.players[mySeat]?.isHost && p.seat !== mySeat) {
            const kickBtn = document.createElement('button');
            kickBtn.innerText = '❌ Kick';
            kickBtn.onclick = () => socket.emit('kickPlayer', p.seat);
            div.appendChild(kickBtn);
        }

        playersContainer.appendChild(div);
    });

    if (gameState.players[mySeat]?.isHost && gameState.players.length < 4) {
        const addBotBtn = document.createElement('button');
        addBotBtn.innerText = '🤖 Dodaj Bota';
        addBotBtn.onclick = () => socket.emit('addBot');
        playersContainer.appendChild(addBotBtn);
    }
}

function renderTable() {
    const trickContainer = document.getElementById('trick-container');
    trickContainer.innerHTML = '';

    gameState.trick.forEach(item => {
        const cardDiv = document.createElement('div');
        cardDiv.className = `card ${item.card.red ? 'red' : ''}`;
        cardDiv.innerHTML = `${item.card.rank}<br>${item.card.symbol}`;
        trickContainer.appendChild(cardDiv);
    });

    if (gameState.phase === 'show_musik') {
        const musikDiv = document.createElement('div');
        musikDiv.className = 'musik-preview';
        musikDiv.innerHTML = '<strong>Musik:</strong> ' + gameState.musik.map(c => `${c.rank}${c.symbol}`).join(' ');
        trickContainer.appendChild(musikDiv);
    }
}

function getCrossMeldCandidate() {
    if (!gameState || gameState.phase !== "play" || gameState.trick.length === 0) return null;
    const previous = gameState.trick[gameState.trick.length - 1];
    if (!previous || previous.player === mySeat || previous.card.rank !== "Q" || gameState.meldedSuits.includes(previous.card.suit)) return null;

    const myHand = gameState.players[mySeat]?.hand || [];
    return myHand.find(c => c.rank === "K" && c.suit === previous.card.suit) || null;
}

function canPlayCardClient(card, isCrossMeldAttempt = false) {
    if (!gameState || gameState.phase !== "play" || gameState.leader !== mySeat) return false;

    const hand = gameState.players[mySeat].hand;

    if (gameState.trick.length === 0) return true;

    const leadSuit = gameState.trick[0].card.suit;
    const hasLeadSuit = hand.some(c => c.suit === leadSuit);

    const crossCandidate = getCrossMeldCandidate();
    if (isCrossMeldAttempt && crossCandidate && card.id === crossCandidate.id) {
        const highestInLead = gameState.trick
            .filter(t => t.card.suit === leadSuit)
            .reduce((best, curr) => curr.card.value > best.card.value ? curr : best);

        const hasHigherThanCurrent = hand.some(c => c.suit === leadSuit && c.value > highestInLead.card.value);

        if (hasHigherThanCurrent && card.value <= highestInLead.card.value) {
            return false;
        }

        return true; 
    }

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

function renderMyHand() {
    const handContainer = document.getElementById('my-hand');
    handContainer.innerHTML = '';

    const myHand = gameState.players[mySeat]?.hand || [];

    myHand.forEach(card => {
        const cardDiv = document.createElement('div');
        const playable = canPlayCardClient(card, false);
        const playableMeld = canPlayCardClient(card, true);

        const isSelected = selectedCardId === card.id;

        cardDiv.className = `card ${card.red ? 'red' : ''} ${playable || playableMeld ? 'playable' : 'disabled'} ${isSelected ? 'selected' : ''}`;
        cardDiv.innerHTML = `${card.rank}<br>${card.symbol}`;

        cardDiv.onclick = () => {
            selectedCardId = card.id;
            
            // Jeśli jest nasza kolej w fazie grania, zagraj kartę
            if (gameState.phase === 'play' && gameState.leader === mySeat) {
                const crossCandidate = getCrossMeldCandidate();
                if (crossCandidate && crossCandidate.id === card.id && canPlayCardClient(card, true)) {
                    socket.emit('playCard', { seat: mySeat, cardId: card.id, tryMeld: true });
                    selectedCardId = null;
                    return;
                }

                if (canPlayCardClient(card, false)) {
                    // Automatyczne sprawdzenie meldunku przy wyjściu z ręki K lub Q
                    const counterpart = card.rank === 'K' ? 'Q' : (card.rank === 'Q' ? 'K' : null);
                    const hasPair = counterpart && myHand.some(c => c.suit === card.suit && c.rank === counterpart);
                    const isMelded = gameState.meldedSuits.includes(card.suit);

                    const shouldMeld = gameState.trick.length === 0 && hasPair && !isMelded;

                    socket.emit('playCard', { seat: mySeat, cardId: card.id, tryMeld: shouldMeld });
                    selectedCardId = null;
                }
            } else {
                renderUI(); // Odśwież zaznaczenie w ręce
            }
        };

        handContainer.appendChild(cardDiv);
    });
}

function renderActions() {
    const actionsContainer = document.getElementById('actions-container');
    actionsContainer.innerHTML = '';

    // Dedykowana obsługa Przycisk Meldunek K/Q
    if (gameState.phase === 'play' && gameState.leader === mySeat && gameState.trick.length === 0) {
        const myHand = gameState.players[mySeat]?.hand || [];
        const selectedCard = myHand.find(c => c.id === selectedCardId);

        if (selectedCard && (selectedCard.rank === 'K' || selectedCard.rank === 'Q')) {
            const counterpart = selectedCard.rank === 'K' ? 'Q' : 'K';
            const hasPair = myHand.some(c => c.suit === selectedCard.suit && c.rank === counterpart);
            const isMelded = gameState.meldedSuits.includes(selectedCard.suit);

            if (hasPair && !isMelded) {
                const meldBtn = document.createElement('button');
                meldBtn.innerText = `👑 Zamelduj ${selectedCard.suit}`;
                meldBtn.className = 'meld-btn';
                meldBtn.onclick = () => {
                    socket.emit('declareMeld', { seat: mySeat, suit: selectedCard.suit, cardId: selectedCard.id });
                    selectedCardId = null;
                };
                actionsContainer.appendChild(meldBtn);
            }
        }
    }

    if (gameState.phase === 'bid' && gameState.bidder === mySeat) {
        const bidBtn = document.createElement('button');
        const nextBid = gameState.highestBid + 10;
        bidBtn.innerText = `Licytuj ${nextBid}`;
        bidBtn.onclick = () => socket.emit('bid', { seat: mySeat, amount: nextBid });

        const passBtn = document.createElement('button');
        passBtn.innerText = 'Pas';
        passBtn.onclick = () => socket.emit('bid', { seat: mySeat, amount: 0 });

        actionsContainer.appendChild(bidBtn);
        actionsContainer.appendChild(passBtn);

        const has9s = (gameState.players[mySeat]?.hand || []).filter(c => c.rank === "9").length === 4;
        if (has9s) {
            const ninesBtn = document.createElement('button');
            ninesBtn.innerText = '🎴 Zgłoś 4 Dziewiątki';
            ninesBtn.onclick = () => socket.emit('foldFourNines', { seat: mySeat });
            actionsContainer.appendChild(ninesBtn);
        }
    }

    if (gameState.phase === 'next' && gameState.players[mySeat]?.isHost) {
        const nextBtn = document.createElement('button');
        nextBtn.innerText = 'Następna Runda ▶';
        nextBtn.onclick = () => socket.emit('nextRound');
        actionsContainer.appendChild(nextBtn);
    }
}

function renderLogAndChat() {
    const logBox = document.getElementById('log-box');
    logBox.innerHTML = gameState.log.map(l => `<div>${l}</div>`).join('');

    const chatBox = document.getElementById('chat-box');
    chatBox.innerHTML = gameState.chat.map(c => `<div>${c}</div>`).join('');
}
