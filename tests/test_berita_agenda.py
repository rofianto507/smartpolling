from datetime import timedelta

from odoo import fields
from odoo.exceptions import AccessError
from odoo.fields import Command
from odoo.tests import HttpCase, tagged


@tagged('post_install', '-at_install', 'smartpolling')
class TestBeritaAgenda(HttpCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        env = cls.env
        # Mulai dari kondisi bersih (transaksi test di-rollback di akhir)
        env['smartpolling.berita'].with_context(active_test=False).search([]).unlink()
        env['smartpolling.agenda'].with_context(active_test=False).search([]).unlink()

        cls.relawan = env['smartpolling.relawan'].create({'name': 'Relawan Uji Info', 'hp': '089900001111'})
        cls.petugas = env['res.users'].create({
            'name': 'Petugas Uji Info',
            'login': 'petugas_uji_info',
            'password': 'petugas_uji_info',
            'relawan_id': cls.relawan.id,
            'group_ids': [Command.set([
                env.ref('base.group_portal').id,
                env.ref('smartpolling.group_relawan').id,
            ])],
        })

        Berita = env['smartpolling.berita']
        cls.berita_terbit = Berita.create({
            'name': 'Rapat Koordinasi Relawan',
            'isi': '<p>Isi dengan <b>teks tebal</b>.</p>',
        })
        cls.berita_terbit.action_terbitkan()
        cls.berita_draft = Berita.create({'name': 'Draft Rahasia', 'isi': '<p>belum terbit</p>'})

        now = fields.Datetime.now()
        Agenda = env['smartpolling.agenda']
        cls.agenda_besok = Agenda.create({
            'name': 'Pelatihan Saksi TPS', 'lokasi': 'Aula Kecamatan',
            'tanggal_mulai': now + timedelta(days=1),
            'tanggal_selesai': now + timedelta(days=1, hours=3),
            'deskripsi': '<p>Bawa <i>alat tulis</i>.</p>',
        })
        cls.agenda_besok.action_terbitkan()
        cls.agenda_batal = Agenda.create({'name': 'Apel Akbar', 'tanggal_mulai': now + timedelta(days=2)})
        cls.agenda_batal.action_terbitkan()
        cls.agenda_batal.action_batalkan()
        cls.agenda_lewat = Agenda.create({
            'name': 'Sosialisasi Lalu',
            'tanggal_mulai': now - timedelta(days=5),
            'tanggal_selesai': now - timedelta(days=5, hours=-2),
        })
        cls.agenda_lewat.action_terbitkan()
        cls.agenda_draft = Agenda.create({'name': 'Agenda Draft', 'tanggal_mulai': now + timedelta(days=3)})

    # ── Model & hak akses ─────────────────────────────────────────────
    def test_terbitkan_isi_tanggal(self):
        self.assertEqual(self.berita_terbit.state, 'terbit')
        self.assertTrue(self.berita_terbit.tanggal_terbit)

    def test_relawan_hanya_lihat_terbit(self):
        berita = self.env['smartpolling.berita'].with_user(self.petugas).search([])
        self.assertEqual(berita, self.berita_terbit)
        agenda = self.env['smartpolling.agenda'].with_user(self.petugas).search([])
        self.assertEqual(agenda, self.agenda_besok | self.agenda_batal | self.agenda_lewat)

    def test_relawan_tidak_bisa_tulis(self):
        with self.assertRaises(AccessError):
            self.berita_terbit.with_user(self.petugas).write({'name': 'Diubah'})
        with self.assertRaises(AccessError):
            self.env['smartpolling.agenda'].with_user(self.petugas).create({
                'name': 'X', 'tanggal_mulai': fields.Datetime.now()})

    # ── API mobile ────────────────────────────────────────────────────
    def test_api_mobile(self):
        self.authenticate('petugas_uji_info', 'petugas_uji_info')

        res = self.make_jsonrpc_request('/mobile/api/berita/list')
        self.assertEqual(res['total'], 1)
        self.assertEqual(res['records'][0]['judul'], 'Rapat Koordinasi Relawan')
        self.assertEqual(res['records'][0]['ringkasan'], 'Isi dengan teks tebal.')

        res = self.make_jsonrpc_request('/mobile/api/berita/record', {'berita_id': self.berita_draft.id})
        self.assertEqual(res, {'error': 'not_found'})

        res = self.make_jsonrpc_request('/mobile/api/agenda/list', {'mode': 'upcoming'})
        self.assertEqual([r['nama'] for r in res['records']], ['Pelatihan Saksi TPS', 'Apel Akbar'])
        res = self.make_jsonrpc_request('/mobile/api/agenda/list', {'mode': 'past'})
        self.assertEqual([r['nama'] for r in res['records']], ['Sosialisasi Lalu'])

        res = self.make_jsonrpc_request('/mobile/api/info/home')
        self.assertEqual([a['nama'] for a in res['agenda']], ['Pelatihan Saksi TPS'])  # yang batal tidak di Beranda
        self.assertEqual(len(res['berita']), 1)

    def test_api_tanpa_login(self):
        self.authenticate(None, None)
        res = self.make_jsonrpc_request('/mobile/api/berita/list')
        self.assertEqual(res, {'error': 'unauthorized'})

    # ── UI app mobile (Chrome headless) ───────────────────────────────
    def test_ui_mobile(self):
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
        const clickText = (sel, text) => {
            const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.includes(text));
            if (!el) throw new Error('Tidak ada ' + sel + ' berisi ' + text);
            el.click();
        };
        (async () => {
            try {
                // Beranda: seksi agenda terdekat & berita terbaru
                await wait('.sm-tab.active .sm-agenda-item');
                await wait('.sm-tab.active .sm-news-item');

                // Info (tombol app bar) → Berita (draft tidak boleh muncul)
                const P = '.sm-segment ~ .sm-list ';   // daftar di halaman Info
                clickText('.sm-appbar-btn', 'Info');
                await wait('.sm-segment');
                await wait(P + '.sm-news-item');
                const n = document.querySelectorAll(P + '.sm-news-item').length;
                if (n !== 1) throw new Error('Jumlah berita di halaman Info = ' + n + ', harusnya 1');

                // Detail berita: HTML dirender (bukan di-escape)
                document.querySelector(P + '.sm-news-item').click();
                const rich = await wait('.sm-rich');
                if (!rich.querySelector('b')) throw new Error('Isi berita tidak dirender sebagai HTML');
                document.querySelector('.sm-back-btn').click();

                // Kembali ke halaman Info → Agenda: akan datang (2, termasuk batal) lalu sudah lewat (1)
                await wait('.sm-segment');
                clickText('.sm-segment-btn', 'Agenda');
                await wait(P + '.sm-agenda-item');
                if (!document.querySelector('.sm-agenda-item--batal')) throw new Error('Agenda batal tidak ditandai');
                clickText('.sm-chip', 'Sudah Lewat');
                await new Promise((r) => setTimeout(r, 800));
                const lewat = [...document.querySelectorAll(P + '.sm-agenda-item')].map((e) => e.textContent);
                if (lewat.length !== 1 || !lewat[0].includes('Sosialisasi Lalu')) {
                    throw new Error('Daftar agenda lewat salah: ' + JSON.stringify(lewat));
                }

                // Detail agenda
                document.querySelector(P + '.sm-agenda-item').click();
                await wait('.sm-article-title');
                console.log('test successful');
            } catch (e) {
                console.error('UI mobile gagal: ' + e.message);
            }
        })();
        """
        self.browser_js('/mobile/app', code, login='petugas_uji_info', timeout=90)
