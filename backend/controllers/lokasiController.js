const prisma = require("../prismaClient");

// Ambil semua lokasi
const getLokasi = async (req, res) => {
    try {
        const rows = await prisma.lokasi.findMany({ orderBy: { nama_lokasi: "asc" } });
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// Tambah lokasi baru
const createLokasi = async (req, res) => {
    const { nama_lokasi } = req.body;
    if (!nama_lokasi || nama_lokasi.trim() === "") {
        return res.status(400).json({ success: false, message: "Nama lokasi wajib diisi." });
    }
    try {
        const data = await prisma.lokasi.create({ data: { nama_lokasi: nama_lokasi.trim() } });
        res.json({ success: true, message: "Lokasi berhasil ditambahkan.", data });
    } catch (err) {
        if (err.code === "P2002") {
            return res.status(400).json({ success: false, message: "Lokasi sudah terdaftar." });
        }
        res.status(500).json({ success: false, message: err.message });
    }
};

// Hapus lokasi
const deleteLokasi = async (req, res) => {
    const { id } = req.params;
    try {
        await prisma.lokasi.delete({ where: { id: parseInt(id) } });
        res.json({ success: true, message: "Lokasi berhasil dihapus." });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

module.exports = { getLokasi, createLokasi, deleteLokasi };
