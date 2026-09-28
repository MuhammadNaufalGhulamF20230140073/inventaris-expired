const bcrypt = require("bcryptjs");
const prisma = require("../prismaClient");

// Ambil semua user
const getUser = async (req, res) => {
    const { role } = req.query;
    try {
        const rows = await prisma.users.findMany({
            where: role ? { role: { equals: role, mode: "insensitive" } } : undefined,
            select: {
                id: true, username: true, email: true, nama: true,
                role: true, status: true, is_2fa_enabled: true, created_at: true
            },
            orderBy: { nama: "asc" }
        });
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// Tambah user login baru
const createUser = async (req, res) => {
    const { username, email, password, nama, role, status } = req.body;

    if (!nama || nama.trim() === "") return res.status(400).json({ success: false, message: "Nama wajib diisi." });
    if (!username || username.trim() === "") return res.status(400).json({ success: false, message: "Username wajib diisi." });
    if (!password || password.trim() === "") return res.status(400).json({ success: false, message: "Password wajib diisi." });

    const userRole = (role || "OPERATOR_INVENTARIS").toUpperCase();
    const userStatus = status || "active";
    const userUsername = username.trim().toLowerCase();
    const userEmail = (email || "").trim().toLowerCase();
    const hashedPassword = bcrypt.hashSync(password.trim(), 10);

    try {
        const data = await prisma.users.create({
            data: { username: userUsername, email: userEmail, password: hashedPassword, nama: nama.trim(), role: userRole, status: userStatus }
        });
        res.json({
            success: true,
            message: "Akun pengguna berhasil ditambahkan dengan keamanan terenkripsi.",
            data: { id: data.id, username: userUsername, email: userEmail, nama: nama.trim(), role: userRole, status: userStatus }
        });
    } catch (err) {
        if (err.code === "P2002") {
            return res.status(400).json({ success: false, message: "Username sudah terdaftar. Gunakan username lain." });
        }
        res.status(500).json({ success: false, message: err.message });
    }
};

// Update user
const updateUser = async (req, res) => {
    const { id } = req.params;
    const { username, email, password, nama, role, status } = req.body;

    if (!nama || nama.trim() === "") return res.status(400).json({ success: false, message: "Nama wajib diisi." });
    if (!username || username.trim() === "") return res.status(400).json({ success: false, message: "Username wajib diisi." });

    const userRole = (role || "OPERATOR_INVENTARIS").toUpperCase();
    const userStatus = status || "active";
    const userUsername = username.trim().toLowerCase();
    const userEmail = (email || "").trim().toLowerCase();

    const dataUpdate = { username: userUsername, email: userEmail, nama: nama.trim(), role: userRole, status: userStatus };
    if (password && password.trim() !== "") {
        dataUpdate.password = bcrypt.hashSync(password.trim(), 10);
    }

    try {
        await prisma.users.update({ where: { id: parseInt(id) }, data: dataUpdate });
        res.json({ success: true, message: "Akun pengguna berhasil diperbarui." });
    } catch (err) {
        if (err.code === "P2002") return res.status(400).json({ success: false, message: "Username sudah digunakan oleh pengguna lain." });
        if (err.code === "P2025") return res.status(404).json({ success: false, message: "Pengguna tidak ditemukan." });
        res.status(500).json({ success: false, message: err.message });
    }
};

// Reset 2FA
const resetUser2FA = async (req, res) => {
    const { id } = req.params;
    try {
        await prisma.users.update({ where: { id: parseInt(id) }, data: { is_2fa_enabled: 0, totp_secret: null } });
        res.json({ success: true, message: "Microsoft Authenticator (2FA) berhasil direset untuk pengguna ini." });
    } catch (err) {
        if (err.code === "P2025") return res.status(404).json({ success: false, message: "Pengguna tidak ditemukan." });
        res.status(500).json({ success: false, message: err.message });
    }
};

// Hapus user
const deleteUser = async (req, res) => {
    const { id } = req.params;
    try {
        await prisma.users.delete({ where: { id: parseInt(id) } });
        res.json({ success: true, message: "Pengguna berhasil dihapus." });
    } catch (err) {
        if (err.code === "P2025") return res.status(404).json({ success: false, message: "Pengguna tidak ditemukan." });
        res.status(500).json({ success: false, message: err.message });
    }
};

// Ambil matriks hak akses menu
const getRolePermissions = async (req, res) => {
    try {
        const rows = await prisma.rolePermissions.findMany();
        const matrix = {};
        rows.forEach(r => {
            if (!matrix[r.role]) matrix[r.role] = {};
            matrix[r.role][r.menu_key] = Number(r.is_visible) === 1;
        });
        res.json({ success: true, data: matrix });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// Update matriks hak akses menu
const updateRolePermissions = async (req, res) => {
    const { role, permissions } = req.body;
    if (!role || !permissions) return res.status(400).json({ success: false, message: "Role dan permissions wajib dikirim." });

    const roleName = role.toUpperCase();
    const keys = Object.keys(permissions);

    try {
        await prisma.rolePermissions.deleteMany({ where: { role: roleName } });
        if (keys.length > 0) {
            await prisma.rolePermissions.createMany({
                data: keys.map(menuKey => ({ role: roleName, menu_key: menuKey, is_visible: permissions[menuKey] ? 1 : 0 }))
            });
        }
        res.json({ success: true, message: `Hak akses menu untuk role ${roleName} berhasil diperbarui!` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// Ambil matriks pembatasan kategori per role
const getRoleCategoryPermissions = async (req, res) => {
    try {
        const rows = await prisma.roleCategories.findMany();
        const matrix = {};
        rows.forEach(r => {
            if (!matrix[r.role]) matrix[r.role] = [];
            matrix[r.role].push(r.nama_kategori);
        });
        res.json({ success: true, data: matrix });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// Update pembatasan kategori untuk role
const updateRoleCategoryPermissions = async (req, res) => {
    const { role, categories } = req.body;
    if (!role) return res.status(400).json({ success: false, message: "Role wajib dikirim." });

    const roleName = role.toUpperCase();
    const categoriesArray = Array.isArray(categories) ? categories : [];

    try {
        await prisma.roleCategories.deleteMany({ where: { role: roleName } });
        if (categoriesArray.length > 0) {
            await prisma.roleCategories.createMany({
                data: categoriesArray.map(kat => ({ role: roleName, nama_kategori: kat }))
            });
        }
        res.json({ success: true, message: `Akses kategori barang untuk role ${roleName} berhasil diperbarui!` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

module.exports = {
    getUser, createUser, updateUser, deleteUser, resetUser2FA,
    getRolePermissions, updateRolePermissions,
    getRoleCategoryPermissions, updateRoleCategoryPermissions
};
