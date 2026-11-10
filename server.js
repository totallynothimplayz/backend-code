
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

const DATA_FILE = process.env.DATA_FILE ||
    path.join(__dirname, 'data', 'cloud-data.json');

const CHAT_LIMIT = 100;
const PRESENCE_TIMEOUT = 60000;
const MAX_HEARTBEAT_INTERVAL = 90000;

let configs = [];
let messages = [];
let leaderboard = [];
let nextMessageId = 1;

const presence = new Map();

function str(value, fallback = '') {
    return typeof value === 'string'
        ? value.trim()
        : fallback;
}

function loadData() {
    try {
        const data = JSON.parse(
            fs.readFileSync(DATA_FILE, 'utf8')
        );

        configs = Array.isArray(data.configs)
            ? data.configs
            : [];

        messages = Array.isArray(data.messages)
            ? data.messages
            : [];

        leaderboard = Array.isArray(data.leaderboard)
            ? data.leaderboard
            : [];

        nextMessageId = Number(data.nextMessageId) || 1;

        for (const player of leaderboard) {
            player.Identity = String(
                player.Identity ||
                player.identity ||
                'anonymous'
            );

            player.UserId = Number(player.UserId) || 0;

            player.NamePreview = str(
                player.NamePreview,
                'Anonymous'
            );

            player.TotalSeconds = Math.max(
                0,
                Number(
                    player.TotalSeconds ??
                    player.Seconds ??
                    player.OnlineTime ??
                    player.Time ??
                    0
                ) || 0
            );

            player.LastSeen = Number(player.LastSeen) || 0;
            player.CreatedAt = Number(player.CreatedAt) || Date.now();
        }

        if (messages.length > 0) {
            nextMessageId = Math.max(
                nextMessageId,
                ...messages.map(m => Number(m.Id) || 0)
            ) + 1;
        }

    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('Load error:', error.message);
        }

        configs = [];
        messages = [];
        leaderboard = [];
        nextMessageId = 1;
    }
}

function saveData() {
    try {
        fs.mkdirSync(path.dirname(DATA_FILE), {
            recursive: true
        });

        const temp = DATA_FILE + '.tmp';

        fs.writeFileSync(temp, JSON.stringify({
            configs,
            messages,
            leaderboard,
            nextMessageId
        }, null, 2));

        fs.renameSync(temp, DATA_FILE);

    } catch (error) {
        console.error('Save error:', error.message);
    }
}

function getIdentity(req) {
    return str(
        req.headers['x-nullui-identity'] ||
        req.headers['x-user-id'] ||
        req.body?.Identity ||
        req.body?.identity ||
        req.body?.UserId ||
        req.body?.userId,
        'anonymous'
    ).slice(0, 128);
}

function getScript(req) {
    return str(
        req.headers['x-nullui-script'] ||
        req.body?.Script ||
        req.body?.script,
        'default'
    ).slice(0, 128);
}

function getPayload(body) {
    if (!body || typeof body !== 'object') {
        return null;
    }

    return body.Data ??
        body.data ??
        body.Config ??
        body.config ??
        body;
}

function publicConfig(item) {
    return {
        Id: item.id,
        id: item.id,
        Name: item.name,
        name: item.name,
        Title: item.name,
        title: item.name,
        Description: item.description,
        description: item.description,
        Tags: item.tags || [],
        tags: item.tags || [],
        Script: item.script,
        script: item.script,
        Author: item.author,
        author: item.author,
        CreatedAt: item.createdAt,
        createdAt: item.createdAt,
        UpdatedAt: item.updatedAt,
        updatedAt: item.updatedAt,
        Likes: item.likes,
        likes: item.likes,
        Downloads: item.downloads,
        downloads: item.downloads,
        ShareCode: item.shareCode,
        shareCode: item.shareCode,
        Data: item.data,
        data: item.data
    };
}

function findConfig(id) {
    return configs.find(item =>
        item.id === id ||
        item.shareCode === id
    );
}

function findPlayer(identity) {
    return leaderboard.find(
        player => player.Identity === identity
    );
}

function getOrCreatePlayer(req, identity) {
    let player = findPlayer(identity);

    if (!player) {
        player = {
            Identity: identity,
            UserId: Number(req.body?.UserId) || 0,
            NamePreview: str(
                req.body?.NamePreview,
                'Anonymous'
            ).slice(0, 64),
            TotalSeconds: 0,
            CreatedAt: Date.now(),
            LastSeen: 0
        };

        leaderboard.push(player);
    }

    player.UserId = Number(req.body?.UserId) || player.UserId;

    player.NamePreview = str(
        req.body?.NamePreview,
        player.NamePreview || 'Anonymous'
    ).slice(0, 64);

    player.TotalSeconds = Math.max(
        0,
        Number(player.TotalSeconds) || 0
    );

    return player;
}

function formatPlayer(player, online) {
    const total = Math.max(
        0,
        Math.floor(
            Number(player.TotalSeconds) || 0
        )
    );

    return {
        Identity: player.Identity,
        UserId: player.UserId,
        NamePreview: player.NamePreview,
        Seconds: total,
        TotalSeconds: total,
        OnlineTime: total,
        Time: total,
        IsOnline: Boolean(online),
        LastSeen: player.LastSeen,
        CreatedAt: player.CreatedAt
    };
}

function prunePresence() {
    const currentTime = Date.now();

    for (const [identity, user] of presence.entries()) {
        if (
            currentTime - user.lastSeen >
            PRESENCE_TIMEOUT
        ) {
            presence.delete(identity);
        }
    }
}

function loadPublicConfig(item) {
    return publicConfig(item);
}

loadData();

app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Vind UI Backend Running'
    });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok'
    });
});

app.get('/configs', (req, res) => {
    const query = str(req.query.q).toLowerCase();
    const sort = str(req.query.sort, 'top');

    const limit = Math.min(
        Math.max(parseInt(req.query.limit, 10) || 20, 1),
        100
    );

    let list = configs.filter(item => {
        if (!query) return true;

        const searchable = [
            item.name,
            item.description,
            item.author,
            item.script,
            ...(item.tags || [])
        ].join(' ').toLowerCase();

        return searchable.includes(query);
    });

    if (sort === 'top' || sort === 'popular') {
        list.sort((a, b) =>
            b.likes - a.likes ||
            b.createdAt - a.createdAt
        );
    } else if (sort === 'downloads') {
        list.sort((a, b) =>
            b.downloads - a.downloads
        );
    } else {
        list.sort((a, b) =>
            b.createdAt - a.createdAt
        );
    }

    const cursor = Math.max(
        parseInt(req.query.cursor, 10) || 0,
        0
    );

    const page = list.slice(cursor, cursor + limit);

    const nextCursor = cursor + limit < list.length
        ? String(cursor + limit)
        : null;

    const items = page.map(publicConfig);

    res.json({
        Success: true,
        success: true,
        Items: items,
        items,
        NextCursor: nextCursor,
        nextCursor
    });
});

app.get('/configs/mine', (req, res) => {
    const owner = getIdentity(req);

    const items = configs
        .filter(item => item.owner === owner)
        .map(publicConfig);

    res.json({
        Success: true,
        success: true,
        Items: items,
        items
    });
});

app.get('/configs/code/:shareCode', (req, res) => {
    const item = findConfig(req.params.shareCode);

    if (!item) {
        return res.status(404).json({
            success: false,
            error: 'Config not found'
        });
    }

    const config = publicConfig(item);

    res.json({
        Success: true,
        success: true,
        Id: item.id,
        Name: item.name,
        Description: item.description,
        Tags: item.tags || [],
        Author: item.author,
        Data: item.data,
        data: item.data,
        Config: config,
        config,
        Item: config,
        item: config
    });
});

app.get('/configs/:id', (req, res) => {
    const item = findConfig(req.params.id);

    if (!item) {
        return res.status(404).json({
            success: false,
            error: 'Config not found'
        });
    }

    const config = publicConfig(item);

    res.json({
        Success: true,
        success: true,
        Id: item.id,
        Name: item.name,
        Description: item.description,
        Tags: item.tags || [],
        Author: item.author,
        Data: item.data,
        data: item.data,
        Config: config,
        config,
        Item: config,
        item: config
    });
});

app.post('/configs', (req, res) => {
    const payload = getPayload(req.body);

    if (payload === null || payload === undefined) {
        return res.status(400).json({
            success: false,
            error: 'Invalid config data'
        });
    }

    const owner = getIdentity(req);

    const name = str(
        req.body.Name ||
        req.body.name ||
        req.body.Title ||
        req.body.title,
        'Untitled'
    ).slice(0, 60);

    const description = str(
        req.body.Description ||
        req.body.description
    ).slice(0, 280);

    const tags = Array.isArray(req.body.Tags)
        ? req.body.Tags
            .filter(tag => typeof tag === 'string')
            .slice(0, 8)
        : [];

    const item = {
        id: crypto.randomUUID(),
        shareCode: crypto
            .randomBytes(6)
            .toString('hex')
            .toUpperCase(),
        name,
        description,
        tags,
        script: getScript(req),
        author: owner,
        owner,
        ownerToken: crypto
            .randomBytes(24)
            .toString('hex'),
        data: payload,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        likes: 0,
        downloads: 0,
        likedBy: []
    };

    configs.unshift(item);

    saveData();

    const config = publicConfig(item);

    res.status(201).json({
        Success: true,
        success: true,
        Id: item.id,
        OwnerToken: item.ownerToken,
        id: item.id,
        ownerToken: item.ownerToken,
        ShareCode: item.shareCode,
        shareCode: item.shareCode,
        Item: config,
        item: config,
        Config: config,
        config
    });
});

app.delete('/configs/:id', (req, res) => {
    const index = configs.findIndex(
        item => item.id === req.params.id
    );

    if (index === -1) {
        return res.status(404).json({
            success: false,
            error: 'Config not found'
        });
    }

    const item = configs[index];

    const token = str(
        req.headers['x-nullui-owner-token'] ||
        req.headers['x-nullui-token'] ||
        req.body?.OwnerToken ||
        req.body?.token
    );

    if (
        item.owner !== getIdentity(req) &&
        (!token || token !== item.ownerToken)
    ) {
        return res.status(403).json({
            success: false,
            error: 'Not authorized'
        });
    }

    configs.splice(index, 1);

    saveData();

    res.json({
        Success: true,
        success: true
    });
});

app.post('/configs/:id/like', (req, res) => {
    const item = findConfig(req.params.id);

    if (!item) {
        return res.status(404).json({
            success: false,
            error: 'Config not found'
        });
    }

    const user = getIdentity(req);

    if (!item.likedBy.includes(user)) {
        item.likedBy.push(user);
        item.likes++;
        saveData();
    }

    res.json({
        Success: true,
        success: true,
        Likes: item.likes,
        likes: item.likes
    });
});

app.post('/configs/:id/download', (req, res) => {
    const item = findConfig(req.params.id);

    if (!item) {
        return res.status(404).json({
            success: false,
            error: 'Config not found'
        });
    }

    item.downloads++;

    saveData();

    const config = publicConfig(item);

    res.json({
        Success: true,
        success: true,
        Id: item.id,
        Data: item.data,
        data: item.data,
        Item: config,
        item: config
    });
});

app.get('/api/configs/name/:name', (req, res) => {
    const item = configs.find(config =>
        config.name === req.params.name &&
        config.owner === getIdentity(req)
    );

    if (!item) {
        return res.status(404).json({
            success: false,
            error: 'Config not found'
        });
    }

    res.json({
        success: true,
        data: item.data
    });
});

app.post('/api/configs/name/:name', (req, res) => {
    const payload = getPayload(req.body);

    if (payload === null || payload === undefined) {
        return res.status(400).json({
            success: false,
            error: 'Invalid config'
        });
    }

    const owner = getIdentity(req);
    const name = req.params.name.slice(0, 100);

    let item = configs.find(config =>
        config.name === name &&
        config.owner === owner
    );

    if (item) {
        item.data = payload;
        item.updatedAt = Date.now();
    } else {
        item = {
            id: crypto.randomUUID(),
            shareCode: crypto
                .randomBytes(6)
                .toString('hex')
                .toUpperCase(),
            name,
            description: '',
            tags: [],
            script: getScript(req),
            author: owner,
            owner,
            ownerToken: crypto
                .randomBytes(24)
                .toString('hex'),
            data: payload,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            likes: 0,
            downloads: 0,
            likedBy: []
        };

        configs.unshift(item);
    }

    saveData();

    res.json({
        success: true,
        data: publicConfig(item)
    });
});

app.post('/presence/heartbeat', (req, res) => {
    const identity = getIdentity(req);
    const currentTime = Date.now();

    const player = getOrCreatePlayer(req, identity);
    const previous = presence.get(identity);

    if (previous) {
        const elapsed = currentTime - previous.lastSeen;

        if (
            elapsed > 0 &&
            elapsed <= MAX_HEARTBEAT_INTERVAL
        ) {
            player.TotalSeconds += elapsed / 1000;
        }
    }

    player.LastSeen = currentTime;

    presence.set(identity, {
        Identity: identity,
        UserId: player.UserId,
        NamePreview: player.NamePreview,
        lastSeen: currentTime
    });

    saveData();

    const result = formatPlayer(player, true);

    res.json({
        Success: true,
        success: true,
        Count: presence.size,
        count: presence.size,
        Player: result,
        player: result,
        Seconds: result.Seconds,
        TotalSeconds: result.TotalSeconds
    });
});

app.get('/presence/count', (req, res) => {
    prunePresence();

    res.json({
        Success: true,
        success: true,
        Count: presence.size,
        count: presence.size
    });
});

app.get('/presence/leaderboard', (req, res) => {
    prunePresence();

    const online = new Set(presence.keys());

    const limit = Math.min(
        Math.max(parseInt(req.query.limit, 10) || 10, 1),
        100
    );

    const items = leaderboard
        .map(player => formatPlayer(
            player,
            online.has(player.Identity)
        ))
        .sort((a, b) =>
            b.Seconds - a.Seconds
        )
        .slice(0, limit);

    res.json({
        Success: true,
        success: true,
        Items: items,
        items,
        Players: items,
        players: items,
        Leaderboard: items,
        leaderboard: items,
        Count: items.length,
        count: items.length
    });
});

function createMessage(req) {
    const body = req.body || {};

    const text = str(
        body.Text ||
        body.text ||
        body.Message ||
        body.message
    ).slice(0, 1000);

    if (!text) return null;

    const identity = getIdentity(req);

    return {
        Id: nextMessageId++,
        UserId: Number(body.UserId) || 0,
        Identity: identity,
        Username: identity,
        Text: text,
        CreatedAt: Date.now()
    };
}

app.post('/chat/send', (req, res) => {
    const message = createMessage(req);

    if (!message) {
        return res.status(400).json({
            success: false,
            error: 'Message text required'
        });
    }

    messages.push(message);

    if (messages.length > CHAT_LIMIT) {
        messages = messages.slice(-CHAT_LIMIT);
    }

    saveData();

    res.json({
        Success: true,
        success: true,
        Id: message.Id,
        UserId: message.UserId,
        Identity: message.Identity,
        Username: message.Username,
        Text: message.Text,
        CreatedAt: message.CreatedAt
    });
});

app.get('/chat', (req, res) => {
    const since = Number(req.query.since) || 0;

    const result = messages.filter(
        message => message.Id > since
    );

    res.json({
        Success: true,
        success: true,
        Messages: result,
        messages: result
    });
});

app.post('/chat/:id/report', (req, res) => {
    const id = Number(req.params.id);

    const message = messages.find(
        item => item.Id === id
    );

    if (!message) {
        return res.status(404).json({
            success: false,
            error: 'Message not found'
        });
    }

    console.log('Chat report:', {
        messageId: id,
        reporter: getIdentity(req),
        text: message.Text
    });

    res.json({
        Success: true,
        success: true,
        message: 'Report received'
    });
});

app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        path: req.path
    });
});

app.use((error, req, res, next) => {
    console.error('Request error:', error.message);

    res.status(error.status || 500).json({
        success: false,
        error: error.status === 413
            ? 'Request too large'
            : 'Internal server error'
    });
});

const PORT = Number(process.env.PORT) || 10000;

const server = app.listen(
    PORT,
    '0.0.0.0',
    () => {
        console.log(
            `Vind UI backend listening on port ${PORT}`
        );
    }
);

function shutdown() {
    server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
