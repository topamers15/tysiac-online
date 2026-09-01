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

function renderMyHand() {
    const handContainer = document.getElementById('my-hand');
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

function renderActions() {
    const actionsContainer = document.getElementById('actions-container');
    actionsContainer.innerHTML = '';

    const myHand = gameState.players[mySeat]?.hand || [];
    const selectedCard = myHand.find(c => c.id === selectedCardId);

    // Zgłoszenie 4 dziewiątek
    const has4Nines = myHand.filter(c => c.rank === "9").length === 4;
    if (has4Nines && (gameState.phase === 'bid' || (gameState.phase === 'play' && gameState.tricks.length === 0 && gameState.trick.length === 0))) {
        const ninesBtn = document.createElement('button');
        ninesBtn.innerText = '🎴 Zgłoś 4 Dziewiątki (Koniec)';
        ninesBtn.style.backgroundColor = '#d9534f';
        ninesBtn.onclick = () => socket.emit('foldFourNines', { seat: mySeat });
        actionsContainer.appendChild(ninesBtn);
    }

    // Ruch w fazie rozgrywki
    if (gameState.phase === 'play' && gameState.leader === mySeat) {

        // Przycisk Zamelduj K/Q — generowany dynamicznie tylko wtedy, gdy posiadasz parę K+Q w tym samym kolorze
        if (selectedCard && (selectedCard.rank === 'K' || selectedCard.rank === 'Q')) {
            const counterpart = selectedCard.rank === 'K' ? 'Q' : 'K';
            const hasPair = myHand.some(c => c.suit === selectedCard.suit && c.rank === counterpart);
            const isMelded = gameState.meldedSuits.includes(selectedCard.suit);

            // Meldować można tylko przy wyjściu (gdy na stole nie ma jeszcze kart w tej lewie)
            if (hasPair && !isMelded && gameState.trick.length === 0) {
                const meldBtn = document.createElement('button');
                meldBtn.innerText = `👑 Zamelduj ${selectedCard.suit} i zagraj ${selectedCard.rank}${selectedCard.symbol}`;
                meldBtn.style.backgroundColor = '#28a745';
                meldBtn.style.color = '#ffffff';
                meldBtn.onclick = () => {
                    socket.emit('playCard', { seat: mySeat, cardId: selectedCard.id, tryMeld: true });
                    selectedCardId = null;
                };
                actionsContainer.appendChild(meldBtn);
            }
        }

        // Standardowe zagranie wybranej karty
        if (selectedCard) {
            const playBtn = document.createElement('button');
            playBtn.innerText = `Zagraj ${selectedCard.rank}${selectedCard.symbol}`;
            playBtn.onclick = () => {
                socket.emit('playCard', { seat: mySeat, cardId: selectedCard.id, tryMeld: false });
                selectedCardId = null;
            };
            actionsContainer.appendChild(playBtn);
        }
    }

    // Licytacja
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
    }

    // Przejście do nowej rundy
    if (gameState.phase === 'next' && gameState.players[mySeat]?.isHost) {
        const nextBtn = document.createElement('button');
        nextBtn.innerText = 'Następna Runda ▶';
        nextBtn.onclick = () => socket.emit('nextRound');
        actionsContainer.appendChild(nextBtn);
    }
}

function renderLogAndChat() {
    const logBox = document.getElementById('log-box');
    if (logBox) logBox.innerHTML = gameState.log.map(l => `<div>${l}</div>`).join('');

    const chatBox = document.getElementById('chat-box');
    if (chatBox) chatBox.innerHTML = gameState.chat.map(c => `<div>${c}</div>`).join('');
}
