const socket = io();

let mySeat = null;
let gameState = null;
let selectedCardId = null;
let givenCards = [];

const loginScreen = document.getElementById('login-screen');
const gameScreen = document.getElementById('game-screen');
const playerNameInput = document.getElementById('player-name');
const joinBtn = document.getElementById('join-btn');

const playBtn = document.getElementById('play-btn');
const meldBtn = document.getElementById('meld-btn');

const biddingActions = document.getElementById('bidding-actions');
const mainActions = document.getElementById('main-actions');
const bidBtn = document.getElementById('bid-btn');
const passBtn = document.getElementById('pass-btn');

const modal = document.getElementById('give-card-modal');

joinBtn?.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    if (name) socket.emit('joinGame', name);
});

playBtn?.addEventListener('click', () => {
    if (gameState?.phase === 'exchange') {
        openExchangeModal();
    } else if (selectedCardId !== null && mySeat !== null) {
        socket.emit('playCard', { seat: mySeat, cardId: selectedCardId });
        selectedCardId = null;
    } else {
        alert('Wybierz kartę!');
    }
});

meldBtn?.addEventListener('click', () => {
    if (selectedCardId !== null && mySeat !== null) {
        socket.emit('playCard', { seat: mySeat, cardId: selectedCardId });
        selectedCardId = null;
    }
});

bidBtn?.addEventListener('click', () => {
    if (mySeat !== null && gameState) {
        const nextBid = (gameState.highestBid || 100) + 10;
        socket.emit('bid', { seat: mySeat, amount: nextBid });
    }
});

passBtn?.addEventListener('click', () => {
    if (mySeat !== null) socket.emit('bid', { seat: mySeat, amount: 0 });
});

document.getElementById('chat-send-btn')?.addEventListener('click', sendChat);
document.getElementById('chat-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChat();
});

function sendChat() {
    const input = document.getElementById('chat-input');
    if (input.value.trim()) {
        socket.emit('chatMessage', input.value.trim());
        input.value = '';
    }
}

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
    const isHost = gameState.players[mySeat]?.isHost;

    gameState.players.forEach((p, idx) => {
        const div = document.createElement('div');
        const isActive = (gameState.phase === 'bid' && gameState.bidder === idx) ||
                         (gameState.phase === 'play' && gameState.leader === idx);

        div.className = `player-card ${isActive ? 'active' : ''}`;
        div.innerHTML = `
            <strong>${p.name}${p.isBot ? ' 🤖' : ''}${p.isHost ? ' 👑' : ''}</strong><br>
            <small>Para ${(idx % 2) + 1}</small><br>
            🎴 Karty: ${p.hand ? p.hand.length : 0}
        `;

        if (isHost && p.isBot) {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'btn btn-danger';
            removeBtn.style.cssText = 'padding: 2px 6px; font-size: 10px; margin-top: 5px; width: 100%;';
            removeBtn.innerText = '❌ Usuń Bota';
            removeBtn.onclick = () => socket.emit('removeBot', p.seat);
            div.appendChild(removeBtn);
        }

        playersContainer.appendChild(div);
    });

    if (isHost && gameState.players.length < 4 && gameState.phase === 'waiting') {
        const addBotBtn = document.createElement('button');
        addBotBtn.className = 'btn btn-primary';
        addBotBtn.style.cssText = 'padding: 6px 12px; font-size: 12px; margin-left: 10px; align-self: center;';
        addBotBtn.innerText = '🤖 + Dodaj Bota';
        addBotBtn.onclick = () => socket.emit('addBot');
        playersContainer.appendChild(addBotBtn);
    }
}

function renderTable() {
    const trickContainer = document.getElementById('trick-container');
    const tableLabel = document.getElementById('table-label');
    trickContainer.innerHTML = '';

    if (gameState.phase === 'bid') {
        tableLabel.innerText = 'MUSIK (ZAKRYTY)';
        gameState.musik.forEach(() => {
            const cardDiv = document.createElement('div');
            cardDiv.className = 'card card-back';
            cardDiv.innerHTML = '🎴';
            trickContainer.appendChild(cardDiv);
        });
        return;
    }

    tableLabel.innerText = 'STÓŁ';
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
    if (!biddingActions || !mainActions || !status) return;

    biddingActions.style.display = 'none';
    mainActions.style.display = 'none';

    if (gameState.phase === 'bid') {
        if (gameState.bidder === mySeat) {
            const nextBid = (gameState.highestBid || 100) + 10;
            status.innerText = `Twoja kolej! Licytujesz.`;
            biddingActions.style.display = 'flex';
            if (bidBtn) bidBtn.innerText = `Licytuj ${nextBid}`;
        } else {
            status.innerText = `Licytuje: ${gameState.players[gameState.bidder]?.name} (${gameState.highestBid} pkt)`;
        }
    } else if (gameState.phase === 'exchange' && gameState.highestBidder === mySeat) {
        status.innerText = 'Zaznacz kartę i kliknij przycisk poniżej, aby przekazać 2 karty przeciwnikom.';
        mainActions.style.display = 'flex';
        if (playBtn) playBtn.innerText = 'Przekaż kartę...';
    } else if (gameState.phase === 'play') {
        if (gameState.leader === mySeat) {
            status.innerText = 'Twoja kolej na ruch!';
            mainActions.style.display = 'flex';
            if (playBtn) playBtn.innerText = 'Zagraj';
        } else {
            status.innerText = 'Czekaj na ruch innego gracza...';
        }
    }
}

function openExchangeModal() {
    if (!selectedCardId) return alert('Najpierw zaznacz kartę z ręki!');

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

                if (givenCards.length === 2) {
                    const selectedIds = givenCards.map(g => g.cardId);
                    const recipients = givenCards.map(g => g.targetSeat);
                    socket.emit('exchangeCards', { seat: mySeat, selectedIds, recipients });
                    givenCards = [];
                } else {
                    alert(`Karta przekazana! Wybierz jeszcze 1 kartę.`);
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
