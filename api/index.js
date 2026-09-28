// api/index.js - Vercel Serverless Function Entry Point

module.exports = (req, res) => {
    res.setHeader("Content-Type", "application/json");

    let app;
    try {
        app = require("../backend/index");
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: "Failed to load Express backend application.",
            error: err ? err.message : "Unknown error",
            name: err ? err.name : "Error",
            stack: err ? err.stack : null
        });
    }

    try {
        return app(req, res);
    } catch (err) {
        console.error("Vercel Function Execution Error:", err);
        return res.status(500).json({
            success: false,
            message: "Vercel Function Execution Error",
            error: err ? err.message : "Unknown execution error",
            stack: err ? err.stack : null
        });
    }
};
