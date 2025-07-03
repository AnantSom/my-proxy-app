// server.js
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// --- 1. Middleware Setup ---
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// --- 2. Homepage Route ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- 3. Define Applications to Proxy ---
const proxiedApps = [
    { name: 'Movie Hub', path: '/movie-hub', target: 'http://34.134.191.116:4002' },
    { name: 'Todo List', path: '/todo-list', target: 'http://34.134.191.116:3001' },
    { name: 'YouTube AI Quizzer', path: '/youtube-ai-quizzer', target: 'http://34.134.191.116:5001' },
    { name: 'AI MCQ Generator', path: '/mcq', target: 'http://34.134.191.116:5002' },
    { name: 'Bookmark Manager', path: '/bookmark-manager', target: 'http://34.134.191.116:5003' },
];

// --- 4. Common Proxy Options (With Redirect Fix) ---
const commonProxyOptions = {
    changeOrigin: true,
    ws: true,
    logLevel: 'debug',
    onProxyReq: (proxyReq, req, res) => {
        console.log(`[Proxy Req] ${req.method} ${req.originalUrl} -> ${proxyReq.protocol}//${proxyReq.host}${proxyReq.path}`);
    },
    onProxyRes: (proxyRes, req, res) => {
        console.log(`[Proxy Res] ${req.originalUrl} <- ${proxyRes.statusCode}`);
        if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
            const originalLocation = proxyRes.headers.location;
            if (originalLocation.startsWith('/')) {
                let appPrefix = null;
                const matchedAppByPath = proxiedApps.find(appConfig => req.originalUrl.startsWith(appConfig.path));
                if (matchedAppByPath) {
                    appPrefix = matchedAppByPath.path;
                } else if (req.headers.referer) {
                    const matchedAppByReferer = proxiedApps.find(appConfig => req.headers.referer.includes(appConfig.path));
                    if (matchedAppByReferer) appPrefix = matchedAppByReferer.path;
                } else if (req.cookies['x-proxied-app']) {
                    const matchedAppByCookie = proxiedApps.find(appConfig => appConfig.path === req.cookies['x-proxied-app']);
                    if (matchedAppByCookie) appPrefix = matchedAppByCookie.path;
                }
                if (appPrefix) {
                    const newLocation = `${appPrefix}${originalLocation}`;
                    proxyRes.headers.location = newLocation;
                    console.log(`[Proxy Redirect Rewrite] Rewriting Location from '${originalLocation}' to '${newLocation}'`);
                }
            }
        }
    },
    onError: (err, req, res) => {
        console.error(`[Proxy Error] for ${req.originalUrl}:`, err);
        res.status(500).send('Proxy Error');
    },
};

// --- 5. Apply Specific Proxies (This sets the cookie) ---
proxiedApps.forEach(appConfig => {
    const proxyMiddleware = createProxyMiddleware({
        ...commonProxyOptions,
        target: appConfig.target,
        pathRewrite: { [`^${appConfig.path}`]: '/' },
    });
    app.use(appConfig.path, (req, res, next) => {
        res.cookie('x-proxied-app', appConfig.path, { maxAge: 3600000, httpOnly: true, path: '/' });
        console.log(`[Cookie] Set 'x-proxied-app' to '${appConfig.path}'`);
        proxyMiddleware(req, res, next);
    });
    console.log(`Configured proxy for ${appConfig.name}: ${appConfig.path} -> ${appConfig.target}`);
});

// --- 6. Dynamic Fallback Proxy (With the Homepage Fix) ---
app.use((req, res, next) => {
    // ***** THIS IS THE NEW FIX *****
    // If this is a GET request for the homepage, do NOT proxy it here.
    // Let the correct app.get('/') handler do its job.
    if (req.method === 'GET' && req.path === '/') {
        return next();
    }
    // *******************************

    const isExplicitProxiedPath = proxiedApps.some(appConfig => req.originalUrl.startsWith(appConfig.path));
    if (isExplicitProxiedPath) return next();

    let sourceAppConfig = null;
    if (req.headers.referer) {
        sourceAppConfig = proxiedApps.find(appConfig => req.headers.referer.includes(appConfig.path));
    }
    if (!sourceAppConfig && req.cookies && req.cookies['x-proxied-app']) {
        const appPathFromCookie = req.cookies['x-proxied-app'];
        sourceAppConfig = proxiedApps.find(appConfig => appConfig.path === appPathFromCookie);
        if (sourceAppConfig) console.log(`[Fallback Proxy] Identified app '${sourceAppConfig.name}' using cookie.`);
    }

    if (sourceAppConfig) {
        console.log(`[Fallback Proxy] Routing ${req.method} ${req.originalUrl} to ${sourceAppConfig.name}`);
        const dynamicProxyMiddleware = createProxyMiddleware({
            ...commonProxyOptions,
            target: sourceAppConfig.target,
            pathRewrite: (path, req) => path,
        });
        return dynamicProxyMiddleware(req, res, next);
    }
    next();
});

// --- 7. 404 Handler ---
app.use((req, res) => {
    res.status(404).send('Not Found: This path does not exist on the proxy or could not be routed to an application.');
});

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`Proxy server running on http://localhost:${PORT}`);
    console.log(`This version uses cookies and protects the homepage.`);
});