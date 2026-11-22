"""Data agregat untuk seksi Event & Agenda/Berita di dashboard backend.

Dipakai DUA tempat supaya angkanya selalu identik:
  1. dashboard_smartpolling.js (grafik Event, Agenda & Berita, Dampak Kegiatan)
  2. smartpolling.ai.report._collect_data() (bahan analisis AI)
"""
from datetime import datetime, timedelta

from odoo import api, fields, models

WIB = timedelta(hours=7)
BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
EVENT_STATES = ('draft', 'diajukan', 'disetujui', 'ditolak', 'laporan', 'selesai')


def _pct(a, b):
    return round(a / b * 100, 1) if b else 0.0


class SmartPollingDashboard(models.AbstractModel):
    _name = 'smartpolling.dashboard'
    _description = 'Data Dashboard SmartPolling'

    # ─────────────────────────────────────────────────────────────
    # Helper waktu (hari kalender WIB ↔ UTC naive seperti di database)
    # ─────────────────────────────────────────────────────────────
    @staticmethod
    def _wib_date(dt_utc):
        return (dt_utc + WIB).date()

    @staticmethod
    def _utc_range_of_wib_days(d_from, d_to):
        """[awal d_from, awal (d_to + 1)) dalam UTC naive."""
        start = datetime(d_from.year, d_from.month, d_from.day) - WIB
        end = datetime(d_to.year, d_to.month, d_to.day) + timedelta(days=1) - WIB
        return start, end

    def _voter_scope(self, kabupaten):
        return [('kabupaten_id', '=', kabupaten.id)] if kabupaten else []

    def _event_scope(self, kabupaten):
        return [('pic_id.tps_ids.kabupaten_id', '=', kabupaten.id)] if kabupaten else []

    # ─────────────────────────────────────────────────────────────
    # EVENT
    # ─────────────────────────────────────────────────────────────
    @api.model
    def get_event_data(self, kabupaten_id=None, limit=10):
        kabupaten = self.env['smartpolling.kabupaten'].browse(int(kabupaten_id)) if kabupaten_id else False
        Event = self.env['smartpolling.event']
        events = Event.search(self._event_scope(kabupaten))
        didanai = events.filtered(lambda e: e.state in ('disetujui', 'laporan', 'selesai'))
        dievaluasi = events.filtered(lambda e: e.state in ('laporan', 'selesai'))
        dana = sum(didanai.mapped('dana_disetujui'))
        realisasi = sum(dievaluasi.mapped('total_realisasi'))
        dana_dievaluasi = sum(dievaluasi.mapped('dana_disetujui'))

        per_event = [{
            'id': e.id,
            'nama': e.name,
            'code': e.code,
            'state': e.state,
            'mulai': fields.Datetime.to_string(e.tanggal_mulai),
            'dana_disetujui': e.dana_disetujui,
            'realisasi_dana': e.total_realisasi,
            'serapan_pct': round(e.persen_serapan, 1),
            'target_dpt': e.target_dpt,
            'tersurvey': e.realisasi_dpt,
            'memilih': e.realisasi_memilih,
            'capaian_target_pct': round(e.persen_target, 1),
            'biaya_per_suara': round(e.biaya_per_suara),
            'sudah_lapor': e.state in ('laporan', 'selesai'),
        } for e in didanai.sorted('tanggal_mulai', reverse=True)[:int(limit or 10)]]
        per_event.reverse()   # kronologis untuk grafik

        return {
            'kpi': {
                'per_status': {s: len(events.filtered(lambda e, s=s: e.state == s)) for s in EVENT_STATES},
                'menunggu_persetujuan': len(events.filtered(lambda e: e.state == 'diajukan')),
                'menunggu_verifikasi_laporan': len(events.filtered(lambda e: e.state == 'laporan')),
                'berjalan': len(events.filtered(lambda e: e.state == 'disetujui')),
                'total_anggaran_diajukan': sum(events.filtered(lambda e: e.state != 'draft').mapped('total_anggaran')),
                'total_dana_disetujui': dana,
                'total_realisasi_dana': realisasi,
                'serapan_pct_event_sudah_lapor': _pct(realisasi, dana_dievaluasi),
                'target_dpt_event_sudah_lapor': sum(dievaluasi.mapped('target_dpt')),
                'tersurvey_event_sudah_lapor': sum(dievaluasi.mapped('realisasi_dpt')),
                'memilih_event_sudah_lapor': sum(dievaluasi.mapped('realisasi_memilih')),
                'biaya_per_suara_rata2': round(realisasi / sum(dievaluasi.mapped('realisasi_memilih')))
                if sum(dievaluasi.mapped('realisasi_memilih')) else 0,
            },
            'per_event': per_event,
        }

    # ─────────────────────────────────────────────────────────────
    # AGENDA & BERITA + DAMPAK KEGIATAN
    # ─────────────────────────────────────────────────────────────
    @api.model
    def get_info_data(self, kabupaten_id=None, bulan_lalu=5, bulan_depan=2, hari_dampak=90):
        kabupaten = self.env['smartpolling.kabupaten'].browse(int(kabupaten_id)) if kabupaten_id else False
        Agenda, Berita = self.env['smartpolling.agenda'], self.env['smartpolling.berita']
        now = fields.Datetime.now()
        today = self._wib_date(now)

        # ── Per bulan: agenda terbit/batal & berita terbit ──
        months = []
        y, m = today.year, today.month
        for i in range(-bulan_lalu, bulan_depan + 1):
            mm = m + i
            yy = y + (mm - 1) // 12
            mm = (mm - 1) % 12 + 1
            months.append((yy, mm))
        bulanan = []
        for yy, mm in months:
            awal = datetime(yy, mm, 1)
            akhir = datetime(yy + (mm == 12), mm % 12 + 1, 1)
            s, e = awal - WIB, akhir - WIB
            agenda_dom = [('tanggal_mulai', '>=', s), ('tanggal_mulai', '<', e)]
            bulanan.append({
                'bulan': f'{BULAN[mm - 1]} {yy}',
                'agenda_terbit': Agenda.search_count(agenda_dom + [('state', '=', 'terbit')]),
                'agenda_batal': Agenda.search_count(agenda_dom + [('state', '=', 'batal')]),
                'berita_terbit': Berita.search_count([('state', '=', 'terbit'),
                                                      ('tanggal_terbit', '>=', s), ('tanggal_terbit', '<', e)]),
            })

        mendatang = Agenda.search([('state', '=', 'terbit'), ('tanggal_mulai', '>=', now)],
                                  order='tanggal_mulai asc', limit=5)
        berita_terbaru = Berita.search([('state', '=', 'terbit')], limit=5)

        return {
            'bulanan': bulanan,
            'agenda_mendatang': [{
                'id': a.id, 'nama': a.name, 'lokasi': a.lokasi or '',
                'mulai': fields.Datetime.to_string(a.tanggal_mulai),
            } for a in mendatang],
            'berita_terbaru': [{
                'judul': b.name, 'tanggal': fields.Datetime.to_string(b.tanggal_terbit),
            } for b in berita_terbaru],
            'dampak': self._dampak_kegiatan(kabupaten, today, hari_dampak),
        }

    def _dampak_kegiatan(self, kabupaten, today, hari):
        """Bandingkan jumlah survey pada hari kegiatan (agenda terbit & event didanai)
        dengan rata-rata survey harian dalam `hari` terakhir. Hanya kegiatan yang sudah lewat."""
        Voter = self.env['smartpolling.voter']
        vscope = self._voter_scope(kabupaten)
        d_awal = today - timedelta(days=hari - 1)
        s, e = self._utc_range_of_wib_days(d_awal, today)
        total = Voter.search_count(vscope + [('tanggal', '>=', s), ('tanggal', '<', e)])
        rata2 = round(total / hari, 2)

        kegiatan = []
        for a in self.env['smartpolling.agenda'].search([('state', '=', 'terbit'), ('tanggal_mulai', '>=', s),
                                                         ('tanggal_mulai', '<', e)]):
            d1 = self._wib_date(a.tanggal_mulai)
            d2 = self._wib_date(a.tanggal_selesai) if a.tanggal_selesai else d1
            kegiatan.append(('Agenda', a.name, d1, d2))
        for ev in self.env['smartpolling.event'].search(
                self._event_scope(kabupaten) + [('state', 'in', ('disetujui', 'laporan', 'selesai')),
                                                 ('tanggal_mulai', '>=', s), ('tanggal_mulai', '<', e)]):
            kegiatan.append(('Event', ev.name, self._wib_date(ev.tanggal_mulai), self._wib_date(ev.tanggal_selesai)))

        hasil = []
        for jenis, nama, d1, d2 in sorted(kegiatan, key=lambda k: k[2], reverse=True)[:10]:
            if d1 > today:
                continue
            d2 = min(d2, today)
            ks, ke = self._utc_range_of_wib_days(d1, d2)
            n_hari = (d2 - d1).days + 1
            jumlah = Voter.search_count(vscope + [('tanggal', '>=', ks), ('tanggal', '<', ke)])
            per_hari = round(jumlah / n_hari, 2)
            hasil.append({
                'jenis': jenis, 'nama': nama, 'tanggal': d1.isoformat(), 'jumlah_hari': n_hari,
                'survey': jumlah, 'survey_per_hari': per_hari,
                'rasio_vs_rata2': round(per_hari / rata2, 2) if rata2 else None,
            })
        hasil.reverse()
        return {'rata2_survey_harian': rata2, 'periode_hari': hari, 'kegiatan': hasil}
