// Login / admin checks for API routes.

function requireLogin(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ error: 'Please sign in first' });
    }
    next();
}

// Admins are accounts with IsAdmin = 1 in UserAccount (set at login).
// ADMIN_EMAILS in .env can list extra admin emails as a fallback.
function requireAdmin(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ error: 'Please sign in first' });
    }
    const user = req.session.user;
    const extraAdmins = (process.env.ADMIN_EMAILS || '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);

    if (user.isAdmin || extraAdmins.includes(String(user.email).toLowerCase())) {
        return next();
    }
    return res.status(403).json({ error: 'Admin access required' });
}

module.exports = { requireLogin, requireAdmin };
