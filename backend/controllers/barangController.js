const prisma = require("../prismaClient");

// ======================
// Helper Tanggal & Status
// ======================
const BULAN_INDO = {
    "januari": 1, "februari": 2, "maret": 3, "april": 4,
    "mei": 5, "juni": 6, "juli": 7, "agustus": 8,
    "september": 9, "oktober": 10, "november": 11, "desember": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4,
    "jun": 6, "jul": 7, "ags": 8, "agu": 8, "aug": 8,
    "sep": 9, "okt": 10, "oct": 10, "nov": 11, "des": 12, "dec": 12
};

function normalizeTanggalDB(raw) {
    if (!raw || String(raw).trim() === "") return "";
    let val = String(raw).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
    let m = val.match(/^(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{4})$/);
    if (m) return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
    m = val.match(/^(\d{4})[\-\/](\d{1,2})$/);
    if (m) return `${m[1]}-${String(parseInt(m[2])).padStart(2, "0")}-01`;
    m = val.match(/^(\d{1,2})[\-\/](\d{4})$/);
    if (m) return `${m[2]}-${String(parseInt(m[1])).padStart(2, "0")}-01`;
    m = val.match(/^([a-zA-Z]+)\s+(\d{4})$/i);
    if (m) { const month = BULAN_INDO[m[1].toLowerCase()]; if (month) return `${m[2]}-${String(month).padStart(2, "0")}-01`; }
    m = val.match(/^(\d{4})\s+([a-zA-Z]+)$/i);
    if (m) { const month = BULAN_INDO[m[2].toLowerCase()]; if (month) return `${m[1]}-${String(month).padStart(2, "0")}-01`; }
    m = val.match(/^(\d{4})$/);
    if (m) return `${m[1]}-01-01`;
    const parsed = new Date(val);
    if (!isNaN(parsed.getTime())) return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
    return val;
}

function hitungStatus(item) {
    if (Number(item.is_no_expired) === 1) return { ...item, sisa_hari: 99999, status: "Aman", warna: "green" };
    const today = new Date();
    const normalizedDate = normalizeTanggalDB(item.tanggal_expired);
    const expiredDate = new Date(normalizedDate);
    if (isNaN(expiredDate.getTime())) return { ...item, sisa_hari: -9999, status: "Expired", warna: "gray" };
    const selisihHari = Math.ceil((expiredDate - today) / (1000 * 60 * 60 * 24));
    let status = "", warna = "";
    if (selisihHari < 0) { status = "Expired"; warna = "gray"; }
    else if (selisihHari <= 30) { status = "Segera Expired"; warna = "red"; }
    else if (selisihHari <= 60) { status = "Perlu Diperhatikan"; warna = "yellow"; }
    else { status = "Aman"; warna = "green"; }
    return { ...item, sisa_hari: selisihHari, status, warna };
}

// Hitung stok sisa per batch (FIFO)
async function attachStokSisaBatch(rows) {
    const pemakaianRows = await prisma.pemakaian.groupBy({
        by: ["nama_produk"],
        _sum: { jumlah: true }
    });
    const usageMap = {};
    pemakaianRows.forEach(p => {
        const key = (p.nama_produk || "").trim().toLowerCase();
        usageMap[key] = parseInt(p._sum.jumlah, 10) || 0;
    });

    const grouped = {};
    rows.forEach((r, idx) => {
        const key = (r.nama_produk || "").trim().toLowerCase();
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push({ ...r, _origIdx: idx });
    });

    const result = new Array(rows.length);
    Object.keys(grouped).forEach(key => {
        let usage = usageMap[key] || 0;
        const batches = grouped[key].sort((a, b) => {
            const dateA = a.tanggal_expired || "9999-12-31";
            const dateB = b.tanggal_expired || "9999-12-31";
            return dateA < dateB ? -1 : dateA > dateB ? 1 : a.id - b.id;
        });
        batches.forEach(b => {
            const batchQty = parseInt(b.jumlah, 10) || 0;
            const deduct = Math.min(usage, batchQty);
            const sisa = Math.max(0, batchQty - deduct);
            usage -= deduct;
            const itemWithStatus = hitungStatus({ ...b, stok_sisa: sisa });
            delete itemWithStatus._origIdx;
            result[b._origIdx] = itemWithStatus;
        });
    });
    return result;
}

// Helper sync master data (silent, tidak block response)
async function syncMasterData(kategori, sub_kategori, satuan, lokasi, nama_produk, kode_produk) {
    try {
        if (kategori && kategori.trim() !== "") {
            const kat = await prisma.kategori.upsert({
                where: { nama_kategori: kategori.trim() },
                update: {}, create: { nama_kategori: kategori.trim() }
            });
            if (sub_kategori && sub_kategori.trim() !== "") {
                await prisma.subKategori.upsert({
                    where: { kategori_id_nama_sub_kategori: { kategori_id: kat.id, nama_sub_kategori: sub_kategori.trim() } },
                    update: {}, create: { kategori_id: kat.id, nama_sub_kategori: sub_kategori.trim() }
                }).catch(() => {});
            }
        }
        if (satuan && satuan.trim() !== "") {
            await prisma.satuan.upsert({ where: { nama_satuan: satuan.trim() }, update: {}, create: { nama_satuan: satuan.trim() } }).catch(() => {});
        }
        if (lokasi && lokasi.trim() !== "") {
            await prisma.lokasi.upsert({ where: { nama_lokasi: lokasi.trim() }, update: {}, create: { nama_lokasi: lokasi.trim() } }).catch(() => {});
        }
        if (nama_produk && nama_produk.trim() !== "") {
            const baseKode = kode_produk ? kode_produk.replace(/-b\d+$/, '') : '';
            await prisma.namaBarang.upsert({
                where: { nama: nama_produk.trim() },
                update: {},
                create: {
                    kode: baseKode || "",
                    nama: nama_produk.trim(),
                    kategori: kategori?.trim() || "",
                    sub_kategori: sub_kategori?.trim() || "",
                    satuan: satuan?.trim() || "",
                    lokasi: lokasi?.trim() || ""
                }
            }).catch(() => {});
        }
    } catch (e) { /* silent */ }
}

// Helper filter barang (in-memory post-fetch)
function applyInMemoryBarangFilters(rows, query) {
    const { tgl_dari, tgl_sampai, bulan, kategori, q } = query;
    let filtered = rows;
    if (tgl_dari && tgl_dari.trim() !== "") {
        filtered = filtered.filter(r => (r.tanggal_masuk || "") >= tgl_dari.trim());
    }
    if (tgl_sampai && tgl_sampai.trim() !== "") {
        filtered = filtered.filter(r => (r.tanggal_masuk || "") <= tgl_sampai.trim());
    }
    if (bulan && bulan.match(/^\d{4}-\d{2}$/)) {
        filtered = filtered.filter(r => (r.tanggal_masuk || "").startsWith(bulan));
    }
    if (kategori && kategori.trim() !== "") {
        filtered = filtered.filter(r => (r.kategori || "").toLowerCase() === kategori.trim().toLowerCase());
    }
    if (q && q.trim() !== "") {
        const term = q.trim().toLowerCase();
        filtered = filtered.filter(r =>
            (r.kode_produk || "").toLowerCase().includes(term) ||
            (r.nama_produk || "").toLowerCase().includes(term) ||
            (r.kategori || "").toLowerCase().includes(term) ||
            (r.sub_kategori || "").toLowerCase().includes(term) ||
            (r.lokasi || "").toLowerCase().includes(term) ||
            (r.no_penerimaan || "").toLowerCase().includes(term) ||
            (r.penerima || "").toLowerCase().includes(term)
        );
    }
    return filtered;
}

// ======================
// Tambah Barang
// ======================
const tambahBarang = async (req, res) => {
    const { kode_produk, nama_produk, kategori, sub_kategori, satuan, jumlah, tanggal_expired, tanggal_masuk, lokasi, penerima, no_penerimaan } = req.body;

    if (!kode_produk || !nama_produk || jumlah == null || !tanggal_expired) {
        return res.status(400).json({ success: false, message: "Nama produk, jumlah, dan tanggal expired wajib diisi." });
    }

    const tglMasuk = tanggal_masuk ? normalizeTanggalDB(tanggal_masuk) : new Date().toISOString().slice(0, 10);
    const tglExp = Number(req.body.is_no_expired) === 1 ? "2099-12-31" : normalizeTanggalDB(tanggal_expired);
    const qtyInt = parseInt(jumlah, 10) || 0;
    const cleanNoPenerimaan = (no_penerimaan && String(no_penerimaan).trim() !== "") ? String(no_penerimaan).trim() : `IN-${tglMasuk.replace(/-/g, "")}-001`;
    const cleanKode = (kode_produk || "").trim();

    try {
        await prisma.barang.create({
            data: {
                no_penerimaan: cleanNoPenerimaan,
                kode_produk: cleanKode,
                nama_produk: nama_produk.trim(),
                kategori: kategori || "",
                sub_kategori: sub_kategori || "",
                satuan: satuan || "Pcs",
                jumlah: qtyInt,
                tanggal_expired: tglExp,
                tanggal_masuk: tglMasuk,
                lokasi: lokasi || "",
                penerima: penerima || "",
                is_no_expired: req.body.is_no_expired ? 1 : 0
            }
        });

        await syncMasterData(kategori, sub_kategori, satuan, lokasi, nama_produk, kode_produk);

        return res.status(201).json({ success: true, merged: false, message: `Penerimaan barang baru berhasil disimpan (No. Masuk: ${cleanNoPenerimaan}).` });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

// ======================
// Semua Barang
// ======================
const getSemuaBarang = async (req, res) => {
    try {
        let rows = await prisma.barang.findMany({
            where: { is_arsip: 0 },
            orderBy: [{ tanggal_masuk: "desc" }, { tanggal_expired: "asc" }]
        });
        rows = applyInMemoryBarangFilters(rows, req.query);
        const hasil = await attachStokSisaBatch(rows);
        res.json({ success: true, total: hasil.length, data: hasil });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ======================
// Barang Expired
// ======================
const getBarangExpired = async (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const { tgl_dari_exp, tgl_sampai_exp } = req.query;
    try {
        const where = { is_arsip: 0, is_no_expired: 0 };
        // Hitung expired via in-memory (tanggal_expired disimpan sebagai string)
        let rows = await prisma.barang.findMany({ where, orderBy: { tanggal_expired: "asc" } });

        // Filter expired
        rows = rows.filter(r => {
            const norm = normalizeTanggalDB(r.tanggal_expired);
            return norm <= today;
        });

        if (tgl_dari_exp && tgl_dari_exp.trim() !== "") rows = rows.filter(r => normalizeTanggalDB(r.tanggal_expired) >= tgl_dari_exp.trim());
        if (tgl_sampai_exp && tgl_sampai_exp.trim() !== "") rows = rows.filter(r => normalizeTanggalDB(r.tanggal_expired) <= tgl_sampai_exp.trim());
        rows = applyInMemoryBarangFilters(rows, req.query);

        const hasil = await attachStokSisaBatch(rows);
        res.json({ success: true, total: hasil.length, data: hasil });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ======================
// Data Arsip
// ======================
const getArsip = async (req, res) => {
    try {
        let rows = await prisma.barang.findMany({ where: { is_arsip: 1 }, orderBy: [{ tanggal_masuk: "desc" }, { updated_at: "desc" }] });
        rows = applyInMemoryBarangFilters(rows, req.query);
        const hasil = rows.map(hitungStatus);
        res.json({ success: true, total: hasil.length, data: hasil });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ======================
// Cari Barang
// ======================
const cariBarang = async (req, res) => {
    try {
        let rows = await prisma.barang.findMany({ where: { is_arsip: 0 }, orderBy: [{ tanggal_masuk: "desc" }, { tanggal_expired: "asc" }] });
        rows = applyInMemoryBarangFilters(rows, req.query);
        const hasil = rows.map(hitungStatus);
        res.json({ success: true, total: hasil.length, data: hasil });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ======================
// Get Barang by Kode
// ======================
const getBarangByKode = async (req, res) => {
    const { kode_produk } = req.params;
    try {
        const row = await prisma.barang.findFirst({ where: { kode_produk } });
        if (!row) return res.status(404).json({ success: false, message: "Barang tidak ditemukan." });
        res.json({ success: true, data: hitungStatus(row) });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ======================
// Update Barang
// ======================
const updateBarang = async (req, res) => {
    const { kode_produk } = req.params;
    const targetId = req.body.id || (!isNaN(kode_produk) ? parseInt(kode_produk, 10) : null);
    const { nama_produk, kategori, sub_kategori, satuan, jumlah, tanggal_expired, tanggal_masuk, lokasi, penerima } = req.body;

    const tglExp = Number(req.body.is_no_expired) === 1 ? "2099-12-31" : normalizeTanggalDB(tanggal_expired);
    const tglMasuk = tanggal_masuk ? normalizeTanggalDB(tanggal_masuk) : undefined;

    const data = {
        nama_produk, kategori, sub_kategori: sub_kategori || "",
        satuan, jumlah: parseInt(jumlah, 10), tanggal_expired: tglExp,
        lokasi, penerima: penerima || "",
        is_no_expired: req.body.is_no_expired ? 1 : 0,
        updated_at: new Date()
    };
    if (tglMasuk) data.tanggal_masuk = tglMasuk;

    try {
        const where = targetId ? { id: targetId } : { id: (await prisma.barang.findFirst({ where: { kode_produk }, select: { id: true } }))?.id };
        if (!where.id) return res.status(404).json({ success: false, message: "Barang tidak ditemukan." });

        await prisma.barang.update({ where: { id: where.id }, data });
        await syncMasterData(kategori, sub_kategori, satuan, lokasi, nama_produk, null);
        res.json({ success: true, message: "Barang berhasil diperbarui." });
    } catch (err) {
        if (err.code === "P2025") return res.status(404).json({ success: false, message: "Barang tidak ditemukan." });
        res.status(500).json({ success: false, message: err.message });
    }
};

// ======================
// Hapus Barang
// ======================
const hapusBarang = async (req, res) => {
    const { kode_produk } = req.params;
    const targetId = !isNaN(kode_produk) ? parseInt(kode_produk, 10) : (req.body && req.body.id);
    try {
        if (targetId) {
            await prisma.barang.delete({ where: { id: targetId } });
        } else {
            const found = await prisma.barang.findFirst({ where: { kode_produk }, select: { id: true } });
            if (!found) return res.status(404).json({ success: false, message: "Barang tidak ditemukan." });
            await prisma.barang.delete({ where: { id: found.id } });
        }
        res.json({ success: true, message: "Barang berhasil dihapus." });
    } catch (err) {
        if (err.code === "P2025") return res.status(404).json({ success: false, message: "Barang tidak ditemukan." });
        res.status(500).json({ success: false, message: err.message });
    }
};

// ======================
// Arsipkan Barang
// ======================
const arsipkanBarang = async (req, res) => {
    const { kode_produk } = req.params;
    const targetId = !isNaN(kode_produk) ? parseInt(kode_produk, 10) : (req.body && req.body.id);
    try {
        if (targetId) {
            await prisma.barang.update({ where: { id: targetId }, data: { is_arsip: 1, updated_at: new Date() } });
        } else {
            await prisma.barang.updateMany({ where: { kode_produk }, data: { is_arsip: 1, updated_at: new Date() } });
        }
        res.json({ success: true, message: "Barang berhasil diarsipkan." });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ======================
// Pulihkan Barang
// ======================
const pulihkanBarang = async (req, res) => {
    const { kode_produk } = req.params;
    const targetId = !isNaN(kode_produk) ? parseInt(kode_produk, 10) : (req.body && req.body.id);
    try {
        if (targetId) {
            await prisma.barang.update({ where: { id: targetId }, data: { is_arsip: 0, updated_at: new Date() } });
        } else {
            await prisma.barang.updateMany({ where: { kode_produk }, data: { is_arsip: 0, updated_at: new Date() } });
        }
        res.json({ success: true, message: "Barang berhasil dipulihkan." });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ======================
// Arsipkan Batch Penerimaan
// ======================
const arsipkanBatchPenerimaan = async (req, res) => {
    const { no_penerimaan } = req.params;
    if (!no_penerimaan) return res.status(400).json({ success: false, message: "No. Penerimaan tidak valid." });
    try {
        const result = await prisma.barang.updateMany({ where: { no_penerimaan }, data: { is_arsip: 1, updated_at: new Date() } });
        res.json({ success: true, message: `Seluruh transaksi penerimaan "${no_penerimaan}" (${result.count} item) berhasil diarsipkan.` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ======================
// Pulihkan Batch Penerimaan
// ======================
const pulihkanBatchPenerimaan = async (req, res) => {
    const { no_penerimaan } = req.params;
    if (!no_penerimaan) return res.status(400).json({ success: false, message: "No. Penerimaan tidak valid." });
    try {
        const result = await prisma.barang.updateMany({ where: { no_penerimaan }, data: { is_arsip: 0, updated_at: new Date() } });
        res.json({ success: true, message: `Seluruh transaksi penerimaan "${no_penerimaan}" (${result.count} item) berhasil dipulihkan.` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ======================
// Next No. Penerimaan
// ======================
const getNextNoPenerimaan = async (req, res) => {
    let tgl = req.query.tanggal;
    if (!tgl || !/^\d{4}-\d{2}-\d{2}$/.test(tgl)) {
        const today = new Date();
        tgl = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    }
    const cleanDate = tgl.replace(/-/g, "");
    const prefix = `IN-${cleanDate}`;

    try {
        const rows = await prisma.barang.findMany({
            where: { no_penerimaan: { startsWith: `${prefix}-` } },
            select: { no_penerimaan: true },
            orderBy: { no_penerimaan: "desc" }
        });

        let nextNum = 1;
        if (rows && rows.length > 0) {
            const numbers = rows.map(r => {
                const parts = (r.no_penerimaan || "").split("-");
                return parseInt(parts[parts.length - 1], 10) || 0;
            });
            nextNum = Math.max(...numbers, 0) + 1;
        }

        const noPenerimaan = `${prefix}-${String(nextNum).padStart(3, "0")}`;
        res.json({ success: true, no_penerimaan: noPenerimaan });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ======================
// Batch Penerimaan Barang
// ======================
const createBatchPenerimaan = async (req, res) => {
    const { no_penerimaan, penerima, tanggal_masuk, items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, message: "Keranjang penerimaan kosong." });
    }

    const tglMasuk = normalizeTanggalDB(tanggal_masuk || new Date().toISOString().slice(0, 10));
    const noPenerimaan = no_penerimaan || `IN-${tglMasuk.replace(/-/g, "")}-001`;

    try {
        const mergedMap = new Map();
        for (const rawItem of items) {
            const qtyInt = parseInt(rawItem.jumlah, 10);
            if (!rawItem.nama_produk || isNaN(qtyInt) || qtyInt <= 0) continue;
            const tglExp = Number(rawItem.is_no_expired) === 1 ? "2099-12-31" : normalizeTanggalDB(rawItem.tanggal_expired);
            const key = `${rawItem.nama_produk.trim().toLowerCase()}_${tglExp}`;
            if (mergedMap.has(key)) {
                mergedMap.get(key).jumlah = (parseInt(mergedMap.get(key).jumlah, 10) || 0) + qtyInt;
            } else {
                mergedMap.set(key, { ...rawItem, jumlah: qtyInt, tglExp });
            }
        }

        const processedItems = Array.from(mergedMap.values());
        let processedCount = 0;

        for (const item of processedItems) {
            const { kode_produk, nama_produk, kategori, sub_kategori, satuan, jumlah, lokasi, is_no_expired, tglExp } = item;
            const qtyInt = parseInt(jumlah, 10);

            let cleanKode = (kode_produk || "").trim().toUpperCase();
            if (!cleanKode) {
                const initials = nama_produk.split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 4);
                cleanKode = `${initials || "BRG"}-001`;
            }

            await prisma.barang.create({
                data: {
                    no_penerimaan: noPenerimaan,
                    kode_produk: cleanKode,
                    nama_produk: nama_produk.trim(),
                    kategori: kategori || "",
                    sub_kategori: sub_kategori || "",
                    satuan: satuan || "Pcs",
                    jumlah: qtyInt,
                    tanggal_expired: tglExp,
                    tanggal_masuk: tglMasuk,
                    lokasi: lokasi || "",
                    penerima: penerima || "",
                    is_no_expired: Number(is_no_expired) === 1 ? 1 : 0
                }
            });

            await syncMasterData(kategori, sub_kategori, satuan, lokasi, nama_produk, cleanKode);
            processedCount++;
        }

        res.status(201).json({
            success: true,
            message: `Berhasil menyimpan penerimaan barang (${processedCount} produk, No. Masuk: ${noPenerimaan}).`,
            no_penerimaan: noPenerimaan
        });
    } catch (err) {
        console.error("Gagal simpan batch penerimaan:", err);
        res.status(500).json({ success: false, message: err.message || "Gagal menyimpan penerimaan barang." });
    }
};

// ======================
// Get Barang by No. Penerimaan
// ======================
const getBarangByNoPenerimaan = async (req, res) => {
    const { no_penerimaan } = req.params;
    if (!no_penerimaan) return res.status(400).json({ success: false, message: "No. Penerimaan tidak valid." });
    try {
        const rows = await prisma.barang.findMany({
            where: { no_penerimaan, is_arsip: 0 },
            orderBy: { created_at: "asc" }
        });
        const hasil = rows.map(hitungStatus);
        res.json({ success: true, data: hasil });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ======================
// Update Batch Penerimaan
// ======================
const updateBatchPenerimaan = async (req, res) => {
    const { no_penerimaan } = req.params;
    const { penerima, tanggal_masuk, items, deletedItems } = req.body;
    if (!items || !Array.isArray(items)) {
        return res.status(400).json({ success: false, message: "Data items penerimaan tidak valid." });
    }

    const tglMasuk = normalizeTanggalDB(tanggal_masuk || new Date().toISOString().slice(0, 10));

    try {
        // Hapus item yang dihapus
        if (deletedItems && Array.isArray(deletedItems) && deletedItems.length > 0) {
            for (const itemToDelete of deletedItems) {
                const targetId = itemToDelete?.id;
                const kode = typeof itemToDelete === "string" ? itemToDelete : itemToDelete.kode_produk;
                if (targetId) {
                    await prisma.barang.deleteMany({ where: { id: targetId, no_penerimaan } });
                } else if (kode) {
                    await prisma.barang.deleteMany({ where: { kode_produk: kode, no_penerimaan } });
                }
            }
        }

        for (const item of items) {
            const { id, kode_produk, nama_produk, kategori, sub_kategori, satuan, jumlah, tanggal_expired, lokasi, is_no_expired, isExisting } = item;
            const qtyInt = parseInt(jumlah, 10);
            if (!nama_produk || isNaN(qtyInt) || qtyInt <= 0) continue;
            const tglExp = Number(is_no_expired) === 1 ? "2099-12-31" : normalizeTanggalDB(tanggal_expired);

            if ((isExisting || id) && (id || kode_produk)) {
                const dataUpdate = {
                    nama_produk: nama_produk.trim(),
                    kategori: kategori || "", sub_kategori: sub_kategori || "",
                    satuan: satuan || "Pcs", jumlah: qtyInt,
                    tanggal_expired: tglExp, tanggal_masuk: tglMasuk,
                    lokasi: lokasi || "", penerima: penerima || "",
                    is_no_expired: Number(is_no_expired) === 1 ? 1 : 0,
                    updated_at: new Date()
                };
                if (id) {
                    await prisma.barang.update({ where: { id }, data: dataUpdate });
                } else {
                    await prisma.barang.updateMany({ where: { no_penerimaan, kode_produk }, data: dataUpdate });
                }
            } else {
                let cleanKode = (kode_produk || "").trim().toUpperCase();
                if (!cleanKode) {
                    const initials = nama_produk.split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 4);
                    cleanKode = `${initials || "BRG"}-001`;
                }
                await prisma.barang.create({
                    data: {
                        no_penerimaan, kode_produk: cleanKode, nama_produk: nama_produk.trim(),
                        kategori: kategori || "", sub_kategori: sub_kategori || "",
                        satuan: satuan || "Pcs", jumlah: qtyInt, tanggal_expired: tglExp,
                        tanggal_masuk: tglMasuk, lokasi: lokasi || "", penerima: penerima || "",
                        is_no_expired: Number(is_no_expired) === 1 ? 1 : 0
                    }
                });
                await syncMasterData(kategori, sub_kategori, satuan, lokasi, nama_produk, cleanKode);
            }
        }

        res.json({ success: true, message: `Berhasil memperbarui transaksi penerimaan (No. Masuk: ${no_penerimaan}).` });
    } catch (err) {
        console.error("Gagal update batch penerimaan:", err);
        res.status(500).json({ success: false, message: err.message || "Gagal memperbarui penerimaan barang." });
    }
};

// ======================
// Kartu Stok (Mutasi Inbound & Outbound)
// ======================
const getKartuStok = async (req, res) => {
    const { kode_produk, tgl_dari, tgl_sampai, kategori, q } = req.query;

    try {
        const saldoAwalByKode = {};
        let totalSaldoAwal = 0;

        // 1. Hitung Saldo Awal
        if (tgl_dari && tgl_dari.trim() !== "") {
            const prevInWhere = { is_arsip: 0 };
            if (kode_produk && kode_produk.trim() !== "") prevInWhere.kode_produk = kode_produk.trim();
            if (kategori && kategori.trim() !== "" && kategori !== "Semua") prevInWhere.kategori = { equals: kategori.trim(), mode: "insensitive" };

            const prevInRows = await prisma.barang.findMany({
                where: { ...prevInWhere },
                select: { kode_produk: true, jumlah: true, tanggal_masuk: true }
            });

            const prevOutWhere = {};
            if (kode_produk && kode_produk.trim() !== "") prevOutWhere.kode_produk = kode_produk.trim();

            const prevOutRows = await prisma.pemakaian.findMany({
                where: { ...prevOutWhere },
                select: { kode_produk: true, jumlah: true, tanggal_pemakaian: true }
            });

            prevInRows.filter(r => (r.tanggal_masuk || "") < tgl_dari.trim()).forEach(r => {
                const k = r.kode_produk || "GENERAL";
                saldoAwalByKode[k] = (saldoAwalByKode[k] || 0) + (Number(r.jumlah) || 0);
            });
            prevOutRows.filter(r => (r.tanggal_pemakaian || "") < tgl_dari.trim()).forEach(r => {
                const k = r.kode_produk || "GENERAL";
                saldoAwalByKode[k] = (saldoAwalByKode[k] || 0) - (Number(r.jumlah) || 0);
            });
            Object.keys(saldoAwalByKode).forEach(k => {
                saldoAwalByKode[k] = Math.max(0, saldoAwalByKode[k]);
                totalSaldoAwal += saldoAwalByKode[k];
            });
        }

        // 2. Ambil transaksi mutasi dalam rentang
        const inboundWhere = { is_arsip: 0 };
        if (kode_produk && kode_produk.trim() !== "") inboundWhere.kode_produk = kode_produk.trim();
        if (kategori && kategori.trim() !== "" && kategori !== "Semua") inboundWhere.kategori = { equals: kategori.trim(), mode: "insensitive" };
        if (tgl_dari && tgl_dari.trim() !== "") inboundWhere.tanggal_masuk = { gte: tgl_dari.trim() };
        if (tgl_sampai && tgl_sampai.trim() !== "") inboundWhere.tanggal_masuk = { ...inboundWhere.tanggal_masuk, lte: tgl_sampai.trim() };

        const outboundWhere = {};
        if (kode_produk && kode_produk.trim() !== "") outboundWhere.kode_produk = kode_produk.trim();
        if (tgl_dari && tgl_dari.trim() !== "") outboundWhere.tanggal_pemakaian = { gte: tgl_dari.trim() };
        if (tgl_sampai && tgl_sampai.trim() !== "") outboundWhere.tanggal_pemakaian = { ...outboundWhere.tanggal_pemakaian, lte: tgl_sampai.trim() };

        const [inboundRows, outboundRows] = await Promise.all([
            prisma.barang.findMany({ where: inboundWhere }),
            prisma.pemakaian.findMany({ where: outboundWhere })
        ]);

        // Map inbound
        let allRows = [
            ...inboundRows.map(r => ({
                id: r.id, jenis: "MASUK", no_ref: r.no_penerimaan || "",
                kode_produk: r.kode_produk, nama_produk: r.nama_produk,
                kategori: r.kategori, sub_kategori: r.sub_kategori, satuan: r.satuan,
                qty_masuk: Number(r.jumlah) || 0, qty_keluar: 0,
                tanggal: r.tanggal_masuk || "", lokasi: r.lokasi || "",
                keterangan: r.penerima || "Penerimaan Barang",
                created_at: r.created_at
            })),
            ...outboundRows.map(r => ({
                id: r.id, jenis: "KELUAR", no_ref: r.no_order || "-",
                kode_produk: r.kode_produk, nama_produk: r.nama_produk,
                kategori: "", sub_kategori: "", satuan: "Pcs",
                qty_masuk: 0, qty_keluar: Number(r.jumlah) || 0,
                tanggal: r.tanggal_pemakaian || "", lokasi: "",
                keterangan: `${r.penerima || ""} - ${r.keterangan || ""}`,
                created_at: r.created_at
            }))
        ];

        // Filter q
        if (q && q.trim() !== "") {
            const term = q.trim().toLowerCase();
            allRows = allRows.filter(r =>
                (r.kode_produk || "").toLowerCase().includes(term) ||
                (r.nama_produk || "").toLowerCase().includes(term) ||
                (r.lokasi || "").toLowerCase().includes(term)
            );
        }

        // Sort by tanggal ASC
        allRows.sort((a, b) => {
            if (a.tanggal < b.tanggal) return -1;
            if (a.tanggal > b.tanggal) return 1;
            return 0;
        });

        // Hitung running balance
        const runningBalances = { ...saldoAwalByKode };
        let totalMasuk = 0, totalKeluar = 0;
        const resultList = [];

        if (tgl_dari && tgl_dari.trim() !== "") {
            resultList.push({
                id: 0, jenis: "SALDO_AWAL", no_ref: "SALDO-AWAL",
                kode_produk: kode_produk || "-", nama_produk: "🏁 SALDO AWAL (Stok Bawaan Sebelum Periode)",
                kategori: kategori || "-", sub_kategori: "", satuan: "Unit",
                qty_masuk: 0, qty_keluar: 0, tanggal: tgl_dari,
                lokasi: "Gudang Utama", keterangan: `Sisa stok komulatif sebelum tanggal ${tgl_dari}`,
                saldo_sisa: totalSaldoAwal
            });
        }

        allRows.forEach(item => {
            const k = item.kode_produk || "GENERAL";
            if (runningBalances[k] === undefined) runningBalances[k] = 0;
            const inQty = Number(item.qty_masuk) || 0;
            const outQty = Number(item.qty_keluar) || 0;
            totalMasuk += inQty;
            totalKeluar += outQty;
            runningBalances[k] = (runningBalances[k] || 0) + inQty - outQty;
            resultList.push({ ...item, qty_masuk: inQty, qty_keluar: outQty, saldo_sisa: Math.max(0, runningBalances[k]) });
        });

        const totalSaldoAkhir = Object.values(runningBalances).reduce((a, b) => a + Math.max(0, b), 0);

        res.json({
            success: true,
            summary: { saldo_awal: totalSaldoAwal, total_masuk: totalMasuk, total_keluar: totalKeluar, saldo_akhir: totalSaldoAkhir, total_transaksi: resultList.length },
            data: resultList
        });
    } catch (error) {
        console.error("Gagal mendapatkan kartu stok:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    tambahBarang, getSemuaBarang, getBarangExpired, getArsip, cariBarang,
    getBarangByKode, updateBarang, hapusBarang, arsipkanBarang, pulihkanBarang,
    getNextNoPenerimaan, createBatchPenerimaan, getBarangByNoPenerimaan,
    updateBatchPenerimaan, arsipkanBatchPenerimaan, pulihkanBatchPenerimaan,
    getKartuStok
};