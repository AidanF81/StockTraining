// Login / admin checks for API routes.

function requireLogin(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ error: 'Please sign in first' });
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ error: 'Please sign in first' });
    }
    const allowed = (process.env.ADMIN_EMAILS || '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);

    // No admin list configured: allow any signed-in user (development mode).
    if (allowed.length === 0) return next();

    if (!allowed.includes(req.session.user.email.toLowerCase())) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

module.exports = { requireLogin, requireAdmin };
