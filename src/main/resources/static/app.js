const peersContainer = document.getElementById('peers-container');
const myNameLabel = document.getElementById('myNameLabel');
const myAvatar = document.getElementById('myAvatar');
const dragOverlay = document.getElementById('drag-overlay');

let ws;
let myId;
let peers = [];
const peerConnections = {};
const dataChannels = {};

const CHUNK_SIZE = 16384; // 16KB

// File transfer state
let incomingFileInfo = null;
let incomingFileData = [];
let receivedSize = 0;

function getDeviceName() {
    const ua = navigator.userAgent;
    if (ua.includes('iPhone')) return 'iPhone';
    if (ua.includes('iPad')) return 'iPad';
    if (ua.includes('Android')) return 'Android';
    if (ua.includes('Mac OS')) return 'MacBook';
    if (ua.includes('Windows')) return 'Windows PC';
    if (ua.includes('Linux')) return 'Linux';
    return 'Device';
}

function connectSignaling() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = protocol + '//' + window.location.host + '/signaling';
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        // Send actual device name to server
        ws.send(JSON.stringify({
            type: 'set-name',
            name: getDeviceName()
        }));
    };
    
    ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);
        
        switch (msg.type) {
            case 'identity':
                myId = msg.id;
                myNameLabel.textContent = msg.name;
                myAvatar.textContent = msg.name.charAt(0);
                break;
            case 'peers':
                peers = msg.peers;
                renderPeers();
                break;
            case 'offer':
                await handleOffer(msg);
                break;
            case 'answer':
                await handleAnswer(msg);
                break;
            case 'candidate':
                await handleCandidate(msg);
                break;
        }
    };
}

function renderPeers() {
    peersContainer.innerHTML = '';
    
    const angleStep = (2 * Math.PI) / peers.length;
    const radius = 120; // Distance from center
    
    peers.forEach((peer, index) => {
        const angle = index * angleStep - Math.PI / 2; // start from top
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        
        const peerNode = document.createElement('div');
        peerNode.className = 'peer-node';
        peerNode.style.transform = `translate(${x}px, ${y}px)`;
        
        const avatar = document.createElement('div');
        avatar.className = 'peer-avatar';
        avatar.textContent = peer.name.charAt(0);
        
        const name = document.createElement('span');
        name.className = 'peer-name';
        name.textContent = peer.name;

        const sendBtn = document.createElement('button');
        sendBtn.className = 'peer-send-btn';
        sendBtn.textContent = 'Send File';
        
        peerNode.appendChild(avatar);
        peerNode.appendChild(name);
        peerNode.appendChild(sendBtn);
        
        // Drag events
        peerNode.addEventListener('dragover', (e) => {
            e.preventDefault();
            peerNode.classList.add('drag-over');
        });
        peerNode.addEventListener('dragleave', (e) => {
            peerNode.classList.remove('drag-over');
        });
        peerNode.addEventListener('drop', (e) => {
            e.preventDefault();
            peerNode.classList.remove('drag-over');
            
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                const file = e.dataTransfer.files[0];
                initiateTransfer(peer.id, file);
            }
        });
        
        // Click explicit send button
        sendBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const input = document.getElementById('fileInput');
            input.value = ''; // Reset value
            input.onchange = (e) => {
                if (e.target.files.length > 0) {
                    initiateTransfer(peer.id, e.target.files[0]);
                }
            };
            input.click();
        });
        
        peersContainer.appendChild(peerNode);
    });
}

// WebRTC functions
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

function createPeerConnection(targetId) {
    const pc = new RTCPeerConnection(configuration);
    
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({
                type: 'candidate',
                to: targetId,
                candidate: event.candidate
            }));
        }
    };
    
    pc.ondatachannel = (event) => {
        const receiveChannel = event.channel;
        receiveChannel.binaryType = 'arraybuffer';
        setupDataChannelEvents(receiveChannel, targetId);
    };
    
    peerConnections[targetId] = pc;
    return pc;
}

async function initiateTransfer(targetId, file) {
    const pc = createPeerConnection(targetId);
    const sendChannel = pc.createDataChannel('fileTransfer');
    sendChannel.binaryType = 'arraybuffer';
    
    setupDataChannelEvents(sendChannel, targetId);
    dataChannels[targetId] = sendChannel;
    
    sendChannel.onopen = () => {
        // Send file metadata first
        sendChannel.send(JSON.stringify({
            type: 'meta',
            name: file.name,
            size: file.size,
            fileType: file.type
        }));
        
        sendFileData(sendChannel, file);
    };
    
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    ws.send(JSON.stringify({
        type: 'offer',
        to: targetId,
        sdp: pc.localDescription
    }));
    
    showToast(`Connecting to send ${file.name}...`);
}

async function handleOffer(msg) {
    const targetId = msg.from;
    const pc = createPeerConnection(targetId);
    
    await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    ws.send(JSON.stringify({
        type: 'answer',
        to: targetId,
        sdp: pc.localDescription
    }));
}

async function handleAnswer(msg) {
    const pc = peerConnections[msg.from];
    if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    }
}

async function handleCandidate(msg) {
    const pc = peerConnections[msg.from];
    if (pc) {
        await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
    }
}

function setupDataChannelEvents(channel, peerId) {
    channel.onmessage = (event) => {
        if (typeof event.data === 'string') {
            const data = JSON.parse(event.data);
            if (data.type === 'meta') {
                incomingFileInfo = data;
                incomingFileData = [];
                receivedSize = 0;
                showIncomingModal(data.name, data.size);
            }
        } else {
            // Binary data (file chunk)
            incomingFileData.push(event.data);
            receivedSize += event.data.byteLength;
            
            updateProgress((receivedSize / incomingFileInfo.size) * 100);
            
            if (receivedSize === incomingFileInfo.size) {
                finishReceive();
            }
        }
    };
}

function sendFileData(channel, file) {
    const reader = new FileReader();
    let offset = 0;
    
    reader.onload = (e) => {
        channel.send(e.target.result);
        offset += e.target.result.byteLength;
        
        // update progress ui for sender
        updateProgress((offset / file.size) * 100);
        
        if (offset < file.size) {
            readSlice(offset);
        } else {
            showToast('File sent successfully!');
        }
    };
    
    const readSlice = (o) => {
        const slice = file.slice(offset, o + CHUNK_SIZE);
        reader.readAsArrayBuffer(slice);
    };
    
    showTransferModal(`Sending ${file.name}...`, 'Sending to peer...');
    readSlice(0);
}

let pendingBlobUrl = null;
let pendingFileName = null;

function finishReceive() {
    const blob = new Blob(incomingFileData, { type: incomingFileInfo.fileType });
    pendingBlobUrl = URL.createObjectURL(blob);
    pendingFileName = incomingFileInfo.name;
    
    modalTitle.textContent = "Transfer Complete";
    modalDesc.textContent = `Ready to save ${pendingFileName}`;
    btnAccept.style.display = 'inline-block';
    btnAccept.textContent = "Save File";
    
    btnAccept.onclick = () => {
        const a = document.createElement('a');
        a.href = pendingBlobUrl;
        a.download = pendingFileName;
        a.click();
        
        hideModal();
        showToast(`Saved ${pendingFileName}`);
        
        // Cleanup after a short delay
        setTimeout(() => URL.revokeObjectURL(pendingBlobUrl), 1000);
        
        incomingFileInfo = null;
        incomingFileData = [];
        pendingBlobUrl = null;
        pendingFileName = null;
    };
}

// Global Drag & Drop for visual effect
document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) {
        dragOverlay.classList.add('active');
    }
});
document.addEventListener('dragover', (e) => {
    e.preventDefault();
});
document.addEventListener('dragleave', (e) => {
    if (e.target === dragOverlay) {
        dragOverlay.classList.remove('active');
    }
});
document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragOverlay.classList.remove('active');
});

// Modal & UI Utils
const modal = document.getElementById('transfer-modal');
const modalTitle = document.getElementById('transfer-title');
const modalDesc = document.getElementById('transfer-desc');
const progressEl = document.getElementById('transfer-progress');
const btnAccept = document.getElementById('btn-accept');
const btnCancel = document.getElementById('btn-cancel');

function showTransferModal(title, desc) {
    modalTitle.textContent = title;
    modalDesc.textContent = desc;
    progressEl.style.width = '0%';
    btnAccept.style.display = 'none';
    modal.classList.add('active');
}

function showIncomingModal(filename, size) {
    showTransferModal('Incoming File', `Receiving ${filename} (${(size/1024/1024).toFixed(2)} MB)`);
}

function updateProgress(percent) {
    progressEl.style.width = `${percent}%`;
    if (percent >= 100) {
        setTimeout(hideModal, 1000);
    }
}

function hideModal() {
    modal.classList.remove('active');
}

btnCancel.onclick = hideModal;

function showToast(msg) {
    // simple alert or create custom toast
    console.log(msg);
}

// Start
connectSignaling();
