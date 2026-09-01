const socket = io();

let mySeat = null;
let gameState = null;
let selectedCardId = null;
let givenCards = [];

// Pobranie elementów HTML
const loginScreen = document.getElementById('login-screen');
const gameScreen = document.getElementById('game-screen');
const playerNameInput = document.getElementById('player-name');
const joinBtn = document.getElementById('join-btn');

// Akcje gry
const playBtn = document.getElementById('play-btn');
const meldBtn = document.getElementById('meld-btn');
const declareMeldBtn = document.getElementById('declare-meld-btn');

// Akcje licytacji
const biddingActions = document.getElementById('bidding-actions');
const bidBtn = document.getElementById('bid-btn');
const passBtn = document.getElementById('pass-btn');

const modal = document.getElementById('give-card-modal');

// Dołączenie do gry
joinBtn?.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    if (name) socket.emit('joinGame', name);
});

// ZAGRYWANIE KART / PRZEKAZYWANIE
playBtn?.addEventListener('click', () => {
    if (gameState?.phase === 'exchange') {
        openExchangeModal();
    } else if (selectedCardId !== null && mySeat !== null) {
        socket.emit('playCard', { seat: mySeat, cardId: selectedCardId, tryMeld: false });
        selectedCardId = null;
    } else {
        alert('Najpierw wybierz kartę z ręki!');
    }
});

// MELDOWANIE K/Q
meldBtn?.addEventListener('click', () => {
    if (selectedCardId !== null && mySeat !== null) {
        socket.emit('playCard', { seat: mySeat, cardId: selectedCardId, tryMeld: true });
        selectedCardId = null;
    } else {
        alert('Wybierz Króla lub Damę do zameldowania!');
    }
});

declareMeldBtn?.addEventListener('click', () => {
    if (selectedCardId !== null && mySeat !== null) {
        socket.emit('playCard', { seat: mySeat, cardId: selectedCardId, tryMeld: true });
        selectedCardId = null;
    }
});

// OBSŁUGA LICYTACJI
bidBtn?.addEventListener('click', () => {
    if (mySeat !== null) {
        socket.emit('makeBid', { seat: mySeat, action: 'raise' });
    }
});

passBtn?.addEventListener('click', () => {
    if (mySeat !== null) {
        socket.emit('makeBid', { seat: mySeat, action: 'pass' });
    }
});

// OBSŁUGA SOCKET.IO
socket.on('assignedSeat', (seat) => {
    mySeat = seat;
    if (loginScreen) loginScreen.style.display = 'none';
    if (gameScreen) gameScreen.style.display = 'block';
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
    renderLogAndChat();
    updateControls();
}

function renderHeader() {
    document.getElementById('round-info').innerText = `Rozdanie: ${gameState.round}`;
    document.getElementById('score-info').innerText = `Para 1: ${gameState.scores[0]} | Para 2: ${gameState.scores[1]}`;
    document.getElementById('trump-info').innerText = `Atut: ${gameState.trump || 'Brak'}`;
}

function renderPlayers() {
    const playersContainer = document.getElementById('players-container');
    playersContainer.innerHTML = '';

    gameState.players.forEach((p, idx) => {
        const div = document.createElement('div');
        const isActive = (gameState.phase === 'bidding' && gameState.currentBidder === idx) ||
                         (gameState.phase === 'play' && gameState.leader === idx);

        div.className = `player-card ${isActive ? 'active' : ''}`;
        
        let botLabel = p.isBot ? ' 🤖' : '';
        let hostLabel = p.isHost ? ' 👑' : '';

        div.innerHTML = `
            <strong>${p.name}${botLabel}${hostLabel}</strong><br>
            <small>Para ${(idx % 2) + 1}</small><br>
            🎴 Cards: ${p.hand ? p.hand.length : 0}
        `;

        // Przycisk dodawania bota (tylko dla Hosta, jeśli jest wolne miejsce)
        if (gameState.players[mySeat]?.isHost && !p.connected && !p.isBot) {
            const addBotBtn = document.createElement('button');
            addBotBtn.className = 'btn btn-primary';
            addBotBtn.style.cssText = 'padding:2px 6px; font-size:10px; margin-top:5px;';
            addBotBtn.innerText = '+ Dodaj Bota';
            addBotBtn.onclick = () => socket.emit('addBot', idx);
            div.appendChild(addBotBtn);
        }

        playersContainer.appendChild(div);
    });
}

function renderTable() {
    const trickContainer = document.getElementById('trick-container');
    trickContainer.innerHTML = '';

    gameState.trick.forEach(item => {
        const cardDiv = document.createElement('div');
        cardDiv.className = `card ${item.card.red ? 'red' : ''}`;
        cardDiv.innerHTML = `<div>${item.card.rank}</div><div>${item.card.symbol}</div>`;
        trickContainer.appendChild(cardDiv);
    });
}

function renderMyHand() {
    const handContainer = document.getElementById('my-hand');
    handContainer.innerHTML = '';

    const myHand = gameState.players[mySeat]?.hand || [];

    myHand.forEach(card => {
        const cardDiv = document.createElement('div');
        const isSelected = selectedCardId === card.id;

        cardDiv.className = `card ${card.red ? 'red' : ''} ${isSelected ? 'selected' : ''}`;
        cardDiv.innerHTML = `<div>${card.rank}</div><div>${card.symbol}</div>`;

        cardDiv.onclick = () => {
            selectedCardId = card.id;
            renderUI();
        };

        handContainer.appendChild(cardDiv);
    });
}

function updateControls() {
    const status = document.getElementById('turn-status');
    const mainActions = document.getElementById('main-actions');

    // Domyślne ukrycie
    biddingActions.style.display = 'none';
    mainActions.style.display = 'none';

    if (gameState.phase === 'bidding') {
        if (gameState.currentBidder === mySeat) {
            status.innerText = `Licytacja! Aktualna stawka: ${gameState.highestBid || 100}`;
            biddingActions.style.display = 'flex';
        } else {
            status.innerText = 'Trwa licytacja innych graczy...';
        }
    } else if (gameState.phase === 'exchange' && gameState.highestBidder === mySeat) {
        status.innerText = 'Wygrałeś licytację! Zaznacz kartę i wciśnij "Przekaż", aby oddać ją innemu graczowi.';
        mainActions.style.display = 'flex';
        playBtn.innerText = 'Przekaż wybraną kartę...';
    } else if (gameState.phase === 'play') {
        if (gameState.leader === mySeat) {
            status.innerText = 'Twoja kolej!';
            mainActions.style.display = 'flex';
            playBtn.innerText = 'Zagraj';
        } else {
            status.innerText = 'Oczekiwanie na ruch innego gracza...';
        }
    }
}

function openExchangeModal() {
    if (!selectedCardId) {
        alert('Najpierw zaznacz kartę, którą chcesz przekazać!');
        return;
    }

    const myHand = gameState.players[mySeat]?.hand || [];
    const card = myHand.find(c => c.id === selectedCardId);
    
    document.getElementById('selected-card-name').innerText = `${card.rank}${card.symbol}`;
    const recipientsDiv = document.getElementById('recipient-buttons');
    recipientsDiv.innerHTML = '';

    gameState.players.forEach(p => {
        if (p.seat !== mySeat) {
            const btn = document.createElement('button');
            btn.className = 'btn btn-primary';
            btn.innerText = `Oddaj dla: ${p.name}`;
            btn.onclick = () => {
                givenCards.push({ cardId: selectedCardId, targetSeat: p.seat });
                selectedCardId = null;
                modal.style.display = 'none';

                if (givenCards.length === 2) { // Przekazanie 2 kart (po jednej dla przeciwników/partnera)
                    const selectedIds = givenCards.map(g => g.cardId);
                    const recipients = givenCards.map(g => g.targetSeat);
                    socket.emit('exchangeCards', { seat: mySeat, selectedIds, recipients });
                    givenCards = [];
                } else {
                    alert(`Karta przekazana! Wybierz jeszcze ${2 - givenCards.length} kartę.`);
                    renderUI();
                }
            };
            recipientsDiv.appendChild(btn);
        }
    });

    modal.style.display = 'flex';
}

function renderLogAndChat() {
    const logBox = document.getElementById('log-box');
    if (logBox) logBox.innerHTML = gameState.log.map(l => `<div>${l}</div>`).join('');

    const chatBox = document.getElementById('chat-box');
    if (chatBox) chatBox.innerHTML = gameState.chat.map(c => `<div>${c}</div>`).join('');
}
