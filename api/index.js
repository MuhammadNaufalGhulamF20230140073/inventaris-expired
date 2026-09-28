// api/index.js - Vercel Serverless Function Entry Point

module.exports = (req, res) => {
    res.setHeader("Content-Type", "application/json");

    const modulesToTest = [
        ["express", () => require("express")],
        ["cors", () => require("cors")],
        ["bcryptjs", () => require("bcryptjs")],
        ["jsonwebtoken", () => require("jsonwebtoken")],
        ["qrcode", () => require("qrcode")],
        ["exceljs", () => require("exceljs")],
        ["prismaClient", () => require("../backend/prismaClient")],
        ["authRoutes", () => require("../backend/routes/authRoutes")],
        ["barangRoutes", () => require("../backend/routes/barangRoutes")],
        ["dashboardRoutes", () => require("../backend/routes/dashboardRoutes")],
        ["exportImportRoutes", () => require("../backend/routes/exportImportRoutes")],
        ["kategoriRoutes", () => require("../backend/routes/kategoriRoutes")],
        ["lokasiRoutes", () => require("../backend/routes/lokasiRoutes")],
        ["namaBarangRoutes", () => require("../backend/routes/namaBarangRoutes")],
        ["pemakaianRoutes", () => require("../backend/routes/pemakaianRoutes")],
        ["satuanRoutes", () => require("../backend/routes/satuanRoutes")],
        ["settingRoutes", () => require("../backend/routes/settingRoutes")],
        ["userRoutes", () => require("../backend/routes/userRoutes")],
        ["backendApp", () => require("../backend/index")]
    ];

    const failed = [];
    for (const [name, fn] of modulesToTest) {
        try {
            fn();
        } catch (err) {
            failed.push({ module: name, error: err ? err.message : String(err), stack: err ? err.stack : null });
        }
    }

    if (failed.length > 0) {
        return res.status(500).json({
            success: false,
            message: "Module loading diagnostics failed on Vercel.",
            failedModules: failed
        });
    }

    try {
        const app = require("../backend/index");
        return app(req, res);
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: "Vercel Function Execution Error",
            error: err ? err.message : "Unknown error",
            stack: err ? err.stack : null
        });
    }
};
