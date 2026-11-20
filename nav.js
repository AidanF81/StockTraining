// Adam Frazier - IFT 401 Stock Training System
// Top menu fix: if someone is signed in, the "Login" link becomes "Log Out".
// Clicking Log Out signs them out and goes back to the sign in page.
// Every user page loads this file with <script src="nav.js"></script>

(async () => {
    const link = document.querySelector('header nav a[href="index.html"]');
    if (!link) return;

    try {
        // GET /api/me returns 401 when nobody is signed in, so the link just stays as Login
        const response = await fetch('/api/me');
        if (!response.ok) return;
    } catch (err) {
        return;   // server not reachable, leave the menu alone
    }

    link.textContent = 'Log Out';
    link.classList.remove('active-nav');   // dont highlight it like its the current page
    link.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
            await fetch('/api/logout', { method: 'POST' });
        } catch (err) {
            // go to the sign in page either way
        }
        window.location.href = 'index.html';
    });
})();
