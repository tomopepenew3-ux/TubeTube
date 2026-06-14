const socket = io();
const roomName = location.pathname.split('/')[1] || 'lobby';
let myName = '';
let isRemoteAction = false;

document.getElementById('start-btn').addEventListener('click', () => {
    const name = document.getElementById('username').value.trim();
    if (!name) return alert('名前を入力してください');
    myName = name;
    socket.emit('joinRoom', { roomName, userName: name });
});

socket.on('full', (msg) => alert(msg));

socket.on('roomState', (state) => {
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('main').style.display = 'block';
    updateQueue(state.queue);
    updateParticipants(state.users);
});

socket.on('updateUsers', (users) => updateParticipants(users));

function updateParticipants(users) {
    const list = document.getElementById('participants-list');
    list.innerHTML = users.map(u => `<div>${u.name}</div>`).join('');
}

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

socket.on('chatMessage', (data) => {
    const div = document.createElement('div');
    div.textContent = `${data.time} ${data.userName}: ${data.text}`;
    const messages = document.getElementById('chat-messages');
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
});

document.querySelectorAll('.reaction-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        socket.emit('reaction', { userName: myName, type: btn.dataset.type });
    });
});

socket.on('reaction', (data) => {
    const div = document.createElement('div');
    div.textContent = `${data.userName}: ${data.type}`;
    document.getElementById('chat-messages').appendChild(div);
});

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

socket.on('updateQueue', (queue) => updateQueue(queue));

function updateQueue(queue) {
    const list = document.getElementById('queue-list');
    list.innerHTML = queue.map((v, i) => `<div>${i + 1}. ${v.title} (${v.addedBy})</div>`).join('');
}

socket.on('playVideo', (data) => {
    if (!player || !player.getVideoData) return;
    isRemoteAction = true;

    const videoData = player.getVideoData();
    const currentVideoId = videoData ? videoData.video_id : null;

    if (currentVideoId === data.videoId) {
        if (Math.abs(player.getCurrentTime() - data.currentTime) > 2) {
            player.seekTo(data.currentTime, true);
        }
        
        const currentState = player.getPlayerState();
        if (data.isPlaying && currentState !== YT.PlayerState.PLAYING) {
            player.playVideo();
        } else if (!data.isPlaying && currentState !== YT.PlayerState.PAUSED) {
            player.pauseVideo();
        }
    } else {
        if (data.isPlaying) {
            player.loadVideoById({ videoId: data.videoId, startSeconds: data.currentTime });
        } else {
            player.cueVideoById({ videoId: data.videoId, startSeconds: data.currentTime });
        }
    }

    // 誤作動・無限ループ防止：リモート操作後、0.5秒間は自分のイベントを無視する
    setTimeout(() => {
        isRemoteAction = false;
    }, 500);
});

socket.on('playerControl', (data) => {
    if (!player || !player.getPlayerState) return;
    
    isRemoteAction = true;
    const currentState = player.getPlayerState();

    if (data.action === 'play') {
        if (Math.abs(player.getCurrentTime() - data.currentTime) > 1.5) {
            player.seekTo(data.currentTime, true);
        }
        if (currentState !== YT.PlayerState.PLAYING) {
            player.playVideo();
        }
    } else if (data.action === 'pause') {
        if (currentState !== YT.PlayerState.PAUSED) {
            player.pauseVideo();
        }
    }

    // 誤作動・無限ループ防止：リモート操作後、0.5秒間は自分のイベントを無視する
    setTimeout(() => {
        isRemoteAction = false;
    }, 500);
});

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

function onPlayerStateChange(event) {
    if (document.hidden) return;

    // リモートから操作された時は、自分の通知イベントを完全にストップさせて無限ループを防御
    if (isRemoteAction) return;

    if (event.data === YT.PlayerState.PLAYING) {
        socket.emit('playerControl', { action: 'play', currentTime: player.getCurrentTime() });
    } else if (event.data === YT.PlayerState.PAUSED) {
        socket.emit('playerControl', { action: 'pause', currentTime: player.getCurrentTime() });
    } else if (event.data === YT.PlayerState.ENDED) {
        socket.emit('nextVideo');
    }
}

// 画面が表に戻ってきたとき（タブのアクティブ化）だけ、安全に再同期を要求する
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        socket.emit('requestSync');
    }
});
