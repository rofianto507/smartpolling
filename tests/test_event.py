from datetime import timedelta

from odoo import fields
from odoo.exceptions import AccessError, UserError
from odoo.fields import Command
from odoo.tests import HttpCase, tagged


@tagged('post_install', '-at_install', 'smartpolling')
class TestEvent(HttpCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        env = cls.env
        portal = env.ref('base.group_portal')
        g_relawan = env.ref('smartpolling.group_relawan')

        def make_petugas(nama, hp, login):
            rel = env['smartpolling.relawan'].create({'name': nama, 'hp': hp})
            env['res.users'].create({
                'name': nama, 'login': login, 'password': login, 'relawan_id': rel.id,
                'group_ids': [Command.set([portal.id, g_relawan.id])],
            })
            return rel

        cls.pic = make_petugas('PIC Uji Event', '089911110001', 'pic_uji_event')
        cls.lain = make_petugas('Relawan Lain Uji', '089911110002', 'lain_uji_event')

        desa = env['smartpolling.desa'].search([], limit=1)
        if not desa:
            kab = env['smartpolling.kabupaten'].create({'name': 'Kab Uji', 'code': 'KU'})
            kec = env['smartpolling.kecamatan'].create({'name': 'Kec Uji', 'code': 'KCU', 'kabupaten_id': kab.id})
            desa = env['smartpolling.desa'].create({'name': 'Desa Uji', 'code': 'DSU', 'kecamatan_id': kec.id})
        tps = env['smartpolling.tps'].create({'name': 'TPS Uji Event', 'desa_id': desa.id, 'relawan_id': cls.pic.id})
        cls.dpt1, cls.dpt2, cls.dpt3 = env['smartpolling.dpt'].create([{
            'nama': f'Pemilih Uji {i}', 'nik': f'99000000000000{i:02d}', 'jenis_kelamin': 'L',
            'tps_id': tps.id, 'petugas_id': cls.pic.id,
        } for i in (1, 2, 3)])

        cls.now = fields.Datetime.now()

    def _event_vals(self, **kw):
        vals = {
            'name': 'Silaturahmi Uji', 'pic_id': self.pic.id, 'target_dpt': 10,
            'tanggal_mulai': self.now - timedelta(hours=1),
            'tanggal_selesai': self.now + timedelta(hours=2),
            'anggaran_ids': [Command.create({'uraian': 'Konsumsi', 'qty': 10, 'harga_satuan': 25000})],
        }
        vals.update(kw)
        return vals

    # ── Alur lengkap lewat API mobile ─────────────────────────────────
    def test_alur_lengkap(self):
        self.authenticate('pic_uji_event', 'pic_uji_event')
        rpc = self.make_jsonrpc_request
        dt = lambda d: d.strftime('%Y-%m-%d %H:%M:%S')  # noqa: E731
        data = {
            'nama': 'Jalan Sehat Warga', 'lokasi': 'Lapangan RW 3', 'deskripsi': 'Penggalangan suara',
            'mulai': dt(self.now - timedelta(hours=1)), 'selesai': dt(self.now + timedelta(hours=3)),
            'target_dpt': 3,
            'anggaran': [
                {'uraian': 'Konsumsi', 'qty': 100, 'satuan': 'porsi', 'harga_satuan': 20000},
                {'uraian': 'Sewa tenda', 'qty': 1, 'satuan': 'unit', 'harga_satuan': 500000},
            ],
        }
        # Draft → total anggaran dihitung server
        res = rpc('/mobile/api/event/save', {'data': data})
        self.assertTrue(res.get('success'), res)
        event = self.env['smartpolling.event'].browse(res['id'])
        self.assertEqual(event.state, 'draft')
        self.assertEqual(event.pic_id, self.pic)
        self.assertEqual(event.total_anggaran, 2_500_000)
        self.assertTrue(event.code.startswith('EVT/'))

        # Edit draft lalu ajukan
        data['target_dpt'] = 4
        res = rpc('/mobile/api/event/save', {'event_id': event.id, 'data': data, 'ajukan': True})
        self.assertTrue(res.get('success'), res)
        event.invalidate_recordset()
        self.assertEqual((event.state, event.target_dpt), ('diajukan', 4))

        # Setelah diajukan tidak bisa diubah/dihapus petugas
        self.assertIn('error', rpc('/mobile/api/event/save', {'event_id': event.id, 'data': data}))
        self.assertIn('error', rpc('/mobile/api/event/delete', {'event_id': event.id}))
        # Survey belum bisa ditandai ke event yang belum disetujui
        res = rpc('/mobile/api/survey/create', {'dpt_id': self.dpt1.id, 'pilihan': 'memilih', 'event_id': event.id})
        self.assertIn('error', res)

        # Admin pusat menyetujui dengan dana lebih kecil dari pengajuan
        event.dana_disetujui = 2_000_000
        event.action_setujui()
        self.assertEqual(event.state, 'disetujui')

        # Survey selama event → realisasi (pilihan terakhir per DPT yang dihitung)
        for dpt, pilihan in ((self.dpt1, 'ragu_ragu'), (self.dpt1, 'memilih'), (self.dpt2, 'tidak_memilih')):
            res = rpc('/mobile/api/survey/create', {'dpt_id': dpt.id, 'pilihan': pilihan, 'event_id': event.id})
            self.assertTrue(res.get('success'), res)
        # Survey biasa (tanpa event) tidak dihitung
        rpc('/mobile/api/survey/create', {'dpt_id': self.dpt3.id, 'pilihan': 'memilih'})
        self.assertEqual(rpc('/mobile/api/event/active')['records'][0]['id'], event.id)

        detail = rpc('/mobile/api/event/record', {'event_id': event.id})
        self.assertTrue(detail['can_lapor'])
        self.assertTrue(detail['can_survey'])
        self.assertEqual((detail['realisasi_dpt'], detail['realisasi_memilih']), (2, 1))

        # Berita acara
        res = rpc('/mobile/api/event/laporan', {'event_id': event.id, 'data': {
            'ringkasan': 'Berjalan lancar', 'jumlah_peserta': 120,
            'realisasi': [{'uraian': 'Konsumsi', 'jumlah': 1_500_000}, {'uraian': 'Tenda', 'jumlah': 300_000}],
        }})
        self.assertTrue(res.get('success'), res)
        event.invalidate_recordset()
        self.assertEqual(event.state, 'laporan')
        self.assertEqual(event.total_realisasi, 1_800_000)
        self.assertEqual(event.selisih_dana, 200_000)
        self.assertAlmostEqual(event.persen_serapan, 90.0)
        self.assertAlmostEqual(event.persen_target, 50.0)      # 2 dari 4
        self.assertAlmostEqual(event.persen_memilih, 50.0)     # 1 dari 2
        self.assertEqual(event.biaya_per_suara, 1_800_000)

        # Admin mengembalikan laporan → petugas memperbaiki (baris lama dipertahankan via id)
        event.catatan_admin = 'Lampirkan nota tenda'
        event.action_kembalikan_laporan()
        line_ids = event.realisasi_ids.ids
        res = rpc('/mobile/api/event/laporan', {'event_id': event.id, 'data': {
            'ringkasan': 'Berjalan lancar', 'jumlah_peserta': 120,
            'realisasi': [{'id': line_ids[0], 'uraian': 'Konsumsi', 'jumlah': 1_500_000},
                          {'uraian': 'Tenda + transport', 'jumlah': 700_000}],
        }})
        self.assertTrue(res.get('success'), res)
        event.invalidate_recordset()
        self.assertEqual(event.realisasi_ids[0].id, line_ids[0])
        self.assertNotIn(line_ids[1], event.realisasi_ids.ids)
        self.assertEqual(event.selisih_dana, -200_000)   # lebih bayar

        event.action_selesai()
        self.assertEqual(event.state, 'selesai')

    # ── Aturan bisnis & hak akses ─────────────────────────────────────
    def test_ajukan_butuh_anggaran_dan_target(self):
        event = self.env['smartpolling.event'].create(self._event_vals(target_dpt=0))
        with self.assertRaises(UserError):
            event.action_ajukan()
        event.write({'target_dpt': 5, 'anggaran_ids': [Command.clear()]})
        with self.assertRaises(UserError):
            event.action_ajukan()

    def test_tolak_dan_revisi_butuh_catatan(self):
        event = self.env['smartpolling.event'].create(self._event_vals())
        event.action_ajukan()
        with self.assertRaises(UserError):
            event.action_tolak()
        with self.assertRaises(UserError):
            event.action_minta_revisi()
        event.catatan_admin = 'Anggaran konsumsi terlalu besar'
        event.action_minta_revisi()
        self.assertEqual(event.state, 'draft')
        event.action_ajukan()
        event.action_tolak()
        self.assertEqual(event.state, 'ditolak')

    def test_petugas_tidak_bisa_menyetujui(self):
        event = self.env['smartpolling.event'].create(self._event_vals())
        event.action_ajukan()
        petugas = self.env['res.users'].search([('login', '=', 'pic_uji_event')])
        with self.assertRaises(AccessError):
            event.with_user(petugas).action_setujui()

    def test_isolasi_antar_petugas(self):
        event = self.env['smartpolling.event'].create(self._event_vals())
        event.action_ajukan()
        event.action_setujui()
        lain = self.env['res.users'].search([('login', '=', 'lain_uji_event')])
        self.assertFalse(self.env['smartpolling.event'].with_user(lain).search([('id', '=', event.id)]))

        self.authenticate('lain_uji_event', 'lain_uji_event')
        self.assertEqual(self.make_jsonrpc_request('/mobile/api/event/record', {'event_id': event.id}),
                         {'error': 'not_found'})
        self.assertEqual(self.make_jsonrpc_request('/mobile/api/event/list')['total'], 0)
        self.assertEqual(self.make_jsonrpc_request('/mobile/api/event/active')['records'], [])

    def test_laporan_belum_bisa_sebelum_mulai(self):
        event = self.env['smartpolling.event'].create(self._event_vals(
            tanggal_mulai=self.now + timedelta(days=2), tanggal_selesai=self.now + timedelta(days=2, hours=3)))
        event.action_ajukan()
        event.action_setujui()
        self.authenticate('pic_uji_event', 'pic_uji_event')
        res = self.make_jsonrpc_request('/mobile/api/event/laporan', {'event_id': event.id, 'data': {
            'ringkasan': 'x', 'realisasi': [{'uraian': 'a', 'jumlah': 1}]}})
        self.assertIn('error', res)
        self.assertEqual(event.state, 'disetujui')

    # ── UI app mobile (Chrome headless) ───────────────────────────────
    def test_ui_event(self):
        selesai = self.env['smartpolling.event'].create(self._event_vals(name='Event Evaluasi UI'))
        selesai.action_ajukan()
        selesai.action_setujui()
        selesai.write({'ba_ringkasan': 'ok', 'realisasi_ids': [Command.create({'uraian': 'Konsumsi', 'jumlah': 300000})]})
        selesai.action_kirim_laporan()

        code = """
        const wait = (sel, ms = 10000) => new Promise((resolve, reject) => {
            const t0 = Date.now();
            (function poll() {
                const el = document.querySelector(sel);
                if (el) return resolve(el);
                if (Date.now() - t0 > ms) return reject(new Error('Timeout menunggu ' + sel));
                setTimeout(poll, 100);
            })();
        });
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const clickText = (sel, text) => {
            const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.includes(text));
            if (!el) throw new Error('Tidak ada ' + sel + ' berisi ' + text);
            el.click();
        };
        const setVal = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
        (async () => {
            try {
                await wait('.sm-bottom-nav');
                clickText('.sm-nav-item', 'Event');
                await wait('.sm-tab.active .sm-event-item');

                // Detail event yang sudah lapor → bar evaluasi tampil
                document.querySelector('.sm-tab.active .sm-event-item').click();
                await wait('.sm-cmp-row');
                if (document.querySelectorAll('.sm-cmp-row').length !== 5) throw new Error('Bar evaluasi tidak lengkap');
                document.querySelector('.sm-back-btn').click();

                // Ajukan event baru dari form
                await wait('.sm-tab.active .sm-fab');
                document.querySelector('.sm-tab.active .sm-fab').click();
                await wait('.sm-line-edit');
                setVal(document.querySelector('input[placeholder^="mis. Silaturahmi"]'), 'Event Dari UI');
                setVal(document.querySelector('input[placeholder="mis. 150"]'), '25');
                setVal(document.querySelector('input[placeholder^="Uraian"]'), 'Konsumsi');
                setVal(document.querySelector('input[placeholder="Harga satuan"]'), '50000');
                await sleep(200);
                clickText('.sm-action-bar .sm-btn-primary', 'Ajukan');
                await wait('.sm-confirm-box');
                clickText('.sm-confirm-box .sm-btn-primary', 'Ya');
                await wait('.sm-badge--ev-diajukan');
                if (!document.querySelector('.sm-article-title').textContent.includes('Event Dari UI')) {
                    throw new Error('Detail event baru tidak tampil');
                }
                console.log('test successful');
            } catch (e) {
                console.error('UI event gagal: ' + e.message);
            }
        })();
        """
        self.browser_js('/mobile/app', code, login='pic_uji_event', timeout=90)
        baru = self.env['smartpolling.event'].search([('name', '=', 'Event Dari UI')])
        self.assertEqual((baru.state, baru.target_dpt, baru.total_anggaran), ('diajukan', 25, 50000))
