const prisma = require("../prismaClient");

// Daftar nama bulan Indonesia untuk parsing
const BULAN_INDO = {
    "januari": 1, "februari": 2, "maret": 3, "april": 4,
    "mei": 5, "juni": 6, "juli": 7, "agustus": 8,
    "september": 9, "oktober": 10, "november": 11, "desember": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4,
    "jun": 6, "jul": 7, "ags": 8, "agu": 8, "aug": 8,
    "sep": 9, "okt": 10, "oct": 10, "nov": 11, "des": 12, "dec": 12
};

function normalizeTanggal(raw) {
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
    if (!isNaN(parsed.getTime())) {
        return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
    }
    return val;
}

const getDashboard = async (req, res) => {
    const dashboard = { total_barang: 0, expired: 0, warning: 0, aman: 0 };

    try {
        const rows = await prisma.barang.findMany({
            where: { is_arsip: 0 },
            select: { id: true, nama_produk: true, jumlah: true, tanggal_expired: true, is_no_expired: true }
        });

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
        rows.forEach(r => {
            const key = (r.nama_produk || "").trim().toLowerCase();
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(r);
        });

        const activeBatches = [];
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
                if (sisa > 0) activeBatches.push({ ...b, stok_sisa: sisa });
            });
        });

        dashboard.total_barang = activeBatches.length;
        const today = new Date();

        activeBatches.forEach(item => {
            if (Number(item.is_no_expired) === 1) { dashboard.aman++; return; }
            const normalizedDate = normalizeTanggal(item.tanggal_expired);
            const expiredDate = new Date(normalizedDate);
            if (isNaN(expiredDate.getTime())) { dashboard.expired++; return; }
            const selisihHari = Math.ceil((expiredDate - today) / (1000 * 60 * 60 * 24));
            if (selisihHari < 0) dashboard.expired++;
            else if (selisihHari <= 30) dashboard.warning++;
            else dashboard.aman++;
        });

        res.json({ success: true, data: dashboard });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

module.exports = { getDashboard };