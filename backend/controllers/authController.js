const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { generateSecret, verifySync, generateURI } = require("otplib");
const qrcode = require("qrcode");
const prisma = require("../prismaClient");

const JWT_SECRET = process.env.JWT_SECRET || "inventaris_secret_token_secure_key_2026";

// Helper: Bentuk response login lengkap dengan token & hak akses
const sendLoginResponse = async (res, user, message = "Login berhasil.") => {
    const token = jwt.sign(
        { id: user.id, username: user.username, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: "7d" }
    );

    try {
        const permRows = await prisma.rolePermissions.findMany({ where: { role: user.role } });
        const catRows = await prisma.roleCategories.findMany({ where: { role: user.role } });

        const permissions = {};
        permRows.forEach(p => { permissions[p.menu_key] = Number(p.is_visible) === 1; });
        const allowedCategories = catRows.map(c => c.nama_kategori);

        res.json({
            success: true,
            message,
            token,
            data: {
                id: user.id,
                username: user.username,
                email: user.email || "",
                nama: user.nama,
                role: user.role,
                is_2fa_enabled: Number(user.is_2fa_enabled) === 1,
                token,
                permissions,
                allowedCategories
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 1. Login Endpoint
const login = async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, message: "Username/Email dan password wajib diisi." });
    }

    const cleanIdentifier = username.trim();
    const cleanPassword = password.trim();

    try {
        const user = await prisma.users.findFirst({
            where: {
                AND: [
                    { status: "active" },
                    {
                        OR: [
                            { username: { equals: cleanIdentifier, mode: "insensitive" } },
                            { email: { equals: cleanIdentifier, mode: "insensitive", not: "" } }
                        ]
                    }
                ]
            }
        });

        if (!user) {
            return res.status(401).json({ success: false, message: "Username/Email tidak ditemukan atau akun dinonaktifkan." });
        }

        // Verifikasi password
        let isMatch = false;
        let isLegacyPlain = false;

        if (user.password && (user.password.startsWith("$2a$") || user.password.startsWith("$2b$") || user.password.startsWith("$2y$"))) {
            try { isMatch = bcrypt.compareSync(cleanPassword, user.password); } catch (e) { isMatch = false; }
        } else {
            if (user.password === cleanPassword) { isMatch = true; isLegacyPlain = true; }
        }

        if (!isMatch) {
            return res.status(401).json({ success: false, message: "Password yang Anda masukkan salah." });
        }

        // Auto-upgrade plaintext password
        if (isLegacyPlain) {
            const encryptedHash = bcrypt.hashSync(cleanPassword, 10);
            await prisma.users.update({ where: { id: user.id }, data: { password: encryptedHash } }).catch(() => {});
        }

        // Cek 2FA
        if (Number(user.is_2fa_enabled) === 1 && user.totp_secret) {
            const tempToken = jwt.sign({ id: user.id, username: user.username, email: user.email, is2FA: true }, JWT_SECRET, { expiresIn: "5m" });
            return res.json({
                success: true, require2FA: true, tempToken,
                message: "Masukkan 6 digit kode dari aplikasi Microsoft Authenticator Anda.",
                user: { id: user.id, username: user.username, email: user.email || "", nama: user.nama }
            });
        }

        // Setup 2FA baru
        try {
            const secret = generateSecret();
            const issuer = "Inventaris Gedung Agung";
            const accountLabel = user.email && user.email.trim() ? `${user.email} (${user.username})` : user.username;
            const otpauthUri = generateURI({ issuer, label: accountLabel, secret });

            const qrCodeUrl = await qrcode.toDataURL(otpauthUri, { width: 250, margin: 2, color: { dark: "#0f4c81", light: "#ffffff" } });
            const setupToken = jwt.sign({ id: user.id, username: user.username, email: user.email, secret, is2FASetup: true }, JWT_SECRET, { expiresIn: "15m" });

            return res.json({
                success: true, require2FASetup: true, setupToken, qrCodeUrl, secret,
                message: `Halo ${user.nama}, demi keamanan, silakan buka Microsoft Authenticator di HP Anda dan scan QR Code ini.`,
                user: { id: user.id, username: user.username, email: user.email || "", nama: user.nama }
            });
        } catch (qrErr) {
            console.error("Gagal generate QR Code:", qrErr);
            return sendLoginResponse(res, user, "Login berhasil.");
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 1.1 Aktivasi & Login 2FA Pertama Kali
const activateAndLogin2FA = async (req, res) => {
    const { setupToken, otpCode } = req.body;
    if (!setupToken || !otpCode) return res.status(400).json({ success: false, message: "Sesi setup dan kode 6 digit wajib diisi." });

    try {
        const decoded = jwt.verify(setupToken, JWT_SECRET);
        if (!decoded || !decoded.id || !decoded.secret || !decoded.is2FASetup) {
            return res.status(401).json({ success: false, message: "Sesi setup QR Code telah kadaluarsa. Silakan login kembali." });
        }

        const cleanCode = String(otpCode).trim();
        const verification = verifySync({ token: cleanCode, secret: decoded.secret, epochTolerance: 30 });

        if (!verification || !verification.valid) {
            return res.status(400).json({ success: false, message: "Kode 6 digit salah atau tidak sesuai. Pastikan jam pada smartphone Anda diatur otomatis." });
        }

        await prisma.users.update({ where: { id: decoded.id }, data: { totp_secret: decoded.secret, is_2fa_enabled: 1 } });
        const user = await prisma.users.findUnique({ where: { id: decoded.id } });
        if (!user) return res.status(500).json({ success: false, message: "Gagal memproses data akun." });

        return sendLoginResponse(res, user, "Selamat! Microsoft Authenticator berhasil terpasang dan Anda telah berhasil login.");
    } catch (err) {
        return res.status(401).json({ success: false, message: "Sesi setup QR Code telah kadaluarsa. Silakan ulangi login dari awal." });
    }
};

// 2. Verifikasi 6 Digit Kode 2FA
const verify2FA = async (req, res) => {
    const { tempToken, otpCode } = req.body;
    if (!tempToken || !otpCode) return res.status(400).json({ success: false, message: "Token sesi dan 6 digit kode wajib diisi." });

    try {
        const decoded = jwt.verify(tempToken, JWT_SECRET);
        if (!decoded || !decoded.id || !decoded.is2FA) return res.status(401).json({ success: false, message: "Sesi verifikasi tidak valid atau telah kadaluarsa." });

        const user = await prisma.users.findFirst({ where: { id: decoded.id, status: "active" } });
        if (!user) return res.status(401).json({ success: false, message: "Pengguna tidak ditemukan atau dinonaktifkan." });
        if (!user.totp_secret) return res.status(400).json({ success: false, message: "Kunci keamanan Microsoft Authenticator belum dikonfigurasi." });

        const cleanCode = String(otpCode).trim();
        const verification = verifySync({ token: cleanCode, secret: user.totp_secret, epochTolerance: 30 });
        if (!verification || !verification.valid) {
            return res.status(401).json({ success: false, message: "Kode 6 digit Microsoft Authenticator salah atau telah kadaluarsa." });
        }

        return sendLoginResponse(res, user, "Autentikasi dua faktor Microsoft Authenticator berhasil.");
    } catch (err) {
        return res.status(401).json({ success: false, message: "Sesi verifikasi kadaluarsa (lebih dari 5 menit). Silakan ulangi login dari awal." });
    }
};

// 3. Setup 2FA (Generate QR Code)
const setup2FA = async (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ success: false, message: "User ID wajib dikirim." });

    try {
        const user = await prisma.users.findUnique({
            where: { id: parseInt(userId) },
            select: { id: true, username: true, email: true, nama: true, is_2fa_enabled: true }
        });
        if (!user) return res.status(404).json({ success: false, message: "Pengguna tidak ditemukan." });

        const secret = generateSecret();
        const issuer = "Inventaris Gedung Agung";
        const accountLabel = user.email && user.email.trim() ? `${user.email} (${user.username})` : user.username;
        const otpauthUri = generateURI({ issuer, label: accountLabel, secret });
        const qrCodeUrl = await qrcode.toDataURL(otpauthUri, { width: 260, margin: 2, color: { dark: "#0f4c81", light: "#ffffff" } });

        res.json({ success: true, secret, qrCodeUrl, otpauthUri, username: user.username, email: user.email || "", is_2fa_enabled: Number(user.is_2fa_enabled) === 1 });
    } catch (err) {
        console.error("Setup 2FA error:", err);
        res.status(500).json({ success: false, message: "Gagal membuat QR Code Microsoft Authenticator." });
    }
};

// 4. Aktifkan 2FA
const enable2FA = async (req, res) => {
    const { userId, secret, otpCode } = req.body;
    if (!userId || !secret || !otpCode) return res.status(400).json({ success: false, message: "User ID, secret, dan kode verifikasi 6 digit wajib diisi." });

    const cleanCode = String(otpCode).trim();
    const verification = verifySync({ token: cleanCode, secret: secret.trim(), epochTolerance: 30 });
    if (!verification || !verification.valid) return res.status(400).json({ success: false, message: "Kode verifikasi salah atau tidak sesuai." });

    try {
        await prisma.users.update({ where: { id: parseInt(userId) }, data: { totp_secret: secret.trim(), is_2fa_enabled: 1 } });
        res.json({ success: true, message: "Microsoft Authenticator berhasil diaktifkan! Akun Anda kini dilindungi verifikasi 2 langkah." });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 5. Nonaktifkan 2FA
const disable2FA = async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false, message: "User ID wajib dikirim." });

    try {
        await prisma.users.update({ where: { id: parseInt(userId) }, data: { totp_secret: null, is_2fa_enabled: 0 } });
        res.json({ success: true, message: "Microsoft Authenticator berhasil dinonaktifkan dari akun ini." });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// Ambil Profil User
const getProfile = async (req, res) => {
    let targetUsername = req.query.username;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            if (decoded && decoded.username) targetUsername = decoded.username;
        } catch (jwtErr) {
            if (!targetUsername) return res.status(401).json({ success: false, message: "Sesi token keamanan telah kadaluarsa. Silakan login kembali." });
        }
    }

    if (!targetUsername) return res.status(400).json({ success: false, message: "Username atau token otentikasi wajib dikirim." });

    try {
        const user = await prisma.users.findFirst({
            where: { username: { equals: targetUsername, mode: "insensitive" } },
            select: { id: true, username: true, email: true, nama: true, role: true, status: true, is_2fa_enabled: true }
        });
        if (!user) return res.status(404).json({ success: false, message: "Pengguna tidak ditemukan." });

        const permRows = await prisma.rolePermissions.findMany({ where: { role: user.role } });
        const catRows = await prisma.roleCategories.findMany({ where: { role: user.role } });

        const permissions = {};
        permRows.forEach(p => { permissions[p.menu_key] = Number(p.is_visible) === 1; });
        const allowedCategories = catRows.map(c => c.nama_kategori);

        res.json({
            success: true,
            data: { ...user, email: user.email || "", is_2fa_enabled: Number(user.is_2fa_enabled) === 1, permissions, allowedCategories }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

module.exports = { login, activateAndLogin2FA, verify2FA, setup2FA, enable2FA, disable2FA, getProfile, JWT_SECRET };
