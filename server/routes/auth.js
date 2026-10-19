// Account routes: register, login, logout, current user.
// Table used: UserAccount (Email PK, FirstName, LastName, PasswordHash, Balance, IsAdmin)

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { isTrue } = require('../util');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The account whose password doubles as the "admin password" at sign-up (team decision).
const ADMIN_ACCOUNT_EMAIL = (process.env.ADMIN_ACCOUNT_EMAIL || 'admin@admin.com').toLowerCase();

function isBcryptHash(value) {
    return typeof value === 'string' && value.length === 60 && /^\$2[aby]\$\d{2}\$/.test(value);
}

// True if `entered` matches `stored`. `stored` is normally a bcrypt hash, but rows
// added by hand in MySQL Workbench may hold the plain password; accept those too.
async function passwordMatches(entered, stored) {
    if (!stored) return false;
    if (isBcryptHash(stored)) return bcrypt.compare(String(entered), stored);
    return String(entered) === String(stored);
}

// Password rules from the Systems Design document.
function passwordProblem(password, email) {
    const p = String(password);
    if (p.length < 8) return 'Password must be at least 8 characters';
    if (!/[A-Za-z]/.test(p) || !/\d/.test(p) || !/[^A-Za-z0-9]/.test(p)) {
        return 'Password must include a letter, a number, and a special character';
    }
    const emailName = String(email).split('@')[0].toLowerCase();
    if (emailName.length >= 3 && p.toLowerCase().includes(emailName)) {
        return 'Password must not contain your email name';
    }
    return null;
}

function sessionUser(row) {
    return {
        email: row.Email,
        firstName: row.FirstName,
        lastName: row.LastName,
        isAdmin: isTrue(row.IsAdmin)
    };
}

// POST /api/register  { firstName, lastName, email, password, adminCode? }
router.post('/register', async (req, res) => {
    const { firstName, lastName, email, password, adminCode } = req.body || {};

    if (!firstName || !lastName || !email || !password) {
        return res.status(400).json({ error: 'All fields are required' });
    }
    const cleanEmail = String(email).trim().toLowerCase();
    if (!EMAIL_PATTERN.test(cleanEmail) || cleanEmail.length > 255) {
        return res.status(400).json({ error: 'Enter a valid email address' });
    }
    if (String(firstName).trim().length > 50 || String(lastName).trim().length > 50) {
        return res.status(400).json({ error: 'Names must be 50 characters or fewer' });
    }
    const problem = passwordProblem(password, cleanEmail);
    if (problem) return res.status(400).json({ error: problem });

    try {
        // Optional admin sign-up: the entered admin password must match the default admin account's password.
        let isAdmin = 0;
        if (adminCode) {
            const [adminRows] = await db.query(
                'SELECT PasswordHash FROM UserAccount WHERE LOWER(Email) = ? LIMIT 1',
                [ADMIN_ACCOUNT_EMAIL]
            );
            const ok = adminRows[0] && await passwordMatches(adminCode, adminRows[0].PasswordHash);
            if (!ok) {
                return res.status(403).json({ error: 'Admin password is incorrect. Leave it blank for a regular account.' });
            }
            isAdmin = 1;
        }

        const passwordHash = await bcrypt.hash(String(password), 10);
        const values = [cleanEmail, String(firstName).trim(), String(lastName).trim(), passwordHash];
        try {
            await db.query(
                'INSERT INTO UserAccount (Email, FirstName, LastName, PasswordHash, IsAdmin) VALUES (?, ?, ?, ?, ?)',
                [...values, isAdmin]
            );
        } catch (err) {
            // Table without the IsAdmin column yet: fall back to the original four columns.
            if (err.code !== 'ER_BAD_FIELD_ERROR') throw err;
            console.warn('[register] IsAdmin column not found; creating a regular account');
            await db.query(
                'INSERT INTO UserAccount (Email, FirstName, LastName, PasswordHash) VALUES (?, ?, ?, ?)',
                values
            );
            isAdmin = 0;
        }

        return res.status(201).json({
            message: isAdmin ? 'Admin account created' : 'Account created',
            email: cleanEmail,
            isAdmin: Boolean(isAdmin)
        });
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
            'SELECT * FROM UserAccount WHERE LOWER(Email) = ? LIMIT 1',
            [cleanEmail]
        );
        const account = rows[0];
        const ok = account && await passwordMatches(password, account.PasswordHash);
        if (!ok) {
            return res.status(401).json({ error: 'Incorrect email or password' });
        }

        // A hand-entered plain-text password gets replaced with a hash on first successful login.
        if (!isBcryptHash(account.PasswordHash)) {
            const upgraded = await bcrypt.hash(String(password), 10);
            await db.query('UPDATE UserAccount SET PasswordHash = ? WHERE Email = ?', [upgraded, account.Email]);
        }

        req.session.user = sessionUser(account);
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
