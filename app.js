const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

const PORT = 3003;

// 静的ファイル（html/css/js）を配信
app.use(express.static(__dirname));

// どのURLでもindex.htmlを返す（部屋名はURLで管理）
app.get('/:room', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 部屋の状態を管理するオブジェクト
const rooms = {};

io.on('connection', (socket) => {
    let currentRoom = null;

    // 入室処理
    socket.on('joinRoom', (data) => {
        const { roomName, userName } = data;
        currentRoom = roomName;
        socket.join(roomName);

        // 部屋がなければ作る
        if (!rooms[roomName]) {
            rooms[roomName] = {
                users: [],
                queue: [],
                currentIndex: 0,
                isPlaying: false,
                currentTime: 0,
                lastSyncTime: Date.now()
            };
        }

        const room = rooms[roomName];

        // 満員チェック
        if (room.users.length >= 8) {
            socket.emit('full', 'この部屋は満員です。');
            socket.leave(roomName);
            return;
        }

        room.users.push({ id: socket.id, name: userName });

        // 入室した人に現在の部屋の状態を送る
        socket.emit('roomState', {
            users: room.users,
            queue: room.queue,
            currentIndex: room.currentIndex,
            isPlaying: room.isPlaying,
            currentTime: room.currentTime
        });

        // 入室時に再生中の動画があれば送る
        if (room.queue.length > 0) {
            socket.emit('playVideo', {
                videoId: room.queue[room.currentIndex].videoId,
                currentTime: room.currentTime
            });
        }

        // 全員に参加者リスト更新を通知
        io.to(currentRoom).emit('updateUsers', room.users);

        // 入室メッセージをチャットに流す
        io.to(currentRoom).emit('chatMessage', {
            userName: 'システム',
            text: `${userName} が入室しました`,
            time: new Date().toLocaleTimeString('ja-JP', {hour: '2-digit', minute:'2-digit'})
        });
    });

    // 動画をキューに追加
    socket.on('addToQueue', (data) => {
        const room = rooms[currentRoom];
        if (!
