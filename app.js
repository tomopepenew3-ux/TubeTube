const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

const PORT = 3003;

app.use(express.static(__dirname));

app.get('/:room', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.