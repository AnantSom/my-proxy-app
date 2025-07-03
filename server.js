// server.js
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000; // Use environment variable for port or default to 3000

// --- 1. Homepage Setup (These routes should come first) ---

// Serve static files from the 'public' directory
// This handles requests like:
// - GET /index.html (though app.get('/') below also handles this for the root)
// - GET /css/style.css (if you add specific CSS for your homepage later)
app.use(express.static(path.join(__dirname, 'public')));

// Specific handler for the root path for homepage (GET requests)
app.get('/', (req, res) => {
    // If the request for '/' (root) is a GET request, serve the index.html
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- 2. MCQ App Proxy Options (Common options for all MCQ-related proxies) ---
const mcqProxyOptions = {
    target: 'http://34.134.191.116:5002', // The URL of your MCQ application
    changeOrigin: true, // Needed for virtual hosted sites (sets Host header to target)
    ws: true, // Enable proxying of WebSockets (if your target app uses them)
    logLevel: 'debug', // 'debug' or 'info' for more verbose logging of proxy activity
    onProxyReq: (proxyReq, req, res) => {
        console.log(`[Proxy Req] ${req.method} ${req.originalUrl} -> ${proxyReq.protocol}//${proxyReq.host}${proxyReq.path}`);
    },
    onProxyRes: (proxyRes, req, res) => {
        console.log(`[Proxy Res] ${req.originalUrl} <- ${proxyRes.statusCode}`);
    },
    onError: (err, req, res) => {
        console.error(`[Proxy Error] for ${req.originalUrl}:`, err);
        res.status(500).send('Proxy Error: Could not connect to the MCQ application or internal proxy issue.');
    },
};

// --- 3. Proxy for requests explicitly to /mcq ---
// This handles requests like http://localhost:3000/mcq, http://localhost:3000/mcq/questions, etc.
app.use('/mcq', createProxyMiddleware({
    ...mcqProxyOptions, // Inherit base options
    pathRewrite: {
        '^/mcq': '/', // Rewrite: /mcq/something -> /something on the target
    },
}));

// --- 4. Catch-all Proxy for the MCQ App's internal absolute paths ---
// This is the crucial part to fix "Cannot POST /" and other absolute paths.
// This middleware will be hit for any request that was NOT handled by:
// - `express.static` (for local static files like your homepage's CSS/JS)
// - `app.get('/')` (for the homepage itself)
//
// If a request reaches this point, it means it's not for your homepage.
// We assume it must be an internal request from the proxied MCQ app that used an absolute path.
// This will proxy requests like:
// - POST / (e.g., "generate quiz" form submission) -> POST http://34.134.191.116:5002/
// - GET /css/mcq-app.css -> GET http://34.134.191.116:5002/css/mcq-app.css
// - GET /api/data -> GET http://34.134.191.116:5002/api/data
//
// IMPORTANT: This means NO OTHER routes or APIs should exist directly on your proxy's root ('/')
// besides your homepage. Any new root-level routes would need to be placed *before* this catch-all proxy.
app.use((req, res, next) => {
    // Check if the request is for the root (/) and it's a POST request.
    // Our `app.get('/')` handles GET requests to root. `express.static` handles GET requests for static files.
    // Any POST request to root, or any GET/POST request to other paths not starting with /mcq
    // that were not satisfied by express.static, are assumed to be for the MCQ app.
    
    // We use a middleware function here to ensure this proxy runs after specific static/GET / rules.
    const proxyMiddleware = createProxyMiddleware({
        ...mcqProxyOptions, // Inherit base options
        // No pathRewrite needed here, as the paths are already absolute from the root
        // and should be forwarded as is.
        // Example: /css/style.css on proxy -> /css/style.css on target
        // Example: POST / on proxy -> POST / on target
    });

    // Call the proxy middleware. If it handles the request, it ends the response.
    // Otherwise, it calls next().
    proxyMiddleware(req, res, next);
});


// --- Start the Server ---
app.listen(PORT, () => {
    console.log(`Proxy server running on http://localhost:${PORT}`);
    console.log(`Homepage accessible at http://localhost:${PORT}`);
    console.log(`MCQ App accessible via http://localhost:${PORT}/mcq`);
    console.log(`MCQ App's internal absolute paths (like POST /) are now also proxied.`);
});