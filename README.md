# SmartPolling

Modul **Odoo 19** untuk manajemen data pemenangan pemilu berbasis wilayah: pendataan relawan, TPS, Daftar Pemilih Tetap (DPT), dan survey preferensi pemilih, lengkap dengan dashboard peta interaktif dan aplikasi mobile untuk relawan lapangan.

## Fitur

- **Data Wilayah** — hierarki Kabupaten/Kota → Kecamatan → Desa/Kelurahan dengan geometri GeoJSON.
- **Relawan** — data relawan lapangan (nama, HP, alamat, foto, status), plus wizard **Buat User** untuk membuatkan akun login.
- **TPS** — Tempat Pemungutan Suara per desa, dengan koordinator relawan serta target vs realisasi jumlah DPT.
- **DPT** — biodata pemilih (NIK unik), koordinat GPS yang bisa diatur lewat peta Leaflet (drag marker), dan status verifikasi.
- **Survey (Voter)** — riwayat kunjungan survey preferensi per DPT (memilih / ragu-ragu / belum menentukan / tidak memilih) dengan foto dokumentasi; tiap survey otomatis tercatat di chatter DPT.
- **Dashboard** — KPI ringkas, peta choropleth 3 level dengan drill-down dan marker cluster titik DPT, serta grafik ECharts (distribusi pilihan, survey per petugas, tren 30 hari).
- **Berita & Agenda** — admin menulis berita (dengan gambar sampul, bisa disematkan) dan agenda kegiatan (waktu, lokasi, bisa dibatalkan) di backend; setelah diterbitkan, langsung tampil di app petugas.
- **Event Penggalangan Suara** — petugas mengajukan event (detail, rincian anggaran, target DPT tersurvey) dari app; admin pusat menyetujui & menetapkan dana, menolak, atau minta revisi. Selama event, survey bisa ditandai untuk event tersebut. Setelah event, PIC mengirim berita acara (ringkasan, foto kegiatan, rincian penggunaan dana + foto nota). Hasil akhirnya **evaluasi**: anggaran vs realisasi dana (serapan, sisa/lebih bayar) dan target vs realisasi suara (DPT tersurvey, suara Memilih, biaya per suara) — per event di app & backend, serta lintas event lewat list/pivot.
- **App Mobile Relawan** (`/mobile`) — aplikasi web mobile-first berbasis Owl: beranda KPI + agenda terdekat + berita terbaru, input DPT dengan GPS, input survey dengan kompresi foto, tab Event (pengajuan, berita acara, evaluasi), halaman Info (berita & agenda), dan profil.

## Hak Akses

| Grup | Akses |
|---|---|
| Administrator | Penuh atas semua data, termasuk membuat akun relawan, verifikasi DPT, menerbitkan berita & agenda, serta menyetujui/menolak pendanaan event dan memverifikasi berita acara |
| Relawan | User **Portal** — hanya app `/mobile`, tidak bisa masuk backend. Data DPT/Survey dalam cakupannya sendiri, TPS yang dikoordinasi (baca saja), berita & agenda yang sudah terbit (baca saja), event miliknya sendiri (ajukan, lapor) |
| Dashboard Viewer | Baca seluruh data operasional, termasuk event & evaluasinya; berita & agenda yang sudah terbit |

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

- **Backend**: menu **SmartPolling** → Dashboard, Data Wilayah, Relawan, TPS, DPT, Hasil Survey, Event, Informasi (Berita, Agenda). Di menu Event, filter **Perlu Tindakan Admin** menampilkan pengajuan dan berita acara yang menunggu keputusan.
- **App mobile relawan**: buka `http://<host>:8069/mobile` dan login dengan akun relawan (user harus memiliki *Relawan Terkait*).

## Pengujian

```bash
python odoo-bin -c odoo.conf -d <nama_db> --test-tags smartpolling --stop-after-init --http-port=8099
```

Test UI app mobile memerlukan Google Chrome dan paket Python `websocket-client`; tanpa keduanya test tersebut dilewati (skip).

## Struktur

```
smartpolling/
├── controllers/   # route & API app mobile relawan, redirect login petugas
├── data/          # sequence kode TPS
├── migrations/    # skrip migrasi antar versi
├── models/        # wilayah, relawan, tps, dpt, voter, berita, agenda, event, res.users, wizard
├── security/      # grup, record rule, access rights
├── static/        # dashboard, widget peta, app mobile, vendor libs
├── tests/         # test model, API, dan UI app mobile
└── views/         # form/list/kanban/pivot/graph/calendar, menu, template mobile
```

## Lisensi

LGPL-3 — © CV Sel Studio
