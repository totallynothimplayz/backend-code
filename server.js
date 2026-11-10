
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "cloud-data.json");

const HEARTBEAT_TIMEOUT = 60 * 1000;
const MAX_HEARTBEAT_INTERVAL = 90 * 1000;

let data = {
    configs: [],
    messages: [],
    leaderboard: [],
    nextConfigId: 1,
    nextMessageId: 1
};

const presence = new Map();

function now() {
    return Date.now();
}

function makeId() {
    return `${now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function saveData() {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });

        const temporaryFile = DATA_FILE + ".tmp";

        fs.writeFileSync(
            temporaryFile,
            JSON.stringify(data, null, 2),
            "utf8"
        );

        fs.renameSync(temporaryFile, DATA_FILE);

        return true;
    } catch (error) {
        console.error("Failed to save data:", error);
        return false;
    }
}

function loadData() {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });

        if (!fs.existsSync(DATA_FILE)) {
            saveData();
            return;
        }

        const loaded = JSON.parse(
            fs.readFileSync(DATA_FILE, "utf8")
        );

        data.configs = Array.isArray(loaded.configs)
            ? loaded.configs
            : [];

        data.messages = Array.isArray(loaded.messages)
            ? loaded.messages
            : [];

        data.leaderboard = Array.isArray(loaded.leaderboard)
            ? loaded.leaderboard
            : [];

        data.nextConfigId =
            Number(loaded.nextConfigId) || 1;

        data.nextMessageId =
            Number(loaded.nextMessageId) || 1;

        for (const player of data.leaderboard) {
            player.Identity = String(
                player.Identity || player.identity || ""
            );

            player.UserId =
                player.UserId ?? player.userId ?? null;

            player.NamePreview = String(
                player.NamePreview ||
                player.Username ||
                player.username ||
                "Unknown"
            );

            player.TotalSeconds = Math.max(
                0,
                Number(
                    player.TotalSeconds ??
                    player.totalSeconds ??
                    player.Time ??
                    0
                ) || 0
            );

            player.LastSeen = Number(
                player.LastSeen || 0
            );

            player.CreatedAt = Number(
                player.CreatedAt || now()
            );
        }

        console.log("Data loaded successfully.");
    } catch (error) {
        console.error("Failed to load data:", error);
        throw error;
    }
}

function getIdentity(req) {
    const body = req.body || {};

    const identity =
        body.Identity ||
        body.identity ||
        body.UserId ||
        body.userId ||
        body.Username ||
        body.username;

    if (identity === undefined || identity === null) {
        return null;
    }

    const result = String(identity).trim();

    if (!result || result.length > 200) {
        return null;
    }

    return result;
}

function getPlayerName(req) {
    const body = req.body || {};

    return String(
        body.NamePreview ||
        body.Username ||
        body.username ||
        body.Name ||
        body.name ||
        "Unknown"
    ).slice(0, 100);
}

function getUserId(req) {
    const body = req.body || {};

    return body.UserId ??
        body.userId ??
        null;
}

function findLeaderboardPlayer(identity) {
    return data.leaderboard.find(
        player => player.Identity === identity
    );
}

function getOrCreateLeaderboardPlayer(req, identity) {
    let player = findLeaderboardPlayer(identity);

    if (!player) {
        player = {
            Identity: identity,
            UserId: getUserId(req),
            NamePreview: getPlayerName(req),
            TotalSeconds: 0,
            CreatedAt: now(),
            LastSeen: 0
        };

        data.leaderboard.push(player);
    }

    if (getUserId(req) !== null) {
        player.UserId = getUserId(req);
    }

    const name = getPlayerName(req);

    if (name !== "Unknown") {
        player.NamePreview = name;
    }

    return player;
}

function formatPlayer(player, isOnline) {
    const totalSeconds = Math.max(
        0,
        Math.floor(Number(player.TotalSeconds) || 0)
    );

    return {
        Identity: player.Identity,
        UserId: player.UserId,
        NamePreview: player.NamePreview,
        TotalSeconds: totalSeconds,
        OnlineTime: totalSeconds,
        Time: totalSeconds,
        IsOnline: Boolean(isOnline),
        LastSeen: player.LastSeen || 0,
        CreatedAt: player.CreatedAt || 0
    };
}

function cleanExpiredPresence() {
    const currentTime = now();

    for (const [identity, session] of presence.entries()) {
        if (
            currentTime - session.lastSeen >
            HEARTBEAT_TIMEOUT
        ) {
            presence.delete(identity);
        }
    }
}

function getPublicConfig(config) {
    return {
        Id: config.Id,
        id: config.Id,
        Name: config.Name,
        name: config.Name,
        Username: config.Username,
        username: config.Username,
        Identity: config.Identity,
        identity: config.Identity,
        Description: config.Description || "",
        description: config.Description || "",
        Code: config.Code || "",
        code: config.Code || "",
        ShareCode: config.ShareCode,
        shareCode: config.ShareCode,
        CreatedAt: config.CreatedAt,
        createdAt: config.CreatedAt,
        Likes: config.Likes || 0,
        likes: config.Likes || 0,
        Downloads: config.Downloads || 0,
        downloads: config.Downloads || 0,
        Published: Boolean(config.Published),
        published: Boolean(config.Published)
    };
}

function getPublicMessage(message) {
    return {
        Id: message.Id,
        UserId: message.UserId,
        Identity: message.Identity,
        Username: message.Username,
        Text: message.Text,
        CreatedAt: message.CreatedAt
    };
}

function getConfigById(id) {
    return data.configs.find(
        config => String(config.Id) === String(id)
    );
}

function getConfigByShareCode(code) {
    return data.configs.find(
        config => config.ShareCode === String(code)
    );
}

function getRequestValue(req, ...keys) {
    for (const key of keys) {
        if (req.body && req.body[key] !== undefined) {
            return req.body[key];
        }

        if (req.query && req.query[key] !== undefined) {
            return req.query[key];
        }
    }

    return undefined;
}

app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "Cloud backend online",
        version: "2.0"
    });
});

app.get("/health", (req, res) => {
    res.json({
        success: true,
        status: "online"
    });
});

app.get("/configs", (req, res) => {
    let configs = data.configs.filter(
        config => config.Published
    );

    const search = String(
        req.query.search || ""
    ).toLowerCase();

    if (search) {
        configs = configs.filter(config =>
            String(config.Name || "")
                .toLowerCase()
                .includes(search) ||
            String(config.Username || "")
                .toLowerCase()
                .includes(search)
        );
    }

    const sort = String(
        req.query.sort || "newest"
    ).toLowerCase();

    if (sort === "likes") {
        configs.sort(
            (a, b) => (b.Likes || 0) - (a.Likes || 0)
        );
    } else if (sort === "downloads") {
        configs.sort(
            (a, b) =>
                (b.Downloads || 0) -
                (a.Downloads || 0)
        );
    } else {
        configs.sort(
            (a, b) =>
                (b.CreatedAt || 0) -
                (a.CreatedAt || 0)
        );
    }

    const result = configs.map(getPublicConfig);

    res.json({
        success: true,
        Configs: result,
        configs: result
    });
});

app.get("/configs/mine", (req, res) => {
    const identity = String(
        req.query.Identity ||
        req.query.identity ||
        req.query.UserId ||
        req.query.userId ||
        ""
    );

    const configs = data.configs.filter(
        config => config.Identity === identity
    );

    const result = configs.map(getPublicConfig);

    res.json({
        success: true,
        Configs: result,
        configs: result
    });
});

app.get("/configs/code/:shareCode", (req, res) => {
    const config = getConfigByShareCode(
        req.params.shareCode
    );

    if (!config) {
        return res.status(404).json({
            success: false,
            error: "Config not found"
        });
    }

    const result = getPublicConfig(config);

    res.json({
        success: true,
        Config: result,
        config: result
    });
});

app.get("/configs/:id", (req, res) => {
    const config = getConfigById(req.params.id);

    if (!config) {
        return res.status(404).json({
            success: false,
            error: "Config not found"
        });
    }

    const result = getPublicConfig(config);

    res.json({
        success: true,
        Config: result,
        config: result
    });
});

app.post("/configs", (req, res) => {
    const identity = getIdentity(req);

    if (!identity) {
        return res.status(400).json({
            success: false,
            error: "Identity is required"
        });
    }

    const name = String(
        getRequestValue(req, "Name", "name") ||
        "Untitled"
    ).slice(0, 100);

    const code = String(
        getRequestValue(req, "Code", "code") ||
        ""
    );

    const description = String(
        getRequestValue(req, "Description", "description") ||
        ""
    ).slice(0, 1000);

    const config = {
        Id: data.nextConfigId++,
        Name: name,
        Username: getPlayerName(req),
        Identity: identity,
        UserId: getUserId(req),
        Description: description,
        Code: code,
        ShareCode: makeId(),
        CreatedAt: now(),
        Likes: 0,
        Downloads: 0,
        Published: Boolean(
            getRequestValue(req, "Published", "published")
        )
    };

    data.configs.push(config);

    saveData();

    const result = getPublicConfig(config);

    res.json({
        success: true,
        Config: result,
        config: result,
        Id: config.Id,
        id: config.Id
    });
});

app.delete("/configs/:id", (req, res) => {
    const identity = getIdentity(req);

    const index = data.configs.findIndex(
        config =>
            String(config.Id) === String(req.params.id)
    );

    if (index === -1) {
        return res.status(404).json({
            success: false,
            error: "Config not found"
        });
    }

    const config = data.configs[index];

    if (
        identity &&
        config.Identity !== identity
    ) {
        return res.status(403).json({
            success: false,
            error: "Not your config"
        });
    }

    data.configs.splice(index, 1);

    saveData();

    res.json({
        success: true
    });
});

app.post("/configs/:id/publish", (req, res) => {
    const config = getConfigById(req.params.id);

    if (!config) {
        return res.status(404).json({
            success: false,
            error: "Config not found"
        });
    }

    const identity = getIdentity(req);

    if (
        identity &&
        identity !== config.Identity
    ) {
        return res.status(403).json({
            success: false,
            error: "Not your config"
        });
    }

    config.Published = true;

    saveData();

    res.json({
        success: true,
        Config: getPublicConfig(config)
    });
});

app.post("/configs/:id/like", (req, res) => {
    const config = getConfigById(req.params.id);

    if (!config) {
        return res.status(404).json({
            success: false,
            error: "Config not found"
        });
    }

    config.Likes = (config.Likes || 0) + 1;

    saveData();

    res.json({
        success: true,
        Likes: config.Likes,
        likes: config.Likes
    });
});

app.post("/configs/:id/download", (req, res) => {
    const config = getConfigById(req.params.id);

    if (!config) {
        return res.status(404).json({
            success: false,
            error: "Config not found"
        });
    }

    config.Downloads = (config.Downloads || 0) + 1;

    saveData();

    res.json({
        success: true,
        Config: getPublicConfig(config),
        config: getPublicConfig(config),
        Code: config.Code,
        code: config.Code
    });
});

app.get("/api/configs/:name", (req, res) => {
    const identity = String(
        req.query.Identity ||
        req.query.identity ||
        ""
    );

    const config = data.configs.find(
        item =>
            item.Name === req.params.name &&
            (!identity || item.Identity === identity)
    );

    if (!config) {
        return res.status(404).json({
            success: false,
            error: "Config not found"
        });
    }

    res.json({
        success: true,
        config: getPublicConfig(config)
    });
});

app.post("/api/configs/:name", (req, res) => {
    const identity = getIdentity(req);

    if (!identity) {
        return res.status(400).json({
            success: false,
            error: "Identity is required"
        });
    }

    const name = String(req.params.name).slice(0, 100);

    let config = data.configs.find(
        item =>
            item.Name === name &&
            item.Identity === identity
    );

    if (config) {
        config.Code = String(
            getRequestValue(req, "Code", "code") || ""
        );

        config.Description = String(
            getRequestValue(req, "Description", "description") ||
            ""
        );

        config.CreatedAt = now();
    } else {
        config = {
            Id: data.nextConfigId++,
            Name: name,
            Username: getPlayerName(req),
            Identity: identity,
            UserId: getUserId(req),
            Description: String(
                getRequestValue(req, "Description", "description") ||
                ""
            ),
            Code: String(
                getRequestValue(req, "Code", "code") || ""
            ),
            ShareCode: makeId(),
            CreatedAt: now(),
            Likes: 0,
            Downloads: 0,
            Published: false
        };

        data.configs.push(config);
    }

    saveData();

    res.json({
        success: true,
        config: getPublicConfig(config)
    });
});

app.get("/chat", (req, res) => {
    const limit = Math.max(
        1,
        Math.min(
            Number(req.query.limit) || 100,
            500
        )
    );

    const messages = data.messages
        .slice(-limit)
        .map(getPublicMessage);

    res.json({
        success: true,
        Messages: messages,
        messages: messages
    });
});

app.get("/chat/history", (req, res) => {
    const limit = Math.max(
        1,
        Math.min(
            Number(req.query.limit) || 100,
            500
        )
    );

    const messages = data.messages
        .slice(-limit)
        .map(getPublicMessage);

    res.json({
        success: true,
        Messages: messages,
        messages: messages
    });
});

app.post("/chat/send", (req, res) => {
    const identity = getIdentity(req);

    if (!identity) {
        return res.status(400).json({
            success: false,
            error: "Identity is required"
        });
    }

    const text = String(
        getRequestValue(
            req,
            "Text",
            "text",
            "Message",
            "message"
        ) || ""
    ).trim();

    if (!text) {
        return res.status(400).json({
            success: false,
            error: "Message is empty"
        });
    }

    if (text.length > 2000) {
        return res.status(400).json({
            success: false,
            error: "Message is too long"
        });
    }

    const message = {
        Id: data.nextMessageId++,
        UserId: getUserId(req),
        Identity: identity,
        Username: getPlayerName(req),
        Text: text,
        CreatedAt: now()
    };

    data.messages.push(message);

    if (data.messages.length > 1000) {
        data.messages = data.messages.slice(-1000);
    }

    saveData();

    const publicMessage = getPublicMessage(message);

    res.json({
        success: true,
        ...publicMessage,
        Message: publicMessage,
        message: publicMessage
    });
});

app.post("/presence/heartbeat", (req, res) => {
    const identity = getIdentity(req);

    if (!identity) {
        return res.status(400).json({
            success: false,
            error: "Identity is required"
        });
    }

    const currentTime = now();

    const player = getOrCreateLeaderboardPlayer(
        req,
        identity
    );

    const previous = presence.get(identity);

    let addedSeconds = 0;

    if (previous) {
        const elapsed = currentTime - previous.lastSeen;

        if (
            elapsed > 0 &&
            elapsed <= MAX_HEARTBEAT_INTERVAL
        ) {
            addedSeconds = elapsed / 1000;
        }
    }

    player.TotalSeconds =
        Math.max(0, Number(player.TotalSeconds) || 0) +
        addedSeconds;

    player.LastSeen = currentTime;

    presence.set(identity, {
        Identity: identity,
        UserId: player.UserId,
        NamePreview: player.NamePreview,
        lastSeen: currentTime
    });

    saveData();

    const publicPlayer = formatPlayer(
        player,
        true
    );

    res.json({
        success: true,
        Player: publicPlayer,
        player: publicPlayer,
        Identity: identity,
        TotalSeconds: publicPlayer.TotalSeconds,
        OnlineTime: publicPlayer.OnlineTime,
        Time: publicPlayer.Time
    });
});

app.get("/presence/count", (req, res) => {
    cleanExpiredPresence();

    res.json({
        success: true,
        Count: presence.size,
        count: presence.size
    });
});

app.get("/presence/leaderboard", (req, res) => {
    cleanExpiredPresence();

    const onlineIdentities = new Set(
        presence.keys()
    );

    const players = data.leaderboard
        .map(player => {
            const online = onlineIdentities.has(
                player.Identity
            );

            return formatPlayer(
                player,
                online
            );
        })
        .sort(
            (a, b) =>
                b.TotalSeconds - a.TotalSeconds
        );

    const limit = Math.max(
        1,
        Math.min(
            Number(req.query.limit) || 100,
            500
        )
    );

    const result = players.slice(0, limit);

    res.json({
        success: true,
        Players: result,
        players: result,
        Leaderboard: result,
        leaderboard: result
    });
});

app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: "Route not found",
        path: req.path
    });
});

app.use((error, req, res, next) => {
    console.error("Server error:", error);

    res.status(500).json({
        success: false,
        error: "Internal server error"
    });
});

loadData();

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Cloud backend running on port ${PORT}`);
});
