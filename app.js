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
        if (!room) return;

        const { videoId, title, addedBy } = data;
        room.queue.push({ videoId, title, addedBy });

        // 全員のキュー表示を更新
        io.to(currentRoom).emit('updateQueue', room.queue);

        // 1本目なら全員自動再生
        if (room.queue.length === 1) {
            room.isPlaying = true;
            room.currentIndex = 0;
            io.to(currentRoom).emit('playVideo', {
            videoId: room.queue[0].videoId,
            currentTime: 0,
            isPlaying: true
            });
        }
    });

    // 再生・一時停止・シーク
    socket.on('playerControl', (data) => {
        const room = rooms[currentRoom];
        if (!room) return;

        const { action, currentTime } = data;

        if (action === 'play') {
            room.isPlaying = true;
            room.currentTime = currentTime;
            room.lastSyncTime = Date.now();
            io.to(currentRoom).emit('playerControl', { action: 'play', currentTime });
        } else if (action === 'pause') {
            room.isPlaying = false;
            room.currentTime = currentTime;
            io.to(currentRoom).emit('playerControl', { action: 'pause', currentTime });
        } else if (action === 'seek') {
            // seekはサーバーの時刻を更新するだけ（全員には送らない）
            room.currentTime = currentTime;
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
            io.to(currentRoom).emit('playVideo', {
                videoId: room.queue[room.currentIndex].videoId,
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
            type: data.type
        });
    });

    // 裏から戻ってきたとき再同期リクエスト
    socket.on('requestSync', () => {
        const room = rooms[currentRoom];
        if (!room || room.queue.length === 0) return;
        socket.emit('playVideo', {
            videoId: room.queue[room.currentIndex].videoId,
            currentTime: room.currentTime
        });
    });

    // 切断処理
        socket.on('disconnect', () => {
        if (!currentRoom || !rooms[currentRoom]) return;

        const room = rooms[currentRoom];
        const user = room.users.find(u => u.id === socket.id);
        const userName = user ? user.name : '誰か';

        room.users = room.users.filter(u => u.id !== socket.id);

        if (room.users.length === 0) {
            delete rooms[currentRoom];
        } else {
            // ★追加：ユーザーが減っても、再生中ならその状態と時間を維持させる
            if (room.isPlaying) {
                const elapsedTime = (Date.now() - room.lastSyncTime) / 1000;
                room.currentTime += elapsedTime;
                room.lastSyncTime = Date.now();
            }

            io.to(currentRoom).emit('updateUsers', room.users);
            io.to(currentRoom).emit('chatMessage', {
                userName: 'システム',
                text: `${userName} が一時的に離脱、または退室しました`,
                time: new Date().toLocaleTimeString('ja-JP', {hour: '2-digit', minute:'2-digit'})
            });
        }
    });
});

http.listen(PORT, () => {
    console.log(`TubeTube running on port ${PORT}`);
});

