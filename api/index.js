// api/index.js - Vercel Serverless Function Entry Point
let app;
let loadError;

function loadBackendApp() {
    if (!app && !loadError) {
        try {
            app = require("../backend/index");
        } catch (err) {
            loadError = err;
            console.error("Failed to load backend/index:", err);
        }
    }
    return app;
}

module.exports = (req, res) => {
    const expressApp = loadBackendApp();

    if (!expressApp) {
        return res.status(500).json({
            success: false,
            message: "Failed to load Express backend application.",
            error: loadError ? (loadError.message || String(loadError)) : "Unknown Error",
            stack: loadError ? loadError.stack : null
        });
    }

    try {
        return expressApp(req, res);
    } catch (err) {
        console.error("Vercel Function Execution Error:", err);
        return res.status(500).json({
            success: false,
            message: err.message || "Serverless Function Execution Error",
            stack: err.stack
        });
    }
};
