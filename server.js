const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text());

app.use((req, res, next) => {
    req.url = req.url.replace(/\/+/g, '/');
    next();
});

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

const handleChat = (req, res) => {
    // Debug what the UI library is actually sending
    console.log("Chat POST body:", req.body);

    let text = "";
    let username = "Anonymous";

    if (typeof req.body === 'string') {
        text = req.body;
    } else if (req.body) {
        text = req.body.text || req.body.message || req.body.content || req.body.msg || req.body.Text || req.body.Message;
        username = req.body.username || req.body.Player || req.body.Username || "Anonymous";
        
        // If text is still missing, check if the whole body is just the text string or wrapped differently
        if (!text && typeof req.body === 'object') {
            const values = Object.values(req.body);
            if (values.length > 0 && typeof values[0] === 'string') {
                text = values[0];
            }
        }
    }

    if (!text || typeof text !== 'string' || text.trim() === '') {
        return res.status(400).json({ error: "Message text can't be empty", received: req.body });
    }

    const newMessage = {
        id: Date.now().toString(),
        username: username,
        text: text.trim(),
        timestamp: Date.now()
    };

    globalChatMessages.push(newMessage);
    if (globalChatMessages.length > 50) {
        globalChatMessages.shift();
    }

    res.json({ success: true, message: newMessage, messages: globalChatMessages });
};

app.get('/api/chat', (req, res) => {
    res.json({ messages: globalChatMessages });
});

app.get('/chat', (req, res) => {
    res.json({ messages: globalChatMessages });
});

app.post('/chat/send', handleChat);
app.post('/api/chat/send', handleChat);
app.post('/api/chat', handleChat);
app.post('/chat', handleChat);

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
