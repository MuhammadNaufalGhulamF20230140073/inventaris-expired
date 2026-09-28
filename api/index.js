// api/index.js - Vercel Serverless Function Entry Point
// File ini menghubungkan Express app backend ke Vercel serverless

const app = require("../backend/index");

module.exports = app;
