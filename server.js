const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

let activeUsers = new Map();
let globalChatMessages = [];
let cloudConfigs = new Map();

app.get('/', (req, res) => {
    res.json({ status: "ok", message: "Vind UI Backend Running" });
});

app.post('/api/heartbeat', (req, res) => {
    const userId = req.body.userId || req.headers['x-user-id'] || 'anonymous';
    activeUsers.set(userId, Date.now());
    res.json({ success: true, online: activeUsers.size });
});

app.get('/api/users', (req, res) => {
    const now = Date.now();
    for (const [id, lastSeen] of activeUsers.entries()) {
        if (now - lastSeen > 60000) activeUsers.delete(id);
    }
    res.json({ count: activeUsers.size });
});

app.get('/api/chat', (req, res) => {
    res.json({ messages: globalChatMessages });
});

app.post('/api/chat', (req, res) => {
    const { username, text } = req.body;
    if (!text || text.trim() === '') {
        return res.status(400).json({ error: "Message text cannot be empty" });
    }

    const newMessage = {
        id: Date.now().toString(),
        username: username || "Anonymous",
        text: text.trim(),
        timestamp: Date.now()
    };

    globalChatMessages.push(newMessage);
    if (globalChatMessages.length > 50) {
        globalChatMessages.shift();
    }

    res.json({ success: true, message: newMessage });
});

app.get('/api/configs/:name', (req, res) => {
    const configName = req.params.name;
    if (cloudConfigs.has(configName)) {
        res.json({ success: true, data: cloudConfigs.get(configName) });
    } else {
        res.status(404).json({ error: "Config not found" });
    }
});

app.post('/api/configs/:name', (req, res) => {
    const configName = req.params.name;
    const configData = req.body;

    if (!configData || Object.keys(configData).length === 0) {
        return res.status(400).json({ error: "Invalid config data" });
    }

    cloudConfigs.set(configName, configData);
    res.json({ success: true, message: `Config '${configName}' saved` });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
