const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

const PORT = 3003;

app.use(express.static(__dirname));

app.get('/:room', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const rooms = {};

io.on('connection', (socket) => {
    let currentRoom = null;

    // 部屋に入る
    socket.on('joinRoom', (data) => {
        const { roomName, userName } = data;
        currentRoom = roomName;
        socket.join(roomName);

        // 部屋がなければ作る
        if (!rooms[roomName]) {
            rooms[roomName] = {
                users: [],
                queue: [],        // 動画キュー
                currentIndex: 0,  // 今何番目の動画か
                isPlaying: false,
                currentTime: 0,   // 再生位置（秒）
                lastSyncTime: Date.now()
            };
        }

        const room = rooms[roomName];

        // 満員チェック（8人まで）
        if (room.users.length >= 8) {
            socket.emit('full', 'この部屋は満員です。');
            socket.leave(roomName);
            return;
        }

        // ユーザー追加
        room.users.push({ id: socket.id, name: userName });

        // 入室した人に現在の状態を送る
        socket.emit('roomState', {
            users: room.users,
            queue: room.queue,
            currentIndex: room.currentIndex,
            isPlaying: room.isPlaying,
            currentTime: room.currentTime
        });

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
        if (!room) return;

        const { videoId, title, addedBy } = data;
        room.queue.push({ videoId, title, addedBy });

        io.to(currentRoom).emit('updateQueue', room.queue);

        // キューが1本目なら自動で再生開始
        if (room.queue.length === 1) {
            room.isPlaying = true;
            room.currentIndex = 0;
            socket.to(currentRoom).emit('playVideo', {
            videoId: room.queue[0].videoId,
            currentTime: 0
        });

    // 再生・一時停止
    socket.on('playerControl', (data) => {
        const room = rooms[currentRoom];
        if (!room) return;

        const { action, currentTime } = data;

        if (action === 'play') {
            room.isPlaying = true;
            room.currentTime = currentTime;
            room.lastSyncTime = Date.now();
            socket.to(currentRoom).emit('playerControl', { action: 'play', currentTime });
        } else if (action === 'pause') {
            room.isPlaying = false;
            room.currentTime = currentTime;
            socket.to(currentRoom).emit('playerControl', { action: 'pause', currentTime });
        } else if (action === 'seek') {
            room.currentTime = currentTime;
            socket.to(currentRoom).emit('playerControl', { action: 'seek', currentTime });
        }
    });

    // 次の動画へ
    socket.on('nextVideo', () => {
        const room = rooms[currentRoom];
        if (!room) return;

        if (room.currentIndex < room.queue.length - 1) {
            room.currentIndex++;
            room.currentTime = 0;
            room.isPlaying = true;
            socket.to(currentRoom).emit('playVideo', {
            videoId: room.queue[0].videoId,
            currentTime: 0
        });
        }
    });

    // キューから削除
    socket.on('removeFromQueue', (data) => {
        const room = rooms[currentRoom];
        if (!room) return;

        const { index } = data;
        room.queue.splice(index, 1);

        // 削除した動画が現在再生中より前なら番号ずらす
        if (index < room.currentIndex) {
            room.currentIndex--;
        }

        io.to(currentRoom).emit('updateQueue', room.queue);
    });

    // チャット
    socket.on('chatMessage', (data) => {
        const room = rooms[currentRoom];
        if (!room) return;

        io.to(currentRoom).emit('chatMessage', {
            userName: data.userName,
            text: data.text,
            time: new Date().toLocaleTimeString('ja-JP', {hour: '2-digit', minute:'2-digit'})
        });
    });

    // リアクション
    socket.on('reaction', (data) => {
        io.to(currentRoom).emit('reaction', {
            userName: data.userName,
            type: data.type  // 神・草・泣・熱・乙
        });
    });

    // 切断
    socket.on('disconnect', () => {
        if (!currentRoom || !rooms[currentRoom]) return;

        const room = rooms[currentRoom];
        const user = room.users.find(u => u.id === socket.id);
        const userName = user ? user.name : '誰か';

        room.users = room.users.filter(u => u.id !== socket.id);

        if (room.users.length === 0) {
            // 誰もいなくなったら部屋を消す
            delete rooms[currentRoom];
        } else {
            io.to(currentRoom).emit('updateUsers', room.users);
            io.to(currentRoom).emit('chatMessage', {
                userName: 'システム',
                text: `${userName} が退室しました`,
                time: new Date().toLocaleTimeString('ja-JP', {hour: '2-digit', minute:'2-digit'})
            });
        }
    });
});

http.listen(PORT, () => {
    console.log(`TubeTube running on port ${PORT}`);
});
