"""Analisis dashboard dengan bantuan AI (Gemini) — pola sama dengan AI Insights hr_smartatt:
REST API Gemini via `requests` (tanpa SDK), API key di ir.config_parameter, setiap hasil
disimpan sebagai riwayat.

Bedanya: hasil diminta dalam bentuk JSON terstruktur (responseSchema) supaya bisa dirender
sebagai laporan (status, temuan, wilayah prioritas, evaluasi event, rekomendasi), dan data
yang dikirim ke AI ikut disimpan (`data_json`) supaya angka di laporan bisa diaudit.

PRIVASI: yang dikirim ke Gemini HANYA angka agregat per wilayah/TPS/event. Tidak pernah
NIK, nama pemilih, alamat, atau nama relawan.
"""
import json
import logging
from datetime import timedelta

import requests

from odoo import api, fields, models, _
from odoo.exceptions import AccessError

_logger = logging.getLogger(__name__)

GEMINI_MODEL = 'gemini-2.5-flash'
GEMINI_ENDPOINT = f'https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent'
ICP_KEY = 'smartpolling.gemini_api_key'
PERIODE_PILIHAN = (7, 30, 90)
MAX_WILAYAH = 15

PILIHAN = ('memilih', 'ragu_ragu', 'belum_menentukan', 'tidak_memilih')

# Skema output (subset OpenAPI yang didukung Gemini responseSchema)
_S = lambda **kw: dict(type='STRING', **kw)  # noqa: E731
RESPONSE_SCHEMA = {
    'type': 'OBJECT',
    'properties': {
        'judul': _S(),
        'status': _S(enum=['baik', 'perlu_perhatian', 'kritis']),
        'alasan_status': _S(),
        'ringkasan': _S(),
        'temuan': {'type': 'ARRAY', 'items': {'type': 'OBJECT', 'properties': {
            'judul': _S(), 'detail': _S(),
            'tingkat': _S(enum=['positif', 'netral', 'perhatian', 'kritis']),
        }, 'required': ['judul', 'detail', 'tingkat']}},
        'wilayah_prioritas': {'type': 'ARRAY', 'items': {'type': 'OBJECT', 'properties': {
            'wilayah': _S(), 'alasan': _S(),
        }, 'required': ['wilayah', 'alasan']}},
        'evaluasi_event': _S(),
        'rekomendasi': {'type': 'ARRAY', 'items': {'type': 'OBJECT', 'properties': {
            'aksi': _S(), 'alasan': _S(),
            'prioritas': _S(enum=['tinggi', 'sedang', 'rendah']),
        }, 'required': ['aksi', 'alasan', 'prioritas']}},
        'catatan_data': _S(),
    },
    'required': ['judul', 'status', 'alasan_status', 'ringkasan', 'temuan', 'rekomendasi'],
}

INSTRUKSI = """Anda adalah analis data tim pemenangan pemilu di Indonesia. Di bawah ini data AGREGAT
dari sistem SmartPolling (pendataan DPT, survey preferensi pemilih, TPS, relawan, dan event
penggalangan suara). Buat laporan analisis dalam Bahasa Indonesia untuk admin pusat.

Aturan:
1. Gunakan HANYA angka yang ada di data. Jangan mengarang angka, nama orang, atau wilayah.
   Saat menyebut angka, tulis angkanya (mis. "38% dari 1.081 DPT").
2. "pilihan" dihitung dari survey TERAKHIR tiap DPT. "swing" = ragu_ragu + belum_menentukan
   (kelompok yang paling mungkin dipengaruhi). "cakupan_survey" = persen DPT yang sudah pernah disurvey.
3. Perhatikan ukuran sampel: wilayah/event dengan data sangat sedikit jangan disimpulkan berlebihan,
   sebutkan keterbatasannya di "catatan_data".
4. "temuan": 3-6 butir paling penting (tren, cakupan, sebaran pilihan per wilayah, capaian TPS,
   produktivitas relawan, efisiensi event). Tandai tingkat: positif / netral / perhatian / kritis.
5. "wilayah_prioritas": maksimal 5 wilayah yang paling layak difokuskan (mis. DPT banyak tapi cakupan
   survey rendah, atau proporsi swing tinggi), dengan alasan berbasis angka.
6. "evaluasi_event": bandingkan anggaran vs realisasi dana dan target vs realisasi suara; sebut event
   paling/kurang efisien (biaya per suara) bila datanya ada, dan event yang menunggu persetujuan atau
   verifikasi laporan. Kosongkan bila belum ada event.
7. "dampak_kegiatan_terhadap_survey": "rasio_vs_rata2" = survey per hari saat kegiatan dibagi rata-rata
   survey harian (1.0 = sama dengan biasa, 2.0 = dua kali lipat). Gunakan untuk menilai apakah agenda/event
   menggerakkan aktivitas lapangan, sebutkan di temuan bila polanya jelas. Ingat ini korelasi, bukan
   bukti sebab-akibat. "agenda_berita" menunjukkan intensitas komunikasi/kegiatan per bulan; agenda
   mendatang bisa dijadikan momentum dalam rekomendasi.
8. "rekomendasi": 3-5 aksi konkret dan terukur untuk periode berikutnya. Rekomendasi WAJIB etis dan
   sesuai aturan kampanye (tanpa politik uang, intimidasi, atau penyebaran hoaks).
9. "status": baik / perlu_perhatian / kritis untuk kondisi keseluruhan, dengan alasan singkat."""


class SmartPollingAiReport(models.Model):
    _name = 'smartpolling.ai.report'
    _description = 'Analisis Dashboard AI'
    _order = 'create_date desc, id desc'
    _rec_name = 'judul'

    judul = fields.Char('Judul', required=True)
    status = fields.Selection([
        ('baik', 'Baik'),
        ('perlu_perhatian', 'Perlu Perhatian'),
        ('kritis', 'Kritis'),
    ], string='Status')
    ringkasan = fields.Text('Ringkasan')
    hasil_json = fields.Text('Hasil Analisis (JSON)', required=True)
    data_json = fields.Text('Data yang Dianalisis (JSON)', help='Snapshot data agregat yang dikirim ke AI.')
    kabupaten_id = fields.Many2one('smartpolling.kabupaten', string='Cakupan Kabupaten/Kota')
    periode_hari = fields.Integer('Periode (hari)', required=True, default=30)
    model_ai = fields.Char('Model AI', default=GEMINI_MODEL)
    user_id = fields.Many2one('res.users', string='Dibuat Oleh', default=lambda self: self.env.user, readonly=True)

    # ─────────────────────────────────────────────────────────────
    # API dipanggil dari dashboard
    # ─────────────────────────────────────────────────────────────
    @api.model
    def can_use(self):
        user = self.env.user
        return {
            'can_generate': user.has_group('smartpolling.group_admin') or user.has_group('smartpolling.group_viewer'),
            'can_delete': user.has_group('smartpolling.group_admin'),
            'has_key': bool(self.sudo()._get_api_key()),
        }

    @api.model
    def generate(self, kabupaten_id=None, periode_hari=30):
        user = self.env.user
        if not (user.has_group('smartpolling.group_admin') or user.has_group('smartpolling.group_viewer')):
            raise AccessError(_('Hanya Administrator / Dashboard Viewer yang dapat membuat analisis AI.'))
        api_key = self.sudo()._get_api_key()
        if not api_key:
            return {'error': 'no_api_key'}
        periode_hari = int(periode_hari or 30)
        if periode_hari not in PERIODE_PILIHAN:
            periode_hari = 30
        kabupaten = self.env['smartpolling.kabupaten'].browse(int(kabupaten_id)) if kabupaten_id else False

        data = self._collect_data(kabupaten, periode_hari)
        try:
            hasil = self._call_gemini(api_key, data)
        except _GeminiError as e:
            return {'error': 'request_failed', 'detail': str(e)}

        rec = self.create({
            'judul': (hasil.get('judul') or 'Analisis Dashboard')[:200],
            'status': hasil.get('status') if hasil.get('status') in ('baik', 'perlu_perhatian', 'kritis') else False,
            'ringkasan': hasil.get('ringkasan') or '',
            'hasil_json': json.dumps(hasil, ensure_ascii=False),
            'data_json': json.dumps(data, ensure_ascii=False, indent=1),
            'kabupaten_id': kabupaten.id if kabupaten else False,
            'periode_hari': periode_hari,
        })
        return {'id': rec.id}

    @api.model
    def get_history(self, limit=20):
        recs = self.search([], limit=int(limit or 20))
        return [{
            'id': r.id,
            'judul': r.judul,
            'status': r.status,
            'tanggal': fields.Datetime.to_string(r.create_date),
            'cakupan': r.kabupaten_id.name or 'Seluruh wilayah',
            'periode_hari': r.periode_hari,
            'user': r.user_id.name,
            'hasil': json.loads(r.hasil_json or '{}'),
            'data_json': r.data_json or '',
        } for r in recs]

    # ─────────────────────────────────────────────────────────────
    # Pengumpulan data agregat (tanpa data pribadi)
    # ─────────────────────────────────────────────────────────────
    def _get_api_key(self):
        return self.env['ir.config_parameter'].get_param(ICP_KEY)

    def _collect_data(self, kabupaten, periode_hari):
        env = self.env
        now = fields.Datetime.now()
        start = now - timedelta(days=periode_hari)
        prev_start = start - timedelta(days=periode_hari)
        scope = [('kabupaten_id', '=', kabupaten.id)] if kabupaten else []

        Dpt, Voter, Tps = env['smartpolling.dpt'], env['smartpolling.voter'], env['smartpolling.tps']
        Event, Relawan = env['smartpolling.event'], env['smartpolling.relawan']
        pct = lambda a, b: round(a / b * 100, 1) if b else 0.0  # noqa: E731

        # ── Ringkasan DPT ──
        total_dpt = Dpt.search_count(scope)
        per_state = dict(Dpt._read_group(scope, ['state'], ['__count']))
        tersurvey = Dpt.search_count(scope + [('voter_count', '>', 0)])
        pilihan = dict(Dpt._read_group(scope + [('pilihan_terakhir', '!=', False)], ['pilihan_terakhir'], ['__count']))
        pilihan = {p: pilihan.get(p, 0) for p in PILIHAN}

        # ── Aktivitas survey: periode ini vs periode sebelumnya, tren mingguan ──
        survey_now = Voter.search_count(scope + [('tanggal', '>=', start)])
        survey_prev = Voter.search_count(scope + [('tanggal', '>=', prev_start), ('tanggal', '<', start)])
        bucket = 1 if periode_hari <= 7 else 7
        tren = []
        t = start
        while t < now:
            t_end = min(t + timedelta(days=bucket), now)
            tren.append({
                'mulai': t.strftime('%Y-%m-%d'),
                'survey': Voter.search_count(scope + [('tanggal', '>=', t), ('tanggal', '<', t_end)]),
            })
            t = t_end
        dpt_baru = Dpt.search_count(scope + [('create_date', '>=', start)])

        # ── Per wilayah (kabupaten bila seluruh wilayah, kecamatan bila 1 kabupaten dipilih) ──
        wil_field = 'kecamatan_id' if kabupaten else 'kabupaten_id'
        wil_total = Dpt._read_group(scope, [wil_field], ['__count'])
        wil_survey = dict(Dpt._read_group(scope + [('voter_count', '>', 0)], [wil_field], ['__count']))
        wil_pilihan = {}
        for wil, pil, cnt in Dpt._read_group(scope + [('pilihan_terakhir', '!=', False)], [wil_field, 'pilihan_terakhir'], ['__count']):
            wil_pilihan.setdefault(wil.id, {})[pil] = cnt
        wilayah = []
        for wil, cnt in sorted(wil_total, key=lambda x: -x[1])[:MAX_WILAYAH]:
            p = wil_pilihan.get(wil.id, {})
            n_pilihan = sum(p.values())
            wilayah.append({
                'nama': wil.name or '(tanpa wilayah)',
                'dpt': cnt,
                'cakupan_survey_pct': pct(wil_survey.get(wil, 0), cnt),
                'memilih_pct': pct(p.get('memilih', 0), n_pilihan),
                'swing_pct': pct(p.get('ragu_ragu', 0) + p.get('belum_menentukan', 0), n_pilihan),
                'tidak_memilih_pct': pct(p.get('tidak_memilih', 0), n_pilihan),
                'dpt_dengan_pilihan': n_pilihan,
            })

        # ── TPS ──
        tps_scope = scope + [('state', '=', 'aktif')]
        tps_list = Tps.search(tps_scope)
        tps_target = [t for t in tps_list if t.total_target]
        tps_rendah = sorted(tps_target, key=lambda t: t.total_dpt / t.total_target)[:5]
        tps = {
            'aktif': len(tps_list),
            'tanpa_koordinator': len(tps_list.filtered(lambda t: not t.relawan_id)),
            'total_target_dpt': sum(tps_list.mapped('total_target')),
            'total_dpt_terdata': sum(tps_list.mapped('total_dpt')),
            'capaian_pct': pct(sum(tps_list.mapped('total_dpt')), sum(tps_list.mapped('total_target'))),
            'tps_capaian_di_bawah_50pct': sum(1 for t in tps_target if t.total_dpt / t.total_target < 0.5),
            'lima_tps_capaian_terendah': [{
                'tps': f'{t.code} {t.name}', 'desa': t.desa_id.name, 'dpt': t.total_dpt, 'target': t.total_target,
                'capaian_pct': pct(t.total_dpt, t.total_target),
            } for t in tps_rendah],
        }

        # ── Relawan (anonim: hanya distribusi, tanpa nama) ──
        relawan_aktif = Relawan.search([('state', '=', 'aktif')])
        if kabupaten:
            relawan_aktif = relawan_aktif.filtered(lambda r: any(t.kabupaten_id == kabupaten for t in r.tps_ids))
        survey_per_relawan = dict(Voter._read_group(
            scope + [('tanggal', '>=', start), ('petugas_id', 'in', relawan_aktif.ids)], ['petugas_id'], ['__count']))
        counts = sorted((survey_per_relawan.get(r, 0) for r in relawan_aktif), reverse=True)
        relawan = {
            'aktif': len(relawan_aktif),
            'tanpa_survey_di_periode': sum(1 for c in counts if c == 0),
            'survey_per_relawan_median': counts[len(counts) // 2] if counts else 0,
            'survey_relawan_teratas': counts[0] if counts else 0,
            'porsi_survey_dari_20pct_relawan_teratas': pct(
                sum(counts[:max(1, len(counts) // 5)]), sum(counts)) if counts else 0.0,
        }

        # ── Event, Agenda & Berita: sumber data yang sama dengan grafik dashboard ──
        Dash = env['smartpolling.dashboard']
        kab_id = kabupaten.id if kabupaten else None
        ev = Dash.get_event_data(kab_id)
        event = {
            'ringkasan': ev['kpi'],
            'per_event_didanai': [{k: v for k, v in e.items() if k not in ('id', 'code')} for e in ev['per_event']],
        }
        info = Dash.get_info_data(kab_id, hari_dampak=max(periode_hari, 30))
        agenda_berita = {
            'per_bulan': info['bulanan'],
            'agenda_mendatang': [{'nama': a['nama'], 'lokasi': a['lokasi'], 'mulai_utc': a['mulai']}
                                 for a in info['agenda_mendatang']],
            'judul_berita_terbaru': [b['judul'] for b in info['berita_terbaru']],
        }

        return {
            'dibuat': fields.Datetime.to_string(now) + ' UTC',
            'cakupan': kabupaten.name if kabupaten else 'Seluruh wilayah',
            'periode_hari': periode_hari,
            'dpt': {
                'total': total_dpt,
                'per_status': {s: per_state.get(s, 0) for s in ('baru', 'terverifikasi', 'ditolak')},
                'tersurvey': tersurvey,
                'cakupan_survey_pct': pct(tersurvey, total_dpt),
                'dpt_baru_di_periode': dpt_baru,
                'pilihan_terakhir': pilihan,
                'pilihan_terakhir_pct': {p: pct(v, sum(pilihan.values())) for p, v in pilihan.items()},
            },
            'aktivitas_survey': {
                'survey_periode_ini': survey_now,
                'survey_periode_sebelumnya': survey_prev,
                'perubahan_pct': pct(survey_now - survey_prev, survey_prev) if survey_prev else None,
                'satuan_tren': 'harian' if bucket == 1 else 'mingguan',
                'tren': tren,
            },
            'label_wilayah': 'kecamatan' if kabupaten else 'kabupaten/kota',
            'wilayah': wilayah,
            'tps': tps,
            'relawan': relawan,
            'event': event,
            'agenda_berita': agenda_berita,
            'dampak_kegiatan_terhadap_survey': info['dampak'],
        }

    # ─────────────────────────────────────────────────────────────
    # Gemini
    # ─────────────────────────────────────────────────────────────
    def _call_gemini(self, api_key, data):
        prompt = INSTRUKSI + '\n\nDATA (JSON):\n' + json.dumps(data, ensure_ascii=False)
        payload = {
            'contents': [{'parts': [{'text': prompt}]}],
            'generationConfig': {
                'responseMimeType': 'application/json',
                'responseSchema': RESPONSE_SCHEMA,
                'temperature': 0.3,
            },
        }
        try:
            # API key lewat header (bukan query string) supaya tidak ikut tercatat di URL/log
            resp = requests.post(GEMINI_ENDPOINT, json=payload, timeout=90,
                                 headers={'x-goog-api-key': api_key})
            resp.raise_for_status()
            body = resp.json()
        except requests.exceptions.RequestException as e:
            status = getattr(getattr(e, 'response', None), 'status_code', None)
            resp_obj = getattr(e, 'response', None)
            detail = resp_obj.text[:300] if resp_obj is not None else str(e)
            detail = detail.replace(api_key, '***')
            _logger.warning('SmartPolling AI: Gemini request gagal (status=%s): %s', status, detail)
            raise _GeminiError(f'HTTP {status}: {detail}' if status else detail)
        except ValueError as e:
            raise _GeminiError(f'Respons Gemini bukan JSON valid ({e})')
        try:
            text = body['candidates'][0]['content']['parts'][0]['text']
            hasil = json.loads(text)
            if not isinstance(hasil, dict):
                raise ValueError('bukan objek')
        except (KeyError, IndexError, TypeError, ValueError) as e:
            block = (body.get('promptFeedback') or {}).get('blockReason') if isinstance(body, dict) else None
            _logger.warning('SmartPolling AI: format respons tidak sesuai: %s | block=%s', e, block)
            raise _GeminiError(f'Respons diblokir Gemini (alasan: {block})' if block
                               else f'Format respons AI tidak sesuai ({e})')
        return hasil


class _GeminiError(Exception):
    pass
