
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
app.use(express.text({ limit: '2mb' }));

const DATA_FILE = process.env.DATA_FILE ||
    path.join(__dirname, 'data', 'cloud-data.json');

const CHAT_LIMIT = 100;
const PRESENCE_TTL = 60_000;

let configs = [];
let messages = [];
const presence = new Map();

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

    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('Data load failed:', error.message);
        }

        configs = [];
        messages = [];
    }
}

function persist() {
    try {
        fs.mkdirSync(path.dirname(DATA_FILE), {
            recursive: true
        });

        const temp = `${DATA_FILE}.tmp`;

        fs.writeFileSync(
            temp,
            JSON.stringify({
                configs,
                messages
            }, null, 2)
        );

        fs.renameSync(temp, DATA_FILE);

    } catch (error) {
        console.error('Data save failed:', error.message);
    }
}

function str(value, fallback = '') {
    return typeof value === 'string'
        ? value.trim()
        : fallback;
}

function identity(req) {
    return str(
        req.headers['x-nullui-identity'] ||
        req.headers['x-user-id'] ||
        req.body?.UserId ||
        req.body?.userId ||
        req.body?.Username ||
        req.body?.username,
        'anonymous'
    ).slice(0, 128);
}

function scriptName(req) {
    return str(
        req.headers['x-nullui-script'] ||
        req.body?.Script ||
        req.body?.script,
        'unknown'
    ).slice(0, 128);
}

function payloadFrom(body) {
    if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body)
    ) {
        return null;
    }

    return body.config ??
        body.Config ??
        body.data ??
        body.Data ??
        body;
}

function publicConfig(config) {
    return {
        id: config.id,
        name: config.name,
        title: config.name,
        description: config.description,
        script: config.script,
        author: config.author,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
        likes: config.likes,
        downloads: config.downloads,
        shareCode: config.shareCode,
        data: config.data
    };
}

function findConfig(key) {
    return configs.find(item =>
        item.id === key ||
        item.shareCode === key
    );
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

// CONFIG BROWSING

function listConfigs(req, res) {
    const query = str(req.query.q).toLowerCase();

    const sort = str(
        req.query.sort,
        'new'
    );

    const limit = Math.min(
        Math.max(
            parseInt(req.query.limit, 10) || 20,
            1
        ),
        100
    );

    let list = configs.filter(item => {
        if (!query) return true;

        const searchable = [
            item.name,
            item.description || '',
            item.author || '',
            item.script || ''
        ].join(' ').toLowerCase();

        return searchable.includes(query);
    });

    if (
        sort === 'top' ||
        sort === 'popular'
    ) {
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

    const offset = Math.max(
        parseInt(req.query.cursor, 10) || 0,
        0
    );

    const page = list
        .slice(offset, offset + limit)
        .map(publicConfig);

    const next = offset + limit < list.length
        ? String(offset + limit)
        : null;

    res.json({
        success: true,
        Items: page,
        items: page,
        NextCursor: next,
        nextCursor: next
    });
}

app.get(
    ['/configs', '/api/configs'],
    listConfigs
);

// MY CONFIGS

app.get(
    ['/configs/mine', '/api/configs/mine'],
    (req, res) => {
        const mine = configs
            .filter(item => item.owner === identity(req))
            .map(publicConfig);

        res.json({
            success: true,
            Items: mine,
            items: mine
        });
    }
);

// LOAD CONFIG BY SHARE CODE

app.get(
    [
        '/configs/code/:shareCode',
        '/api/configs/code/:shareCode'
    ],
    (req, res) => {
        const item = findConfig(
            req.params.shareCode
        );

        if (!item) {
            return res.status(404).json({
                success: false,
                error: 'Config not found'
            });
        }

        res.json({
            success: true,
            data: item.data,
            config: publicConfig(item),
            item: publicConfig(item)
        });
    }
);

// LOAD CONFIG BY ID

app.get(
    ['/configs/:id', '/api/configs/:id'],
    (req, res) => {
        const item = findConfig(
            req.params.id
        );

        if (!item) {
            return res.status(404).json({
                success: false,
                error: 'Config not found'
            });
        }

        res.json({
            success: true,
            data: item.data,
            config: publicConfig(item),
            item: publicConfig(item)
        });
    }
);

// PUBLISH CONFIG

app.post(
    ['/configs', '/api/configs'],
    (req, res) => {
        const data = payloadFrom(req.body);

        if (
            data === null ||
            data === undefined
        ) {
            return res.status(400).json({
                success: false,
                error: 'Invalid config data'
            });
        }

        const owner = identity(req);

        const name = str(
            req.body?.name ||
            req.body?.Name ||
            req.body?.title ||
            req.body?.Title,
            'Untitled config'
        ).slice(0, 100);

        const item = {
            id: crypto.randomUUID(),

            shareCode: crypto
                .randomBytes(6)
                .toString('hex')
                .toUpperCase(),

            name,

            description: str(
                req.body?.description ||
                req.body?.Description
            ).slice(0, 500),

            script: scriptName(req),

            author: owner,
            owner,

            ownerToken: crypto
                .randomBytes(24)
                .toString('hex'),

            data,

            createdAt: Date.now(),
            updatedAt: Date.now(),

            likes: 0,
            downloads: 0,
            likedBy: []
        };

        configs.unshift(item);

        persist();

        res.status(201).json({
            success: true,
            message: 'Config published',
            id: item.id,
            shareCode: item.shareCode,
            token: item.ownerToken,
            data: publicConfig(item),
            config: publicConfig(item),
            item: publicConfig(item)
        });
    }
);

// DELETE CONFIG

app.delete(
    ['/configs/:id', '/api/configs/:id'],
    (req, res) => {
        const index = configs.findIndex(
            item => item.id === req.params.id
        );

        if (index < 0) {
            return res.status(404).json({
                success: false,
                error: 'Config not found'
            });
        }

        const item = configs[index];

        const token = str(
            req.headers['x-nullui-token'] ||
            req.body?.token ||
            req.body?.Token
        );

        if (
            item.owner !== identity(req) &&
            (!token || token !== item.ownerToken)
        ) {
            return res.status(403).json({
                success: false,
                error: 'Not authorized to delete this config'
            });
        }

        configs.splice(index, 1);

        persist();

        res.json({
            success: true,
            message: 'Config deleted'
        });
    }
);

// LIKE CONFIG

app.post(
    [
        '/configs/:id/like',
        '/api/configs/:id/like'
    ],
    (req, res) => {
        const item = findConfig(
            req.params.id
        );

        if (!item) {
            return res.status(404).json({
                success: false,
                error: 'Config not found'
            });
        }

        const user = identity(req);

        if (!item.likedBy.includes(user)) {
            item.likedBy.push(user);
            item.likes += 1;

            persist();
        }

        res.json({
            success: true,
            likes: item.likes,
            Likes: item.likes
        });
    }
);

// DOWNLOAD CONFIG

app.post(
    [
        '/configs/:id/download',
        '/api/configs/:id/download'
    ],
    (req, res) => {
        const item = findConfig(
            req.params.id
        );

        if (!item) {
            return res.status(404).json({
                success: false,
                error: 'Config not found'
            });
        }

        item.downloads += 1;

        persist();

        res.json({
            success: true,
            data: item.data,
            config: publicConfig(item),
            item: publicConfig(item)
        });
    }
);

// LEGACY NAMED CONFIG API

app.get(
    '/api/configs/name/:name',
    (req, res) => {
        const item = configs.find(config =>
            config.name === req.params.name &&
            config.owner === identity(req)
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
    }
);

app.post(
    '/api/configs/name/:name',
    (req, res) => {
        const data = payloadFrom(req.body);

        if (
            data === null ||
            data === undefined
        ) {
            return res.status(400).json({
                success: false,
                error: 'Invalid config data'
            });
        }

        const owner = identity(req);

        const name = req.params.name.slice(
            0,
            100
        );

        let item = configs.find(config =>
            config.name === name &&
            config.owner === owner
        );

        if (item) {
            item.data = data;
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
                script: scriptName(req),

                author: owner,
                owner,

                ownerToken: crypto
                    .randomBytes(24)
                    .toString('hex'),

                data,

                createdAt: Date.now(),
                updatedAt: Date.now(),

                likes: 0,
                downloads: 0,
                likedBy: []
            };

            configs.unshift(item);
        }

        persist();

        res.json({
            success: true,
            message: `Config '${name}' saved`,
            data: publicConfig(item)
        });
    }
);

// PRESENCE

function heartbeat(req, res) {
    presence.set(identity(req), {
        lastSeen: Date.now(),
        script: scriptName(req)
    });

    res.json({
        success: true,
        count: presence.size,
        online: presence.size
    });
}

function prunePresence() {
    const now = Date.now();

    for (const [user, value] of presence) {
        if (
            now - value.lastSeen >
            PRESENCE_TTL
        ) {
            presence.delete(user);
        }
    }
}

app.post(
    [
        '/presence/heartbeat',
        '/api/heartbeat'
    ],
    heartbeat
);

app.get(
    ['/presence/count', '/api/users'],
    (req, res) => {
        prunePresence();

        res.json({
            success: true,
            count: presence.size,
            online: presence.size
        });
    }
);

app.get(
    '/presence/leaderboard',
    (req, res) => {
        prunePresence();

        const users = [...presence.keys()];

        res.json({
            success: true,
            Items: users,
            items: users,
            count: users.length,
            online: users.length
        });
    }
);

// CHAT

function handleChat(req, res) {
    const body = typeof req.body === 'string'
        ? { text: req.body }
        : (req.body || {});

    const text = str(
        body.Text ||
        body.text ||
        body.Message ||
        body.message ||
        body.Content ||
        body.content ||
        body.msg ||
        body.input ||
        body.value ||
        req.query.text
    ).slice(0, 1000);

    if (!text) {
        return res.status(400).json({
            success: false,
            error: 'Message text is required'
        });
    }

    const userId = identity(req);

    const username = str(
        body.Username ||
        body.username ||
        body.Player ||
        body.UserName,
        userId
    ).slice(0, 64);

    const message = {
        id: crypto.randomUUID(),

        UserId: userId,
        userId,

        Username: username,
        username,

        Text: text,
        text,

        timestamp: Date.now()
    };

    messages.push(message);

    if (messages.length > CHAT_LIMIT) {
        messages = messages.slice(-CHAT_LIMIT);
    }

    persist();

    res.json({
        success: true,
        message,
        Messages: messages,
        messages
    });
}

app.post(
    [
        '/chat/send',
        '/api/chat/send',
        '/api/chat',
        '/chat'
    ],
    handleChat
);

app.get(
    ['/chat', '/api/chat'],
    (req, res) => {
        const since = Number(
            req.query.since ||
            req.query.Since ||
            0
        );

        const result =
            Number.isFinite(since) && since > 0
                ? messages.filter(item =>
                    item.timestamp > since
                )
                : messages;

        res.json({
            success: true,
            Messages: result,
            messages: result
        });
    }
);

// ERRORS

app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        path: req.path
    });
});

app.use((err, req, res, next) => {
    console.error('Request error:', err.message);

    res.status(err.status || 500).json({
        success: false,
        error: err.status === 413
            ? 'Request too large'
            : 'Internal server error'
    });
});

// RENDER

const PORT = Number(process.env.PORT) || 10000;

const server = app.listen(
    PORT,
    '0.0.0.0',
    () => {
        console.log(
            `Vind UI backend listening on 0.0.0.0:${PORT}`
        );
    }
);

function shutdown() {
    server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
