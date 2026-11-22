# SmartPolling

Modul **Odoo 19** untuk manajemen data pemenangan pemilu berbasis wilayah: pendataan relawan, TPS, Daftar Pemilih Tetap (DPT), dan survey preferensi pemilih, lengkap dengan dashboard peta interaktif dan aplikasi mobile untuk relawan lapangan.

## Fitur

- **Data Wilayah** — hierarki Kabupaten/Kota → Kecamatan → Desa/Kelurahan dengan geometri GeoJSON.
- **Relawan** — data relawan lapangan (nama, HP, alamat, foto, status), plus wizard **Buat User** untuk membuatkan akun login.
- **TPS** — Tempat Pemungutan Suara per desa, dengan koordinator relawan serta target vs realisasi jumlah DPT.
- **DPT** — biodata pemilih (NIK unik), koordinat GPS yang bisa diatur lewat peta Leaflet (drag marker), dan status verifikasi.
- **Survey (Voter)** — riwayat kunjungan survey preferensi per DPT (memilih / ragu-ragu / belum menentukan / tidak memilih) dengan foto dokumentasi; tiap survey otomatis tercatat di chatter DPT.
- **Dashboard** — KPI ringkas, peta choropleth 3 level dengan drill-down dan marker cluster titik DPT, serta grafik ECharts (distribusi pilihan, survey per petugas, tren 30 hari).
- **App Mobile Relawan** (`/mobile`) — aplikasi web mobile-first berbasis Owl: beranda KPI, input DPT dengan GPS, input survey dengan kompresi foto, dan profil.

## Hak Akses

| Grup | Akses |
|---|---|
| Administrator | Penuh atas semua data, termasuk membuat akun relawan |
| Relawan | Data DPT/Survey dalam cakupannya sendiri, TPS yang dikoordinasi (baca saja) |
| Dashboard Viewer | Baca seluruh data |

Cakupan relawan ditentukan oleh field **Relawan Terkait** (`relawan_id`) pada user.

## Kebutuhan

- Odoo 19.0
- Dependensi modul: `base`, `web`, `mail`

Library frontend (Leaflet, Leaflet.markercluster, ECharts, Font Awesome) sudah disertakan di `static/lib/`.

## Instalasi

1. Salin folder `smartpolling` ke salah satu direktori `addons_path` Odoo Anda.
2. Install modul:
   ```bash
   python odoo-bin -c odoo.conf -d <nama_db> -i smartpolling
   ```
   atau lewat **Apps → Update Apps List → cari "SmartPolling" → Install**.
3. Atur grup pengguna di **Settings → Users** (kategori *SmartPolling*). Untuk relawan, gunakan tombol **Buat User** di form Relawan agar akun langsung terhubung.

Data wilayah (kabupaten/kecamatan/desa beserta GeoJSON) **tidak** disertakan dalam modul dan perlu diisi sendiri sesuai wilayah yang digunakan.

## Penggunaan

- **Backend**: menu **SmartPolling** → Dashboard, Data Wilayah, Relawan, TPS, DPT, Hasil Survey.
- **App mobile relawan**: buka `http://<host>:8069/mobile` dan login dengan akun relawan (user harus memiliki *Relawan Terkait*).

## Struktur

```
smartpolling/
├── controllers/   # route & API app mobile relawan
├── data/          # sequence kode TPS
├── models/        # wilayah, relawan, tps, dpt, voter, res.users, wizard
├── security/      # grup, record rule, access rights
├── static/        # dashboard, widget peta, app mobile, vendor libs
└── views/         # form/list/kanban/pivot/graph, menu, template mobile
```

## Lisensi

LGPL-3 — © CV Sel Studio
