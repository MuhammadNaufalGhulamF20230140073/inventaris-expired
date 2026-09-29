const prisma = require("../prismaClient");

// Ambil semua nama barang beserta total_stok real-time
const getNamaBarang = async (req, res) => {
    try {
        const namaBarangList = await prisma.namaBarang.findMany({ orderBy: { nama: "asc" } });

        // Hitung total masuk dan total pakai untuk setiap produk
        const barangAgg = await prisma.barang.groupBy({
            by: ["nama_produk"],
            where: { is_arsip: 0 },
            _sum: { jumlah: true }
        });
        const pemakaianAgg = await prisma.pemakaian.groupBy({
            by: ["nama_produk"],
            _sum: { jumlah: true }
        });

        const masukMap = {};
        barangAgg.forEach(b => { masukMap[(b.nama_produk || "").trim()] = parseInt(b._sum.jumlah, 10) || 0; });
        const pakaiMap = {};
        pemakaianAgg.forEach(p => { pakaiMap[(p.nama_produk || "").trim()] = parseInt(p._sum.jumlah, 10) || 0; });

        const data = namaBarangList.map(nb => ({
            ...nb,
            total_stok: Math.max(0, (masukMap[nb.nama] || 0) - (pakaiMap[nb.nama] || 0))
        }));

        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// Helper sync master data
const syncMasterDataHelper = async (kategori, sub_kategori, satuan, lokasi) => {
    try {
        if (kategori && kategori.trim() !== "") {
            const kat = await prisma.kategori.upsert({
                where: { nama_kategori: kategori.trim() },
                update: {},
                create: { nama_kategori: kategori.trim() }
            });
            if (sub_kategori && sub_kategori.trim() !== "") {
                await prisma.subKategori.upsert({
                    where: { kategori_id_nama_sub_kategori: { kategori_id: kat.id, nama_sub_kategori: sub_kategori.trim() } },
                    update: {},
                    create: { kategori_id: kat.id, nama_sub_kategori: sub_kategori.trim() }
                });
            }
        }
        if (satuan && satuan.trim() !== "") {
            await prisma.satuan.upsert({ where: { nama_satuan: satuan.trim() }, update: {}, create: { nama_satuan: satuan.trim() } });
        }
        if (lokasi && lokasi.trim() !== "") {
            await prisma.lokasi.upsert({ where: { nama_lokasi: lokasi.trim() }, update: {}, create: { nama_lokasi: lokasi.trim() } });
        }
    } catch (e) {
        // Silent — sync master tidak boleh memblock response utama
    }
};

// Tambah nama barang
const createNamaBarang = async (req, res) => {
    const { kode, nama, kategori, sub_kategori, satuan, lokasi } = req.body;
    if (!nama || nama.trim() === "") {
        return res.status(400).json({ success: false, message: "Nama barang wajib diisi." });
    }
    try {
        const data = await prisma.namaBarang.create({
            data: {
                kode: kode?.trim() || "",
                nama: nama.trim(),
                kategori: kategori?.trim() || "",
                sub_kategori: sub_kategori?.trim() || "",
                satuan: satuan?.trim() || "",
                lokasi: lokasi?.trim() || ""
            }
        });
        await syncMasterDataHelper(kategori, sub_kategori, satuan, lokasi);
        res.json({ success: true, message: "Data barang berhasil ditambahkan.", data });
    } catch (err) {
        if (err.code === "P2002") return res.status(400).json({ success: false, message: "Nama barang sudah terdaftar." });
        res.status(500).json({ success: false, message: err.message });
    }
};

// Update nama barang
const updateNamaBarang = async (req, res) => {
    const { id } = req.params;
    const { kode, nama, kategori, sub_kategori, satuan, lokasi, manual_total_stok } = req.body;

    if (!nama || nama.trim() === "") {
        return res.status(400).json({ success: false, message: "Nama barang wajib diisi." });
    }

    const cleanNama = nama.trim();
    const cleanKode = kode ? kode.trim() : "";
    const cleanKat = kategori ? kategori.trim() : "";
    const cleanSub = sub_kategori ? sub_kategori.trim() : "";
    const cleanSat = satuan ? satuan.trim() : "";
    const cleanLok = lokasi ? lokasi.trim() : "";

    try {
        const oldMaster = await prisma.namaBarang.findUnique({ where: { id: parseInt(id) } });
        if (!oldMaster) return res.status(404).json({ success: false, message: "Data barang tidak ditemukan." });

        const oldNama = oldMaster.nama || "";
        const oldKode = oldMaster.kode || "";

        await prisma.namaBarang.update({
            where: { id: parseInt(id) },
            data: { kode: cleanKode, nama: cleanNama, kategori: cleanKat, sub_kategori: cleanSub, satuan: cleanSat, lokasi: cleanLok }
        });

        // Sinkronkan ke tabel barang dan pemakaian
        if (oldNama !== cleanNama || oldKode !== cleanKode) {
            await prisma.barang.updateMany({
                where: { OR: [{ nama_produk: oldNama }, { kode_produk: oldKode }, { nama_produk: cleanNama }] },
                data: { kode_produk: cleanKode, nama_produk: cleanNama, kategori: cleanKat, sub_kategori: cleanSub, satuan: cleanSat, lokasi: cleanLok }
            });
            await prisma.pemakaian.updateMany({
                where: { OR: [{ nama_produk: oldNama }, { kode_produk: oldKode }, { nama_produk: cleanNama }] },
                data: { kode_produk: cleanKode, nama_produk: cleanNama }
            });
        }

        // Penyesuaian stok manual
        if (manual_total_stok !== undefined && manual_total_stok !== null && manual_total_stok !== "") {
            const targetStok = parseInt(manual_total_stok, 10) || 0;
            const batch = await prisma.barang.findFirst({ where: { nama_produk: cleanNama, is_arsip: 0 } });
            if (batch) {
                await prisma.barang.update({ where: { id: batch.id }, data: { jumlah: targetStok, updated_at: new Date() } });
            } else {
                const newKodeBatch = cleanKode ? `${cleanKode}-b1` : `PRD-${Date.now()}`;
                await prisma.barang.create({
                    data: { kode_produk: newKodeBatch, nama_produk: cleanNama, kategori: cleanKat, sub_kategori: cleanSub, satuan: cleanSat, jumlah: targetStok, tanggal_expired: "2099-12-31", tanggal_masuk: new Date().toISOString().slice(0, 10), lokasi: cleanLok }
                });
            }
        }

        await syncMasterDataHelper(cleanKat, cleanSub, cleanSat, cleanLok);
        res.json({ success: true, message: "Data barang berhasil diperbarui dan riwayat stok telah disinkronkan." });
    } catch (err) {
        if (err.code === "P2002") return res.status(400).json({ success: false, message: "Nama barang sudah terdaftar." });
        res.status(500).json({ success: false, message: err.message });
    }
};

// Hapus nama barang
const deleteNamaBarang = async (req, res) => {
    const { id } = req.params;
    try {
        await prisma.namaBarang.delete({ where: { id: parseInt(id) } });
        res.json({ success: true, message: "Data barang berhasil dihapus." });
    } catch (err) {
        if (err.code === "P2025") return res.status(404).json({ success: false, message: "Data barang tidak ditemukan." });
        res.status(500).json({ success: false, message: err.message });
    }
};

module.exports = { getNamaBarang, createNamaBarang, updateNamaBarang, deleteNamaBarang };
