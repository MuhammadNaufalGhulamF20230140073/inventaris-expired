const prisma = require("../prismaClient");

// Helper normalisasi tanggal
const normalizeTanggalDB = (tgl) => {
    if (!tgl) return new Date().toISOString().slice(0, 10);
    if (tgl.includes("T")) return tgl.split("T")[0];
    return tgl.trim();
};

// Helper generate No Order otomatis: OUT-YYYYMMDD-001
const generateNoOrderHelper = async (tglPemakaian) => {
    const cleanDate = (tglPemakaian || new Date().toISOString().slice(0, 10)).replace(/-/g, "");
    const prefix = `OUT-${cleanDate}-`;

    const rows = await prisma.pemakaian.findMany({
        where: { no_order: { startsWith: prefix } },
        select: { no_order: true },
        distinct: ["no_order"]
    });

    const count = rows ? rows.length : 0;
    const nextSeq = String(count + 1).padStart(3, "0");
    return `${prefix}${nextSeq}`;
};

// Endpoint API untuk mendapatkan No. Order Otomatis berikutnya
const getNextNoOrder = async (req, res) => {
    try {
        const tgl = req.query.tanggal || new Date().toISOString().slice(0, 10);
        const nextNoOrder = await generateNoOrderHelper(tgl);
        res.json({ success: true, no_order: nextNoOrder });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// Ambil semua data pemakaian barang
const getPemakaian = async (req, res) => {
    const { bulan, tgl_dari, tgl_sampai, q, kode_produk, kategori, sort } = req.query;

    try {
        // Ambil pemakaian
        const whereP = {};
        if (kode_produk && kode_produk.trim() !== "") whereP.kode_produk = kode_produk.trim();

        let rows = await prisma.pemakaian.findMany({
            where: whereP,
            orderBy: [
                { tanggal_pemakaian: sort === "terlama" ? "asc" : "desc" },
                { id: sort === "terlama" ? "asc" : "desc" }
            ]
        });

        // Join manual dengan barang dan nama_barang untuk kategori/sub_kategori/satuan
        const allBarang = await prisma.barang.findMany({ select: { nama_produk: true, kategori: true, sub_kategori: true, satuan: true } });
        const allNamaBarang = await prisma.namaBarang.findMany({ select: { kode: true, nama: true, kategori: true, sub_kategori: true, satuan: true } });

        const barangMap = {};
        allBarang.forEach(b => { if (!barangMap[b.nama_produk]) barangMap[b.nama_produk] = b; });
        const nbKodeMap = {};
        const nbNamaMap = {};
        allNamaBarang.forEach(nb => {
            if (nb.kode) nbKodeMap[nb.kode] = nb;
            nbNamaMap[nb.nama] = nb;
        });

        rows = rows.map(p => {
            const b = barangMap[p.nama_produk];
            const nb = nbKodeMap[p.kode_produk] || nbNamaMap[p.nama_produk];
            return {
                ...p,
                kategori: b?.kategori || nb?.kategori || "Umum",
                sub_kategori: b?.sub_kategori || nb?.sub_kategori || "",
                satuan: b?.satuan || nb?.satuan || "Unit"
            };
        });

        // Filter tanggal
        if (tgl_dari && tgl_dari.trim() !== "") {
            rows = rows.filter(r => (r.tanggal_pemakaian || "") >= tgl_dari.trim());
        }
        if (tgl_sampai && tgl_sampai.trim() !== "") {
            rows = rows.filter(r => (r.tanggal_pemakaian || "") <= tgl_sampai.trim());
        }
        if (bulan && bulan.match(/^\d{4}-\d{2}$/)) {
            rows = rows.filter(r => (r.tanggal_pemakaian || "").startsWith(bulan));
        }
        if (kategori && kategori.trim() !== "") {
            rows = rows.filter(r => r.kategori === kategori.trim());
        }
        if (q && q.trim() !== "") {
            const term = q.trim().toLowerCase();
            rows = rows.filter(r =>
                (r.no_order || "").toLowerCase().includes(term) ||
                (r.kode_produk || "").toLowerCase().includes(term) ||
                (r.nama_produk || "").toLowerCase().includes(term) ||
                (r.penerima || "").toLowerCase().includes(term) ||
                (r.keterangan || "").toLowerCase().includes(term) ||
                (r.kategori || "").toLowerCase().includes(term)
            );
        }

        res.json({ success: true, total: rows.length, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// Tambah/Update Batch Transaksi Pemakaian Barang
const tambahPemakaian = async (req, res) => {
    const { items, no_order, is_edit, kode_produk, nama_produk, jumlah, tanggal_pemakaian, penerima, keterangan } = req.body;

    const list = (Array.isArray(items) && items.length > 0) ? items : [{ kode_produk, nama_produk, jumlah, keterangan }];

    if (!penerima || penerima.trim() === "") {
        return res.status(400).json({ success: false, message: "Nama penerima / pemakai wajib dipilih." });
    }

    const tglPemakaian = normalizeTanggalDB(tanggal_pemakaian);
    let targetNoOrder = (no_order && no_order.trim() !== "") ? no_order.trim() : await generateNoOrderHelper(tglPemakaian);

    try {
        if (is_edit && targetNoOrder) {
            await prisma.pemakaian.deleteMany({ where: { no_order: targetNoOrder } });
        }

        let processCount = 0;

        for (const item of list) {
            const qtyKeluar = parseInt(item.jumlah, 10) || 0;
            if (!item.nama_produk || qtyKeluar <= 0) continue;

            // Hitung stok
            const totalMasukAgg = await prisma.barang.aggregate({ where: { nama_produk: item.nama_produk, is_arsip: 0 }, _sum: { jumlah: true } });
            const totalDipakaiAgg = await prisma.pemakaian.aggregate({ where: { nama_produk: item.nama_produk }, _sum: { jumlah: true } });

            const totalMasuk = parseInt(totalMasukAgg._sum.jumlah, 10) || 0;
            const totalDipakai = parseInt(totalDipakaiAgg._sum.jumlah, 10) || 0;
            const stokTersedia = Math.max(0, totalMasuk - totalDipakai);

            if (stokTersedia < qtyKeluar) {
                return res.status(400).json({
                    success: false,
                    message: `Stok produk "${item.nama_produk}" tidak mencukupi (${stokTersedia} unit tersedia).`
                });
            }

            // Ambil kode produk utama
            const mainBarang = await prisma.barang.findFirst({ where: { nama_produk: item.nama_produk, is_arsip: 0 }, select: { kode_produk: true } });
            const mainKode = item.kode_produk || mainBarang?.kode_produk || "";

            await prisma.pemakaian.create({
                data: {
                    no_order: targetNoOrder,
                    kode_produk: mainKode,
                    nama_produk: item.nama_produk,
                    jumlah: qtyKeluar,
                    tanggal_pemakaian: tglPemakaian,
                    penerima: penerima.trim(),
                    keterangan: item.keterangan || keterangan || ""
                }
            });
            processCount++;
        }

        res.json({
            success: true,
            no_order: targetNoOrder,
            message: `Berhasil menyimpan pemakaian ${processCount} produk (${targetNoOrder}) untuk penerima "${penerima}".`
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// Update single transaksi pemakaian
const updatePemakaian = async (req, res) => {
    const { id } = req.params;
    const { kode_produk, nama_produk, jumlah, penerima, tanggal_pemakaian, keterangan } = req.body;

    try {
        const oldRow = await prisma.pemakaian.findUnique({ where: { id: parseInt(id) } });
        if (!oldRow) return res.status(404).json({ success: false, message: "Data pemakaian tidak ditemukan." });

        const targetNamaBarang = (nama_produk || oldRow.nama_produk).trim();
        const newJumlah = parseInt(jumlah, 10);
        const newPenerima = (penerima || oldRow.penerima).trim();
        const newTanggal = normalizeTanggalDB(tanggal_pemakaian || oldRow.tanggal_pemakaian);
        const newKeterangan = keterangan !== undefined ? keterangan : oldRow.keterangan;

        if (isNaN(newJumlah) || newJumlah <= 0) {
            return res.status(400).json({ success: false, message: "Jumlah pemakaian harus lebih dari 0." });
        }

        const totalMasukAgg = await prisma.barang.aggregate({ where: { nama_produk: targetNamaBarang, is_arsip: 0 }, _sum: { jumlah: true } });
        const totalDipakaiAgg = await prisma.pemakaian.aggregate({ where: { nama_produk: targetNamaBarang }, _sum: { jumlah: true } });

        let totalMasuk = parseInt(totalMasukAgg._sum.jumlah, 10) || 0;
        let totalDipakai = parseInt(totalDipakaiAgg._sum.jumlah, 10) || 0;
        if (targetNamaBarang === oldRow.nama_produk) totalDipakai -= oldRow.jumlah;
        const stokTersedia = Math.max(0, totalMasuk - totalDipakai);

        if (stokTersedia < newJumlah) {
            return res.status(400).json({
                success: false,
                message: `Stok produk "${targetNamaBarang}" tidak mencukupi untuk ${newJumlah} unit (${stokTersedia} unit tersedia).`
            });
        }

        let targetKode = kode_produk || oldRow.kode_produk;
        if (!targetKode || targetNamaBarang !== oldRow.nama_produk) {
            const bRow = await prisma.barang.findFirst({ where: { nama_produk: targetNamaBarang }, select: { kode_produk: true } });
            if (bRow?.kode_produk) targetKode = bRow.kode_produk;
        }

        await prisma.pemakaian.update({
            where: { id: parseInt(id) },
            data: { kode_produk: targetKode, nama_produk: targetNamaBarang, jumlah: newJumlah, penerima: newPenerima, tanggal_pemakaian: newTanggal, keterangan: newKeterangan }
        });

        res.json({ success: true, message: "Data pemakaian berhasil diperbarui." });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// Hapus transaksi pemakaian
const hapusPemakaian = async (req, res) => {
    const { id } = req.params;
    try {
        const row = await prisma.pemakaian.findUnique({ where: { id: parseInt(id) } });
        if (!row) return res.status(404).json({ success: false, message: "Data pemakaian tidak ditemukan." });
        await prisma.pemakaian.delete({ where: { id: parseInt(id) } });
        res.json({ success: true, message: "Transaksi pemakaian berhasil dibatalkan." });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

module.exports = { getPemakaian, getNextNoOrder, tambahPemakaian, updatePemakaian, hapusPemakaian };
