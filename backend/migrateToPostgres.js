/**
 * migrateToPostgres.js
 * Migrasi data dari SQLite lokal ke PostgreSQL (Vercel/Neon/Supabase)
 * menggunakan Prisma Client.
 *
 * Cara pakai:
 *   1. Isi DATABASE_URL di file .env
 *   2. npx prisma migrate deploy   (atau prisma db push untuk dev)
 *   3. node migrateToPostgres.js
 */

const sqlite3 = require("sqlite3").verbose();
const { PrismaClient } = require("@prisma/client");
const path = require("path");
const os = require("os");
const fs = require("fs");

const prisma = new PrismaClient();

// ─── helper: baca SQLite ─────────────────────────────────────────────────────
function readSqlite(sqliteDb, query) {
    return new Promise((resolve, reject) => {
        sqliteDb.all(query, [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

// ─── main ─────────────────────────────────────────────────────────────────────
async function migrate() {
    console.log("=== MIGRASI SQLite → PostgreSQL (Prisma) ===\n");

    // 1. Temukan file SQLite
    const candidates = [
        path.join(os.homedir(), "Documents", "InventarisGedungAgung", "inventaris.db"),
        path.join(__dirname, "database", "inventaris.db"),
    ];

    const sqlitePath = candidates.find(fs.existsSync);

    if (!sqlitePath) {
        console.log(
            "File SQLite tidak ditemukan. " +
            "Skema sudah dibuat via 'prisma migrate deploy', tidak ada data lama yang perlu dipindahkan."
        );
        process.exit(0);
    }

    console.log(`SQLite ditemukan: ${sqlitePath}`);
    const sqliteDb = new sqlite3.Database(sqlitePath);

    try {
        // ── 2. kategori ────────────────────────────────────────────────────
        const kategoriRows = await readSqlite(sqliteDb, "SELECT * FROM kategori");
        console.log(`Migrasi ${kategoriRows.length} baris → kategori`);
        for (const r of kategoriRows) {
            await prisma.kategori.upsert({
                where: { nama_kategori: r.nama_kategori },
                update: {},
                create: { nama_kategori: r.nama_kategori },
            });
        }

        // ── 3. lokasi ──────────────────────────────────────────────────────
        const lokasiRows = await readSqlite(sqliteDb, "SELECT * FROM lokasi");
        console.log(`Migrasi ${lokasiRows.length} baris → lokasi`);
        for (const r of lokasiRows) {
            await prisma.lokasi.upsert({
                where: { nama_lokasi: r.nama_lokasi },
                update: {},
                create: { nama_lokasi: r.nama_lokasi },
            });
        }

        // ── 4. satuan ──────────────────────────────────────────────────────
        const satuanRows = await readSqlite(sqliteDb, "SELECT * FROM satuan");
        console.log(`Migrasi ${satuanRows.length} baris → satuan`);
        for (const r of satuanRows) {
            await prisma.satuan.upsert({
                where: { nama_satuan: r.nama_satuan },
                update: {},
                create: { nama_satuan: r.nama_satuan },
            });
        }

        // ── 5. sub_kategori ────────────────────────────────────────────────
        let subKatRows = [];
        try {
            subKatRows = await readSqlite(sqliteDb, "SELECT * FROM sub_kategori");
        } catch (_) { /* tabel mungkin belum ada di SQLite lama */ }
        console.log(`Migrasi ${subKatRows.length} baris → sub_kategori`);
        for (const r of subKatRows) {
            await prisma.subKategori.upsert({
                where: {
                    kategori_id_nama_sub_kategori: {
                        kategori_id: r.kategori_id,
                        nama_sub_kategori: r.nama_sub_kategori,
                    },
                },
                update: {},
                create: {
                    kategori_id: r.kategori_id,
                    nama_sub_kategori: r.nama_sub_kategori,
                },
            });
        }

        // ── 6. nama_barang ─────────────────────────────────────────────────
        let namaBarangRows = [];
        try {
            namaBarangRows = await readSqlite(sqliteDb, "SELECT * FROM nama_barang");
        } catch (_) { }
        console.log(`Migrasi ${namaBarangRows.length} baris → nama_barang`);
        for (const r of namaBarangRows) {
            await prisma.namaBarang.upsert({
                where: { nama: r.nama },
                update: {},
                create: {
                    kode: r.kode || "",
                    nama: r.nama,
                    kategori: r.kategori || "",
                    sub_kategori: r.sub_kategori || "",
                    satuan: r.satuan || "",
                    lokasi: r.lokasi || "",
                },
            });
        }

        // ── 7. barang ──────────────────────────────────────────────────────
        const barangRows = await readSqlite(sqliteDb, "SELECT rowid AS id, * FROM barang");
        console.log(`Migrasi ${barangRows.length} baris → barang`);
        for (const r of barangRows) {
            await prisma.barang.upsert({
                where: { id: r.id },
                update: {
                    kode_produk: r.kode_produk,
                    nama_produk: r.nama_produk,
                    kategori: r.kategori || "",
                    sub_kategori: r.sub_kategori || "",
                    satuan: r.satuan || "",
                    jumlah: r.jumlah || 0,
                    tanggal_expired: r.tanggal_expired || "",
                    tanggal_masuk: r.tanggal_masuk || null,
                    lokasi: r.lokasi || "",
                    penerima: r.penerima || "",
                    no_penerimaan: r.no_penerimaan || "",
                    is_no_expired: r.is_no_expired || 0,
                    is_arsip: r.is_arsip || 0,
                },
                create: {
                    id: r.id,
                    kode_produk: r.kode_produk,
                    nama_produk: r.nama_produk,
                    kategori: r.kategori || "",
                    sub_kategori: r.sub_kategori || "",
                    satuan: r.satuan || "",
                    jumlah: r.jumlah || 0,
                    tanggal_expired: r.tanggal_expired || "",
                    tanggal_masuk: r.tanggal_masuk || null,
                    lokasi: r.lokasi || "",
                    penerima: r.penerima || "",
                    no_penerimaan: r.no_penerimaan || "",
                    is_no_expired: r.is_no_expired || 0,
                    is_arsip: r.is_arsip || 0,
                    created_at: r.created_at ? new Date(r.created_at) : new Date(),
                },
            });
        }

        // ── 8. pemakaian ───────────────────────────────────────────────────
        let pemakaianRows = [];
        try {
            pemakaianRows = await readSqlite(sqliteDb, "SELECT * FROM pemakaian");
        } catch (_) { }
        console.log(`Migrasi ${pemakaianRows.length} baris → pemakaian`);
        for (const r of pemakaianRows) {
            await prisma.pemakaian.upsert({
                where: { id: r.id },
                update: {},
                create: {
                    id: r.id,
                    no_order: r.no_order || "",
                    kode_produk: r.kode_produk,
                    nama_produk: r.nama_produk,
                    jumlah: r.jumlah,
                    tanggal_pemakaian: r.tanggal_pemakaian,
                    penerima: r.penerima || "",
                    keterangan: r.keterangan || "",
                    created_at: r.created_at ? new Date(r.created_at) : new Date(),
                },
            });
        }

        // ── 9. users (Seed Akun Login Bawaan) ──────────────────────────────
        const bcrypt = require("bcryptjs");
        const defaultUsers = [
            {
                username: "admin",
                email: "admin@gedungagung.id",
                password: bcrypt.hashSync("admin123", 10),
                nama: "Administrator Sistem",
                role: "ADMIN",
                status: "active",
            },
            {
                username: "operator_inv",
                email: "inventaris@gedungagung.id",
                password: bcrypt.hashSync("operator123", 10),
                nama: "Petugas Inventaris",
                role: "OPERATOR_INVENTARIS",
                status: "active",
            },
            {
                username: "operator_poli",
                email: "poliklinik@gedungagung.id",
                password: bcrypt.hashSync("operator123", 10),
                nama: "Petugas Poliklinik",
                role: "OPERATOR_POLIKLINIK",
                status: "active",
            },
        ];

        console.log(`Membuat ${defaultUsers.length} akun pengguna default...`);
        for (const u of defaultUsers) {
            await prisma.users.upsert({
                where: { username: u.username },
                update: {
                    email: u.email,
                    nama: u.nama,
                    role: u.role,
                    status: u.status,
                },
                create: u,
            });
        }

        // ── 10. pengaturan ─────────────────────────────────────────────────
        let pengaturanRows = [];
        try {
            pengaturanRows = await readSqlite(sqliteDb, "SELECT * FROM pengaturan");
        } catch (_) { }
        console.log(`Migrasi ${pengaturanRows.length} baris → pengaturan`);
        for (const r of pengaturanRows) {
            await prisma.pengaturan.upsert({
                where: { key_name: r.key_name },
                update: { value_text: r.value_text },
                create: { key_name: r.key_name, value_text: r.value_text },
            });
        }

        // ── 11. role_permissions ───────────────────────────────────────────
        let rolePermRows = [];
        try {
            rolePermRows = await readSqlite(sqliteDb, "SELECT * FROM role_permissions");
        } catch (_) { }
        console.log(`Migrasi ${rolePermRows.length} baris → role_permissions`);
        for (const r of rolePermRows) {
            await prisma.rolePermissions.upsert({
                where: { role_menu_key: { role: r.role, menu_key: r.menu_key } },
                update: { is_visible: r.is_visible ?? 1 },
                create: { role: r.role, menu_key: r.menu_key, is_visible: r.is_visible ?? 1 },
            });
        }

        if (rolePermRows.length === 0) {
            console.log("Menambahkan hak akses menu (role_permissions) bawaan...");
            const defaultPermissions = [
                ['ADMIN', 'dashboard', 1],
                ['ADMIN', 'master_barang', 1],
                ['ADMIN', 'penerimaan', 1],
                ['ADMIN', 'pemakaian', 1],
                ['ADMIN', 'laporan', 1],
                ['ADMIN', 'laporan_expired', 1],
                ['ADMIN', 'rekap_penerimaan', 1],
                ['ADMIN', 'rekap_pemakaian', 1],
                ['ADMIN', 'arsip', 1],
                ['ADMIN', 'pengaturan', 1],
                ['ADMIN', 'kelola_pengguna', 1],

                ['OPERATOR_INVENTARIS', 'dashboard', 1],
                ['OPERATOR_INVENTARIS', 'master_barang', 1],
                ['OPERATOR_INVENTARIS', 'penerimaan', 1],
                ['OPERATOR_INVENTARIS', 'pemakaian', 1],
                ['OPERATOR_INVENTARIS', 'laporan', 1],
                ['OPERATOR_INVENTARIS', 'laporan_expired', 1],
                ['OPERATOR_INVENTARIS', 'rekap_penerimaan', 1],
                ['OPERATOR_INVENTARIS', 'rekap_pemakaian', 1],
                ['OPERATOR_INVENTARIS', 'arsip', 1],
                ['OPERATOR_INVENTARIS', 'pengaturan', 0],
                ['OPERATOR_INVENTARIS', 'kelola_pengguna', 0],

                ['OPERATOR_POLIKLINIK', 'dashboard', 1],
                ['OPERATOR_POLIKLINIK', 'master_barang', 0],
                ['OPERATOR_POLIKLINIK', 'penerimaan', 0],
                ['OPERATOR_POLIKLINIK', 'pemakaian', 1],
                ['OPERATOR_POLIKLINIK', 'laporan', 1],
                ['OPERATOR_POLIKLINIK', 'laporan_expired', 0],
                ['OPERATOR_POLIKLINIK', 'rekap_penerimaan', 0],
                ['OPERATOR_POLIKLINIK', 'rekap_pemakaian', 1],
                ['OPERATOR_POLIKLINIK', 'arsip', 0],
                ['OPERATOR_POLIKLINIK', 'pengaturan', 0],
                ['OPERATOR_POLIKLINIK', 'kelola_pengguna', 0],

                ['PEMAKAI', 'dashboard', 1],
                ['PEMAKAI', 'master_barang', 0],
                ['PEMAKAI', 'penerimaan', 0],
                ['PEMAKAI', 'pemakaian', 1],
                ['PEMAKAI', 'laporan', 1],
                ['PEMAKAI', 'laporan_expired', 0],
                ['PEMAKAI', 'rekap_penerimaan', 0],
                ['PEMAKAI', 'rekap_pemakaian', 1],
                ['PEMAKAI', 'arsip', 0],
                ['PEMAKAI', 'pengaturan', 0],
                ['PEMAKAI', 'kelola_pengguna', 0],
            ];
            for (const [role, menu_key, is_visible] of defaultPermissions) {
                await prisma.rolePermissions.upsert({
                    where: { role_menu_key: { role, menu_key } },
                    update: { is_visible },
                    create: { role, menu_key, is_visible },
                });
            }
        }

        // ── 12. role_categories ────────────────────────────────────────────
        let roleCatRows = [];
        try {
            roleCatRows = await readSqlite(sqliteDb, "SELECT * FROM role_categories");
        } catch (_) { }
        console.log(`Migrasi ${roleCatRows.length} baris → role_categories`);
        for (const r of roleCatRows) {
            await prisma.roleCategories.upsert({
                where: { role_nama_kategori: { role: r.role, nama_kategori: r.nama_kategori } },
                update: {},
                create: { role: r.role, nama_kategori: r.nama_kategori },
            });
        }

        console.log("\n=== MIGRASI SELESAI! Data berhasil dipindahkan ke PostgreSQL ===");

    } catch (err) {
        console.error("ERROR saat migrasi:", err);
        process.exitCode = 1;
    } finally {
        sqliteDb.close();
        await prisma.$disconnect();
    }
}

migrate();
