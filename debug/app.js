// --- ABLY CONFIGURATION ---
// --- SECURITY GUARD ---
const _auth = {
    p1: "bQw6qw.VKgWOA",
    p2: "cyDRDoW203VwoE17Iv1DCcucwZCklOPptuZhtu1",
    p3: "bd_0",
    get k() { return this.p1 + ":" + this.p2 + this.p3; },
    get isAuthorized() {
        const host = window.location.hostname;
        return host === 'burningkzoom.github.io' || host === 'localhost' || host === '127.0.0.1';
    }
};
let ably = null;
let channel = null;

let roomState = {
    roomId: null,
    myUserId: localStorage.getItem('sushi_userId') || 'user_' + Math.random().toString(36).substr(2, 9),
    myName: localStorage.getItem('sushi_userName') || '',
    peers: {},
    hostId: null,
    isBillFinalized: false
};
localStorage.setItem('sushi_userId', roomState.myUserId);
let currentTowerView = 'personal';

const restaurants = {
    katsu: [
        { id: 'red', price: 40, label: 'Red' },
        { id: 'blue', price: 50, label: 'Blue' },
        { id: 'green', price: 60, label: 'Green' },
        { id: 'yellow', price: 70, label: 'Yellow' },
        { id: 'brown', price: 80, label: 'Brown' },
        { id: 'pink', price: 90, label: 'Pink' },
        { id: 'grey', price: 100, label: 'Grey' },
        { id: 'white-gold', price: 120, label: 'White-Gold' },
        { id: 'red-gold', price: 140, label: 'Red-Gold' },
        { id: 'solid-gold', price: 150, label: 'Solid Gold' },
        { id: 'blue-check', price: 160, label: 'Blue Check' },
        { id: 'black-gold', price: 180, label: 'Black-Gold' }
    ],
    sushiro: [
        { id: 's-white', price: 30, label: 'White' },
        { id: 's-red', price: 40, label: 'Red' },
        { id: 's-silver', price: 60, label: 'Silver' },
        { id: 's-gold', price: 80, label: 'Gold' },
        { id: 's-black', price: 120, label: 'Black' }
    ]
};

let state = {
    timestamp: Date.now(),
    lastActive: 'katsu',
    targetPrice: '',
    towerMode: 'combined',
    data: {
        katsu: { counts: {}, plateSubtotal: 0, customItems: [] },
        sushiro: { counts: {}, plateSubtotal: 0, customItems: [] }
    }
};

// --- LOBBY & SYNC FUNCTIONS ---

    // --- HAPTIC FEEDBACK ---
function triggerHaptic() {
    if ("vibrate" in navigator) {
        navigator.vibrate(50); // Short 50ms vibration
    }
}

function showQRCode() {
    if (!roomState.roomId) return;
    document.getElementById('modalRoomId').innerText = roomState.roomId;
    document.getElementById('qrModal').style.display = 'flex';
    document.getElementById('qrcode-modal').innerHTML = '';
    new QRCode(document.getElementById("qrcode-modal"), {
        text: window.location.href.split("?")[0] + "?table=" + roomState.roomId,
        width: 180,
        height: 180
    });
}

function closeQRCode() {
    document.getElementById('qrModal').style.display = 'none';
}

function showSpecialGuide() {
    document.getElementById('specialGuideModal').style.display = 'flex';
}

function closeSpecialGuide() {
    document.getElementById('specialGuideModal').style.display = 'none';
}

function copyTableLink() {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
        const btn = document.getElementById('copyLinkBtn');
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<span>✅</span> Copied!';
        btn.style.background = 'var(--green)';
        setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.style.background = 'var(--blue)';
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy: ', err);
        alert('Could not copy link. Please copy the URL manually.');
    });
}

function showNameInput() {
    document.getElementById("lobbyError").style.display = "none";
    document.getElementById("inlineNameError").style.display = "none";
    document.getElementById('startMultiplayerSection').style.display = 'none';
    document.getElementById('nameInputSection').style.display = 'block';
}

function resetLobby() {
    roomState.myName = '';
    localStorage.removeItem('sushi_userName');
    updateLobbyUI();
    updateTowerToggleUI();
}

function saveName() {
    const name = document.getElementById('userNameInput').value.trim();
    if (name) {
        roomState.myName = name;
        localStorage.setItem('sushi_userName', name);
        
        const urlParams = new URLSearchParams(window.location.search);
        const tableParam = urlParams.get('table') || roomState.roomId;
        if (tableParam) {
            joinRoom(tableParam);
        } else {
            updateLobbyUI();
            updateTowerToggleUI();
        }
    }
}

function hostRoom() {
    const newRoomId = Math.random().toString(36).substr(2, 6).toUpperCase();
    roomState.hostId = roomState.myUserId; // Set local host ID
    joinRoom(newRoomId);
    setTimeout(showQRCode, 300);
}

function joinRoom(roomId) {
    document.getElementById("lobbyError").style.display = "none";
    roomState.roomId = roomId;
    localStorage.setItem('sushi_roomId', roomId);
    
    const url = new URL(window.location);
    url.searchParams.set('table', roomId);
    window.history.pushState({}, '', url);

    updateLobbyUI();
    updateTowerToggleUI();
    initAbly();
}

function joinRoomFromInput() {
    document.getElementById("lobbyError").style.display = "none";
    const code = document.getElementById('joinRoomInput').value.trim().toUpperCase();
    if (code) {
        joinRoom(code);
    }
}

function leaveRoom() {
    if (roomState.roomId && !roomState.isBillFinalized) {
        if (!confirm("Are you sure? Your plates will be removed from the table total if you leave before the bill is finalized.")) {
            return;
        }
    }

    if (channel) {
        channel.presence.leave();
        channel.detach();
    }
    roomState.roomId = null;
    roomState.peers = {};
    roomState.myName = '';
    roomState.hostId = null;
    roomState.isBillFinalized = false;
    localStorage.removeItem('sushi_roomId');
    localStorage.removeItem('sushi_userName');
    
    const url = new URL(window.location);
    url.searchParams.delete('table');
    window.history.pushState({}, '', url);
    
    updateLobbyUI();
    updateTowerToggleUI();
    updateUI();
    renderTower();
}

function finalizeBill() {
    if (!channel || roomState.hostId !== roomState.myUserId) return;
    const newState = !roomState.isBillFinalized;
    const actionText = newState ? "Finalize bill? This will lock counts for everyone." : "Allow everyone to edit counts again?";
    
    if (confirm(actionText)) {
        channel.publish('finalizeBill', { hostId: roomState.myUserId, isFinalized: newState });
    }
}

function updateLobbyUI() {
    const startSection = document.getElementById('startMultiplayerSection');
    const nameSection = document.getElementById('nameInputSection');
    const controlsSection = document.getElementById('roomControls');
    const activeSection = document.getElementById('activeRoomSection');

    startSection.style.display = 'none';
    nameSection.style.display = 'none';
    controlsSection.style.display = 'none';
    activeSection.style.display = 'none';

    if (roomState.roomId && roomState.myName) {
        activeSection.style.display = 'block';
        document.getElementById('roomIdDisplay').innerText = roomState.roomId;
        document.getElementById('tableBillSection').style.display = 'block';
        
        // Show Finalize button ONLY for host
        const finalizeBtn = document.getElementById('finalizeBillBtn');
        if (roomState.hostId === roomState.myUserId) {
            finalizeBtn.style.display = 'block';
            finalizeBtn.innerText = roomState.isBillFinalized ? '✏️ Edit Bill' : '📝 Finalize Bill';
            finalizeBtn.style.background = roomState.isBillFinalized ? '#3498db' : 'var(--orange)';
        } else {
            finalizeBtn.style.display = 'none';
        }
    } else if (roomState.roomId && !roomState.myName) {
        nameSection.style.display = 'block';
        document.getElementById('tableBillSection').style.display = 'none';
    } else if (roomState.myName) {
        controlsSection.style.display = 'block';
        document.getElementById('displayName').innerText = roomState.myName;
        document.getElementById('tableBillSection').style.display = 'none';
    } else {
        startSection.style.display = 'block';
        document.getElementById('tableBillSection').style.display = 'none';
    }
}

                function initAbly() {
    const errEl = document.getElementById('lobbyError');
    const inlineNameErrEl = document.getElementById('inlineNameError');
    const contBtn = document.getElementById('lobbyContinueBtn');
    
    // Domain Lock Check
    if (!_auth.isAuthorized) {
        console.error("Unauthorized Domain: Sync Disabled.");
        if (errEl) {
            errEl.innerText = "Sync is only available on the official website.";
            errEl.style.display = 'block';
        }
        return;
    } 
    const joinInputBtn = document.querySelector('#roomControls button[onclick="joinRoomFromInput()"]');
    
    if (errEl) errEl.style.display = 'none';
    if (inlineNameErrEl) inlineNameErrEl.style.display = 'none';
    if (contBtn) contBtn.innerText = 'Connecting...';
    if (joinInputBtn) joinInputBtn.innerText = '...';

    if (!ably) {
        ably = new Ably.Realtime({ 
            key: _auth.k, 
            clientId: roomState.myUserId,
            transports: ['web_socket', 'xhr_streaming', 'xhr_polling']
        });
    }
    
    const tempChannel = ably.channels.get('test:' + roomState.roomId);

    const connectionTimeout = setTimeout(() => {
        if (contBtn && (contBtn.innerText === 'Connecting...' || contBtn.innerText === '...')) {
            if (contBtn) contBtn.innerText = 'Continue';
            if (joinInputBtn) joinInputBtn.innerText = 'Join';
            errEl.innerText = "Connection slow. Try refreshing or check Brave Shields.";
            errEl.style.display = 'block';
        }
    }, 8000);

    tempChannel.presence.get((err, members) => {
        clearTimeout(connectionTimeout);
        if (contBtn) contBtn.innerText = 'Continue';
        if (joinInputBtn) joinInputBtn.innerText = 'Join';

        if (err) {
            errEl.innerText = "Error connecting to table. Please try again.";
            errEl.style.display = 'block';
            return;
        }

        const nameTaken = members && members.some(m => 
            m.data && m.data.name === roomState.myName && m.clientId !== roomState.myUserId
        );

        if (nameTaken) {
            // CRITICAL: Clear name but keep room so user is forced back to Name Input for the SAME room
            const takenName = roomState.myName;
            roomState.myName = '';
            localStorage.removeItem('sushi_userName');
            
            updateLobbyUI();
            showNameInput();

            // Set error AFTER UI reset (since showNameInput hides it)
            if (inlineNameErrEl) {
                inlineNameErrEl.innerText = `Name "${takenName}" is already taken at this table!`;
                inlineNameErrEl.style.display = 'block';
            }
            return;
        }

        // Host Determination: Smallest clientId or first in presence is usually host, 
        // but we'll use a specific message to announce host if needed. 
        // For simplicity, first person in presence becomes host if no hostId set.
        if (!roomState.hostId && members && members.length > 0) {
            // Sort by timestamp to find the oldest member
            const sorted = members.sort((a, b) => a.timestamp - b.timestamp);
            roomState.hostId = sorted[0].clientId;
        } else if (!roomState.hostId) {
            roomState.hostId = roomState.myUserId;
        }

        channel = tempChannel;
        channel.subscribe('syncState', (message) => {
            if (message.clientId !== roomState.myUserId) {
                roomState.peers[message.clientId] = { ...message.data, isOffline: false };
                updateUsersList(); updateUI(); renderTower();
            }
        });

        channel.subscribe('finalizeBill', (message) => {
            roomState.isBillFinalized = message.data.isFinalized;
            roomState.hostId = message.data.hostId;
            updateUI();
            updateLobbyUI();
        });

        channel.subscribe('explicitLeave', (message) => {
            if (message.clientId !== roomState.myUserId) {
                delete roomState.peers[message.clientId];
                updateUsersList(); updateUI(); renderTower();
            }
        });

        channel.presence.subscribe('enter', (member) => {
            if (roomState.peers[member.clientId]) roomState.peers[member.clientId].isOffline = false;
            if (member.clientId !== roomState.myUserId) publishMyState();
        });

        channel.presence.subscribe('leave', (member) => {
            // If bill is finalized, we KEEP their data for the table total
            if (roomState.isBillFinalized) {
                if (roomState.peers[member.clientId]) {
                    roomState.peers[member.clientId].isOffline = true;
                }
            } else {
                delete roomState.peers[member.clientId];
            }
            updateUsersList(); updateUI(); renderTower();
        });

        channel.presence.enter({ name: roomState.myName });
        channel.history({ limit: 10, direction: 'backwards' }, (err, resultPage) => {
            if (!err && resultPage && resultPage.items.length > 0) {
                resultPage.items.forEach(msg => {
                    if (msg.name === 'syncState' && msg.clientId !== roomState.myUserId) {
                        if (!roomState.peers[msg.clientId]) roomState.peers[msg.clientId] = msg.data;
                    }
                    if (msg.name === 'finalizeBill') {
                        roomState.isBillFinalized = true;
                        roomState.hostId = msg.data.hostId;
                    }
                });
                updateUsersList(); updateUI(); renderTower();
            }
        });
        publishMyState();
        updateLobbyUI();
    });
}

function updateUsersList() {
    let names = [roomState.myName + " (You)"];
    for (const [id, data] of Object.entries(roomState.peers)) {
        if (data.name) names.push(data.name);
    }
    document.getElementById('usersList').innerText = names.join(', ');
}

function publishMyState() {
    if (!channel || !roomState.roomId) return;
    const type = document.getElementById('restaurantSelect').value;
    const currentData = state.data[type];
    channel.publish('syncState', {
        name: roomState.myName,
        restaurant: type,
        counts: currentData.counts,
        customItems: currentData.customItems
    });
}

function setTowerView(view) {
    currentTowerView = view;
    updateTowerToggleUI();
    renderTower();
}

function updateTowerToggleUI() {
    const personalBtn = document.getElementById('viewPersonalBtn');
    const tableBtn = document.getElementById('viewTableBtn');
    const container = document.getElementById('towerToggleContainer');

    if (!roomState.roomId) {
        container.style.display = 'none';
        return;
    }
    container.style.display = 'flex';

    if (currentTowerView === 'personal') {
        personalBtn.style.background = 'var(--accent)';
        personalBtn.style.color = 'white';
        tableBtn.style.background = 'transparent';
        tableBtn.style.color = '#666';
    } else {
        tableBtn.style.background = 'var(--accent)';
        tableBtn.style.color = 'white';
        personalBtn.style.background = 'transparent';
        personalBtn.style.color = '#666';
    }
}

// --- CORE CALCULATOR FUNCTIONS ---
function formatBudget(input) {
    let value = input.value.replace(/,/g, '');
    if (value === '' || isNaN(value)) {
        input.value = '';
        return;
    }
    input.value = Number(value).toLocaleString('en-US');
}

function getBudgetValue() {
    return parseFloat(document.getElementById('targetPrice').value.replace(/,/g, '')) || 0;
}

function saveData() {
    state.timestamp = Date.now();
    state.lastActive = document.getElementById('restaurantSelect').value;
    state.targetPrice = document.getElementById('targetPrice').value;
    localStorage.setItem('sushi_calc_v2', JSON.stringify(state));
    publishMyState();
}

function loadData() {
    const saved = localStorage.getItem('sushi_calc_v2');
    if (!saved) return false;
    const loadedState = JSON.parse(saved);
    if (Date.now() - loadedState.timestamp > 6 * 60 * 60 * 1000) {
        localStorage.removeItem('sushi_calc_v2');
        return false;
    }
    state = loadedState;
    document.getElementById('restaurantSelect').value = state.lastActive;
    document.getElementById('targetPrice').value = state.targetPrice;
    initApp(true);
    return true;
}

function switchRestaurant() {
    saveData();
    initApp(true);
}

function initApp(isSwitching = false) {
    const type = document.getElementById('restaurantSelect').value;
    const plateData = restaurants[type];
    const container = document.getElementById('plates-container');
    container.innerHTML = '';
    if (!state.data[type]) state.data[type] = { counts: {}, plateSubtotal: 0, customItems: [] };
    const currentData = state.data[type];
    
    plateData.forEach(plate => {
        if (currentData.counts[plate.id] === undefined) currentData.counts[plate.id] = 0;
        const card = document.createElement('div');
        card.className = 'plate-card';
        card.innerHTML = `
            <div class="plate-info">
                <div class="plate-color-dot dot-${plate.id}"></div>
                <span>฿${plate.price}</span>
            </div>
            <div class="controls-row">
                <button class="ctrl-btn btn-minus" onclick="changeCount('${plate.id}', -1, ${plate.price})">−</button>
                <div class="count-display" id="count-${plate.id}">${currentData.counts[plate.id]}</div>
                <button class="ctrl-btn btn-plus" onclick="changeCount('${plate.id}', 1, ${plate.price})">+</button>
            </div>
        `;
        container.appendChild(card);
    });
    renderTower();
    renderCustomList();
    updateUI();
    if (!isSwitching) saveData();
}

function changeCount(id, delta, price) {
    const type = document.getElementById('restaurantSelect').value;
    const currentData = state.data[type];
    const newCount = (currentData.counts[id] || 0) + delta;
    if (newCount < 0) return;
    
    // Trigger Pop Animation on the count display
    const countEl = document.getElementById(`count-${id}`);
    countEl.classList.remove('pop-animation');
    void countEl.offsetWidth; // Trigger reflow
    countEl.classList.add('pop-animation');

    triggerHaptic();
    currentData.counts[id] = newCount;
    currentData.plateSubtotal += (delta * price);
    countEl.innerText = newCount;
    renderTower();
    updateUI();
    saveData();
}

    function renderTower() {
    const type = document.getElementById('restaurantSelect').value;
    const tower = document.getElementById('plateTower');
    const summary = document.getElementById('towerSummary');
    tower.innerHTML = '';
    summary.innerHTML = '';
    
    let combinedCounts = { ...state.data[type].counts };
    if (currentTowerView === 'table' && roomState.roomId) {
        for (const peer of Object.values(roomState.peers)) {
            if (peer.restaurant === type && peer.counts) {
                for (const [pId, pCount] of Object.entries(peer.counts)) {
                    combinedCounts[pId] = (combinedCounts[pId] || 0) + pCount;
                }
            }
        }
    }

    summary.style.display = 'flex';
    let allPlates = [];
    let totalCount = 0;
    let totalViewPrice = 0;
    const plateData = restaurants[type];

    // CALCULATE TOTAL VIEW PRICE (Plates + Custom Items)
    // 1. Plates
    plateData.forEach(plate => {
        const count = combinedCounts[plate.id] || 0;
        totalViewPrice += (count * plate.price);
    });

    // 2. Custom Items
    if (currentTowerView === 'personal') {
        state.data[type].customItems.forEach(item => {
            totalViewPrice += (item.price * item.qty);
        });
    } else {
        // Table view: include everyone's custom items
        state.data[type].customItems.forEach(item => {
            totalViewPrice += (item.price * item.qty);
        });
        for (const peer of Object.values(roomState.peers)) {
            if (peer.restaurant === type && peer.customItems) {
                peer.customItems.forEach(item => {
                    totalViewPrice += (item.price * item.qty);
                });
            }
        }
    }

    plateData.forEach(plate => {
        const count = combinedCounts[plate.id] || 0;
        if (count > 0) {
            totalCount += count;
            for (let i = 0; i < count; i++) { allPlates.push(plate.id); }
            
            // PERCENTAGE CALCULATION
            const percentage = totalViewPrice > 0 ? Math.round(((count * plate.price) / totalViewPrice) * 100) : 0;
            
            const item = document.createElement('div');
            item.style.display = 'flex';
            item.style.alignItems = 'center';
            item.style.gap = '8px';
            item.style.fontSize = '0.75rem';
            item.style.whiteSpace = 'nowrap';
            item.innerHTML = `<div class="plate-color-dot dot-${plate.id}" style="width:12px !important; height:12px !important; border-width:1px !important; border-radius: 50% !important;"></div> <span style="min-width:15px"><b>${count}</b></span> <span style="color:#aaa; font-size:0.6rem;">(${percentage}%)</span>`;
            summary.appendChild(item);
        }
    });

    if (allPlates.length === 0) {
        tower.innerHTML = '<span style="color:#ccc; font-style:italic; font-size:0.8rem;">Plate stack will appear here</span>';
        summary.style.display = 'none';
        return;
    }

    const stackContainer = document.createElement('div');
    stackContainer.style.display = 'flex';
    stackContainer.style.flexDirection = 'column';
    stackContainer.style.alignItems = 'center';
    const totalLabel = document.createElement('div');
    totalLabel.style.fontSize = '0.75rem';
    totalLabel.style.fontWeight = 'bold';
    totalLabel.style.marginBottom = '8px';
    totalLabel.style.color = 'var(--accent)';
    totalLabel.innerText = `Total: ${totalCount}`;
    stackContainer.appendChild(totalLabel);

    const stack = document.createElement('div');
    stack.className = 'stack';
    allPlates.forEach(id => {
        const plate = document.createElement('div');
        plate.className = `visual-plate dot-${id}`;
        stack.appendChild(plate);
    });
    stackContainer.appendChild(stack);
    tower.appendChild(stackContainer);
}

function addCustomItem() {
    const type = document.getElementById('restaurantSelect').value;
    const currentData = state.data[type];
    const nameInput = document.getElementById('customName');
    const priceInput = document.getElementById('customPrice');
    const qtyInput = document.getElementById('customQty');
    const name = nameInput.value.trim() || 'Extra Item';
    const price = parseFloat(priceInput.value) || 0;
    const qty = parseInt(qtyInput.value) || 1;
    if (price > 0 && qty > 0) {
        currentData.customItems.push({ id: Date.now(), name, price, qty });
        triggerHaptic();
        nameInput.value = ''; priceInput.value = ''; qtyInput.value = '1';
        renderCustomList(); updateUI(); saveData();
    }
}

function removeCustomItem(id) {
    const type = document.getElementById('restaurantSelect').value;
    state.data[type].customItems = state.data[type].customItems.filter(item => item.id !== id);
    renderCustomList(); updateUI(); saveData();
}

function changeCustomQty(id, delta) {
    const type = document.getElementById('restaurantSelect').value;
    const item = state.data[type].customItems.find(i => i.id === id);
    if (item) {
        item.qty += delta;
        triggerHaptic();
        if (item.qty <= 0) removeCustomItem(id);
        else { renderCustomList(); updateUI(); saveData(); }
    }
}

function renderCustomList() {
    const type = document.getElementById('restaurantSelect').value;
    const list = document.getElementById('customItemsList');
    list.innerHTML = '';
    state.data[type].customItems.forEach(item => {
        const div = document.createElement('div');
        div.className = 'custom-item';
        div.style.alignItems = 'center';
        div.innerHTML = `
            <div style="flex: 1; min-width: 0;">
                <div style="font-weight: bold; font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.name}</div>
                <div style="color: #aaa; font-size: 0.7rem;">฿${item.price.toLocaleString()}/unit</div>
            </div>
            <div class="controls-row" style="padding: 1px; min-width: 85px; margin: 0 10px;">
                <button class="ctrl-btn btn-minus" style="width: 24px; height: 24px; font-size: 0.9rem;" onclick="changeCustomQty(${item.id}, -1)">−</button>
                <div class="count-display" style="font-size: 0.85rem; min-width: 20px;">${item.qty}</div>
                <button class="ctrl-btn btn-plus" style="width: 24px; height: 24px; font-size: 0.9rem;" onclick="changeCustomQty(${item.id}, 1)">+</button>
            </div>
            <div style="font-weight: bold; font-size: 0.85rem; min-width: 60px; text-align: right; margin-right: 5px;">฿${(item.price * item.qty).toLocaleString()}</div>
            <button class="btn-remove-custom" onclick="removeCustomItem(${item.id})">×</button>
        `;
        list.appendChild(div);
    });
}

function reset() {
    if (!confirm('Clear all items for THIS restaurant?')) return;
    const type = document.getElementById('restaurantSelect').value;
    state.data[type] = { counts: {}, plateSubtotal: 0, customItems: [] };
    initApp(true); saveData();
}

function updateUI() {
    const type = document.getElementById('restaurantSelect').value;
    const currentData = state.data[type];
    const customSubtotal = currentData.customItems.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const subtotal = currentData.plateSubtotal + customSubtotal;
    const service = subtotal * 0.10;
    const total = subtotal + service;
    const target = getBudgetValue();

    // --- Bill Finalization UI Logic ---
    const statusLabel = document.getElementById('billStatusLabel');
    if (roomState.isBillFinalized) {
        statusLabel.innerText = 'FINALIZED';
        statusLabel.style.background = 'var(--orange)';
        document.querySelectorAll('.ctrl-btn, .btn-add-custom, .btn-remove-custom, .btn-reset').forEach(btn => btn.disabled = true);
        document.querySelectorAll('input').forEach(input => input.disabled = true);
    } else {
        statusLabel.innerText = 'LIVE';
        statusLabel.style.background = '#2ecc71';
        document.querySelectorAll('.ctrl-btn, .btn-add-custom, .btn-remove-custom, .btn-reset').forEach(btn => btn.disabled = false);
        document.querySelectorAll('input').forEach(input => input.disabled = false);
    }

    document.getElementById('subtotal').innerText = subtotal.toLocaleString('en-US', {minimumFractionDigits: 2});
    document.getElementById('service').innerText = service.toLocaleString('en-US', {minimumFractionDigits: 2});
    document.getElementById('total').innerText = total.toLocaleString('en-US', {minimumFractionDigits: 2});

    const summaryBox = document.getElementById('summaryBox');
    const progContainer = document.getElementById('progContainer');
    const progBar = document.getElementById('progBar');
    const remRow = document.getElementById('remRow');
    const remVal = document.getElementById('remaining');
    const remLabel = document.getElementById('remLabel');

    if (target > 0) {
        progContainer.style.display = 'block'; remRow.style.display = 'flex';
        const percent = Math.min((total / target) * 100, 100);
        progBar.style.width = percent + '%';
        const diff = target - total;
        remVal.innerText = Math.abs(diff).toLocaleString('en-US', {minimumFractionDigits: 2});
        summaryBox.classList.remove('near-budget', 'over-budget');
        const affordSection = document.getElementById('affordabilitySection');
        const affordList = document.getElementById('affordabilityList');

        if (total > target) {
            summaryBox.classList.add('over-budget'); progBar.style.backgroundColor = '#e74c3c';
            remLabel.innerText = 'Over:'; affordSection.style.display = 'none';
        } else {
            remLabel.innerText = 'Remaining:';
            if (total > target * 0.8) { summaryBox.classList.add('near-budget'); progBar.style.backgroundColor = '#f1c40f'; }
            else { progBar.style.backgroundColor = '#2ecc71'; }
            affordSection.style.display = 'block'; affordList.innerHTML = '';
            const availableForFood = diff / 1.10;
            restaurants[type].forEach(plate => {
                const count = Math.floor(availableForFood / plate.price);
                if (count > 0) {
                    const item = document.createElement('div');
                    item.style = 'display:flex; align-items:center; gap:4px; font-size:0.75rem; background:#fff; padding:3px 8px; border-radius:12px; border:1px solid #f0f0f0; box-shadow:0 1px 2px rgba(0,0,0,0.02)';
                    item.innerHTML = `<div class="plate-color-dot dot-${plate.id}" style="width:10px; height:10px;"></div> <b>${count}</b>`;
                    affordList.appendChild(item);
                }
            });
            if (affordList.innerHTML === '') affordSection.style.display = 'none';
        }
    } else {
        progContainer.style.display = 'none'; remRow.style.display = 'none';
        document.getElementById('affordabilitySection').style.display = 'none';
        summaryBox.classList.remove('near-budget', 'over-budget');
    }

    if (roomState.roomId) {
        let tablePlateTotal = currentData.plateSubtotal;
        let tableCustomTotal = customSubtotal;
        let tableTotalPlates = Object.values(currentData.counts).reduce((a, b) => a + b, 0);
        
        const priceMap = {}; restaurants[type].forEach(p => priceMap[p.id] = p.price);
        for (const peer of Object.values(roomState.peers)) {
            if (peer.restaurant === type && peer.counts) {
                for (const [pId, pCount] of Object.entries(peer.counts)) {
                    if (priceMap[pId]) {
                        tablePlateTotal += (priceMap[pId] * pCount);
                        tableTotalPlates += pCount;
                    }
                }
            }
            if (peer.restaurant === type && peer.customItems) {
                tableCustomTotal += peer.customItems.reduce((s, i) => s + (i.price * i.qty), 0);
            }
        }
        const tSubtotal = tablePlateTotal + tableCustomTotal;
        const tTotal = tSubtotal * 1.10;
        document.getElementById('tableSubtotal').innerText = tSubtotal.toLocaleString('en-US', {minimumFractionDigits: 2});
        document.getElementById('tableService').innerText = (tSubtotal * 0.10).toLocaleString('en-US', {minimumFractionDigits: 2});
        document.getElementById('tableTotalFull').innerText = tTotal.toLocaleString('en-US', {minimumFractionDigits: 2});

        const platesEl = document.getElementById('tableTotalPlates');
        const rankEl = document.getElementById('tableRankDisplay');
        platesEl.innerText = tableTotalPlates;
        
        let rankText = "";
        let rankClass = "";

        if (tableTotalPlates >= 50) {
            rankText = "🏙️ Skyline Conqueror";
            rankClass = "rank-royalty";
        } else if (tableTotalPlates >= 25) {
            rankText = "🏗️ Tower Architect";
            rankClass = "rank-beast";
        } else if (tableTotalPlates >= 10) {
            rankText = "📚 Stack Specialist";
            rankClass = "rank-ninja";
        } else if (tableTotalPlates >= 1) {
            rankText = "🥢 Plate Padawan";
            rankClass = "rank-appetizer";
        } else {
            rankText = "🥣 Appetizer Stage";
            rankClass = "rank-appetizer";
        }

        rankEl.innerText = rankText;
        rankEl.className = "rank-label " + rankClass;

        // --- User Breakdown ---
        const breakdownContainer = document.getElementById('usersBreakdown');
        breakdownContainer.innerHTML = '<div style="font-size: 0.65rem; color: #aaa; margin-bottom: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em; text-align:center;">Who owes what:</div>';
        
        // Add Me
        const myRow = document.createElement('div');
        myRow.className = 'row';
        myRow.style.fontSize = '0.85rem';
        myRow.style.marginBottom = '6px';
        myRow.innerHTML = `<span>${roomState.myName || 'Me'} (You)</span> <span>฿${total.toLocaleString('en-US', {minimumFractionDigits: 2})}</span>`;
        breakdownContainer.appendChild(myRow);
        
        // Add Peers
        for (const peer of Object.values(roomState.peers)) {
            if (peer.restaurant === type) {
                let peerPlateSub = 0;
                if (peer.counts) {
                    for (const [pId, pCount] of Object.entries(peer.counts)) {
                        if (priceMap[pId]) peerPlateSub += (priceMap[pId] * pCount);
                    }
                }
                const peerCustomSub = (peer.customItems || []).reduce((s, i) => s + (i.price * i.qty), 0);
                const peerTotal = (peerPlateSub + peerCustomSub) * 1.10;
                
                const pRow = document.createElement('div');
                pRow.className = 'row';
                pRow.style.fontSize = '0.85rem';
                pRow.style.marginBottom = '6px';
                pRow.innerHTML = `<span>${peer.name || 'Friend'}</span> <span>฿${peerTotal.toLocaleString('en-US', {minimumFractionDigits: 2})}</span>`;
                breakdownContainer.appendChild(pRow);
            }
        }

        document.getElementById('tableBillSection').style.display = 'block';
    } else {
        document.getElementById('tableBillSection').style.display = 'none';
    }
}

window.onload = () => {
    const dataLoaded = loadData();
    const urlParams = new URLSearchParams(window.location.search);
    const tableParam = urlParams.get('table');
    
    updateLobbyUI();
    updateTowerToggleUI();

    if (tableParam && !roomState.roomId) {
        if (roomState.myName) {
            joinRoom(tableParam);
        } else {
            showNameInput();
        }
    } else if (localStorage.getItem('sushi_roomId') && roomState.myName) {
        joinRoom(localStorage.getItem('sushi_roomId'));
    }
    
    if (!dataLoaded) {
        initApp();
    }
};