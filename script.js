const socket = io();
const roomName = location.pathname.split('/')[1] || 'lobby';
let myName = '';
let isRemoteAction = false;

// 入室ボタンのイベント
document.getElementById('start-btn').addEventListener('click', () => {
    const name = document.getElementById('username').value.trim();
    if (!name) return alert('名前を入力してください');
    myName = name;
    socket.emit('joinRoom', { roomName, userName: name });
});

socket.on('full', (msg) => alert(msg));

// 部屋の状態を初期化
socket.on('roomState', (state) => {
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('main').style.display = 'block';
    updateQueue(state.queue);
    updateParticipants(state.users);
});

socket.on('updateUsers', (users) => updateParticipants(users));

// 参加者一覧の更新
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
    div.textContent = `${data.userName}: ${data.type}`;
    document.getElementById('chat-messages').appendChild(div);
});

// 動画追加ボタン
document.getElementById('add-btn').addEventListener('click', () => {
    const url = document.getElementById('video-url').value.trim();
    if (!url) return;
    const videoId = extractVideoId(url);
    if (!videoId) return alert('正しいYouTube URLを入力してください');
    socket.emit('addToQueue', { videoId, title: videoId, addedBy: myName });
    document.getElementById('video-url').value = '';
});

// YouTube URLからVideoIDを抜き出す（通常・ショート・ライブ・モバイル対応）
function extractVideoId(url) {
    const match = url.match(/(?:v=|youtu\.be\/|shorts\/|live\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
}

socket.on('updateQueue', (queue) => updateQueue(queue));

// キューの表示更新
function updateQueue(queue) {
    const list = document.getElementById('queue-list');
    list.innerHTML = queue.map((v, i) => `<div>${i + 1}. ${v.title} (${v.addedBy})</div>`).join('');
}

// 動画の再生・変更イベント（同期ズレの許容値を0.3秒に強化）
socket.on('playVideo', (data) => {
    if (!player || !player.getVideoData) return;
    
    // 自分が裏（ホーム画面など）にいるときは他人の画面を止めないようにスルー
    if (document.hidden) return;

    isRemoteAction = true;
    const videoData = player.getVideoData();
    const currentVideoId = videoData ? videoData.video_id : null;

    if (currentVideoId === data.videoId) {
        if (Math.abs(player.getCurrentTime() - data.currentTime) > 0.3) {
            player.seekTo(data.currentTime, true);
        }
        
        const currentState = player.getPlayerState();
        if (data.isPlaying && currentState !== YT.PlayerState.PLAYING) {
            player.playVideo();
        } else if (!data.isPlaying && currentState !== YT.PlayerState.PAUSED) {
            player.pauseVideo();
        }
        isRemoteAction = false;
    } else {
        if (data.isPlaying) {
            player.loadVideoById({ videoId: data.videoId, startSeconds: data.currentTime });
        } else {
            player.cueVideoById({ videoId: data.videoId, startSeconds: data.currentTime });
        }
    }
});

// プレイヤーの一時停止・再開コントロール（同期ズレ0.3秒）
socket.on('playerControl', (data) => {
    if (!player || !player.getPlayerState || document.hidden) return;
    
    isRemoteAction = true;
    const currentState = player.getPlayerState();

    if (data.action === 'play') {
        if (Math.abs(player.getCurrentTime() - data.currentTime) > 0.3) {
            player.seekTo(data.currentTime, true);
        }
        if (currentState !== YT.PlayerState.PLAYING) {
            player.playVideo();
        } else {
            isRemoteAction = false;
        }
    } else if (data.action === 'pause') {
        if (currentState !== YT.PlayerState.PAUSED) {
            player.pauseVideo();
        } else {
            isRemoteAction = false;
        }
    }
});

// YouTube Iframe APIの初期化
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

// プレイヤーの状態が変わったときの処理
// script.js 修正箇所
function onPlayerStateChange(event) {
    if (document.hidden) return;
    if (isRemoteAction) {
        if (event.data === YT.PlayerState.PLAYING || 
            event.data === YT.PlayerState.PAUSED) {
            isRemoteAction = false;
        }
        return;
    }

    if (event.data === YT.PlayerState.PLAYING) {
        socket.emit('playerControl', { action: 'play', currentTime: player.getCurrentTime() });
    } else if (event.data === YT.PlayerState.PAUSED) {
        // ★バッファリング直後のPAUSEDは無視する
        setTimeout(() => {
            if (player.getPlayerState() === YT.PlayerState.PAUSED) {
                socket.emit('playerControl', { action: 'pause', currentTime: player.getCurrentTime() });
            }
        }, 300);
    } else if (event.data === YT.PlayerState.ENDED) {
        socket.emit('nextVideo');
    }
}

// 定期的な同期リクエスト（10秒ごと）
setInterval(() => {
    if (player && player.getPlayerState && !document.hidden) {
        socket.emit('requestSync');
    }
}, 10000);

// タブ切り替え・ホーム画面移動の対策処理
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        // 画面に戻ってきたら、一瞬置いてから最新の状態に強制同期する
        setTimeout(() => {
            socket.emit('requestSync');
        }, 300);
    } else {
        // ホーム画面や別タブに移動した瞬間、Safariでも音が流れないよう自分のプレイヤーだけ止める
        if (player && player.pauseVideo) {
            isRemoteAction = true; // サーバーには停止命令を送らない
            player.pauseVideo();
        }
    }
});





