// Stock Training System - API + web server
// IFT 401 Capstone (Feeley / Foster / Frazier)
//
// Serves the HTML/CSS pages from the repo root and the JSON API under /api.
// Start with:  cd server && npm install && npm start

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const session = require('express-session');

const db = require('./db');
const authRoutes = require('./routes/auth');
const stockRoutes = require('./routes/stocks');
const cashRoutes = require('./routes/cash');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SITE_ROOT = path.join(__dirname, '..');

// Trust the nginx/Apache proxy in front of us so cookies and IPs behave.
app.set('trust proxy', 1);

app.use(express.json({ limit: '50kb' }));

app.use(session({
    name: 'sts.sid',
    secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,              // the site runs over plain HTTP for now
        maxAge: 8 * 60 * 60 * 1000  // 8 hours
    }
}));

// --- API ---
app.get('/api/health', async (req, res) => {
    try {
        await db.query('SELECT 1');
        res.json({ ok: true, database: 'connected' });
    } catch (err) {
        res.status(500).json({ ok: false, database: err.code || err.message });
    }
});

app.use('/api', authRoutes);
app.use('/api', stockRoutes);
app.use('/api', cashRoutes);

app.use('/api', (req, res) => {
    res.status(404).json({ error: `No API route for ${req.method} ${req.path}` });
});

// --- Static pages (the HTML/CSS files in the repo root) ---
// Never serve the server code, secrets, keys, or git data.
const BLOCKED = /(^|\/)(server|node_modules|\.git)(\/|$)|\.(pem|env|md|sql|json)$/i;
app.use((req, res, next) => {
    if (BLOCKED.test(req.path)) return res.status(404).send('Not found');
    next();
});
app.use(express.static(SITE_ROOT, { index: 'index.html', extensions: ['html'] }));

app.use((req, res) => res.status(404).send('Page not found'));

app.listen(PORT, () => {
    console.log(`Stock Training System server listening on port ${PORT}`);
    console.log(`Pages served from ${SITE_ROOT}`);
    db.query('SELECT 1')
        .then(() => console.log(`[db] Connected to ${process.env.DB_HOST}, database "${db.name()}"`))
        .catch((err) => console.warn('[db] Not connected yet:', err.code || err.message));
});
