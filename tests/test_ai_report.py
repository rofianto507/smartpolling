import json
from datetime import timedelta
from unittest.mock import MagicMock, patch

import requests

from odoo import fields
from odoo.exceptions import AccessError
from odoo.fields import Command
from odoo.tests import TransactionCase, tagged

POST = 'odoo.addons.smartpolling.models.ai_report.requests.post'
HASIL_AI = {
    'judul': 'Analisis Uji', 'status': 'perlu_perhatian', 'alasan_status': 'Cakupan survey rendah',
    'ringkasan': 'Ringkasan uji.',
    'temuan': [{'judul': 'Cakupan', 'detail': '10% DPT tersurvey', 'tingkat': 'perhatian'}],
    'wilayah_prioritas': [{'wilayah': 'Kab Uji', 'alasan': 'swing tinggi'}],
    'evaluasi_event': '', 'catatan_data': 'Data sedikit.',
    'rekomendasi': [{'aksi': 'Tambah relawan', 'alasan': 'cakupan rendah', 'prioritas': 'tinggi'}],
}


def _fake_response(payload):
    resp = MagicMock()
    resp.raise_for_status.return_value = None
    resp.json.return_value = payload
    return resp


@tagged('post_install', '-at_install', 'smartpolling')
class TestAiReport(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        env = cls.env
        cls.Report = env['smartpolling.ai.report']
        cls.relawan = env['smartpolling.relawan'].create({'name': 'Relawan Rahasia Uji', 'hp': '089977770001'})
        desa = env['smartpolling.desa'].search([], limit=1)
        tps = env['smartpolling.tps'].create({'name': 'TPS AI Uji', 'desa_id': desa.id, 'relawan_id': cls.relawan.id,
                                              'total_target': 10})
        cls.dpt = env['smartpolling.dpt'].create({
            'nama': 'Pemilih Rahasia Uji', 'nik': '9988776655443321', 'jenis_kelamin': 'P',
            'tps_id': tps.id, 'petugas_id': cls.relawan.id, 'alamat': 'Jl. Rahasia No. 7',
        })
        env['smartpolling.voter'].create({'dpt_id': cls.dpt.id, 'pilihan': 'ragu_ragu'})

        def make_user(login, group):
            return env['res.users'].create({
                'name': login, 'login': login,
                'group_ids': [Command.set([env.ref('base.group_user').id, env.ref(group).id])],
            })
        cls.admin = make_user('admin_ai_uji', 'smartpolling.group_admin')
        cls.viewer = make_user('viewer_ai_uji', 'smartpolling.group_viewer')
        cls.petugas = env['res.users'].create({
            'name': 'petugas_ai_uji', 'login': 'petugas_ai_uji', 'relawan_id': cls.relawan.id,
            'group_ids': [Command.set([env.ref('base.group_portal').id, env.ref('smartpolling.group_relawan').id])],
        })

    def _set_key(self, key='KUNCI-RAHASIA-123'):
        self.env['ir.config_parameter'].sudo().set_param('smartpolling.gemini_api_key', key)
        return key

    # ── Data agregat ──────────────────────────────────────────────────
    def test_data_tanpa_data_pribadi(self):
        data = self.Report._collect_data(False, 30)
        teks = json.dumps(data, ensure_ascii=False)
        for rahasia in ('9988776655443321', 'Pemilih Rahasia Uji', 'Relawan Rahasia Uji', 'Jl. Rahasia'):
            self.assertNotIn(rahasia, teks)
        self.assertGreaterEqual(data['dpt']['total'], 1)
        for kunci in ('aktivitas_survey', 'wilayah', 'tps', 'relawan', 'event', 'agenda_berita',
                      'dampak_kegiatan_terhadap_survey'):
            self.assertIn(kunci, data)

    def test_cakupan_kabupaten(self):
        kab = self.dpt.kabupaten_id
        data = self.Report._collect_data(kab, 7)
        self.assertEqual(data['cakupan'], kab.name)
        self.assertEqual(data['label_wilayah'], 'kecamatan')
        self.assertEqual(data['dpt']['total'], self.env['smartpolling.dpt'].search_count([('kabupaten_id', '=', kab.id)]))
        self.assertEqual(len(data['aktivitas_survey']['tren']), 7)   # tren harian untuk 7 hari

    # ── Generate ──────────────────────────────────────────────────────
    def test_tanpa_api_key(self):
        self.env['ir.config_parameter'].sudo().set_param('smartpolling.gemini_api_key', False)
        self.assertEqual(self.Report.with_user(self.admin).generate(), {'error': 'no_api_key'})

    def test_generate_berhasil(self):
        key = self._set_key()
        body = {'candidates': [{'content': {'parts': [{'text': json.dumps(HASIL_AI)}]}}]}
        with patch(POST, return_value=_fake_response(body)) as post:
            res = self.Report.with_user(self.viewer).generate(kabupaten_id=None, periode_hari=90)
        self.assertIn('id', res)
        rec = self.Report.browse(res['id'])
        self.assertEqual((rec.judul, rec.status, rec.periode_hari, rec.user_id), ('Analisis Uji', 'perlu_perhatian', 90, self.viewer))
        self.assertEqual(json.loads(rec.hasil_json)['rekomendasi'][0]['prioritas'], 'tinggi')
        # API key lewat header, bukan URL; output JSON terstruktur diminta
        args, kwargs = post.call_args
        self.assertNotIn(key, args[0])
        self.assertEqual(kwargs['headers']['x-goog-api-key'], key)
        self.assertEqual(kwargs['json']['generationConfig']['responseMimeType'], 'application/json')
        self.assertNotIn('9988776655443321', json.dumps(kwargs['json']))
        # Riwayat
        hist = self.Report.with_user(self.viewer).get_history()
        self.assertEqual(hist[0]['hasil']['judul'], 'Analisis Uji')

    def test_periode_tidak_valid_jadi_30(self):
        self._set_key()
        body = {'candidates': [{'content': {'parts': [{'text': json.dumps(HASIL_AI)}]}}]}
        with patch(POST, return_value=_fake_response(body)):
            res = self.Report.with_user(self.admin).generate(periode_hari=999)
        self.assertEqual(self.Report.browse(res['id']).periode_hari, 30)

    def test_error_http_api_key_disensor(self):
        key = self._set_key()
        err_resp = MagicMock(status_code=403, text=f'API key {key} tidak valid')
        err = requests.exceptions.HTTPError(response=err_resp)
        fake = MagicMock()
        fake.raise_for_status.side_effect = err
        n = self.Report.search_count([])
        with patch(POST, return_value=fake):
            res = self.Report.with_user(self.admin).generate()
        self.assertEqual(res['error'], 'request_failed')
        self.assertNotIn(key, res['detail'])
        self.assertIn('403', res['detail'])
        self.assertEqual(self.Report.search_count([]), n)   # gagal → tidak ada riwayat

    def test_respons_bukan_json(self):
        self._set_key()
        body = {'candidates': [{'content': {'parts': [{'text': 'bukan json'}]}}]}
        with patch(POST, return_value=_fake_response(body)):
            res = self.Report.with_user(self.admin).generate()
        self.assertEqual(res['error'], 'request_failed')

    def test_hak_akses(self):
        with self.assertRaises(AccessError):
            self.Report.with_user(self.petugas).generate()
        self.assertFalse(self.Report.with_user(self.viewer).can_use()['can_delete'])
        self.assertTrue(self.Report.with_user(self.admin).can_use()['can_delete'])
        rec = self.Report.create({'judul': 'x', 'hasil_json': '{}'})
        with self.assertRaises(AccessError):
            rec.with_user(self.viewer).unlink()

    # ── Data grafik dashboard ─────────────────────────────────────────
    def test_dampak_kegiatan(self):
        Dash = self.env['smartpolling.dashboard']
        kemarin = fields.Datetime.now() - timedelta(days=1)
        agenda = self.env['smartpolling.agenda'].create({'name': 'Agenda Dampak Uji', 'tanggal_mulai': kemarin})
        agenda.action_terbitkan()
        for _i in range(3):
            self.env['smartpolling.voter'].create({'dpt_id': self.dpt.id, 'pilihan': 'memilih', 'tanggal': kemarin})
        dampak = Dash.get_info_data()['dampak']
        row = next(k for k in dampak['kegiatan'] if k['nama'] == 'Agenda Dampak Uji')
        self.assertEqual((row['jenis'], row['jumlah_hari']), ('Agenda', 1))
        self.assertGreaterEqual(row['survey'], 3)
        self.assertGreater(row['rasio_vs_rata2'], 1)

    def test_data_event_dashboard(self):
        Event = self.env['smartpolling.event']
        now = fields.Datetime.now()
        ev = Event.create({
            'name': 'Event Grafik Uji', 'pic_id': self.relawan.id, 'target_dpt': 5,
            'tanggal_mulai': now - timedelta(hours=2), 'tanggal_selesai': now - timedelta(hours=1),
            'anggaran_ids': [Command.create({'uraian': 'a', 'qty': 1, 'harga_satuan': 100000})],
        })
        ev.action_ajukan()
        ev.action_setujui()
        ev.write({'ba_ringkasan': 'ok', 'realisasi_ids': [Command.create({'uraian': 'a', 'jumlah': 120000})]})
        ev.action_kirim_laporan()
        data = self.env['smartpolling.dashboard'].get_event_data()
        row = next(r for r in data['per_event'] if r['id'] == ev.id)
        self.assertEqual((row['dana_disetujui'], row['realisasi_dana'], row['serapan_pct']), (100000, 120000, 120.0))
        self.assertGreaterEqual(data['kpi']['menunggu_verifikasi_laporan'], 1)
