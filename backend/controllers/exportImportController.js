const prisma = require("../prismaClient");
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

// Folder tempat simpan file export
const os = require("os");
const isVercel = process.env.VERCEL || process.env.NODE_ENV === "production";
const documentsDir = isVercel
    ? path.join(os.tmpdir(), "InventarisGedungAgung")
    : path.join(os.homedir(), "Documents", "InventarisGedungAgung");
const EXPORTS_DIR = path.join(documentsDir, "exports");

// Pastikan folder exports ada
try {
    if (!fs.existsSync(EXPORTS_DIR)) {
        fs.mkdirSync(EXPORTS_DIR, { recursive: true });
    }
} catch (err) {
    console.warn("Could not create EXPORTS_DIR:", err.message);
}

// ==========================
// Helper: Format tanggal DD-MM-YYYY
// ==========================
function getTanggalHariIni() {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const yyyy = now.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
}

// ==========================
// Helper: Load Konfigurasi Terpusat dari Database
// ==========================
function getSystemSettings(callback) {
    const defaultSettings = {
        threshold_kritis: 30,
        threshold_diperhatikan: 60,

        label_expired: "Expired",
        label_kritis: "Segera Expired",
        label_diperhatikan: "Diperhatikan",
        label_aman: "Aman",
        label_non_expired: "Non-Expired (5 Thn)",

        nama_instansi: "Gedung Agung",
        sub_instansi: "Istana Kepresidenan Yogyakarta",
        nama_penanggung_jawab: "Budi Santoso, S.STP",
        nip_penanggung_jawab: "19850315 200801 1 002",
        jabatan_penanggung_jawab: "Kepala Subbagian Rumah Tangga & Perlengkapan"
    };

    prisma.pengaturan.findMany()
        .then(rows => {
            if (!rows || rows.length === 0) {
                return callback(defaultSettings);
            }
            const settings = { ...defaultSettings };
            rows.forEach(r => {
                if (r.key_name === "threshold_kritis" || r.key_name === "threshold_diperhatikan") {
                    settings[r.key_name] = Number(r.value_text) || defaultSettings[r.key_name];
                } else if (r.value_text && r.value_text.trim() !== "") {
                    settings[r.key_name] = r.value_text;
                }
            });
            callback(settings);
        })
        .catch(err => {
            console.error("Error getSystemSettings:", err.message);
            callback(defaultSettings);
        });
}

// ==========================
// Helper: Konversi Warna Hex Konfigurasi ke ARGB Excel & Kontras Teks
// ==========================
function getExcelColor(hexColor, fallbackHex = "#dc3545") {
    const raw = (hexColor && typeof hexColor === "string" && hexColor.trim() !== "") ? hexColor.trim() : fallbackHex;
    const hex = raw.replace("#", "");
    const cleanHex = hex.length === 6 ? hex.toUpperCase() : fallbackHex.replace("#", "").toUpperCase();

    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    const textArgb = yiq >= 160 ? "FF000000" : "FFFFFFFF";

    return {
        bgArgb: "FF" + cleanHex,
        textArgb: textArgb
    };
}

// ==========================
// Helper: Hitung status barang dinamis dari Konfigurasi
// ==========================
function hitungStatus(item, settings = {}) {
    const isNoExp = Number(item.is_no_expired) === 1;
    if (isNoExp) {
        return {
            ...item,
            sisa_hari: 999,
            status: settings.label_non_expired || "Non-Expired (5 Thn)"
        };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const normalizedDate = normalizeTanggal(item.tanggal_expired);
    const expiredDate = new Date(normalizedDate);

    // Jika tanggal tidak valid, beri status khusus
    if (isNaN(expiredDate.getTime())) {
        return { ...item, sisa_hari: -9999, status: settings.label_expired || "Expired" };
    }

    expiredDate.setHours(0, 0, 0, 0);

    const selisihHari = Math.ceil(
        (expiredDate - today) / (1000 * 60 * 60 * 24)
    );

    const limitKritis = Number(settings.threshold_kritis !== undefined ? settings.threshold_kritis : 30);
    const limitDiperhatikan = Number(settings.threshold_diperhatikan !== undefined ? settings.threshold_diperhatikan : 60);

    let status = "";
    if (selisihHari < 0) {
        status = settings.label_expired || "Expired";
    } else if (selisihHari <= limitKritis) {
        status = settings.label_kritis || "Segera Expired";
    } else if (selisihHari <= limitDiperhatikan) {
        status = settings.label_diperhatikan || "Diperhatikan";
    } else {
        status = settings.label_aman || "Aman";
    }

    return { ...item, sisa_hari: selisihHari, status };
}

// ==========================
// Helper: Normalisasi tanggal (handle input parsial bulan+tahun saja)
// ==========================
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

    // Sudah format YYYY-MM-DD lengkap → langsung return
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;

    // Format DD-MM-YYYY atau DD/MM/YYYY (lengkap) → ubah ke YYYY-MM-DD
    let m = val.match(/^(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{4})$/);
    if (m) {
        const dd = String(m[1]).padStart(2, "0");
        const mm = String(m[2]).padStart(2, "0");
        return `${m[3]}-${mm}-${dd}`;
    }

    // === PARTIAL: hanya bulan + tahun ===

    // Format YYYY-MM (tanpa hari)
    m = val.match(/^(\d{4})[\-\/](\d{1,2})$/);
    if (m) {
        const year = parseInt(m[1]);
        const month = parseInt(m[2]);
        return `${year}-${String(month).padStart(2, "0")}-01`;
    }

    // Format MM-YYYY atau MM/YYYY
    m = val.match(/^(\d{1,2})[\-\/](\d{4})$/);
    if (m) {
        const month = parseInt(m[1]);
        const year = parseInt(m[2]);
        return `${year}-${String(month).padStart(2, "0")}-01`;
    }

    // Format "Agustus 2026", "Agu 2026", "Aug 2026" (nama bulan + tahun)
    m = val.match(/^([a-zA-Z]+)\s+(\d{4})$/i);
    if (m) {
        const bulanKey = m[1].toLowerCase();
        const year = parseInt(m[2]);
        const month = BULAN_INDO[bulanKey];
        if (month) {
            return `${year}-${String(month).padStart(2, "0")}-01`;
        }
    }

    // Format "2026 Agustus" (tahun + nama bulan)
    m = val.match(/^(\d{4})\s+([a-zA-Z]+)$/i);
    if (m) {
        const year = parseInt(m[1]);
        const bulanKey = m[2].toLowerCase();
        const month = BULAN_INDO[bulanKey];
        if (month) {
            return `${year}-${String(month).padStart(2, "0")}-01`;
        }
    }

    // Format tahun saja "2026" → 01 Januari tahun itu
    m = val.match(/^(\d{4})$/);
    if (m) {
        return `${m[1]}-01-01`;
    }

    // Tidak dikenali → coba parse native JS Date sebagai fallback
    const parsed = new Date(val);
    if (!isNaN(parsed.getTime())) {
        const dd = String(parsed.getDate()).padStart(2, "0");
        const mm = String(parsed.getMonth() + 1).padStart(2, "0");
        const yyyy = parsed.getFullYear();
        return `${yyyy}-${mm}-${dd}`;
    }

    // Fallback terakhir: kembalikan apa adanya
    return val;
}

// ==========================
// Helper: Buat file Excel dari data
// ==========================
async function buatExcel(rows, namaFile, tipeLaporan, settings = {}) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Sistem Inventaris - Gedung Agung";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Data Barang");

    const dataRows = rows.map(item => hitungStatus(item, settings));

    const labelExpired = settings.label_expired || "Expired";
    const labelKritis = settings.label_kritis || "Segera Expired";
    const labelDiperhatikan = settings.label_diperhatikan || "Diperhatikan";
    const labelAman = settings.label_aman || "Aman";

    // Hitung ringkasan
    const total = dataRows.length;
    const expired = dataRows.filter(item => item.status === labelExpired).length;
    const segeraExpired = dataRows.filter(item => item.status === labelKritis).length;
    const perluDiperhatikan = dataRows.filter(item => item.status === labelDiperhatikan).length;
    const aman = dataRows.filter(item => item.status === labelAman).length;

    // 1. Judul Laporan (Row 1)
    sheet.mergeCells("A1:L1");
    const titleRow = sheet.getRow(1);
    const instansiText = (settings.nama_instansi && settings.sub_instansi)
        ? `${settings.nama_instansi.toUpperCase()} - ${settings.sub_instansi.toUpperCase()}`
        : "ISTANA KEPRESIDENAN YOGYAKARTA";
    titleRow.getCell(1).value = `LAPORAN INVENTARIS BARANG - ${instansiText}`;
    titleRow.getCell(1).font = { bold: true, size: 14, color: { argb: "FF0F172A" } };
    titleRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
    titleRow.height = 30;

    // 2. Info / Tipe Laporan & Tanggal (Row 2)
    sheet.mergeCells("A2:L2");
    const infoRow = sheet.getRow(2);
    infoRow.getCell(1).value = `Kategori Laporan: ${tipeLaporan}   |   Tanggal Unduh: ${getTanggalHariIni()}`;
    infoRow.getCell(1).font = { italic: true, size: 10, color: { argb: "FF475569" } };
    infoRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
    infoRow.height = 20;

    // 3. Ringkasan Status (Row 3)
    sheet.mergeCells("A3:L3");
    const summaryRow = sheet.getRow(3);

    let summaryText = "";
    let fontColor = "FF0B2147"; // Default deep blue
    let fontBg = "FFF1F5F9"; // Default light gray

    if (tipeLaporan === "Barang Kedaluwarsa" || tipeLaporan === "Audit Barang Kedaluwarsa") {
        summaryText = `Ringkasan Laporan Audit:  [ ${labelExpired}: ${total} Jenis Barang ]`;
        fontColor = "FF991B1B"; // Red
        fontBg = "FFFEE2E2"; // Light red
    } else if (tipeLaporan === "Arsip Barang") {
        summaryText = `Ringkasan Laporan:  [ Arsip: ${total} ]`;
        fontColor = "FF475569"; // Slate gray
        fontBg = "FFF1F5F9";
    } else {
        summaryText = `Ringkasan Laporan:  [ Total Barang: ${total} ]  -  [ ${labelExpired}: ${expired} ]  -  [ ${labelKritis}: ${segeraExpired} ]  -  [ ${labelDiperhatikan}: ${perluDiperhatikan} ]  -  [ ${labelAman}: ${aman} ]`;
    }

    summaryRow.getCell(1).value = summaryText;
    summaryRow.getCell(1).font = { bold: true, size: 11, color: { argb: fontColor } };
    summaryRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
    summaryRow.getCell(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: fontBg }
    };
    summaryRow.height = 25;

    // Row 4: Kosong untuk pembatas
    sheet.getRow(4).height = 15;

    // Row 5: Header Tabel
    const headerCols = [
        { name: "No.", width: 6 },
        { name: "Kode Produk", width: 18 },
        { name: "Nama Produk", width: 30 },
        { name: "Kategori", width: 18 },
        { name: "Sub Kategori", width: 18 },
        { name: "Satuan", width: 12 },
        { name: "Jumlah", width: 10 },
        { name: "Tanggal Masuk", width: 16 },
        { name: "Tanggal Expired", width: 18 },
        { name: "Lokasi", width: 20 },
        { name: "Status", width: 18 },
        { name: "Sisa Hari", width: 12 }
    ];

    // Tulis Header Tabel di Row 5
    const headerRow = sheet.getRow(5);
    headerRow.height = 26;
    headerCols.forEach((col, idx) => {
        const cell = headerRow.getCell(idx + 1);
        cell.value = col.name;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
        cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF0284C7" } // Warna biru langit / primary
        };
        cell.alignment = { vertical: "middle", horizontal: "center" };
        cell.border = {
            top: { style: "thin", color: { argb: "FFCBD5E1" } },
            left: { style: "thin", color: { argb: "FFCBD5E1" } },
            bottom: { style: "medium", color: { argb: "FF0F172A" } },
            right: { style: "thin", color: { argb: "FFCBD5E1" } }
        };

        // Atur lebar kolom
        sheet.getColumn(idx + 1).width = col.width;
    });

    // Row 6+: Isi Data
    let startRow = 6;
    dataRows.forEach((item, index) => {
        const row = sheet.getRow(startRow);
        row.height = 20;

        const tglMasukStr = item.tanggal_masuk || (item.created_at ? String(item.created_at).slice(0, 10) : "-");

        const cellValues = [
            index + 1, // No.
            item.kode_produk,
            item.nama_produk,
            item.kategori,
            item.sub_kategori || "-",
            item.satuan,
            item.jumlah,
            tglMasukStr,
            item.tanggal_expired || "-",
            item.lokasi || "-",
            item.status,
            item.sisa_hari
        ];

        cellValues.forEach((val, idx) => {
            const cell = row.getCell(idx + 1);
            cell.value = val;
            cell.alignment = {
                vertical: "middle",
                horizontal: (idx === 0 || idx === 1 || idx === 5 || idx === 6 || idx === 7 || idx === 8 || idx === 10 || idx === 11) ? "center" : "left"
            };
            cell.border = {
                top: { style: "thin", color: { argb: "FFE2E8F0" } },
                left: { style: "thin", color: { argb: "FFE2E8F0" } },
                bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
                right: { style: "thin", color: { argb: "FFE2E8F0" } }
            };
        });

        // Warna status sel sesuai Konfigurasi terpusat
        const statusCell = row.getCell(11);
        let colorConfig = null;
        if (item.status === labelExpired) {
            colorConfig = getExcelColor(settings.color_expired, "#dc3545");
        } else if (item.status === labelKritis) {
            colorConfig = getExcelColor(settings.color_kritis, "#ffc107");
        } else if (item.status === labelDiperhatikan) {
            colorConfig = getExcelColor(settings.color_diperhatikan, "#fd7e14");
        } else if (item.status === labelAman) {
            colorConfig = getExcelColor(settings.color_aman, "#198754");
        } else {
            colorConfig = getExcelColor(settings.color_non_expired, "#0dcaf0");
        }

        startRow++;
    });

    // Tanda Tangan Footer Resmi
    startRow += 3;
    const ftRow1 = sheet.getRow(startRow);
    ftRow1.getCell(2).value = "Mengetahui,";
    ftRow1.getCell(2).font = { bold: true };
    ftRow1.getCell(10).value = `Yogyakarta, ${getTanggalHariIni()}`;
    ftRow1.getCell(10).font = { bold: true };

    startRow++;
    const ftRow2 = sheet.getRow(startRow);
    ftRow2.getCell(2).value = settings.jabatan_penanggung_jawab || "Kepala Subbagian Rumah Tangga & Perlengkapan";
    ftRow2.getCell(10).value = "Petugas Pemeriksa / Pengurus Barang";

    startRow += 4;
    const ftRow3 = sheet.getRow(startRow);
    ftRow3.getCell(2).value = `(${settings.penanggung_jawab || "........................................................"})`;
    ftRow3.getCell(2).font = { bold: true };
    ftRow3.getCell(10).value = "(........................................................)";
    ftRow3.getCell(10).font = { bold: true };

    // Simpan file ke folder exports
    const filePath = path.join(EXPORTS_DIR, namaFile);
    await workbook.xlsx.writeFile(filePath);

    return filePath;
}

// ==========================
// EXPORT: Penerimaan Barang (dengan filter bulan & detail lengkap)
// ==========================

// Helper: ubah YYYY-MM ke label Indonesia, misal "2026-08" → "Agustus 2026"
function formatLabelBulan(ym) {
    if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return "";
    const [y, m] = ym.split("-");
    const nm = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni",
        "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    return `${nm[parseInt(m)]} ${y}`;
}

const exportPenerimaanBarang = async (req, res) => {
    // kode_produk, tgl_dari, tgl_sampai, bulanDari, bulanSampai, statusExpired, kategori, q
    const { kode_produk, tgl_dari, tgl_sampai, bulanDari, bulanSampai, statusExpired, kategori, q } = req.query;

    const validDari = bulanDari && /^\d{4}-\d{2}$/.test(bulanDari);
    const validSampai = bulanSampai && /^\d{4}-\d{2}$/.test(bulanSampai);

    try {
        let rows = await prisma.barang.findMany({
            where: { is_arsip: 0 },
            orderBy: [{ tanggal_masuk: "desc" }, { created_at: "desc" }]
        });

        if (kode_produk && kode_produk.trim()) {
            rows = rows.filter(r => r.kode_produk === kode_produk.trim());
        }

        if (tgl_dari) {
            rows = rows.filter(r => (r.tanggal_masuk || (r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : "")) >= tgl_dari);
        }

        if (tgl_sampai) {
            rows = rows.filter(r => (r.tanggal_masuk || (r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : "")) <= tgl_sampai);
        }

        if (validDari && validSampai && !tgl_dari && !tgl_sampai) {
            rows = rows.filter(r => {
                const ym = (r.tanggal_masuk || (r.created_at ? new Date(r.created_at).toISOString().slice(0, 7) : "")).slice(0, 7);
                return ym >= bulanDari && ym <= bulanSampai;
            });
        } else if (validDari && !tgl_dari && !tgl_sampai) {
            rows = rows.filter(r => {
                const ym = (r.tanggal_masuk || (r.created_at ? new Date(r.created_at).toISOString().slice(0, 7) : "")).slice(0, 7);
                return ym === bulanDari;
            });
        }

        if (kategori && kategori !== "" && kategori !== "Semua") {
            rows = rows.filter(r => (r.kategori || "").toLowerCase() === kategori.trim().toLowerCase());
        }

        if (q && q.trim() !== "") {
            const term = q.trim().toLowerCase();
            rows = rows.filter(r =>
                (r.no_penerimaan && r.no_penerimaan.toLowerCase().includes(term)) ||
                (r.kode_produk && r.kode_produk.toLowerCase().includes(term)) ||
                (r.nama_produk && r.nama_produk.toLowerCase().includes(term)) ||
                (r.penerima && r.penerima.toLowerCase().includes(term)) ||
                (r.lokasi && r.lokasi.toLowerCase().includes(term)) ||
                (r.kategori && r.kategori.toLowerCase().includes(term))
            );
        }

        getSystemSettings(async (settings) => {
            try {
                const tanggal = getTanggalHariIni();

                // Hitung status setiap item (sisa_hari) & filter statusExpired
                let filteredRows = rows.map(r => hitungStatus(r, settings));

                const limitKritis = Number(settings.threshold_kritis !== undefined ? settings.threshold_kritis : 30);
                const limitDiperhatikan = Number(settings.threshold_diperhatikan !== undefined ? settings.threshold_diperhatikan : 60);

                const LABEL_STATUS = {
                    EXPIRED: settings.label_expired || "Expired",
                    SEGERA: settings.label_kritis || "Segera Expired",
                    DIPERHATIKAN: settings.label_diperhatikan || "Diperhatikan",
                    AMAN: settings.label_aman || "Aman",
                    NON_EXPIRED: settings.label_non_expired || "Non-Expired",
                };

                if (statusExpired && statusExpired !== "" && LABEL_STATUS[statusExpired]) {
                    filteredRows = filteredRows.filter(r => {
                        const isNoExp = Number(r.is_no_expired) === 1;
                        if (statusExpired === "NON_EXPIRED") return isNoExp;
                        if (isNoExp) return false;
                        const sisa = r.sisa_hari;
                        if (statusExpired === "EXPIRED") return sisa < 0;
                        if (statusExpired === "SEGERA") return sisa >= 0 && sisa <= limitKritis;
                        if (statusExpired === "DIPERHATIKAN") return sisa > limitKritis && sisa <= limitDiperhatikan;
                        if (statusExpired === "AMAN") return sisa > limitDiperhatikan;
                        return true;
                    });
                }

                // Label status & periode
                const labelStatus = (statusExpired && LABEL_STATUS[statusExpired])
                    ? LABEL_STATUS[statusExpired]
                    : "Semua Status";

                let labelBulan = "Semua Bulan";
                let sufixFile = "";
                if (validDari && validSampai) {
                    labelBulan = `${formatLabelBulan(bulanDari)} s/d ${formatLabelBulan(bulanSampai)}`;
                    sufixFile = `_${bulanDari}_sd_${bulanSampai}`;
                } else if (validDari) {
                    labelBulan = formatLabelBulan(bulanDari);
                    sufixFile = `_${bulanDari}`;
                }
                if (statusExpired && LABEL_STATUS[statusExpired]) {
                    sufixFile += `_${statusExpired}`;
                }

                const namaFile = `PenerimaanBarang${sufixFile}_${tanggal}.xlsx`;

                // Grouping data per Transaksi Penerimaan (no_penerimaan)
                const groupedMap = new Map();
                filteredRows.forEach(item => {
                    const key = (item.no_penerimaan && item.no_penerimaan.trim() !== "")
                        ? item.no_penerimaan.trim()
                        : `TANPA-NO-${item.kode_produk}`;

                    if (!groupedMap.has(key)) {
                        groupedMap.set(key, {
                            no_penerimaan: item.no_penerimaan || key,
                            tanggal_masuk: item.tanggal_masuk || (item.created_at ? String(item.created_at).slice(0, 10) : "-"),
                            penerima: item.penerima || "-",
                            items: [],
                            total_unit: 0,
                            kategori_set: new Set(),
                            lokasi_set: new Set()
                        });
                    }
                    const g = groupedMap.get(key);
                    g.items.push(item);
                    g.total_unit += Number(item.jumlah) || 0;
                    if (item.kategori) g.kategori_set.add(item.kategori);
                    if (item.lokasi) g.lokasi_set.add(item.lokasi);
                });

                const groupedList = Array.from(groupedMap.values()).map(g => {
                    let statusRingkasan = "Aman";
                    g.items.forEach(it => {
                        const isNoExp = Number(it.is_no_expired) === 1;
                        const sisa = it.sisa_hari !== undefined ? it.sisa_hari : 999;
                        if (!isNoExp) {
                            if (sisa < 0) statusRingkasan = "Ada Expired";
                            else if (sisa <= 30 && statusRingkasan !== "Ada Expired") statusRingkasan = "Ada Segera Expired";
                            else if (sisa <= 60 && statusRingkasan !== "Ada Expired" && statusRingkasan !== "Ada Segera Expired") statusRingkasan = "Ada Diperhatikan";
                        }
                    });

                    return {
                        ...g,
                        kategori_str: Array.from(g.kategori_set).join(", "),
                        lokasi_str: Array.from(g.lokasi_set).join(", "),
                        status_ringkasan: statusRingkasan
                    };
                });

                const workbook = new ExcelJS.Workbook();
                workbook.creator = "Sistem Inventaris - Gedung Agung";
                workbook.created = new Date();

                const labelKat = (kategori && kategori !== "" && kategori !== "Semua") ? kategori : "Semua Kategori";
                const totalItem = filteredRows.length;
                const totalJumlah = filteredRows.reduce((s, r) => s + (Number(r.jumlah) || 0), 0);

                // ==========================================
                // Sheet 1: Laporan Penerimaan Barang (No. Masuk di-merge vertical, items terpisah kebawah)
                // ==========================================
                const sheet1 = workbook.addWorksheet("Laporan Penerimaan");

                // Row 1: Judul
                sheet1.mergeCells("A1:N1");
                const t1_1 = sheet1.getRow(1);
                t1_1.getCell(1).value = "LAPORAN PENERIMAAN BARANG - ISTANA KEPRESIDENAN YOGYAKARTA";
                t1_1.getCell(1).font = { bold: true, size: 14, color: { argb: "FF0F172A" } };
                t1_1.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
                t1_1.height = 32;

                // Row 2: Info & Filter
                sheet1.mergeCells("A2:N2");
                const t1_2 = sheet1.getRow(2);
                t1_2.getCell(1).value = `Periode: ${labelBulan}   |   Kategori: ${labelKat}   |   Status: ${labelStatus}   |   Tanggal Cetak: ${getTanggalHariIni()}`;
                t1_2.getCell(1).font = { italic: true, size: 10, color: { argb: "FF475569" } };
                t1_2.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
                t1_2.height = 20;

                // Row 3: Ringkasan Global
                sheet1.mergeCells("A3:N3");
                const t1_3 = sheet1.getRow(3);
                t1_3.getCell(1).value = `Ringkasan:  [ Total Transaksi: ${groupedList.length} No. Masuk ]  —  [ Total Jenis Barang: ${totalItem} ]  —  [ Total Unit Diterima: ${totalJumlah} ]`;
                t1_3.getCell(1).font = { bold: true, size: 11, color: { argb: "FF0B2147" } };
                t1_3.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
                t1_3.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0F2FE" } };
                t1_3.height = 26;

                sheet1.getRow(4).height = 10;

                // Row 5: Header Tabel (14 Kolom Terpisah)
                const headerCols1 = [
                    { name: "No.", width: 6 },
                    { name: "No. Masuk / Penerimaan", width: 22 },
                    { name: "Tanggal Masuk", width: 14 },
                    { name: "Petugas Penerima", width: 20 },
                    { name: "Kode Produk", width: 18 },
                    { name: "Nama Barang", width: 30 },
                    { name: "Kategori", width: 18 },
                    { name: "Sub Kategori", width: 18 },
                    { name: "Satuan", width: 12 },
                    { name: "Jumlah\nDiterima", width: 13 },
                    { name: "Tanggal\nExpired", width: 14 },
                    { name: "Ket. Expired", width: 16 },
                    { name: "Lokasi Simpan", width: 22 },
                    { name: "Status Expired", width: 18 }
                ];

                const headerRow1 = sheet1.getRow(5);
                headerRow1.height = 34;
                headerCols1.forEach((col, idx) => {
                    const cell = headerRow1.getCell(idx + 1);
                    cell.value = col.name;
                    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
                    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F4C81" } };
                    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
                    cell.border = {
                        top: { style: "thin", color: { argb: "FFCBD5E1" } },
                        left: { style: "thin", color: { argb: "FFCBD5E1" } },
                        bottom: { style: "medium", color: { argb: "FF0F172A" } },
                        right: { style: "thin", color: { argb: "FFCBD5E1" } }
                    };
                    sheet1.getColumn(idx + 1).width = col.width;
                });

                // Isi Data Row 6+ (Per barang di kolom masing-masing, No. Masuk di-merge vertikal)
                let currentRow = 6;
                groupedList.forEach((group, gIdx) => {
                    const startRow = currentRow;
                    const count = group.items.length;
                    const endRow = startRow + count - 1;

                    group.items.forEach((item) => {
                        const row = sheet1.getRow(currentRow);
                        row.height = 22;

                        const tglMasuk = item.tanggal_masuk || (item.created_at ? String(item.created_at).slice(0, 10) : "-");
                        const ketExpired = Number(item.is_no_expired) === 1 ? "♾️ Tanpa Expired (5 Thn)" : "";
                        const itemStatus = Number(item.is_no_expired) === 1 ? "Non-Expired" : (item.status || "-");

                        const vals = [
                            gIdx + 1,
                            group.no_penerimaan,
                            tglMasuk,
                            group.penerima,
                            item.kode_produk || "-",
                            item.nama_produk || "-",
                            item.kategori || "-",
                            item.sub_kategori || "-",
                            item.satuan || "Pcs",
                            Number(item.jumlah) || 0,
                            item.tanggal_expired || "-",
                            ketExpired,
                            item.lokasi || "-",
                            itemStatus
                        ];

                        vals.forEach((val, colIdx) => {
                            const cell = row.getCell(colIdx + 1);
                            cell.value = val;
                            cell.alignment = {
                                vertical: "middle",
                                horizontal: (colIdx === 0 || colIdx === 1 || colIdx === 2 || colIdx === 4 || colIdx === 8 || colIdx === 9 || colIdx === 13) ? "center" : "left"
                            };
                            cell.border = {
                                top: { style: "thin", color: { argb: "FFE2E8F0" } },
                                left: { style: "thin", color: { argb: "FFE2E8F0" } },
                                bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
                                right: { style: "thin", color: { argb: "FFE2E8F0" } }
                            };
                            if (gIdx % 2 !== 0) {
                                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
                            }
                        });

                        // Format kolom jumlah
                        const jumlahCell = row.getCell(10);
                        jumlahCell.font = { bold: true, color: { argb: "FF1E40AF" } };

                        // Format kolom status sel sesuai Konfigurasi terpusat
                        const statusCell = row.getCell(14);
                        let colorConfig = null;
                        if (itemStatus === settings.label_expired || itemStatus === "Expired") {
                            colorConfig = getExcelColor(settings.color_expired, "#dc3545");
                        } else if (itemStatus === settings.label_kritis || itemStatus === "Segera Expired") {
                            colorConfig = getExcelColor(settings.color_kritis, "#ffc107");
                        } else if (itemStatus === settings.label_diperhatikan || itemStatus === "Diperhatikan" || itemStatus === "Perlu Diperhatikan") {
                            colorConfig = getExcelColor(settings.color_diperhatikan, "#fd7e14");
                        } else if (itemStatus === settings.label_aman || itemStatus === "Aman") {
                            colorConfig = getExcelColor(settings.color_aman, "#198754");
                        } else {
                            colorConfig = getExcelColor(settings.color_non_expired, "#0dcaf0");
                        }

                        if (colorConfig) {
                            statusCell.font = { bold: true, color: { argb: colorConfig.textArgb } };
                            statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colorConfig.bgArgb } };
                        }

                        currentRow++;
                    });

                    // Merge vertikal kolom header transaksi (Col 1-4: No, No. Masuk, Tanggal, Penerima) bila lebih dari 1 item
                    if (count > 1) {
                        sheet1.mergeCells(`A${startRow}:A${endRow}`);
                        sheet1.mergeCells(`B${startRow}:B${endRow}`);
                        sheet1.mergeCells(`C${startRow}:C${endRow}`);
                        sheet1.mergeCells(`D${startRow}:D${endRow}`);
                    }
                });

                // Baris TOTAL di bawah data
                const totalRow = sheet1.getRow(currentRow);
                totalRow.height = 26;
                sheet1.mergeCells(`A${currentRow}:I${currentRow}`);
                totalRow.getCell(1).value = `TOTAL PENERIMAAN  (${groupedList.length} Transaksi, ${totalItem} Jenis Barang)`;
                totalRow.getCell(1).font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
                totalRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F4C81" } };
                totalRow.getCell(1).alignment = { horizontal: "right", vertical: "middle" };

                totalRow.getCell(10).value = totalJumlah;
                totalRow.getCell(10).font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
                totalRow.getCell(10).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F4C81" } };
                totalRow.getCell(10).alignment = { horizontal: "center", vertical: "middle" };

                for (let c = 11; c <= 14; c++) {
                    const cell = totalRow.getCell(c);
                    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F4C81" } };
                }

                // ==========================================
                // Sheet 2: Rekap per Kategori
                // ==========================================
                const sheetKat = workbook.addWorksheet("Rekap per Kategori");

                const rekapKat = {};
                filteredRows.forEach(r => {
                    const kat = r.kategori || "(Tanpa Kategori)";
                    if (!rekapKat[kat]) rekapKat[kat] = { jumlah: 0, item: 0 };
                    rekapKat[kat].jumlah += Number(r.jumlah) || 0;
                    rekapKat[kat].item++;
                });

                sheetKat.mergeCells("A1:D1");
                sheetKat.getRow(1).getCell(1).value = `REKAP PENERIMAAN PER KATEGORI — ${labelBulan}  |  ${labelStatus}`;
                sheetKat.getRow(1).getCell(1).font = { bold: true, size: 13, color: { argb: "FF0F172A" } };
                sheetKat.getRow(1).getCell(1).alignment = { horizontal: "center" };
                sheetKat.getRow(1).height = 28;

                ["No.", "Kategori", "Total Item", "Total Jumlah Diterima"].forEach((h, i) => {
                    const cell = sheetKat.getRow(2).getCell(i + 1);
                    cell.value = h;
                    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
                    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F4C81" } };
                    cell.alignment = { horizontal: "center", vertical: "middle" };
                    sheetKat.getRow(2).height = 24;
                });
                sheetKat.getColumn(1).width = 8;
                sheetKat.getColumn(2).width = 28;
                sheetKat.getColumn(3).width = 16;
                sheetKat.getColumn(4).width = 22;

                Object.entries(rekapKat)
                    .sort((a, b) => b[1].jumlah - a[1].jumlah)
                    .forEach(([kat, data], i) => {
                        const row = sheetKat.getRow(3 + i);
                        row.getCell(1).value = i + 1;
                        row.getCell(2).value = kat;
                        row.getCell(3).value = data.item;
                        row.getCell(4).value = data.jumlah;
                        row.getCell(4).font = { bold: true, color: { argb: "FF1E40AF" } };
                        for (let c = 1; c <= 4; c++) {
                            row.getCell(c).alignment = { horizontal: c === 2 ? "left" : "center", vertical: "middle" };
                            row.getCell(c).border = {
                                top: { style: "thin", color: { argb: "FFE2E8F0" } },
                                left: { style: "thin", color: { argb: "FFE2E8F0" } },
                                bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
                                right: { style: "thin", color: { argb: "FFE2E8F0" } }
                            };
                            if (i % 2 !== 0) row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
                        }
                        row.height = 20;
                    });

                // ==========================================
                // Sheet 3: Rekap per Penerima
                // ==========================================
                const sheetPen = workbook.addWorksheet("Rekap per Penerima");

                const rekapPen = {};
                filteredRows.forEach(r => {
                    const pen = r.penerima || "-";
                    if (!rekapPen[pen]) rekapPen[pen] = { jumlah: 0, item: 0 };
                    rekapPen[pen].jumlah += Number(r.jumlah) || 0;
                    rekapPen[pen].item++;
                });

                sheetPen.mergeCells("A1:D1");
                sheetPen.getRow(1).getCell(1).value = `REKAP PENERIMAAN PER PENERIMA — ${labelBulan}  |  ${labelStatus}`;
                sheetPen.getRow(1).getCell(1).font = { bold: true, size: 13, color: { argb: "FF0F172A" } };
                sheetPen.getRow(1).getCell(1).alignment = { horizontal: "center" };
                sheetPen.getRow(1).height = 28;

                ["No.", "Nama Penerima", "Total Item Diterima", "Total Jumlah Diterima"].forEach((h, i) => {
                    const cell = sheetPen.getRow(2).getCell(i + 1);
                    cell.value = h;
                    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
                    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF065F46" } };
                    cell.alignment = { horizontal: "center", vertical: "middle" };
                    sheetPen.getRow(2).height = 24;
                });
                sheetPen.getColumn(1).width = 8;
                sheetPen.getColumn(2).width = 28;
                sheetPen.getColumn(3).width = 22;
                sheetPen.getColumn(4).width = 24;

                Object.entries(rekapPen)
                    .sort((a, b) => b[1].jumlah - a[1].jumlah)
                    .forEach(([pen, data], i) => {
                        const row = sheetPen.getRow(3 + i);
                        row.getCell(1).value = i + 1;
                        row.getCell(2).value = pen;
                        row.getCell(3).value = data.item;
                        row.getCell(4).value = data.jumlah;
                        row.getCell(4).font = { bold: true, color: { argb: "FF065F46" } };
                        for (let c = 1; c <= 4; c++) {
                            row.getCell(c).alignment = { horizontal: c === 2 ? "left" : "center", vertical: "middle" };
                            row.getCell(c).border = {
                                top: { style: "thin", color: { argb: "FFE2E8F0" } },
                                left: { style: "thin", color: { argb: "FFE2E8F0" } },
                                bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
                                right: { style: "thin", color: { argb: "FFE2E8F0" } }
                            };
                            if (i % 2 !== 0) row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0FDF4" } };
                        }
                        row.height = 20;
                    });

                // Simpan & kirim
                const filePath = path.join(EXPORTS_DIR, namaFile);
                await workbook.xlsx.writeFile(filePath);
                res.download(filePath, namaFile, (downloadErr) => {
                    if (downloadErr) console.error("Gagal kirim file penerimaan:", downloadErr);
                });

            } catch (excelErr) {
                console.error("Gagal membuat Excel Penerimaan:", excelErr);
                res.status(500).json({ success: false, message: "Gagal membuat file Excel Penerimaan Barang." });
            }
        });
    } catch (err) {
        console.error("Gagal export penerimaan barang:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

// ==========================
// EXPORT: Semua Barang Aktif
// ==========================
const exportSemuaBarang = async (req, res) => {
    try {
        const rows = await prisma.barang.findMany({
            where: { is_arsip: 0 },
            orderBy: [{ kategori: "asc" }, { tanggal_expired: "asc" }]
        });

        getSystemSettings(async (settings) => {
            try {
                const tanggal = getTanggalHariIni();
                const namaFile = `SemuaBarang_${tanggal}.xlsx`;
                const filePath = await buatExcel(rows, namaFile, "Semua Barang Aktif", settings);

                res.download(filePath, namaFile, (downloadErr) => {
                    if (downloadErr) console.error("Gagal mengirim file:", downloadErr);
                });
            } catch (excelErr) {
                console.error("Gagal membuat Excel:", excelErr);
                res.status(500).json({ success: false, message: "Gagal membuat file Excel." });
            }
        });
    } catch (err) {
        console.error("Gagal export semua barang:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

// ==========================
// EXPORT: Barang Expired
// ==========================
const exportBarangExpired = async (req, res) => {
    try {
        const { tgl_dari_exp, tgl_sampai_exp, tgl_dari, tgl_sampai, kode_produk, kategori, status, q } = req.query;
        const finalDari = tgl_dari_exp || tgl_dari;
        const finalSampai = tgl_sampai_exp || tgl_sampai;

        let rows = await prisma.barang.findMany({
            where: { is_arsip: 0, is_no_expired: 0 },
            orderBy: [{ tanggal_expired: "asc" }, { kategori: "asc" }, { nama_produk: "asc" }]
        });

        if (kode_produk && kode_produk.trim() !== "") {
            rows = rows.filter(r => r.kode_produk === kode_produk.trim());
        }

        if (finalDari && finalDari.trim() !== "") {
            rows = rows.filter(r => r.tanggal_expired >= finalDari.trim());
        }
        if (finalSampai && finalSampai.trim() !== "") {
            rows = rows.filter(r => r.tanggal_expired <= finalSampai.trim());
        }
        if (kategori && kategori.trim() !== "" && kategori !== "Semua") {
            rows = rows.filter(r => (r.kategori || "").toLowerCase() === kategori.trim().toLowerCase());
        }
        if (q && q.trim() !== "") {
            const term = q.trim().toLowerCase();
            rows = rows.filter(r =>
                (r.kode_produk && r.kode_produk.toLowerCase().includes(term)) ||
                (r.nama_produk && r.nama_produk.toLowerCase().includes(term)) ||
                (r.lokasi && r.lokasi.toLowerCase().includes(term)) ||
                (r.kategori && r.kategori.toLowerCase().includes(term)) ||
                (r.sub_kategori && r.sub_kategori.toLowerCase().includes(term))
            );
        }

        getSystemSettings(async (settings) => {
            try {
                let dataRows = (rows || []).map(r => hitungStatus(r, settings));
                const limitKritis = Number(settings.threshold_kritis !== undefined ? settings.threshold_kritis : 30);
                const limitDiperhatikan = Number(settings.threshold_diperhatikan !== undefined ? settings.threshold_diperhatikan : 60);

                if (status === "EXPIRED") {
                    dataRows = dataRows.filter(r => r.sisa_hari < 0);
                } else if (status === "SEGERA") {
                    dataRows = dataRows.filter(r => r.sisa_hari >= 0 && r.sisa_hari <= limitKritis);
                } else if (status === "DIPERHATIKAN") {
                    dataRows = dataRows.filter(r => r.sisa_hari > limitKritis && r.sisa_hari <= limitDiperhatikan);
                } else {
                    // Default ALL: fokus pada barang berisiko (expired & warning)
                    dataRows = dataRows.filter(r => r.sisa_hari <= limitDiperhatikan);
                }

                const tanggal = getTanggalHariIni();
                const namaFile = `Laporan_Audit_Kadaluwarsa_${tanggal}.xlsx`;
                const filePath = await buatExcel(dataRows, namaFile, "Audit Barang Kedaluwarsa", settings);

                res.download(filePath, namaFile, (downloadErr) => {
                    if (downloadErr) console.error("Gagal mengirim file audit:", downloadErr);
                });
            } catch (excelErr) {
                console.error("Gagal membuat Excel audit:", excelErr);
                res.status(500).json({ success: false, message: "Gagal membuat file Excel." });
            }
        });
    } catch (err) {
        console.error("Gagal export barang expired:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

// ==========================
// EXPORT: Arsip Barang
// ==========================
const exportArsipBarang = async (req, res) => {
    try {
        const rows = await prisma.barang.findMany({
            where: { is_arsip: 1 },
            orderBy: [{ kategori: "asc" }, { updated_at: "desc" }]
        });

        getSystemSettings(async (settings) => {
            try {
                const tanggal = getTanggalHariIni();
                const namaFile = `ArsipBarang_${tanggal}.xlsx`;
                const filePath = await buatExcel(rows, namaFile, "Arsip Barang", settings);

                res.download(filePath, namaFile, (downloadErr) => {
                    if (downloadErr) console.error("Gagal mengirim file:", downloadErr);
                });
            } catch (excelErr) {
                console.error("Gagal membuat Excel:", excelErr);
                res.status(500).json({ success: false, message: "Gagal membuat file Excel." });
            }
        });
    } catch (err) {
        console.error("Gagal export arsip barang:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};




// ==========================
// EXPORT: Opname Stok (Master Data Barang)
// ==========================
const exportOpnameStok = async (req, res) => {
    try {
        const { kategori, sub_kategori, q } = req.query;

        const [masterRows, barangRows, pemakaianRows] = await Promise.all([
            prisma.namaBarang.findMany({ orderBy: [{ kategori: "asc" }, { sub_kategori: "asc" }, { nama: "asc" }] }),
            prisma.barang.findMany({ where: { is_arsip: 0 } }),
            prisma.pemakaian.findMany()
        ]);

        const sumMasuk = {};
        barangRows.forEach(b => {
            const k = (b.nama_produk || "").trim().toLowerCase();
            sumMasuk[k] = (sumMasuk[k] || 0) + (Number(b.jumlah) || 0);
        });

        const sumKeluar = {};
        pemakaianRows.forEach(p => {
            const k = (p.nama_produk || "").trim().toLowerCase();
            sumKeluar[k] = (sumKeluar[k] || 0) + (Number(p.jumlah) || 0);
        });

        let rows = masterRows.map(nb => {
            const k = (nb.nama || "").trim().toLowerCase();
            const masuk = sumMasuk[k] || 0;
            const keluar = sumKeluar[k] || 0;
            const total_stok = Math.max(0, masuk - keluar);
            return {
                id: nb.id,
                kode: nb.kode,
                nama: nb.nama,
                kategori: nb.kategori,
                sub_kategori: nb.sub_kategori,
                satuan: nb.satuan,
                lokasi: nb.lokasi,
                total_stok
            };
        });

        if (kategori && kategori.trim() !== "" && kategori !== "Semua") {
            rows = rows.filter(r => (r.kategori || "").toLowerCase() === kategori.trim().toLowerCase());
        }

        if (sub_kategori && sub_kategori.trim() !== "") {
            rows = rows.filter(r => (r.sub_kategori || "").toLowerCase() === sub_kategori.trim().toLowerCase());
        }

        if (q && q.trim() !== "") {
            const term = q.trim().toLowerCase();
            rows = rows.filter(r =>
                (r.nama && r.nama.toLowerCase().includes(term)) ||
                (r.kode && r.kode.toLowerCase().includes(term)) ||
                (r.lokasi && r.lokasi.toLowerCase().includes(term))
            );
        }

        const tanggal = getTanggalHariIni();
        const namaFile = `OpnameStok_${tanggal}.xlsx`;

        // Buat workbook Excel
        const workbook = new ExcelJS.Workbook();
        workbook.creator = "Sistem Inventaris - Gedung Agung";
        workbook.created = new Date();

        const sheet = workbook.addWorksheet("Opname Stok");

        const totalBarang = rows.length;
        const stokKosong = rows.filter(r => r.total_stok === 0).length;
        const stokAda = rows.filter(r => r.total_stok > 0).length;

            // Row 1: Judul
            sheet.mergeCells("A1:K1");
            const titleRow = sheet.getRow(1);
            titleRow.getCell(1).value = "LAPORAN OPNAME STOK BARANG - ISTANA KEPRESIDENAN YOGYAKARTA";
            titleRow.getCell(1).font = { bold: true, size: 14, color: { argb: "FF0F172A" } };
            titleRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
            titleRow.height = 30;

            // Row 2: Info
            sheet.mergeCells("A2:K2");
            const infoRow = sheet.getRow(2);
            const infoKat = kategori ? `Kategori: ${kategori}` : "Semua Kategori";
            const infoSub = sub_kategori ? `Sub: ${sub_kategori}` : "";
            const infoSearch = q ? `Pencarian: "${q}"` : "";
            const filterSummary = [infoKat, infoSub, infoSearch].filter(Boolean).join("   |   ");
            infoRow.getCell(1).value = `Laporan Opname Stok   |   ${filterSummary}   |   Tanggal Cetak: ${getTanggalHariIni()}`;
            infoRow.getCell(1).font = { italic: true, size: 10, color: { argb: "FF475569" } };
            infoRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
            infoRow.height = 20;

            // Row 3: Ringkasan
            sheet.mergeCells("A3:K3");
            const summaryRow = sheet.getRow(3);
            summaryRow.getCell(1).value = `Ringkasan:  [ Total Item: ${totalBarang} ]  -  [ Stok Ada: ${stokAda} ]  -  [ Stok Kosong: ${stokKosong} ]`;
            summaryRow.getCell(1).font = { bold: true, size: 11, color: { argb: "FF0B2147" } };
            summaryRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
            summaryRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0F2FE" } };
            summaryRow.height = 25;

            // Row 4: Kosong
            sheet.getRow(4).height = 10;

            // Row 5: Header Tabel
            const headerCols = [
                { name: "No.", width: 6 },
                { name: "Kode Master", width: 18 },
                { name: "Nama Barang", width: 32 },
                { name: "Kategori", width: 18 },
                { name: "Sub Kategori", width: 18 },
                { name: "Satuan", width: 12 },
                { name: "Lokasi Standard", width: 22 },
                { name: "Stok Sistem", width: 14 },
                { name: "Stok Fisik (Isi)", width: 16 },
                { name: "Selisih", width: 12 },
                { name: "Keterangan", width: 28 },
            ];

            const headerRow = sheet.getRow(5);
            headerRow.height = 28;
            headerCols.forEach((col, idx) => {
                const cell = headerRow.getCell(idx + 1);
                cell.value = col.name;
                cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0284C7" } };
                cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
                cell.border = {
                    top: { style: "thin", color: { argb: "FFCBD5E1" } },
                    left: { style: "thin", color: { argb: "FFCBD5E1" } },
                    bottom: { style: "medium", color: { argb: "FF0F172A" } },
                    right: { style: "thin", color: { argb: "FFCBD5E1" } }
                };
                sheet.getColumn(idx + 1).width = col.width;
            });

            // Row 6+: Isi Data dengan Pengelompokan Kategori
            let startRow = 6;
            let currentKategori = null;
            let itemNo = 1;

            rows.forEach((item) => {
                const katName = (item.kategori || "Tanpa Kategori").trim();
                if (katName !== currentKategori) {
                    currentKategori = katName;

                    // Sisipkan Row Pembatas Kategori
                    sheet.mergeCells(`A${startRow}:K${startRow}`);
                    const catRow = sheet.getRow(startRow);
                    catRow.height = 24;
                    catRow.getCell(1).value = `📁 KATEGORI: ${currentKategori.toUpperCase()}`;
                    catRow.getCell(1).font = { bold: true, size: 11, color: { argb: "FF0F172A" } };
                    catRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
                    catRow.getCell(1).alignment = { vertical: "middle", horizontal: "left" };
                    startRow++;
                }

                const row = sheet.getRow(startRow);
                row.height = 22;

                const cellValues = [
                    itemNo++,
                    item.kode || "-",
                    item.nama,
                    item.kategori || "-",
                    item.sub_kategori || "-",
                    item.satuan || "-",
                    item.lokasi || "-",
                    item.total_stok,
                    "",  // Kolom "Stok Fisik" - dikosongkan untuk diisi manual saat opname
                    "",  // Kolom "Selisih" - dikosongkan
                    "",  // Kolom "Keterangan" - dikosongkan
                ];

                cellValues.forEach((val, idx) => {
                    const cell = row.getCell(idx + 1);
                    cell.value = val;
                    cell.alignment = {
                        vertical: "middle",
                        horizontal: (idx === 0 || idx === 7 || idx === 8 || idx === 9) ? "center" : "left"
                    };
                    cell.border = {
                        top: { style: "thin", color: { argb: "FFE2E8F0" } },
                        left: { style: "thin", color: { argb: "FFE2E8F0" } },
                        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
                        right: { style: "thin", color: { argb: "FFE2E8F0" } }
                    };

                    // Warna kolom stok sistem
                    if (idx === 7) {
                        if (item.total_stok === 0) {
                            cell.font = { bold: true, color: { argb: "FF991B1B" } };
                            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
                        } else {
                            cell.font = { bold: true, color: { argb: "FF166534" } };
                            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCFCE7" } };
                        }
                    }

                    // Warna background kolom yang perlu diisi (Stok Fisik, Selisih, Keterangan)
                    if (idx === 8 || idx === 9 || idx === 10) {
                        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF9C4" } }; // Kuning muda
                    }
                });

                startRow++;
            });

            // Footer - Tanda Tangan
            const lastDataRow = startRow;
            sheet.getRow(lastDataRow + 1).height = 10;

            // Merge dan buat area tanda tangan
            const ttdRow1 = lastDataRow + 2;
            const ttdRow2 = lastDataRow + 7;

            sheet.mergeCells(`A${ttdRow1}:C${ttdRow1}`);
            sheet.getRow(ttdRow1).getCell(1).value = "Mengetahui,";
            sheet.getRow(ttdRow1).getCell(1).alignment = { horizontal: "center" };

            sheet.mergeCells(`E${ttdRow1}:G${ttdRow1}`);
            sheet.getRow(ttdRow1).getCell(5).value = "Yang Melakukan Opname,";
            sheet.getRow(ttdRow1).getCell(5).alignment = { horizontal: "center" };

            sheet.mergeCells(`A${ttdRow2}:C${ttdRow2}`);
            sheet.getRow(ttdRow2).getCell(1).value = "(...................................)";
            sheet.getRow(ttdRow2).getCell(1).alignment = { horizontal: "center" };
            sheet.getRow(ttdRow2).getCell(1).font = { underline: true };

            sheet.mergeCells(`E${ttdRow2}:G${ttdRow2}`);
            sheet.getRow(ttdRow2).getCell(5).value = "(...................................)";
            sheet.getRow(ttdRow2).getCell(5).alignment = { horizontal: "center" };
            sheet.getRow(ttdRow2).getCell(5).font = { underline: true };

            // Simpan & kirim file
            const filePath = path.join(EXPORTS_DIR, namaFile);
            await workbook.xlsx.writeFile(filePath);

            res.download(filePath, namaFile, (downloadErr) => {
                if (downloadErr) {
                    console.error("Gagal mengirim file opname:", downloadErr);
                }
            });
    } catch (err) {
        console.error("Gagal export opname stok:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

const parseFlexDate = (rawVal) => {
    // Helper: 5 tahun dari hari ini
    const fiveYearsFromNow = () => {
        const d = new Date();
        d.setFullYear(d.getFullYear() + 5);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${dd}`;
    };

    if (rawVal === null || rawVal === undefined) {
        return { isNoExpired: 1, dateStr: fiveYearsFromNow() };
    }

    const str = String(rawVal).trim();
    if (!str || str === "" || str === "-") {
        return { isNoExpired: 1, dateStr: fiveYearsFromNow() };
    }

    const upper = str.toUpperCase();
    if (upper.includes("NON") || upper.includes("TANPA") || upper.includes("5 THN") || upper.includes("5 TAHUN")) {
        return { isNoExpired: 1, dateStr: fiveYearsFromNow() };
    }

    // Handle Excel Serial Number (e.g. 45657)
    if (!isNaN(str) && Number(str) > 30000 && Number(str) < 70000) {
        const excelDate = new Date(Math.round((Number(str) - 25569) * 86400 * 1000));
        if (!isNaN(excelDate.getTime())) {
            const y = excelDate.getUTCFullYear();
            const m = String(excelDate.getUTCMonth() + 1).padStart(2, '0');
            const d = String(excelDate.getUTCDate()).padStart(2, '0');
            return { isNoExpired: 0, dateStr: `${y}-${m}-${d}` };
        }
    }

    // Replace slashes or dots with dashes
    const cleanStr = str.replace(/[\/\.]/g, "-").replace(/\s+/g, "");
    const parts = cleanStr.split("-");

    if (parts.length === 3) {
        let p1 = parseInt(parts[0], 10);
        let p2 = parseInt(parts[1], 10);
        let p3 = parseInt(parts[2], 10);

        if (!isNaN(p1) && !isNaN(p2) && !isNaN(p3)) {
            // Case YYYY-MM-DD (e.g. 2027-05-15)
            if (p1 > 1000) {
                const y = p1;
                const m = String(Math.min(Math.max(p2, 1), 12)).padStart(2, '0');
                const d = String(Math.min(Math.max(p3, 1), 31)).padStart(2, '0');
                return { isNoExpired: 0, dateStr: `${y}-${m}-${d}` };
            }
            // Case DD-MM-YYYY (e.g. 15-05-2027 or 31-12-2028)
            if (p3 > 1000) {
                const y = p3;
                const m = String(Math.min(Math.max(p2, 1), 12)).padStart(2, '0');
                const d = String(Math.min(Math.max(p1, 1), 31)).padStart(2, '0');
                return { isNoExpired: 0, dateStr: `${y}-${m}-${d}` };
            }
        }
    } else if (parts.length === 2) {
        let p1 = parseInt(parts[0], 10);
        let p2 = parseInt(parts[1], 10);

        if (!isNaN(p1) && !isNaN(p2)) {
            // Case YYYY-MM (e.g. 2027-1 or 2027-05) -> Default day to 01
            if (p1 > 1000) {
                const y = p1;
                const m = String(Math.min(Math.max(p2, 1), 12)).padStart(2, '0');
                return { isNoExpired: 0, dateStr: `${y}-${m}-01` };
            }
            // Case MM-YYYY (e.g. 05-2027 or 5-2027) -> Default day to 01
            if (p2 > 1000) {
                const y = p2;
                const m = String(Math.min(Math.max(p1, 1), 12)).padStart(2, '0');
                return { isNoExpired: 0, dateStr: `${y}-${m}-01` };
            }
        }
    } else if (parts.length === 1) {
        let yearOnly = parseInt(parts[0], 10);
        if (!isNaN(yearOnly) && yearOnly > 1000 && yearOnly < 2200) {
            return { isNoExpired: 0, dateStr: `${yearOnly}-01-01` };
        }
    }

    // Fallback: Non-Expired = 5 tahun dari sekarang
    return { isNoExpired: 1, dateStr: fiveYearsFromNow() };
};

const downloadTemplateImportPenerimaan = async (req, res) => {
    try {
        const [masterRows, rowsKat, rowsSat, rowsLok, rowsSubKat] = await Promise.all([
            prisma.namaBarang.findMany({ orderBy: [{ kategori: "asc" }, { nama: "asc" }] }),
            prisma.kategori.findMany({ orderBy: { nama_kategori: "asc" } }),
            prisma.satuan.findMany({ orderBy: { nama_satuan: "asc" } }),
            prisma.lokasi.findMany({ orderBy: { nama_lokasi: "asc" } }),
            prisma.subKategori.findMany({ orderBy: { nama_sub_kategori: "asc" } })
        ]);

        const kategoriList = rowsKat.map(r => r.nama_kategori).filter(Boolean);
        const satuanList = rowsSat.map(r => r.nama_satuan).filter(Boolean);
        const lokasiList = rowsLok.map(r => r.nama_lokasi).filter(Boolean);
        const subKategoriList = rowsSubKat.map(r => r.nama_sub_kategori).filter(Boolean);

        const workbook = new ExcelJS.Workbook();
        workbook.creator = "Sistem Inventaris - Gedung Agung";

        // Sheet 1: Form Import Penerimaan
        const sheet = workbook.addWorksheet("Form Import Penerimaan");

        // Row 1: Title
        sheet.mergeCells("A1:H1");
        const r1 = sheet.getRow(1);
        r1.getCell(1).value = "FORM IMPORT DATA PENERIMAAN BATCH - GEDUNG AGUNG";
        r1.getCell(1).font = { bold: true, size: 14, color: { argb: "FF0F172A" } };
        r1.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
        r1.height = 30;

        // Row 2: Instructions
        sheet.mergeCells("A2:H2");
        const r2 = sheet.getRow(2);
        r2.getCell(1).value = "PETUNJUK: Kolom Kode Barang boleh kosong (otomatis). Nama Barang WAJIB diisi. Expired: tulis tanggal YYYY-MM-DD, Non-Expired, atau kosongkan.";
        r2.getCell(1).font = { italic: true, size: 9, color: { argb: "FF0284C7" } };
        r2.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
        r2.height = 22;

        // Row 3: Headers — NO "No." column, start directly with Kode Barang
        const headers = [
            { name: "Kode Barang", width: 20 },
            { name: "Nama Barang (Wajib)", width: 36 },
            { name: "Jumlah", width: 12 },
            { name: "Tanggal Expired (YYYY-MM-DD / Non-Expired / Kosong)", width: 34 },
            { name: "Satuan", width: 14 },
            { name: "Lokasi Simpan", width: 22 },
            { name: "Kategori", width: 20 },
            { name: "Sub Kategori", width: 20 }
        ];

        const headerRow = sheet.getRow(3);
        headerRow.height = 28;
        headers.forEach((col, idx) => {
            const cell = headerRow.getCell(idx + 1);
            cell.value = col.name;
            cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F4C81" } };
            cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
            sheet.getColumn(idx + 1).width = col.width;
        });

        // Freeze header row
        sheet.views = [{ state: "frozen", ySplit: 3 }];

        // Set clean row heights for data rows 4..100
        for (let i = 4; i <= 100; i++) {
            sheet.getRow(i).height = 22;
        }

        // Sheet 2: Referensi System (Real-time System Master Data)
        const sheet2 = workbook.addWorksheet("Referensi System");
        sheet2.mergeCells("A1:I1");
        sheet2.getRow(1).getCell(1).value = "MASTER DATA ACUAN DROPDOWN SISTEM INVENTARIS GEDUNG AGUNG";
        sheet2.getRow(1).getCell(1).font = { bold: true, size: 12, color: { argb: "FF0F172A" } };
        sheet2.getRow(1).getCell(1).alignment = { horizontal: "center" };
        sheet2.getRow(1).height = 26;

        // Headers for Sheet 2 Reference Columns
        sheet2.getRow(2).getCell(1).value = "Daftar Kategori System";
        sheet2.getRow(2).getCell(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
        sheet2.getRow(2).getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0284C7" } };

        sheet2.getRow(2).getCell(3).value = "Daftar Satuan System";
        sheet2.getRow(2).getCell(3).font = { bold: true, color: { argb: "FFFFFFFF" } };
        sheet2.getRow(2).getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0284C7" } };

        sheet2.getRow(2).getCell(5).value = "Daftar Lokasi System";
        sheet2.getRow(2).getCell(5).font = { bold: true, color: { argb: "FFFFFFFF" } };
        sheet2.getRow(2).getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0284C7" } };

        sheet2.getRow(2).getCell(7).value = "Master Nama Barang System";
        sheet2.getRow(2).getCell(7).font = { bold: true, color: { argb: "FFFFFFFF" } };
        sheet2.getRow(2).getCell(7).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0284C7" } };

        sheet2.getRow(2).getCell(9).value = "Daftar Sub Kategori System";
        sheet2.getRow(2).getCell(9).font = { bold: true, color: { argb: "FFFFFFFF" } };
        sheet2.getRow(2).getCell(9).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0284C7" } };

        sheet2.getColumn(1).width = 24; // Kategori
        sheet2.getColumn(2).width = 4;
        sheet2.getColumn(3).width = 20; // Satuan
        sheet2.getColumn(4).width = 4;
        sheet2.getColumn(5).width = 24; // Lokasi
        sheet2.getColumn(6).width = 4;
        sheet2.getColumn(7).width = 34; // Nama Barang
        sheet2.getColumn(8).width = 4;
        sheet2.getColumn(9).width = 24; // Sub Kategori

        // Populate Kategori (Col A)
        const katCount = kategoriList.length > 0 ? kategoriList.length : 1;
        (kategoriList.length > 0 ? kategoriList : ["Umum", "ATK", "Elektronik"]).forEach((kat, i) => {
            sheet2.getRow(3 + i).getCell(1).value = kat;
        });

        // Populate Satuan (Col C)
        const satCount = satuanList.length > 0 ? satuanList.length : 1;
        (satuanList.length > 0 ? satuanList : ["Pcs", "Rim", "Dus", "Box", "Botol"]).forEach((sat, i) => {
            sheet2.getRow(3 + i).getCell(3).value = sat;
        });

        // Populate Lokasi (Col E)
        const lokCount = lokasiList.length > 0 ? lokasiList.length : 1;
        (lokasiList.length > 0 ? lokasiList : ["Gudang Utama", "Gudang ATK", "Ruang Server"]).forEach((lok, i) => {
            sheet2.getRow(3 + i).getCell(5).value = lok;
        });

        // Populate Master Nama Barang (Col G)
        const barangCount = masterRows.length > 0 ? masterRows.length : 1;
        (masterRows.length > 0 ? masterRows : [{ nama: "Kertas HVS A4 80gr" }]).forEach((item, i) => {
            sheet2.getRow(3 + i).getCell(7).value = item.nama;
        });

        // Populate Sub Kategori (Col I)
        const subKatCount = subKategoriList.length > 0 ? subKategoriList.length : 1;
        (subKategoriList.length > 0 ? subKategoriList : ["Umum", "Kertas", "Alat Tulis"]).forEach((sub, i) => {
            sheet2.getRow(3 + i).getCell(9).value = sub;
        });

        // DataValidations — col layout: A=Kode, B=Nama, C=Jumlah, D=Expired, E=Satuan, F=Lokasi, G=Kategori, H=SubKat
        const maxRow = 300;
        sheet.dataValidations.add(`B4:B${maxRow}`, {
            type: "list",
            allowBlank: true,
            formulae: [`'Referensi System'!$G$3:$G$${barangCount + 2}`]
        });
        sheet.dataValidations.add(`D4:D${maxRow}`, {
            type: "list",
            allowBlank: true,
            formulae: ['"Non-Expired (5 Tahun)"']
        });
        sheet.dataValidations.add(`E4:E${maxRow}`, {
            type: "list",
            allowBlank: true,
            formulae: [`'Referensi System'!$C$3:$C$${satCount + 2}`]
        });
        sheet.dataValidations.add(`F4:F${maxRow}`, {
            type: "list",
            allowBlank: true,
            formulae: [`'Referensi System'!$E$3:$E$${lokCount + 2}`]
        });
        sheet.dataValidations.add(`G4:G${maxRow}`, {
            type: "list",
            allowBlank: true,
            formulae: [`'Referensi System'!$A$3:$A$${katCount + 2}`]
        });
        sheet.dataValidations.add(`H4:H${maxRow}`, {
            type: "list",
            allowBlank: true,
            formulae: [`'Referensi System'!$I$3:$I$${subKatCount + 2}`]
        });

        const fileName = `Template_Import_Penerimaan_${getTanggalHariIni()}.xlsx`;
        const filePath = path.join(EXPORTS_DIR, fileName);
        await workbook.xlsx.writeFile(filePath);
        res.download(filePath, fileName, (err) => {
            if (err) console.error("Gagal mengirim template import:", err);
        });
    } catch (err) {
        console.error("Gagal membuat template import:", err);
        res.status(500).json({ success: false, message: "Gagal membuat template import." });
    }
};

const ensureMasterEntry = async (tableName, columnName, value) => {
    if (!value || typeof value !== "string" || !value.trim()) {
        return;
    }
    const valClean = value.trim();
    try {
        if (tableName === "kategori") {
            const exists = await prisma.kategori.findFirst({ where: { nama_kategori: { equals: valClean, mode: "insensitive" } } });
            if (!exists) await prisma.kategori.create({ data: { nama_kategori: valClean } });
        } else if (tableName === "lokasi") {
            const exists = await prisma.lokasi.findFirst({ where: { nama_lokasi: { equals: valClean, mode: "insensitive" } } });
            if (!exists) await prisma.lokasi.create({ data: { nama_lokasi: valClean } });
        } else if (tableName === "satuan") {
            const exists = await prisma.satuan.findFirst({ where: { nama_satuan: { equals: valClean, mode: "insensitive" } } });
            if (!exists) await prisma.satuan.create({ data: { nama_satuan: valClean } });
        }
    } catch (e) {
        // Ignore duplicate errors
    }
};

const importPenerimaanBarang = async (req, res) => {
    try {
        const { no_penerimaan, tanggal_masuk, penerima, rows } = req.body;
        if (!rows || !Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ success: false, message: "Data import kosong atau format tidak sesuai." });
        }

        const now = new Date();
        const defaultDate = now.toISOString().slice(0, 10);
        const batchNoPenerimaan = (no_penerimaan && String(no_penerimaan).trim() !== "")
            ? String(no_penerimaan).trim()
            : `MASUK-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${Math.floor(100 + Math.random() * 900)}`;

        const batchTanggalMasuk = normalizeTanggal(tanggal_masuk) || defaultDate;
        const batchPenerima = (penerima && String(penerima).trim() !== "") ? String(penerima).trim() : "Petugas Persediaan";

        const masterList = await prisma.namaBarang.findMany();
        const masterMap = new Map();
        (masterList || []).forEach(m => {
            if (m.nama) masterMap.set(m.nama.trim().toLowerCase(), m);
        });

        let successCount = 0;

        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];

            let rawKode = "";
            let rawNama = "";
            let rawJumlah = "";
            let rawExp = "";
            let rawSatuan = "";
            let rawLokasi = "";
            let rawKategori = "";
            let rawSubKategori = "";

            if (r && typeof r === "object") {
                Object.keys(r).forEach(k => {
                    const keyLower = k.toLowerCase().trim();
                    const val = String(r[k] !== undefined && r[k] !== null ? r[k] : "").trim();
                    if (!val) return;

                    if (!rawKode && keyLower.includes("kode")) {
                        rawKode = val;
                    } else if (!rawNama && (keyLower.includes("nama") || keyLower.includes("produk") || keyLower.includes("barang"))) {
                        rawNama = val;
                    } else if (!rawJumlah && (keyLower.includes("jumlah") || keyLower.includes("banyak") || keyLower.includes("qty"))) {
                        rawJumlah = val;
                    } else if (!rawExp && (keyLower.includes("expired") || keyLower.includes("exp"))) {
                        rawExp = val;
                    } else if (!rawSatuan && (keyLower.includes("satuan") || keyLower.includes("unit"))) {
                        rawSatuan = val;
                    } else if (!rawLokasi && (keyLower.includes("lokasi") || keyLower.includes("gudang"))) {
                        rawLokasi = val;
                    } else if (!rawKategori && keyLower.includes("kategori") && !keyLower.includes("sub")) {
                        rawKategori = val;
                    } else if (!rawSubKategori && keyLower.includes("sub")) {
                        rawSubKategori = val;
                    }
                });
            }

            if (!rawNama) continue;

            const namaProduk = String(rawNama).trim();
            const namaUpper = namaProduk.toUpperCase();
            if (
                namaUpper.includes("CONTOH") ||
                namaUpper.includes("HAPUS") ||
                namaUpper.includes("TIMPA") ||
                namaUpper.startsWith("NAMA BARANG") ||
                namaUpper.startsWith("NO.")
            ) {
                continue; // Skip visual example row automatically
            }

            const matchedMaster = masterMap.get(namaProduk.toLowerCase()) || null;
            const jumlah = parseInt(rawJumlah, 10) || 1;

            // Robust date parsing
            const dateParseResult = parseFlexDate(rawExp);
            const isNoExpired = dateParseResult.isNoExpired;
            const tanggalExpired = dateParseResult.dateStr;

            let derivedInitials = namaProduk
                .split(/\s+/)
                .map(w => w[0])
                .join("")
                .toUpperCase()
                .slice(0, 4);
            let fallbackKode = `${derivedInitials || "BRG"}-001`;
            let kodeProduk = (rawKode || (matchedMaster ? matchedMaster.kode : "") || fallbackKode).trim().toUpperCase();
            let kategori = (rawKategori || (matchedMaster ? matchedMaster.kategori : "") || "Umum").trim();
            let subKategori = (rawSubKategori || (matchedMaster ? matchedMaster.sub_kategori : "") || "").trim();
            let satuan = (rawSatuan || (matchedMaster ? matchedMaster.satuan : "") || "Pcs").trim();
            let lokasi = (rawLokasi || (matchedMaster ? matchedMaster.lokasi : "") || "Gudang Utama").trim();

            // Auto-register custom typed Kategori, Lokasi, Satuan to master tables
            await Promise.all([
                ensureMasterEntry("kategori", "nama_kategori", kategori),
                ensureMasterEntry("lokasi", "nama_lokasi", lokasi),
                ensureMasterEntry("satuan", "nama_satuan", satuan)
            ]);

            // Daftarkan Sub Kategori ke tabel sub_kategori (butuh kategori_id)
            if (subKategori && subKategori.trim() !== "") {
                const katRow = await prisma.kategori.findFirst({ where: { nama_kategori: { equals: kategori.trim(), mode: "insensitive" } } });
                if (katRow) {
                    const subExists = await prisma.subKategori.findFirst({
                        where: { kategori_id: katRow.id, nama_sub_kategori: { equals: subKategori.trim(), mode: "insensitive" } }
                    });
                    if (!subExists) {
                        await prisma.subKategori.create({
                            data: { kategori_id: katRow.id, nama_sub_kategori: subKategori.trim() }
                        });
                    }
                }
            }

            if (matchedMaster) {
                let updated = false;
                const updateData = {};
                if (subKategori && matchedMaster.sub_kategori !== subKategori) {
                    matchedMaster.sub_kategori = subKategori;
                    updateData.sub_kategori = subKategori;
                    updated = true;
                }
                if (kategori && matchedMaster.kategori !== kategori) {
                    matchedMaster.kategori = kategori;
                    updateData.kategori = kategori;
                    updated = true;
                }
                if (satuan && matchedMaster.satuan !== satuan) {
                    matchedMaster.satuan = satuan;
                    updateData.satuan = satuan;
                    updated = true;
                }
                if (lokasi && matchedMaster.lokasi !== lokasi) {
                    matchedMaster.lokasi = lokasi;
                    updateData.lokasi = lokasi;
                    updated = true;
                }
                if (updated) {
                    await prisma.namaBarang.update({
                        where: { id: matchedMaster.id },
                        data: updateData
                    });
                }
            } else {
                try {
                    await prisma.namaBarang.create({
                        data: {
                            kode: kodeProduk,
                            nama: namaProduk,
                            kategori,
                            sub_kategori: subKategori,
                            satuan,
                            lokasi
                        }
                    });
                    masterMap.set(namaProduk.toLowerCase(), { kode: kodeProduk, nama: namaProduk, kategori, sub_kategori: subKategori, satuan, lokasi });
                } catch (e) {
                    // Ignore duplicate nama_barang
                }
            }

            await prisma.barang.create({
                data: {
                    no_penerimaan: batchNoPenerimaan,
                    kode_produk: kodeProduk,
                    nama_produk: namaProduk,
                    kategori,
                    sub_kategori: subKategori,
                    satuan,
                    jumlah,
                    tanggal_masuk: batchTanggalMasuk,
                    tanggal_expired: tanggalExpired,
                    lokasi,
                    penerima: batchPenerima,
                    is_no_expired: isNoExpired,
                    is_arsip: 0
                }
            });
            successCount++;
        }

        return res.json({
            success: true,
            message: `Berhasil mengimpor Transaksi Penerimaan ${batchNoPenerimaan} (${successCount} jenis barang)!`,
            no_penerimaan: batchNoPenerimaan,
            importedCount: successCount
        });
    } catch (err) {
        console.error("Gagal mengimpor penerimaan barang:", err);
        return res.status(500).json({ success: false, message: "Terjadi kesalahan saat memproses impor data." });
    }
};

const openExportsFolder = async (req, res) => {
    try {
        const { exec } = require("child_process");

        if (!fs.existsSync(EXPORTS_DIR)) {
            fs.mkdirSync(EXPORTS_DIR, { recursive: true });
        }

        let command = "";
        if (process.platform === "win32") {
            command = `explorer.exe "${EXPORTS_DIR}"`;
        } else if (process.platform === "darwin") {
            command = `open "${EXPORTS_DIR}"`;
        } else {
            command = `xdg-open "${EXPORTS_DIR}"`;
        }

        exec(command, (error) => {
            if (error && process.platform !== "win32") {
                console.error("Gagal membuka folder:", error);
                return res.status(500).json({ success: false, message: "Gagal membuka folder exports." });
            }
            if (error) {
                console.log("Explorer callback error (normal for explorer.exe):", error.message);
            }
            return res.json({ success: true, message: "Folder exports berhasil dibuka." });
        });
    } catch (err) {
        console.error("Gagal membuka folder exports:", err);
        res.status(500).json({ success: false, message: "Gagal membuka folder exports." });
    }
};

// ==========================
// EXPORT: Kartu Stok & Mutasi Real-Time
// ==========================
const exportKartuStok = async (req, res) => {
    const { kode_produk, tgl_dari, tgl_sampai, kategori, q } = req.query;

    try {
        const saldoAwalByKode = {};
        let totalSaldoAwal = 0;

        const allBarang = await prisma.barang.findMany({
            where: { is_arsip: 0 }
        });
        const allPemakaian = await prisma.pemakaian.findMany();

        // 1. Saldo awal per kode_produk
        if (tgl_dari && tgl_dari.trim() !== "") {
            const cutOffDate = tgl_dari.trim();

            allBarang.forEach(b => {
                const bDate = b.tanggal_masuk
                    ? b.tanggal_masuk.slice(0, 10)
                    : (b.created_at ? new Date(b.created_at).toISOString().slice(0, 10) : "");
                
                if (bDate && bDate < cutOffDate) {
                    if (kode_produk && kode_produk.trim() !== "" && b.kode_produk !== kode_produk.trim()) return;
                    if (kategori && kategori.trim() !== "" && kategori !== "Semua" && (b.kategori || "").toLowerCase() !== kategori.trim().toLowerCase()) return;
                    
                    const k = b.kode_produk || "GENERAL";
                    saldoAwalByKode[k] = (saldoAwalByKode[k] || 0) + (Number(b.jumlah) || 0);
                }
            });

            allPemakaian.forEach(p => {
                const pDate = p.tanggal_pemakaian
                    ? p.tanggal_pemakaian.slice(0, 10)
                    : (p.created_at ? new Date(p.created_at).toISOString().slice(0, 10) : "");
                
                if (pDate && pDate < cutOffDate) {
                    if (kode_produk && kode_produk.trim() !== "" && p.kode_produk !== kode_produk.trim()) return;
                    if (kategori && kategori.trim() !== "" && kategori !== "Semua" && (p.kategori || "").toLowerCase() !== kategori.trim().toLowerCase()) return;
                    
                    const k = p.kode_produk || "GENERAL";
                    saldoAwalByKode[k] = (saldoAwalByKode[k] || 0) - (Number(p.jumlah) || 0);
                }
            });

            Object.keys(saldoAwalByKode).forEach(k => {
                saldoAwalByKode[k] = Math.max(0, saldoAwalByKode[k]);
                totalSaldoAwal += saldoAwalByKode[k];
            });
        }

        // 2. Data mutasi
        const inboundList = [];
        allBarang.forEach(b => {
            const bDate = b.tanggal_masuk
                ? b.tanggal_masuk.slice(0, 10)
                : (b.created_at ? new Date(b.created_at).toISOString().slice(0, 10) : "");

            if (kode_produk && kode_produk.trim() !== "" && b.kode_produk !== kode_produk.trim()) return;
            if (kategori && kategori.trim() !== "" && kategori !== "Semua" && (b.kategori || "").toLowerCase() !== kategori.trim().toLowerCase()) return;
            if (tgl_dari && tgl_dari.trim() !== "" && bDate < tgl_dari.trim()) return;
            if (tgl_sampai && tgl_sampai.trim() !== "" && bDate > tgl_sampai.trim()) return;

            if (q && q.trim() !== "") {
                const term = q.trim().toLowerCase();
                const matchKode = (b.kode_produk || "").toLowerCase().includes(term);
                const matchNama = (b.nama_produk || "").toLowerCase().includes(term);
                const matchLokasi = (b.lokasi || "").toLowerCase().includes(term);
                if (!matchKode && !matchNama && !matchLokasi) return;
            }

            inboundList.push({
                id: b.id,
                jenis: "MASUK",
                no_ref: b.no_penerimaan,
                kode_produk: b.kode_produk,
                nama_produk: b.nama_produk,
                kategori: b.kategori,
                sub_kategori: b.sub_kategori,
                satuan: b.satuan,
                qty_masuk: Number(b.jumlah) || 0,
                qty_keluar: 0,
                tanggal: bDate,
                lokasi: b.lokasi,
                keterangan: b.penerima || "Penerimaan Barang",
                created_at: b.created_at
            });
        });

        const outboundList = [];
        allPemakaian.forEach(p => {
            const pDate = p.tanggal_pemakaian
                ? p.tanggal_pemakaian.slice(0, 10)
                : (p.created_at ? new Date(p.created_at).toISOString().slice(0, 10) : "");

            if (kode_produk && kode_produk.trim() !== "" && p.kode_produk !== kode_produk.trim()) return;
            if (kategori && kategori.trim() !== "" && kategori !== "Semua" && (p.kategori || "").toLowerCase() !== kategori.trim().toLowerCase()) return;
            if (tgl_dari && tgl_dari.trim() !== "" && pDate < tgl_dari.trim()) return;
            if (tgl_sampai && tgl_sampai.trim() !== "" && pDate > tgl_sampai.trim()) return;

            if (q && q.trim() !== "") {
                const term = q.trim().toLowerCase();
                const matchKode = (p.kode_produk || "").toLowerCase().includes(term);
                const matchNama = (p.nama_produk || "").toLowerCase().includes(term);
                const matchLokasi = (p.lokasi_pemakaian || "").toLowerCase().includes(term);
                if (!matchKode && !matchNama && !matchLokasi) return;
            }

            outboundList.push({
                id: p.id,
                jenis: "KELUAR",
                no_ref: p.no_order || "-",
                kode_produk: p.kode_produk,
                nama_produk: p.nama_produk,
                kategori: p.kategori || "",
                sub_kategori: p.sub_kategori || "",
                satuan: p.satuan || "Pcs",
                qty_masuk: 0,
                qty_keluar: Number(p.jumlah) || 0,
                tanggal: pDate,
                lokasi: p.lokasi_pemakaian || "",
                keterangan: (p.penerima ? p.penerima : "") + (p.keterangan ? " - " + p.keterangan : ""),
                created_at: p.created_at
            });
        });

        const rows = [...inboundList, ...outboundList].sort((a, b) => {
            if (a.tanggal !== b.tanggal) return (a.tanggal || "").localeCompare(b.tanggal || "");
            const dateA = new Date(a.created_at).getTime();
            const dateB = new Date(b.created_at).getTime();
            if (dateA !== dateB) return dateA - dateB;
            return a.id - b.id;
        });

        getSystemSettings(async (settings) => {
            try {
                const workbook = new ExcelJS.Workbook();
                workbook.creator = "Sistem Inventaris - Gedung Agung";
                workbook.created = new Date();

                const sheet = workbook.addWorksheet("Kartu Stok");

                // 1. Title Row (A1:K1)
                sheet.mergeCells("A1:K1");
                const titleRow = sheet.getRow(1);
                const instansiText = (settings.nama_instansi && settings.sub_instansi)
                    ? `${settings.nama_instansi.toUpperCase()} - ${settings.sub_instansi.toUpperCase()}`
                    : "ISTANA KEPRESIDENAN YOGYAKARTA";
                titleRow.getCell(1).value = `LAPORAN KARTU STOK & MUTASI BARANG - ${instansiText}`;
                titleRow.getCell(1).font = { bold: true, size: 14, color: { argb: "FF0F172A" } };
                titleRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
                titleRow.height = 30;

                // 2. Sub-title info (A2:K2)
                sheet.mergeCells("A2:K2");
                const infoRow = sheet.getRow(2);
                const prodInfo = kode_produk ? `Produk Kode: ${kode_produk}` : "Semua Produk";
                const periodInfo = (tgl_dari || tgl_sampai) ? `Periode: ${tgl_dari || 'Awal'} s.d. ${tgl_sampai || 'Hari Ini'}` : "Semua Periode";
                infoRow.getCell(1).value = `${prodInfo}   |   ${periodInfo}   |   Tanggal Unduh: ${getTanggalHariIni()}`;
                infoRow.getCell(1).font = { italic: true, size: 10, color: { argb: "FF475569" } };
                infoRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
                infoRow.height = 20;

                // 3. Summary row (A3:K3)
                const runningBalances = { ...saldoAwalByKode };
                let totalMasuk = 0;
                let totalKeluar = 0;

                (rows || []).forEach(r => {
                    totalMasuk += Number(r.qty_masuk) || 0;
                    totalKeluar += Number(r.qty_keluar) || 0;
                });
                const totalSaldoAkhir = totalSaldoAwal + totalMasuk - totalKeluar;

                sheet.mergeCells("A3:K3");
                const sumRow = sheet.getRow(3);
                const summaryTxt = `[ Saldo Awal: ${totalSaldoAwal} ]   -   [ Total Masuk (+): ${totalMasuk} ]   -   [ Total Keluar (-): ${totalKeluar} ]   -   [ Saldo Sisa Akhir: ${Math.max(0, totalSaldoAkhir)} ]`;
                sumRow.getCell(1).value = summaryTxt;
                sumRow.getCell(1).font = { bold: true, size: 11, color: { argb: "FF1E3A8A" } };
                sumRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
                sumRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF6FF" } };
                sumRow.height = 25;

                sheet.getRow(4).height = 15; // Row pembatas

                // 4. Header Tabel (Row 5)
                const headerCols = [
                    { name: "No.", width: 6 },
                    { name: "Tanggal", width: 14 },
                    { name: "Jenis Mutasi", width: 14 },
                    { name: "No. Referensi", width: 20 },
                    { name: "Kode Produk", width: 16 },
                    { name: "Nama Produk", width: 30 },
                    { name: "Masuk (+)", width: 14 },
                    { name: "Keluar (-)", width: 14 },
                    { name: "Saldo Sisa", width: 14 },
                    { name: "Lokasi", width: 20 },
                    { name: "Keterangan", width: 30 }
                ];

                const headerRow = sheet.getRow(5);
                headerRow.height = 26;
                headerCols.forEach((col, idx) => {
                    const cell = headerRow.getCell(idx + 1);
                    cell.value = col.name;
                    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
                    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } }; // Dark slate header
                    cell.alignment = { vertical: "middle", horizontal: "center" };
                    cell.border = {
                        top: { style: "thin", color: { argb: "FFCBD5E1" } },
                        left: { style: "thin", color: { argb: "FFCBD5E1" } },
                        bottom: { style: "medium", color: { argb: "FF0F172A" } },
                        right: { style: "thin", color: { argb: "FFCBD5E1" } }
                    };
                    sheet.getColumn(idx + 1).width = col.width;
                });

                // 5. Data Rows (Row 6+)
                let startRow = 6;

                // Sisipkan Saldo Awal di Excel jika ada tgl_dari
                if (tgl_dari && tgl_dari.trim() !== "") {
                    const rowSA = sheet.getRow(startRow);
                    rowSA.height = 22;
                    const valsSA = ["🏁", tgl_dari, "SALDO AWAL", "SALDO-AWAL", kode_produk || "-", "🏁 SALDO AWAL (Stok Bawaan Sebelum Periode)", "-", "-", totalSaldoAwal, "Gudang Utama", `Sisa stok komulatif sebelum tanggal ${tgl_dari}`];
                    valsSA.forEach((val, idx) => {
                        const cell = rowSA.getCell(idx + 1);
                        cell.value = val;
                        cell.alignment = { vertical: "middle", horizontal: (idx === 0 || idx === 1 || idx === 2 || idx === 3 || idx === 6 || idx === 7 || idx === 8) ? "center" : "left" };
                        cell.font = { bold: true, color: { argb: "FF78350F" } };
                        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFBEB" } }; // Warning tint
                        cell.border = {
                            top: { style: "thin", color: { argb: "FFCBD5E1" } },
                            left: { style: "thin", color: { argb: "FFCBD5E1" } },
                            bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
                            right: { style: "thin", color: { argb: "FFCBD5E1" } }
                        };
                    });
                    startRow++;
                }

                (rows || []).forEach((item, index) => {
                    const k = item.kode_produk || 'GENERAL';
                    if (runningBalances[k] === undefined) {
                        runningBalances[k] = 0;
                    }

                    const row = sheet.getRow(startRow);
                    row.height = 20;

                    const inQty = Number(item.qty_masuk) || 0;
                    const outQty = Number(item.qty_keluar) || 0;
                    runningBalances[k] += inQty - outQty;

                    const cellValues = [
                        index + 1,
                        item.tanggal,
                        item.jenis,
                        item.no_ref,
                        item.kode_produk,
                        item.nama_produk,
                        inQty > 0 ? inQty : "-",
                        outQty > 0 ? outQty : "-",
                        Math.max(0, runningBalances[k]),
                        item.lokasi || "Gudang Utama",
                        item.keterangan || "-"
                    ];

                    cellValues.forEach((val, idx) => {
                        const cell = row.getCell(idx + 1);
                        cell.value = val;
                        cell.alignment = {
                            vertical: "middle",
                            horizontal: (idx === 0 || idx === 1 || idx === 2 || idx === 3 || idx === 4 || idx === 6 || idx === 7 || idx === 8) ? "center" : "left"
                        };
                        cell.border = {
                            top: { style: "thin", color: { argb: "FFE2E8F0" } },
                            left: { style: "thin", color: { argb: "FFE2E8F0" } },
                            bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
                            right: { style: "thin", color: { argb: "FFE2E8F0" } }
                        };
                    });

                    // Styling jenis mutasi & saldo sisa
                    const jenisCell = row.getCell(3);
                    if (item.jenis === "MASUK") {
                        jenisCell.font = { bold: true, color: { argb: "FF15803D" } };
                        row.getCell(7).font = { bold: true, color: { argb: "FF15803D" } };
                    } else {
                        jenisCell.font = { bold: true, color: { argb: "FFB91C1C" } };
                        row.getCell(8).font = { bold: true, color: { argb: "FFB91C1C" } };
                    }

                    // Column Saldo Sisa Highlight
                    const saldoCell = row.getCell(9);
                    saldoCell.font = { bold: true, color: { argb: "FF1E3A8A" } };
                    saldoCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF6FF" } };

                    startRow++;
                });

                // Footer Tanda Tangan
                startRow += 2;
                const ftRow1 = sheet.getRow(startRow);
                ftRow1.getCell(2).value = "Mengetahui,";
                ftRow1.getCell(2).font = { bold: true };
                ftRow1.getCell(9).value = `Yogyakarta, ${getTanggalHariIni()}`;
                ftRow1.getCell(9).font = { bold: true };

                startRow++;
                const ftRow2 = sheet.getRow(startRow);
                ftRow2.getCell(2).value = "Kepala Subbagian Rumah Tangga & Perlengkapan";
                ftRow2.getCell(9).value = "Petugas Pengelola & Pengurus Barang";

                startRow += 4;
                const ftRow3 = sheet.getRow(startRow);
                ftRow3.getCell(2).value = "------------------------------------------";
                ftRow3.getCell(9).value = "------------------------------------------";

                const tanggalStr = getTanggalHariIni();
                const namaFile = `Kartu_Stok_${tanggalStr}.xlsx`;
                const filePath = path.join(EXPORTS_DIR, namaFile);
                await workbook.xlsx.writeFile(filePath);

                res.download(filePath, namaFile, (downloadErr) => {
                    if (downloadErr) console.error("Gagal mendownload Kartu Stok Excel:", downloadErr);
                });
            } catch (excelErr) {
                console.error("Gagal membuat Kartu Stok Excel:", excelErr);
                res.status(500).json({ success: false, message: "Gagal membuat file Excel Kartu Stok." });
            }
        });
    } catch (err) {
        console.error("Gagal export kartu stok:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

// Export Rekap Pemakaian Barang / Barang Keluar Ke Excel
const exportPemakaianBarang = async (req, res) => {
    try {
        const { tgl_dari, tgl_sampai, kode_produk, kategori, q, sort } = req.query;

        const allPemakaian = await prisma.pemakaian.findMany();

        let filtered = allPemakaian.filter(item => {
            const pDate = item.tanggal_pemakaian
                ? item.tanggal_pemakaian.slice(0, 10)
                : (item.created_at ? new Date(item.created_at).toISOString().slice(0, 10) : "");

            if (kode_produk && kode_produk.trim() !== "" && item.kode_produk !== kode_produk.trim()) return false;
            if (kategori && kategori.trim() !== "" && kategori !== "Semua" && (item.kategori || "").toLowerCase() !== kategori.trim().toLowerCase()) return false;
            if (tgl_dari && tgl_dari.trim() !== "" && pDate < tgl_dari.trim()) return false;
            if (tgl_sampai && tgl_sampai.trim() !== "" && pDate > tgl_sampai.trim()) return false;

            if (q && q.trim() !== "") {
                const term = q.trim().toLowerCase();
                const matchNoOrder = (item.no_order || "").toLowerCase().includes(term);
                const matchKode = (item.kode_produk || "").toLowerCase().includes(term);
                const matchNama = (item.nama_produk || "").toLowerCase().includes(term);
                const matchPenerima = (item.penerima || "").toLowerCase().includes(term);
                const matchKeterangan = (item.keterangan || "").toLowerCase().includes(term);
                if (!matchNoOrder && !matchKode && !matchNama && !matchPenerima && !matchKeterangan) return false;
            }

            return true;
        });

        const sortDir = (sort === "terlama") ? 1 : -1;
        filtered.sort((a, b) => {
            const dateA = a.tanggal_pemakaian || (a.created_at ? new Date(a.created_at).toISOString().slice(0, 10) : "");
            const dateB = b.tanggal_pemakaian || (b.created_at ? new Date(b.created_at).toISOString().slice(0, 10) : "");
            if (dateA !== dateB) return (dateA.localeCompare(dateB)) * sortDir;
            return (a.id - b.id) * sortDir;
        });

        const rows = filtered;

        getSystemSettings(async (settings) => {
            try {
                const workbook = new ExcelJS.Workbook();
                workbook.creator = "Sistem Inventaris - Gedung Agung";
                workbook.created = new Date();

                const sheet = workbook.addWorksheet("Pemakaian Barang");

                // Title
                sheet.mergeCells("A1:J1");
                const tRow = sheet.getRow(1);
                const instansiText = (settings.nama_instansi && settings.sub_instansi)
                    ? `${settings.nama_instansi.toUpperCase()} - ${settings.sub_instansi.toUpperCase()}`
                    : "ISTANA KEPRESIDENAN YOGYAKARTA";
                tRow.getCell(1).value = `REKAPITULASI PEMAKAIAN / BARANG KELUAR - ${instansiText}`;
                tRow.getCell(1).font = { bold: true, size: 14, color: { argb: "FF0F172A" } };
                tRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
                tRow.height = 30;

                // Info Subtitle
                sheet.mergeCells("A2:J2");
                const infoRow = sheet.getRow(2);
                const periodInfo = (tgl_dari || tgl_sampai) ? `Periode: ${tgl_dari || 'Awal'} s.d. ${tgl_sampai || 'Hari Ini'}` : "Semua Periode";
                const katInfo = kategori ? `Kategori: ${kategori}` : "Semua Kategori";
                infoRow.getCell(1).value = `${katInfo}   |   ${periodInfo}   |   Tanggal Unduh: ${getTanggalHariIni()}`;
                infoRow.getCell(1).font = { italic: true, size: 10, color: { argb: "FF475569" } };
                infoRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
                infoRow.height = 20;

                sheet.getRow(3).height = 10;

                // Header Cols
                const headerCols = [
                    { name: "No.", width: 6 },
                    { name: "No. Order", width: 22 },
                    { name: "Kode Produk", width: 16 },
                    { name: "Nama Produk", width: 32 },
                    { name: "Kategori", width: 20 },
                    { name: "Jumlah Keluar", width: 15 },
                    { name: "Satuan", width: 12 },
                    { name: "Tgl Pemakaian", width: 16 },
                    { name: "Penerima", width: 24 },
                    { name: "Keterangan", width: 30 }
                ];

                const headerRow = sheet.getRow(4);
                headerRow.height = 26;
                headerCols.forEach((col, idx) => {
                    const cell = headerRow.getCell(idx + 1);
                    cell.value = col.name;
                    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
                    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
                    cell.alignment = { vertical: "middle", horizontal: "center" };
                    cell.border = {
                        top: { style: "thin", color: { argb: "FFCBD5E1" } },
                        left: { style: "thin", color: { argb: "FFCBD5E1" } },
                        bottom: { style: "medium", color: { argb: "FF0F172A" } },
                        right: { style: "thin", color: { argb: "FFCBD5E1" } }
                    };
                    sheet.getColumn(idx + 1).width = col.width;
                });

                let startRow = 5;
                let totalUnits = 0;

                (rows || []).forEach((item, index) => {
                    const row = sheet.getRow(startRow);
                    row.height = 22;
                    const qty = Number(item.jumlah) || 0;
                    totalUnits += qty;

                    const rowVals = [
                        index + 1,
                        item.no_order || "-",
                        item.kode_produk || "-",
                        item.nama_produk || "-",
                        item.kategori || "-",
                        qty,
                        item.satuan || "Pcs",
                        item.tanggal_pemakaian || (item.created_at ? String(item.created_at).slice(0, 10) : "-"),
                        item.penerima || "-",
                        item.keterangan || "-"
                    ];

                    rowVals.forEach((val, cIdx) => {
                        const cell = row.getCell(cIdx + 1);
                        cell.value = val;
                        cell.alignment = {
                            vertical: "middle",
                            horizontal: (cIdx === 0 || cIdx === 1 || cIdx === 2 || cIdx === 6 || cIdx === 7) ? "center" : (cIdx === 5 ? "right" : "left")
                        };
                        cell.border = {
                            top: { style: "thin", color: { argb: "FFE2E8F0" } },
                            left: { style: "thin", color: { argb: "FFE2E8F0" } },
                            bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
                            right: { style: "thin", color: { argb: "FFE2E8F0" } }
                        };
                    });
                    startRow++;
                });

                // Total Summary Row
                const summaryRow = sheet.getRow(startRow);
                summaryRow.height = 25;
                sheet.mergeCells(`A${startRow}:E${startRow}`);
                summaryRow.getCell(1).value = `TOTAL KESELURUHAN (${rows.length} Transaksi)`;
                summaryRow.getCell(1).font = { bold: true, size: 11, color: { argb: "FF0F172A" } };
                summaryRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };

                summaryRow.getCell(6).value = totalUnits;
                summaryRow.getCell(6).font = { bold: true, size: 11, color: { argb: "FF0F172A" } };
                summaryRow.getCell(6).alignment = { horizontal: "right", vertical: "middle" };

                for (let c = 1; c <= 10; c++) {
                    const cell = summaryRow.getCell(c);
                    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
                    cell.border = {
                        top: { style: "medium", color: { argb: "FFD97706" } },
                        bottom: { style: "medium", color: { argb: "FFD97706" } },
                        left: { style: "thin", color: { argb: "FFFDE68A" } },
                        right: { style: "thin", color: { argb: "FFFDE68A" } }
                    };
                }

                // Tanda Tangan Footer
                startRow += 3;
                const ftRow1 = sheet.getRow(startRow);
                ftRow1.getCell(2).value = "Mengetahui,";
                ftRow1.getCell(8).value = `Yogyakarta, ${getTanggalHariIni()}`;

                startRow++;
                const ftRow2 = sheet.getRow(startRow);
                ftRow2.getCell(2).value = "Kepala Subbagian Rumah Tangga & Perlengkapan";
                ftRow2.getCell(8).value = "Petugas Pengelola & Pengurus Barang";

                startRow += 4;
                const ftRow3 = sheet.getRow(startRow);
                ftRow3.getCell(2).value = "------------------------------------------";
                ftRow3.getCell(8).value = "------------------------------------------";

                const tanggalStr = getTanggalHariIni();
                const namaFile = `Rekap_Pemakaian_Barang_${tanggalStr}.xlsx`;
                const filePath = path.join(EXPORTS_DIR, namaFile);
                await workbook.xlsx.writeFile(filePath);

                res.download(filePath, namaFile, (downloadErr) => {
                    if (downloadErr) console.error("Gagal mendownload Rekap Pemakaian Excel:", downloadErr);
                });
            } catch (excelErr) {
                console.error("Gagal membuat Excel Pemakaian:", excelErr);
                res.status(500).json({ success: false, message: "Gagal membuat file Excel Rekap Pemakaian." });
            }
        });
    } catch (err) {
        console.error("Gagal export pemakaian barang:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

const resetAllInventoryData = async (req, res) => {
    try {
        await prisma.pemakaian.deleteMany();
        await prisma.barang.deleteMany();
        await prisma.namaBarang.deleteMany();
        await prisma.subKategori.deleteMany();
        await prisma.kategori.deleteMany();
        await prisma.satuan.deleteMany();
        await prisma.lokasi.deleteMany();

        const defaultKategori = ['Umum', 'ATK', 'Elektronik', 'Kebersihan', 'Konsumsi'];
        for (const k of defaultKategori) {
            await prisma.kategori.create({ data: { nama_kategori: k } }).catch(() => {});
        }

        const defaultSatuan = ['Pcs', 'Rim', 'Dus', 'Box', 'Botol', 'Pack', 'Unit'];
        for (const s of defaultSatuan) {
            await prisma.satuan.create({ data: { nama_satuan: s } }).catch(() => {});
        }

        const defaultLokasi = ['Gudang Utama', 'Gudang ATK', 'Ruang Server'];
        for (const l of defaultLokasi) {
            await prisma.lokasi.create({ data: { nama_lokasi: l } }).catch(() => {});
        }

        return res.json({ success: true, message: "Seluruh data transaksi dan stok barang telah dikosongkan secara bersih!" });
    } catch (err) {
        console.error("Gagal mengosongkan data tabel:", err);
        return res.status(500).json({ success: false, message: "Gagal mengosongkan data tabel: " + err.message });
    }
};

module.exports = {
    exportSemuaBarang,
    exportBarangExpired,
    exportArsipBarang,
    exportOpnameStok,
    exportPenerimaanBarang,
    exportKartuStok,
    exportPemakaianBarang,
    openExportsFolder,
    downloadTemplateImportPenerimaan,
    importPenerimaanBarang,
    resetAllInventoryData
};