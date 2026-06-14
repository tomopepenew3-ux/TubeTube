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

    socket.on('joinRoom', (data) => {
        const { roomName, userName } = data;
        currentRoom = roomName;
        socket.join(roomName);

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

        if (room.users.length >= 8) {
            socket.emit('full', 'この部屋は満員です。');
            socket.leave(roomName);
            return;
        }

        room.users.push({ id: socket.id, name: userName });

        let actualTime = room.currentTime;
        if (room.isPlaying) {
            const elapsedTime = (Date.now() - room.lastSyncTime) / 1000;
            actualTime += elapsedTime;
        }

        socket.emit('roomState', {
            users: room.users,
            queue: room.queue,
            currentIndex: room.currentIndex,
            isPlaying: room.isPlaying,
            currentTime: actualTime
        });

        if (room.queue.length > 0) {
            socket.emit('playVideo', {
                videoId: room.queue[room.currentIndex].videoId,
                currentTime: actualTime,
                isPlaying: room.isPlaying
            });
        }

        io.to(currentRoom).emit('updateUsers', room.users);

        io.to(currentRoom).emit('chatMessage', {
            userName: 'システム',
            text: `${userName} が入室しました`,
            time: new Date().toLocaleTimeString('ja-JP', {hour: '2-digit', minute:'2-digit'})
        });
    });

    socket.on('addToQueue', (data) => {
        const room = rooms[currentRoom];
        if (!room) return;

        const { videoId, title, addedBy } = data;
        room.queue.push({ videoId, title, addedBy });

        io.to(currentRoom).emit('updateQueue', room.queue);

        if (room.queue.length === 1) {
            room.isPlaying = true;
            room.currentIndex = 0;
            room.currentTime = 0;
            room.lastSyncTime = Date.now();
            io.to(currentRoom).emit('playVideo', {
                videoId: room.queue[0].videoId,
                currentTime: 0,
                isPlaying: true
            });
        }
    });

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
            room.currentTime = currentTime;
            room.lastSyncTime = Date.now();
        }
    });

    socket.on('nextVideo', () => {
        const room = rooms[currentRoom];
        if (!room) return;

        if (room.currentIndex < room.queue.length - 1) {
            room.currentIndex++;
            room.currentTime = 0;
            room.isPlaying = true;
            room.lastSyncTime = Date.now();
            io.to(currentRoom).emit('playVideo', {
                videoId: room.queue[room.currentIndex].videoId,
                currentTime: 0,
                isPlaying: true
            });
        }
    });

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

    socket.on('chatMessage', (data) => {
        const room = rooms[currentRoom];
        if (!room) return;

        io.to(currentRoom).emit('chatMessage', {
            userName: data.userName,
            text: data.text,
            time: new Date().toLocaleTimeString('ja-JP', {hour: '2-digit', minute:'2-digit'})
        });
    });

    socket.on('reaction', (data) => {
        io.to(currentRoom).emit('reaction', {
            userName: data.userName,
            type: data.type
        });
    });

    socket.on('requestSync', () => {
        const room = rooms[currentRoom];
        if (!room || room.queue.length === 0) return;

        let actualTime = room.currentTime;
        if (room.isPlaying) {
            const elapsedTime = (Date.now() - room.lastSyncTime) / 1000;
            actualTime += elapsedTime;
        }

        socket.emit('playVideo', {
            videoId: room.queue[room.currentIndex].videoId,
            currentTime: actualTime,
            isPlaying: room.isPlaying
        });
    });

    socket.on('disconnect', () => {
        if (!currentRoom || !rooms[currentRoom]) return;

        const room = rooms[currentRoom];
        const user = room.users.find(u => u.id === socket.id);
        const userName = user ? user.name : '誰か';

        room.users = room.users.filter(u => u.id !== socket.id);

        if (room.users.length === 0) {
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
