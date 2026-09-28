// api/index.js - Vercel Serverless Function Entry Point
const app = require("../backend/index");

module.exports = (req, res) => {
    return app(req, res);
};
