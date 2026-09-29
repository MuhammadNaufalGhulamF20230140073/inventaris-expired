const prisma = require("../prismaClient");

// Ambil semua kategori
const getKategori = async (req, res) => {
    try {
        const rows = await prisma.kategori.findMany({ orderBy: { nama_kategori: "asc" } });
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// Tambah kategori baru
const createKategori = async (req, res) => {
    const { nama_kategori } = req.body;
    if (!nama_kategori || nama_kategori.trim() === "") {
        return res.status(400).json({ success: false, message: "Nama kategori wajib diisi." });
    }
    try {
        const data = await prisma.kategori.create({ data: { nama_kategori: nama_kategori.trim() } });
        res.json({ success: true, message: "Kategori berhasil ditambahkan.", data });
    } catch (err) {
        if (err.code === "P2002") {
            return res.status(400).json({ success: false, message: "Kategori sudah terdaftar." });
        }
        res.status(500).json({ success: false, message: err.message });
    }
};

// Hapus kategori (sekaligus hapus sub kategori terkait)
const deleteKategori = async (req, res) => {
    const { id } = req.params;
    try {
        await prisma.subKategori.deleteMany({ where: { kategori_id: parseInt(id) } });
        await prisma.kategori.delete({ where: { id: parseInt(id) } });
        res.json({ success: true, message: "Kategori berhasil dihapus." });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ======================
// Sub Kategori Handlers
// ======================
const getSubKategori = async (req, res) => {
    const { kategori_id, kategori } = req.query;
    try {
        const rows = await prisma.subKategori.findMany({
            where: kategori_id ? { kategori_id: parseInt(kategori_id) } : undefined,
            include: { kategori: true },
            orderBy: [
                { kategori: { nama_kategori: "asc" } },
                { nama_sub_kategori: "asc" }
            ]
        });

        // Filter by kategori name in-memory jika ada
        const filtered = kategori
            ? rows.filter(r => r.kategori?.nama_kategori === kategori)
            : rows;

        const result = filtered.map(r => ({
            id: r.id,
            kategori_id: r.kategori_id,
            nama_sub_kategori: r.nama_sub_kategori,
            nama_kategori: r.kategori?.nama_kategori || ""
        }));

        res.json({ success: true, total: result.length, data: result });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

const createSubKategori = async (req, res) => {
    const { kategori_id, nama_kategori, nama_sub_kategori } = req.body;

    if (!nama_sub_kategori || nama_sub_kategori.trim() === "") {
        return res.status(400).json({ success: false, message: "Nama sub kategori wajib diisi." });
    }

    try {
        let katId = kategori_id ? parseInt(kategori_id) : null;

        if (!katId && nama_kategori && nama_kategori.trim() !== "") {
            let kat = await prisma.kategori.findFirst({ where: { nama_kategori: nama_kategori.trim() } });
            if (!kat) {
                kat = await prisma.kategori.create({ data: { nama_kategori: nama_kategori.trim() } });
            }
            katId = kat.id;
        }

        if (!katId) {
            return res.status(400).json({ success: false, message: "Kategori utama wajib dipilih." });
        }

        const data = await prisma.subKategori.create({
            data: { kategori_id: katId, nama_sub_kategori: nama_sub_kategori.trim() }
        });

        res.json({ success: true, message: "Sub kategori berhasil ditambahkan.", data });
    } catch (err) {
        if (err.code === "P2002") {
            return res.status(400).json({ success: false, message: "Sub kategori ini sudah terdaftar." });
        }
        res.status(500).json({ success: false, message: err.message });
    }
};

const deleteSubKategori = async (req, res) => {
    const { id } = req.params;
    try {
        await prisma.subKategori.delete({ where: { id: parseInt(id) } });
        res.json({ success: true, message: "Sub kategori berhasil dihapus." });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

module.exports = {
    getKategori,
    createKategori,
    deleteKategori,
    getSubKategori,
    createSubKategori,
    deleteSubKategori
};
