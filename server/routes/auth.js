// Account routes: register, login, logout, current user.
// Table used: UserAccount (Email PK, FirstName, LastName, PasswordHash)

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/register  { firstName, lastName, email, password }
router.post('/register', async (req, res) => {
    const { firstName, lastName, email, password } = req.body || {};

    if (!firstName || !lastName || !email || !password) {
        return res.status(400).json({ error: 'All fields are required' });
    }
    const cleanEmail = String(email).trim().toLowerCase();
    if (!EMAIL_PATTERN.test(cleanEmail) || cleanEmail.length > 255) {
        return res.status(400).json({ error: 'Enter a valid email address' });
    }
    if (String(password).length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (String(firstName).trim().length > 50 || String(lastName).trim().length > 50) {
        return res.status(400).json({ error: 'Names must be 50 characters or fewer' });
    }

    try {
        const passwordHash = await bcrypt.hash(String(password), 10);
        await db.query(
            'INSERT INTO UserAccount (Email, FirstName, LastName, PasswordHash) VALUES (?, ?, ?, ?)',
            [cleanEmail, String(firstName).trim(), String(lastName).trim(), passwordHash]
        );
        return res.status(201).json({ message: 'Account created', email: cleanEmail });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'An account with that email already exists' });
        }
        console.error('[register]', err);
        return res.status(500).json({ error: 'Database error while creating the account' });
    }
});

// POST /api/login  { email, password }
router.post('/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }
    const cleanEmail = String(email).trim().toLowerCase();

    try {
        const [rows] = await db.query(
            'SELECT Email, FirstName, LastName, PasswordHash FROM UserAccount WHERE Email = ? LIMIT 1',
            [cleanEmail]
        );
        const account = rows[0];
        const ok = account && await bcrypt.compare(String(password), account.PasswordHash);
        if (!ok) {
            return res.status(401).json({ error: 'Incorrect email or password' });
        }

        req.session.user = {
            email: account.Email,
            firstName: account.FirstName,
            lastName: account.LastName
        };
        return res.json({ message: 'Signed in', user: req.session.user });
    } catch (err) {
        console.error('[login]', err);
        return res.status(500).json({ error: 'Database error while signing in' });
    }
});

// POST /api/logout
router.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('sts.sid');
        res.json({ message: 'Signed out' });
    });
});

// GET /api/me  -> the signed-in user, or 401
router.get('/me', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not signed in' });
    }
    res.json({ user: req.session.user });
});

module.exports = router;
