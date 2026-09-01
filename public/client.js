const socket = io();

let mySeat = null;
let gameState = null;
let selectedCardId = null;

// Pobranie elementów interfejsu
const loginScreen = document.getElementById('login-screen');
const gameScreen = document.getElementById('game-screen');
const playerNameInput = document.getElementById('player-name');
const joinBtn = document.getElementById('join-btn');

// Przyciski akcji z Twojego interfejsu
const playBtn = document.getElementById('play-btn');           // Przycisk "Zagraj"
const meldBtn = document.getElementById('meld-btn');           // Przycisk "Meldunek K/Q"
const declareMeldBtn = document.getElementById('declare-meld-btn'); // Przycisk "Zgłoś Meldunek"

joinBtn?.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    if (name) {
        socket.emit('joinGame', name);
    }
});

// PODPIĘCIE PRZYCISKÓW AKCJI

// 1. Zwykłe zagranie karty
playBtn?.addEventListener('click', () => {
    if (selectedCardId !== null && mySeat !== null) {
        socket.emit('playCard', { seat: mySeat, cardId: selectedCardId, tryMeld: false });
        selectedCardId = null;
    } else {
        alert('Wybierz najpierw kartę do zagrania!');
    }
});

// 2. Zagranie z MELDUNKIEM (K/Q)
meldBtn?.addEventListener('click', () => {
    if (selectedCardId !== null && mySeat !== null) {
        socket.emit('playCard', { seat: mySeat, cardId: selectedCardId, tryMeld: true });
        selectedCardId = null;
    } else {
        alert('Wybierz najpierw Króla lub Damę do zameldowania!');
    }
});

// 3. Opcjonalny przycisk dodatkowego zgłoszenia
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

socket.on('fullGame', () => alert('Gra jest pełna!'));

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
    renderLogAndChat();
}

function renderHeader() {
    const roundInfo = document.getElementById('round-info');
    const scoreInfo = document.getElementById('score-info');
    const trumpInfo = document.getElementById('trump-info');

    if (roundInfo) roundInfo.innerText = `Rozdanie: ${gameState.round}`;
    if (scoreInfo) scoreInfo.innerText = `Para 1: ${gameState.scores[0]} | Para 2: ${gameState.scores[1]}`;
    
    let trumpText = gameState.trump ? `${gameState.trump}` : 'Brak';
    if (trumpInfo) trumpInfo.innerText = `Atut: ${trumpText}`;
}

function renderPlayers() {
    const playersContainer = document.getElementById('players-container');
    if (!playersContainer) return;
    
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
}

function renderTable() {
    const trickContainer = document.getElementById('trick-container');
    if (!trickContainer) return;
    
    trickContainer.innerHTML = '';

    gameState.trick.forEach(item => {
        const cardDiv = document.createElement('div');
        cardDiv.className = `card ${item.card.red ? 'red' : ''}`;
        cardDiv.innerHTML = `${item.card.rank}<br>${item.card.symbol}`;
        trickContainer.appendChild(cardDiv);
    });
}

function renderMyHand() {
    const handContainer = document.getElementById('my-hand');
    if (!handContainer) return;
    
    handContainer.innerHTML = '';

    const myHand = gameState.players[mySeat]?.hand || [];

    myHand.forEach(card => {
        const cardDiv = document.createElement('div');
        const isSelected = selectedCardId === card.id;

        cardDiv.className = `card ${card.red ? 'red' : ''} ${isSelected ? 'selected' : ''}`;
        cardDiv.innerHTML = `${card.rank}<br>${card.symbol}`;

        cardDiv.onclick = () => {
            selectedCardId = card.id;
            renderUI();
        };

        handContainer.appendChild(cardDiv);
    });
}

function renderLogAndChat() {
    const logBox = document.getElementById('log-box');
    if (logBox) logBox.innerHTML = gameState.log.map(l => `<div>${l}</div>`).join('');

    const chatBox = document.getElementById('chat-box');
    if (chatBox) chatBox.innerHTML = gameState.chat.map(c => `<div>${c}</div>`).join('');
}
