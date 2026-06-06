const socket = io();
const roomName = location.pathname.split('/')[1] || 'lobby';
let myName = '';

// ロビー：入室ボタン
document.getElementById('start-btn').addEventListener('click', () => {
    const name = document.getElementById('username').value.trim();
    if (!name) return alert('名前を入力してください');
    myName = name;
    socket.emit('joinRoom', { roomName, userName: name });
});

// 満員
socket.on('full', (msg) => alert(msg));

// 入室成功 → メイン画面へ
socket.on('roomState', (state) => {
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('main').style.display = 'block';
    updateQueue(state.queue);
    updateParticipants(state.users);
});

// 参加者リスト更新
socket.on('updateUsers', (users) => updateParticipants(users));

function updateParticipants(users) {
    const list = document.getElementById('participants-list');
    list.innerHTML = users.map(u => `<div>${u.name}</div>`).join('');
}

// チャット送信
document.getElementById('send-btn').addEventListener('click', sendChat);
document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
});

function sendChat() {
    const text = document.getElementById('chat-input').value.trim();
    if (!text) return;
    socket.emit('chatMessage', { userName: myName, text });
    document.getElementById('chat-input').value = '';
}

// チャット受信
socket.on('chatMessage', (data) => {
    const div = document.createElement('div');
    div.textContent = `${data.time} ${data.userName}: ${data.text}`;
    const messages = document.getElementById('chat-messages');
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
});

// リアクション送信
document.querySelectorAll('.reaction-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        socket.emit('reaction', { userName: myName, type: btn.dataset.type });
    });
});

// リアクション受信
socket.on('reaction', (data) => {
    const div = document.createElement('div');
    div.textContent = `${data.userName}: ${data.type}！`;
    document.getElementById('chat-messages').appendChild(div);
});

// 動画URL追加
document.getElementById('add-btn').addEventListener('click', () => {
    const url = document.getElementById('video-url').value.trim();
    if (!url) return;
    const videoId = extractVideoId(url);
    if (!videoId) return alert('正しいYouTube URLを入力してください');
    socket.emit('addToQueue', { videoId, title: videoId, addedBy: myName });
    document.getElementById('video-url').value = '';
});

function extractVideoId(url) {
    const match = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
}

// キュー更新
socket.on('updateQueue', (queue) => updateQueue(queue));

function updateQueue(queue) {
    const list = document.getElementById('queue-list');
    list.innerHTML = queue.map((v, i) => `<div>${i + 1}. ${v.title} (${v.addedBy})</div>`).join('');
}

// 動画再生
socket.on('playVideo', (data) => {
    if (player) {
        player.loadVideoById({ videoId: data.videoId, startSeconds: data.currentTime });
    }
});

// 再生コントロール同期
socket.on('playerControl', (data) => {
    if (!player) return;
    isSyncing = true;
    if (data.action === 'play') {
        player.seekTo(data.currentTime);
        player.playVideo();
    } else if (data.action === 'pause') {
        player.pauseVideo();
    } else if (data.action === 'seek') {
        player.seekTo(data.currentTime);
    }
    setTimeout(() => { isSyncing = false; }, 1000);
});

// YouTube IFrame API
let player;
window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player('player', {
        height: '100%',
        width: '100%',
        events: {
            onStateChange: onPlayerStateChange
        }
    });
};

let isSyncing = false;

function onPlayerStateChange(event) {
    if (isSyncing) return;
    if (event.data === YT.PlayerState.PLAYING) {
        socket.emit('playerControl', { action: 'play', currentTime: player.getCurrentTime() });
    } else if (event.data === YT.PlayerState.PAUSED) {
        socket.emit('playerControl', { action: 'pause', currentTime: player.getCurrentTime() });
    } else if (event.data === YT.PlayerState.ENDED) {
        socket.emit('nextVideo');
    }
}
