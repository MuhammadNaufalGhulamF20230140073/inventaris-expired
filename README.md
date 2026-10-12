<div align="center">

# 🏛️ SIVA
### Sistem Inventaris Barang
**Istana Kepresidenan Yogyakarta (Gedung Agung)**

---

[![Node.js](https://img.shields.io/badge/Node.js-Express%205-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-18%20%26%20Vite-61DAFB?logo=react&logoColor=black)](https://reactjs.org/)
[![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL%20%2F%20Prisma-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Vercel](https://img.shields.io/badge/Deploy-Vercel-000000?logo=vercel&logoColor=white)](https://vercel.com/)
[![License](https://img.shields.io/badge/Lisensi-Kedinasan-gold)](#lisensi--hak-cipta)

</div>

---

## 📌 Ringkasan Proyek

**SIVA** adalah platform digital manajemen inventaris barang operasional di lingkungan **Istana Kepresidenan Yogyakarta (Gedung Agung)**. Sistem ini menggantikan proses pencatatan fisik manual dengan pengelolaan inventaris digital yang mencakup pencatatan penerimaan dan pemakaian barang, pemantauan masa kedaluwarsa (*expired*), kartu stok, serta rekapitulasi pelaporan resmi siap cetak berstandar kepresidenan.

---

## 🚀 Fitur Unggulan

### 📊 Executive Dashboard
Ringkasan kondisi inventaris secara menyeluruh: total barang aktif, barang segera kedaluwarsa, barang sudah kedaluwarsa, dan statistik penerimaan/pemakaian terkini.

### ⚠️ Sistem Pemantauan Kedaluwarsa (*Early Warning System*)
- Peringatan visual otomatis terhadap barang yang mendekati atau telah melewati tanggal kedaluwarsa.
- Konfigurasi ambang batas peringatan yang fleksibel (hari sebelum expired).
- Halaman khusus pemantauan expired dengan filter reaktif dinamis.

### 📦 Master Data Barang
- Pencatatan lengkap spesifikasi barang: nama, kategori, sub-kategori, satuan, lokasi penyimpanan, dan foto barang.
- Manajemen nama barang, kategori, sub-kategori, satuan, dan lokasi secara terpusat.

### 📥 Penerimaan Barang
- Pencatatan setiap penerimaan barang masuk lengkap dengan tanggal penerimaan, jumlah, dan tanggal kedaluwarsa.
- Mendukung unggah bukti penerimaan fisik.

### 📤 Pemakaian Barang
- Pencatatan pemakaian/pengeluaran barang dengan validasi stok real-time.
- Riwayat pemakaian terperinci per barang dan per periode.

### 📋 Kartu Stok
- Kartu stok digital per barang dengan riwayat mutasi masuk dan keluar secara kronologis.
- Saldo stok terupdate otomatis setiap transaksi.

### 🗄️ Arsip Barang
- Pengarsipan barang yang sudah tidak aktif atau habis masa berlakunya tanpa menghapus riwayat data.

### 📑 Pusat Laporan & Cetak Dokumen Resmi
- **Laporan Penerimaan Barang**: Rekapitulasi seluruh barang yang diterima berdasarkan periode dan filter dinamis.
- **Laporan Pemakaian Barang**: Rekapitulasi pemakaian barang per periode dengan detail pengguna dan lokasi.
- **Laporan Barang Kedaluwarsa**: Daftar barang expired atau mendekati kedaluwarsa siap audit.
- Format cetak resmi ber-**Kop Surat Gedung Agung Istana Kepresidenan Yogyakarta** yang dapat dikonfigurasi.
- Filter reaktif dinamis (per barang, kategori, lokasi, dan periode waktu).

### 👥 Manajemen Pengguna & Hak Akses (Admin)
- Pengelolaan akun pengguna berbasis **3 peran**: `Super Admin`, `Operator Inventaris`, dan `Operator Poliklinik`.
- **Matriks Hak Akses** visual dan dinamis — konfigurasi izin akses per menu per peran tanpa perlu ubah kode.
- Autentikasi aman dengan **JWT** dan enkripsi password **bcryptjs**.

### ⚙️ Panel Konfigurasi
- **Konfigurasi Expired**: Atur ambang batas hari peringatan kedaluwarsa.
- **Konfigurasi Instansi/Print**: Atur identitas instansi, kop surat, logo, dan tanda tangan untuk dokumen cetak resmi.
- **Konfigurasi Database**: Migrasi dan pengelolaan koneksi database langsung dari antarmuka.

---

## 🛠️ Arsitektur & Teknologi

### Frontend
| Teknologi | Keterangan |
|---|---|
| **React 18** & **Vite** | Library UI & build tool modern |
| **React Router DOM v6** | Client-side routing SPA |
| **Bootstrap 5** & Custom CSS | Framework UI & styling korporat |
| **React Bootstrap** | Komponen Bootstrap native React |
| **React Bootstrap Icons** | Ikon konsisten berbasis Bootstrap |
| **Context API** | State management (`AuthContext`, `SettingsContext`) |

### Backend
| Teknologi | Keterangan |
|---|---|
| **Node.js** & **Express.js v5** | Runtime & framework REST API |
| **RESTful API Architecture** | Pola komunikasi terstandar |
| **JWT** (jsonwebtoken) | Autentikasi berbasis token |
| **bcryptjs** | Enkripsi & hashing password |
| **Multer** | Pengunggahan foto/berkas barang |
| **ExcelJS** & **XLSX** | Ekspor laporan ke format Excel |
| **QRCode** | Generasi kode QR untuk identifikasi barang |
| **otplib** | Dukungan OTP untuk keamanan tambahan |
| **Nodemon** | Hot-reload server saat pengembangan |

### Database
| Teknologi | Keterangan |
|---|---|
| **Prisma ORM** (v6) | ORM modern dengan type-safety penuh |
| **PostgreSQL** | Database utama produksi (Vercel/Supabase) |
| **MySQL** | Opsi database alternatif lokal |
| **SQLite** | Database ringan untuk pengembangan/offline |

### Deployment & Infrastruktur
| Teknologi | Keterangan |
|---|---|
| **Vercel** | Platform deployment *serverless* |
| **Vercel Prisma Postgres** | Database terkelola produksi |
| **Inno Setup** | Pembuat installer Windows (`.exe`) untuk deployment lokal |

---

## 💻 Panduan Instalasi Lokal (Development Setup)

### Prasyarat
Pastikan perangkat Anda telah terinstal:
- [Node.js](https://nodejs.org/) v18 atau lebih baru
- [Git](https://git-scm.com/)
- Database (PostgreSQL / MySQL / atau biarkan SQLite untuk mode lokal)

### 1. Kloning Repositori

```bash
git clone https://github.com/MuhammadNaufalGhulamF20230140073/inventaris-expired.git
cd inventaris-expired
```

### 2. Instalasi Dependensi

Instal dependensi backend dan generate Prisma Client sekaligus dari root:

```bash
npm install
```

Atau instal manual pada masing-masing folder:

```bash
# Backend
cd backend && npm install

# Frontend
cd ../frontend && npm install
```

### 3. Konfigurasi Environment (`.env`)

Salin file contoh dan isi nilainya pada folder `backend`:

```bash
cp backend/.env.example backend/.env
```

Lalu edit `backend/.env`:

```env
# --- PostgreSQL (Prisma / Vercel) ---
DATABASE_URL="postgresql://user:password@host:port/database?sslmode=require"
DATABASE_URL_UNPOOLED="postgresql://user:password@host:port/database?sslmode=require"

# --- Keamanan JWT ---
JWT_SECRET="rahasia_jwt_siva_gedung_agung_2026"

# --- Environment ---
NODE_ENV="development"
```

Dan pada folder `frontend`, buat file `.env`:

```env
VITE_API_URL="http://localhost:3000/api"
```

### 4. Inisialisasi Database

```bash
cd backend

# Push skema Prisma ke database
npx prisma db push

# (Opsional) Buka Prisma Studio untuk melihat data
npx prisma studio
```

### 5. Menjalankan Aplikasi

Buka **dua terminal** terpisah:

**Terminal 1 — Backend:**
```bash
cd backend
npm run dev
# Server berjalan di http://localhost:3000
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
# Aplikasi web berjalan di http://localhost:5173
```

---

## 🌐 Deployment ke Vercel

### Build Frontend

```bash
npm run build
# Output: frontend/dist/
```

### Konfigurasi Vercel

File `vercel.json` sudah terkonfigurasi untuk routing serverless:

```json
{
  "outputDirectory": "frontend/dist",
  "functions": {
    "api/index.js": {
      "includeFiles": "backend/prisma/**"
    }
  },
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/index.js" }
  ]
}
```

Tambahkan variabel environment berikut di **Vercel Dashboard → Settings → Environment Variables**:

| Variabel | Nilai |
|---|---|
| `DATABASE_URL` | URL koneksi PostgreSQL produksi |
| `DATABASE_URL_UNPOOLED` | URL koneksi non-pooled (Prisma Postgres) |
| `JWT_SECRET` | String rahasia JWT yang kuat |
| `NODE_ENV` | `production` |

---

## 🖥️ Installer Windows (Deployment Lokal/Offline)

Untuk kebutuhan deployment pada jaringan lokal tanpa internet:

```bash
# Bungkus aplikasi menjadi paket siap distribusi
Bungkus-Aplikasi.bat

# Buat installer Windows (.exe) menggunakan Inno Setup
Buat-Installer.bat
```

Installer yang dihasilkan (`Setup-Inventaris.exe`) akan menginstal aplikasi beserta semua dependensinya secara otomatis.

---

## 📁 Struktur Proyek

```
inventaris-expired/
├── api/                        # Entry point Vercel serverless
│   └── index.js
├── backend/
│   ├── controllers/            # Logic handler per modul
│   ├── routes/                 # Definisi endpoint API
│   ├── models/                 # Model data
│   ├── prisma/                 # Skema & migrasi Prisma
│   ├── exports/                # Template & logika ekspor Excel
│   ├── uploads/                # Penyimpanan file yang diunggah
│   ├── db.js                   # Konfigurasi koneksi database
│   ├── initDatabase.js         # Inisialisasi & seed database
│   ├── prismaClient.js         # Instance Prisma Client
│   ├── migrateToPostgres.js    # Skrip migrasi ke PostgreSQL
│   └── index.js                # Entry point Express
├── frontend/
│   └── src/
│       ├── assets/             # Logo, gambar statis
│       ├── context/            # AuthContext, SettingsContext
│       ├── pages/              # Halaman utama aplikasi
│       │   ├── Dashboard.jsx
│       │   ├── SemuaBarang.jsx         # Penerimaan Barang
│       │   ├── PemakaianBarang.jsx
│       │   ├── DataBarang.jsx          # Master Data Barang
│       │   ├── KartuStok.jsx
│       │   ├── KategoriLokasi.jsx
│       │   ├── BarangExpired.jsx       # Pemantauan Expired
│       │   ├── ArsipBarang.jsx
│       │   ├── LaporanPenerimaan.jsx
│       │   ├── LaporanPemakaian.jsx
│       │   ├── LaporanExpired.jsx
│       │   ├── KelolaPengguna.jsx
│       │   ├── MatriksHakAkses.jsx
│       │   ├── KonfigurasiExpired.jsx
│       │   ├── KonfigurasiPrint.jsx
│       │   ├── KonfigurasiDatabase.jsx
│       │   └── Login.jsx
│       └── App.jsx
├── vercel.json                 # Konfigurasi deployment Vercel
├── setup.iss                   # Skrip Inno Setup installer Windows
├── Mulai-Aplikasi.vbs          # Skrip jalankan aplikasi lokal
├── Bungkus-Aplikasi.bat        # Skrip packaging distribusi
└── Buat-Installer.bat          # Skrip build installer .exe
```

---

## 🔗 API Endpoint Utama

| Method | Endpoint | Deskripsi |
|---|---|---|
| `POST` | `/api/auth/login` | Login pengguna |
| `GET` | `/api/dashboard` | Data ringkasan dashboard |
| `GET/POST` | `/api/barang` | Daftar & tambah barang |
| `GET/POST` | `/api/pemakaian` | Riwayat & tambah pemakaian |
| `GET/POST` | `/api/kategori` | Manajemen kategori |
| `GET/POST` | `/api/lokasi` | Manajemen lokasi |
| `GET/POST` | `/api/satuan` | Manajemen satuan |
| `GET/POST` | `/api/nama-barang` | Master nama barang |
| `GET/POST` | `/api/users` | Manajemen pengguna |
| `GET/PUT` | `/api/settings` | Konfigurasi sistem |
| `GET` | `/api/data` | Ekspor/impor data |
| `GET` | `/api/health` | Health check server |

---

## 📄 Lisensi & Hak Cipta

**Hak Cipta © 2026 Istana Kepresidenan Yogyakarta (Gedung Agung).**
Dikembangkan untuk keperluan operasional kedinasan inventaris barang kepresidenan.

> Sistem ini bersifat **kedinasan dan rahasia**. Dilarang mendistribusikan, memodifikasi, atau menggunakan di luar keperluan resmi tanpa izin tertulis dari pengelola sistem.
