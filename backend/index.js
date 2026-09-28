const express = require("express");
const cors = require("cors");

const barangRoutes = require("./routes/barangRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const exportImportRoutes = require("./routes/exportImportRoutes");
const kategoriRoutes = require("./routes/kategoriRoutes");
const lokasiRoutes = require("./routes/lokasiRoutes");
const satuanRoutes = require("./routes/satuanRoutes");
const userRoutes = require("./routes/userRoutes");
const namaBarangRoutes = require("./routes/namaBarangRoutes");
const pemakaianRoutes = require("./routes/pemakaianRoutes");
const settingRoutes = require("./routes/settingRoutes");
const authRoutes = require("./routes/authRoutes");

const app = express();

// Middleware CORS & Parser
app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Helper: Mount ke /api/... DAN /... agar cocok di Vercel serverless rewrite maupun lokal
const mountRoute = (routePath, router) => {
    app.use(`/api${routePath}`, router);
    app.use(routePath, router);
};

mountRoute("/auth", authRoutes);
mountRoute("/barang", barangRoutes);
mountRoute("/dashboard", dashboardRoutes);
mountRoute("/data", exportImportRoutes);
mountRoute("/kategori", kategoriRoutes);
mountRoute("/lokasi", lokasiRoutes);
mountRoute("/satuan", satuanRoutes);
mountRoute("/users", userRoutes);
mountRoute("/nama-barang", namaBarangRoutes);
mountRoute("/pemakaian", pemakaianRoutes);
mountRoute("/settings", settingRoutes);

// Health check
app.get(["/api/health", "/health"], (req, res) => {
    res.json({ success: true, message: "API berjalan normal.", timestamp: new Date().toISOString() });
});

// Serve static frontend files (local/non-Vercel)
const path = require("path");
app.use(express.static(path.join(__dirname, "public")));

const indexPath = path.join(__dirname, "public", "index.html");
if (require("fs").existsSync(indexPath)) {
    app.use((req, res, next) => {
        if (req.method === "GET" && !req.path.startsWith("/api")) {
            res.sendFile(indexPath);
        } else {
            next();
        }
    });
}

// Global Error Handler
app.use((err, req, res, next) => {
    console.error("Backend Error:", err);
    res.status(500).json({ success: false, message: err.message || "Terjadi kesalahan server internal." });
});

// Export untuk Vercel (serverless)
module.exports = app;

// Run server hanya jika dijalankan langsung (bukan sebagai Vercel function)
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server berjalan di http://0.0.0.0:${PORT}`);
    });
}