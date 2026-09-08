const socket = io();

let mySeat = null;
let gameState = null;
let selectedCardId = null;

// Kolejność i symbole według tradycyjnych polskich nazw
const SUIT_ORDER = { 'dzwonek': 1, 'czerwo': 2, 'wino': 3, 'żołądź': 4 };
const RANK_POWER = { 'A': 6, '10': 5, 'K': 4, 'Q': 3, 'J': 2, '9': 1 };
const SUIT_SYMBOLS = { dzwonek: '♦', czerwo: '♥', wino: '♠', żołądź: '♣' };

const loginScreen = document.getElementById('login-screen');
const gameScreen = document.getElementById('game-screen');
const playerNameInput = document.getElementById('player-name');
const joinBtn = document.getElementById('join-btn');

const playBtn = document.getElementById('play-btn');
const meldBtn = document.getElementById('meld-btn');
const takeMusikBtn = document.getElementById('take-musik-btn');
const foldNinesBtn = document.getElementById('fold-nines-btn');

const biddingActions = document.getElementById('bidding-actions');
const mainActions = document.getElementById('main-actions');
const bidBtn = document.getElementById('bid-btn');
const passBtn = document.getElementById('pass-btn');
const bidSlider = document.getElementById('bid-slider');
const bidValueDisplay = document.getElementById('bid-value-display');

const modal = document.getElementById('give-card-modal');
const adminConsole = document.getElementById('admin-console');

window.addEventListener('DOMContentLoaded', () => {
    const savedName = localStorage.getItem('tysiac_username');
    if (savedName && playerNameInput) {
        playerNameInput.value = savedName;
        socket.emit('joinGame', savedName);
    }
});

joinBtn?.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    if (name) {
        localStorage.setItem('tysiac_username', name);
        socket.emit('joinGame', name);
    }
});

takeMusikBtn?.addEventListener('click', () => socket.emit('takeMusik'));
foldNinesBtn?.addEventListener('click', () => socket.emit('foldFourNines'));

playBtn?.addEventListener('click', () => {
    if (gameState?.phase === 'exchange') {
        openExchangeModal();
    } else if (selectedCardId !== null && mySeat !== null) {
        socket.emit('playCard', { seat: mySeat, cardId: selectedCardId, isMeld: false });
        selectedCardId = null;
    } else {
        alert('Wybierz kartę z ręki!');
    }
});

meldBtn?.addEventListener('click', () => {
    if (selectedCardId !== null && mySeat !== null) {
        socket.emit('playCard', { seat: mySeat, cardId: selectedCardId, isMeld: true });
        selectedCardId = null;
    } else {
        alert('Wybierz kartę K lub Q do meldunku!');
    }
});

bidSlider?.addEventListener('input', (e) => {
    if (bidValueDisplay) bidValueDisplay.innerText = e.target.value;
});

bidBtn?.addEventListener('click', () => {
    if (mySeat !== null && gameState && bidSlider) {
        const amount = parseInt(bidSlider.value, 10);
        socket.emit('bid', { seat: mySeat, amount });
    }
});

passBtn?.addEventListener('click', () => {
    if (mySeat !== null) socket.emit('bid', { seat: mySeat, amount: 0 });
});

socket.on('invalidMove', (msg) => alert(msg));

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

document.getElementById('admin-exec-btn')?.addEventListener('click', sendAdminCmd);
document.getElementById('admin-cmd-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendAdminCmd();
});

function sendAdminCmd() {
    const input = document.getElementById('admin-cmd-input');
    if (input.value.trim()) {
        socket.emit('adminCommand', input.value.trim());
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
    renderAdminConsole();
    updateControls();
}

function renderHeader() {
    document.getElementById('round-info').innerText = `Rozdanie: ${gameState.round}`;
    document.getElementById('score-info').innerText = `Ogólny: P1: ${gameState.scores[0]} | P2: ${gameState.scores[1]}`;
    
    const trumpSymbol = gameState.trump ? SUIT_SYMBOLS[gameState.trump] || '' : '';
    const trumpText = gameState.trump ? `${gameState.trump.toUpperCase()} ${trumpSymbol}` : 'Brak';
    document.getElementById('trump-info').innerText = `Atut: ${trumpText}`;
    
    const p1RoundScore = (gameState.roundTricks?.[0] || 0) + (gameState.roundMelds?.[0] || 0);
    const p2RoundScore = (gameState.roundTricks?.[1] || 0) + (gameState.roundMelds?.[1] || 0);
    const bidInfo = gameState.highestBid ? ` | Wylicytowano: ${gameState.highestBid}` : '';
    const pauseInfo = gameState.isPaused ? ' ⏸️ (PAUZA)' : '';
    
    document.getElementById('round-live-score').innerText = `W tym rozdaniu — P1: ${p1RoundScore} | P2: ${p2RoundScore}${bidInfo}${pauseInfo}`;
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
            <strong>${p.name}${p.isBot ? ' 🤖' : ''}${p.isHost ? ' 👑' : ''}${!p.connected ? ' 🔴 (rozłączony)' : ''}</strong><br>
            <small>Para ${(idx % 2) + 1}</small><br>
            🎴 Karty: ${p.hand ? p.hand.length : 0}
        `;

        if (isHost && p.isBot) {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'btn btn-danger';
            removeBtn.style.cssText = 'padding: 2px 6px; font-size: 11px; margin-top: 6px; width: 100%;';
            removeBtn.innerText = '❌ Usuń Bota';
            removeBtn.onclick = () => socket.emit('removeBot', p.seat);
            div.appendChild(removeBtn);
        }

        playersContainer.appendChild(div);
    });

    if (isHost && gameState.players.length < 4 && gameState.phase === 'waiting') {
        const addBotBtn = document.createElement('button');
        addBotBtn.className = 'btn btn-primary';
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

    if (gameState.phase === 'show_musik') {
        tableLabel.innerText = 'MUSIK (ODSŁONIĘTY - 10 SEKUND)';
        gameState.musik.forEach(card => {
            const cardDiv = document.createElement('div');
            cardDiv.className = `card ${card.red ? 'red' : ''}`;
            cardDiv.innerHTML = `<div>${card.rank}</div><div>${card.symbol}</div>`;
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
    const myHand = [...(gameState.players[mySeat]?.hand || [])];

    myHand.sort((a, b) => {
        if (SUIT_ORDER[a.suit] !== SUIT_ORDER[b.suit]) {
            return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
        }
        return RANK_POWER[b.rank] - RANK_POWER[a.rank];
    });

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
    if (takeMusikBtn) takeMusikBtn.style.display = 'none';
    if (foldNinesBtn) foldNinesBtn.style.display = 'none';
    if (playBtn) playBtn.style.display = 'inline-block';
    if (meldBtn) meldBtn.style.display = 'inline-block';

    if (gameState.isPaused) {
        status.innerText = 'PAUZA — Gra wstrzymana przez Admina.';
        return;
    }

    if (gameState.phase === 'bid') {
        if (gameState.bidder === mySeat) {
            const minBid = (gameState.highestBid || 100) + 10;

            if (bidSlider) {
                bidSlider.min = minBid > 300 ? 300 : minBid;
                bidSlider.max = 300;
                if (parseInt(bidSlider.value, 10) < minBid) {
                    bidSlider.value = minBid > 300 ? 300 : minBid;
                }
                if (bidValueDisplay) bidValueDisplay.innerText = bidSlider.value;
            }

            status.innerText = `Twoja kolej! Wybierz kwotę suwakiem i zlicytuj.`;
            biddingActions.style.display = 'flex';
        } else {
            status.innerText = `Licytuje: ${gameState.players[gameState.bidder]?.name} (${gameState.highestBid} pkt)`;
        }
    } else if (gameState.phase === 'show_musik') {
        if (gameState.highestBidder === mySeat) {
            status.innerText = 'Wygrałeś licytację! Pobierz musik lub poczekaj 10s.';
            mainActions.style.display = 'flex';
            if (takeMusikBtn) takeMusikBtn.style.display = 'inline-block';
            if (playBtn) playBtn.style.display = 'none';
            if (meldBtn) meldBtn.style.display = 'none';
        } else {
            status.innerText = 'Odsłanianie musiku dla wszystkich graczy (10s)...';
        }
    } else if (gameState.phase === 'exchange') {
        if (gameState.highestBidder === mySeat) {
            const remainingCount = 3 - gameState.givenToSeats.length;
            status.innerText = `Zaznacz kartę i wybierz gracza (pozostało do oddania: ${remainingCount}).`;
            mainActions.style.display = 'flex';
            if (playBtn) playBtn.innerText = 'Oddaj kartę...';
            if (meldBtn) meldBtn.style.display = 'none';
        } else {
            status.innerText = 'Zwycięzca licytacji oddaje karty pozostałym graczon...';
        }
    } else if (gameState.phase === 'play') {
        const me = gameState.players[mySeat];
        const myHand = me?.hand || [];
        const ninesCount = myHand.filter(c => c.rank === '9').length;
        const isFirstTrick = (gameState.roundTricks?.[0] === 0 && gameState.roundTricks?.[1] === 0);

        if (isFirstTrick && ninesCount === 4 && !me?.usedFourNinesFold) {
            mainActions.style.display = 'flex';
            if (foldNinesBtn) foldNinesBtn.style.display = 'inline-block';
        }

        if (gameState.leader === mySeat) {
            status.innerText = 'Twoja kolej na ruch!';
            mainActions.style.display = 'flex';
            if (playBtn) playBtn.innerText = 'Zagraj';
        } else {
            if (!isFirstTrick || ninesCount !== 4 || me?.usedFourNinesFold) {
                if (playBtn) playBtn.style.display = 'none';
                if (meldBtn) meldBtn.style.display = 'none';
            }
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
        if (p.seat !== mySeat && !gameState.givenToSeats.includes(p.seat)) {
            const btn = document.createElement('button');
            btn.className = 'btn btn-primary';
            btn.innerText = `Oddaj dla: ${p.name}`;
            btn.onclick = () => {
                socket.emit('giveCard', { seat: mySeat, cardId: selectedCardId, targetSeat: p.seat });
                selectedCardId = null;
                modal.style.display = 'none';
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

function renderAdminConsole() {
    if (!adminConsole) return;
    const isHost = gameState.players[mySeat]?.isHost;
    adminConsole.style.display = isHost ? 'block' : 'none';
}
