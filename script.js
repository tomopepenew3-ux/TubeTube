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


