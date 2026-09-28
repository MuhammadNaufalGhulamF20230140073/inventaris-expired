const prisma = require("../prismaClient");

// Ambil semua satuan
const getSatuan = async (req, res) => {
    try {
        const rows = await prisma.satuan.findMany({ orderBy: { nama_satuan: "asc" } });
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// Tambah satuan baru
const createSatuan = async (req, res) => {
    const { nama_satuan } = req.body;
    if (!nama_satuan || nama_satuan.trim() === "") {
        return res.status(400).json({ success: false, message: "Nama satuan wajib diisi." });
    }
    try {
        const data = await prisma.satuan.create({ data: { nama_satuan: nama_satuan.trim() } });
        res.json({ success: true, message: "Satuan berhasil ditambahkan.", data });
    } catch (err) {
        if (err.code === "P2002") {
            return res.status(400).json({ success: false, message: "Satuan sudah terdaftar." });
        }
        res.status(500).json({ success: false, message: err.message });
    }
};

// Hapus satuan
const deleteSatuan = async (req, res) => {
    const { id } = req.params;
    try {
        await prisma.satuan.delete({ where: { id: parseInt(id) } });
        res.json({ success: true, message: "Satuan berhasil dihapus." });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

module.exports = { getSatuan, createSatuan, deleteSatuan };
