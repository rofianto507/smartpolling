{
    'name': 'SmartPolling',
    'version': '19.0.1.3.2',
    'summary': 'Pendataan Relawan, TPS, DPT, dan Survey Preferensi Pemilih.',
    'description': """
SmartPolling adalah modul Odoo untuk manajemen data pemenangan pemilu berbasis wilayah.

FITUR UTAMA (v1):

1. Data Wilayah (GeoJSON): Kabupaten/Kota → Kecamatan → Desa/Kelurahan
2. Relawan: pendataan relawan lapangan (nama, HP, alamat, foto, status aktif)
3. TPS: Tempat Pemungutan Suara per desa, koordinator relawan, target vs realisasi DPT
4. DPT: Daftar Pemilih Tetap (NIK, biodata lengkap, koordinat GPS, status verifikasi)
5. Voter: riwayat kunjungan survey preferensi pemilih per DPT (memilih/ragu-ragu/
   belum menentukan/tidak memilih) dengan foto dokumentasi
6. Dashboard: peta sebaran DPT (choropleth kabupaten/kecamatan + titik individual)
   dan KPI card (capaian target, status verifikasi, preferensi pemilih, TPS tanpa
   koordinator)

AKSES BERBASIS PERAN:

- Admin: akses penuh semua data
- Relawan: CRUD data TPS/DPT/Voter pada cakupannya sendiri
- Viewer: akses baca semua data (dashboard)

Platform: Odoo 19.0
""",
    'category': 'Tools',
    'author': 'Cv Sel Studio',
    'website': 'https://selstudio.id',
    'depends': ['base', 'web', 'mail'],
    'data': [
        'security/security.xml',
        'security/ir.model.access.csv',
        'data/sequence_data.xml',
        'views/kabupaten_views.xml',
        'views/kecamatan_views.xml',
        'views/desa_views.xml',
        'views/relawan_views.xml',
        'views/relawan_create_user_wizard_views.xml',
        'views/tps_views.xml',
        'views/dpt_views.xml',
        'views/voter_views.xml',
        'views/berita_views.xml',
        'views/agenda_views.xml',
        'views/event_views.xml',
        'views/res_config_settings_views.xml',
        'views/res_users_views.xml',
        'views/dashboard_views.xml',
        'views/mobile_templates.xml',
        'views/menu.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'smartpolling/static/lib/leaflet/leaflet.css',
            'smartpolling/static/lib/leaflet/leaflet.js',
            'smartpolling/static/lib/leaflet-markercluster/MarkerCluster.css',
            'smartpolling/static/lib/leaflet-markercluster/MarkerCluster.Default.css',
            'smartpolling/static/lib/leaflet-markercluster/leaflet.markercluster.js',
            'smartpolling/static/lib/echart/echarts.min.js',
            'smartpolling/static/src/css/dashboard_smartpolling.css',
            'smartpolling/static/src/css/latlng_map_field.css',
            'smartpolling/static/src/xml/dashboard_smartpolling.xml',
            'smartpolling/static/src/xml/latlng_map_field.xml',
            'smartpolling/static/src/js/dashboard_smartpolling.js',
            'smartpolling/static/src/js/fields/latlng_map_field.js',
        ],
    },
    'installable': True,
    'application': True,
    'sequence': 5,
    'license': 'LGPL-3',
}
