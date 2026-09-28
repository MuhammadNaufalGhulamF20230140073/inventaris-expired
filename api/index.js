// api/index.js - Vercel Serverless Function Entry Point
let app;
let loadError;

try {
    app = require("../backend/index");
} catch (err) {
    loadError = err;
    console.error("Failed to load backend/index:", err);
}

module.exports = (req, res) => {
    if (!app) {
        return res.status(500).json({
            success: false,
            message: "Failed to load Express backend application.",
            error: loadError ? loadError.message : null,
            stack: loadError ? loadError.stack : null
        });
    }

    try {
        return app(req, res);
    } catch (err) {
        console.error("Vercel Function Execution Error:", err);
        return res.status(500).json({
            success: false,
            message: err.message || "Serverless Function Execution Error",
            stack: process.env.NODE_ENV !== "production" ? err.stack : undefined
        });
    }
};
