const socket = io();

let mySeat = null;
let gameState = null;
let selectedCardId = null;
let givenCards = []; // Przechowuje przydziały kart podczas wymiany: [{ cardId, targetSeat }]

const loginScreen = document.getElementById('login-screen');
const gameScreen = document.getElementById('game-screen');
const playerNameInput = document.getElementById('player-name');
const joinBtn = document.getElementById('join-btn');

const playBtn = document.getElementById('play-btn');
const meldBtn = document.getElementById('meld-btn');
const declareMeldBtn = document.getElementById('declare-meld-btn');
const modal = document.getElementById('give-card-modal');

joinBtn?.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    if (name) socket.emit('joinGame', name);
});

// OBSŁUGA PRZYCISKÓW
playBtn?.addEventListener('click', () => {
    if (gameState?.phase === 'exchange') {
        openExchangeModal();
    } else if (selectedCardId !== null && mySeat !== null) {
        socket.emit('playCard', { seat: mySeat, cardId: selectedCardId, tryMeld: false });
        selectedCardId = null;
    } else {
        alert('Wybierz kartę!');
    }
});

meldBtn?.addEventListener('click', () => {
    if (selectedCardId !== null && mySeat !== null) {
        socket.emit('playCard', { seat: mySeat, cardId: selectedCardId, tryMeld: true });
        selectedCardId = null;
    } else {
        alert('Wybierz Króla lub Damę do meldunku!');
    }
});

declareMeldBtn?.addEventListener('click', () => {
    if (selectedCardId !== null && mySeat !== null) {
        socket.emit('playCard', { seat: mySeat, cardId: selectedCardId, tryMeld: true });
        selectedCardId = null;
    }
});

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
        div.className = `player-card ${gameState.leader === idx || gameState.bidder === idx ? 'active' : ''}`;
        div.innerHTML = `
            <strong>${p.name}</strong><br>
            <small>Para ${(idx % 2) + 1}</small><br>
            🎴 ${p.hand ? p.hand.length : 0}
        `;
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
    const biddingActions = document.getElementById('bidding-actions');
    const mainActions = document.getElementById('main-actions');

    if (gameState.phase === 'exchange' && gameState.highestBidder === mySeat) {
        status.innerText = 'Wygrałeś licytację! Wybierz kartę z ręki, a następnie wskaż gracza, któremu chcesz ją oddać.';
        mainActions.style.display = 'flex';
        playBtn.innerText = 'Przekaż wybraną kartę...';
    } else if (gameState.phase === 'play' && gameState.leader === mySeat) {
        status.innerText = 'Twoja kolej!';
        mainActions.style.display = 'flex';
        playBtn.innerText = 'Zagraj';
    } else {
        status.innerText = 'Oczekiwanie na ruch...';
    }
}

// WYBÓR GRACZA DLA PRZEKAZYWANEJ KARTY (WYMIANA)
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

                if (givenCards.length === 3) {
                    // Po wybraniu 3 kart wysyłamy do serwera
                    const selectedIds = givenCards.map(g => g.cardId);
                    const recipients = givenCards.map(g => g.targetSeat);
                    socket.emit('exchangeCards', { seat: mySeat, selectedIds, recipients });
                    givenCards = [];
                } else {
                    alert(`Przekazano kartę. Wybierz jeszcze ${3 - givenCards.length} kart(y).`);
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
