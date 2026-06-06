const socket = io();
const roomName = location.pathname.split('/')[1] || 'lobby';
let myName = '';
let isSyncing = false;

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
    socket.emit('addToQueue', { v