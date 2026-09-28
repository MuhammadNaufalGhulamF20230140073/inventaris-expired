const prisma = require("../prismaClient");

// Default Fallback Settings
const DEFAULT_SETTINGS = {
    threshold_kritis: "30",
    threshold_diperhatikan: "60",
    label_expired: "Expired",
    label_kritis: "Segera Expired",
    label_diperhatikan: "Diperhatikan",
    label_aman: "Aman",
    label_non_expired: "Non-Expired (5 Thn)",
    color_expired: "#dc3545",
    color_kritis: "#ffc107",
    color_diperhatikan: "#fd7e14",
    color_aman: "#198754",
    color_non_expired: "#0dcaf0",
    print_kop_1: "SEKRETARIAT PRESIDEN",
    print_kop_2: "ISTANA KEPRESIDENAN YOGYAKARTA",
    print_judul_dokumen: "BON BARANG",
    print_font_size: "12px",
    print_space_signature: "50px",
    print_label_ttd_kiri: "Penerima",
    print_label_ttd_kanan: "Petugas Persediaan",
    print_nama_petugas: "",
    print_nip_petugas: "",
    print_show_line: "1",
    print_catatan_kaki: "",
    nama_instansi: "Gedung Agung",
    sub_instansi: "Istana Kepresidenan Yogyakarta",
    alamat_instansi: "Jl. Ahmad Yani No. 3, Ngupasan, Gondomanan, Kota Yogyakarta",
    nama_penanggung_jawab: "Budi Santoso, S.STP",
    nip_penanggung_jawab: "19850315 200801 1 002",
    jabatan_penanggung_jawab: "Kepala Subbagian Rumah Tangga & Perlengkapan",
    prefix_no_penerimaan: "MASUK"
};

// GET /api/settings
exports.getSettings = async (req, res) => {
    try {
        const rows = await prisma.pengaturan.findMany();
        const settings = { ...DEFAULT_SETTINGS };
        rows.forEach(r => { settings[r.key_name] = r.value_text; });
        return res.json({ success: true, data: settings });
    } catch (err) {
        console.error("Gagal mengambil pengaturan:", err.message);
        return res.status(500).json({ success: false, message: err.message });
    }
};

// POST /api/settings
exports.updateSettings = async (req, res) => {
    const payload = req.body || {};
    const entries = Object.entries(payload);

    if (entries.length === 0) {
        return res.status(400).json({ success: false, message: "Payload tidak boleh kosong." });
    }

    try {
        // Upsert setiap key setting
        await Promise.all(entries.map(([key, val]) => {
            const valStr = String(val !== undefined && val !== null ? val : "");
            return prisma.pengaturan.upsert({
                where: { key_name: key },
                update: { value_text: valStr },
                create: { key_name: key, value_text: valStr }
            });
        }));
        return res.json({ success: true, message: "Konfigurasi berhasil disimpan." });
    } catch (err) {
        console.error("Gagal menyimpan setting:", err.message);
        return res.status(500).json({ success: false, message: "Gagal menyimpan sebagian konfigurasi." });
    }
};
