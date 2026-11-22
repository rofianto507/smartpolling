import html as htmllib
import json
import logging
import re
from datetime import datetime, timedelta

from odoo import fields, http
from odoo.exceptions import UserError, ValidationError
from odoo.fields import Command
from odoo.http import request

_logger = logging.getLogger(__name__)

_WIB_OFFSET = timedelta(hours=7)

PILIHAN_VALUES = {'memilih', 'ragu_ragu', 'belum_menentukan', 'tidak_memilih'}
JENIS_KELAMIN_VALUES = {'L', 'P'}
STATE_VALUES = {'baru', 'terverifikasi', 'ditolak'}


def _is_valid_image(b64):
    """Cek magic bytes JPEG/PNG/WebP dari string base64 (tanpa prefix data URL)."""
    try:
        import base64
        raw = base64.b64decode(b64[:64], validate=False)
    except Exception:
        return False
    if raw.startswith(b'\xff\xd8\xff'):
        return True
    if raw.startswith(b'\x89PNG'):
        return True
    if raw[:4] == b'RIFF' and raw[8:12] == b'WEBP':
        return True
    return False


class SmartPollingMobileController(http.Controller):

    # ─────────────────────────────────────────────────────────────
    # HELPERS
    # ─────────────────────────────────────────────────────────────
    def _auth_check(self):
        user = request.env.user
        if user._is_public():
            return None
        if not user.relawan_id:
            return None
        return user

    def _dpt_domain(self, user):
        rid = user.relawan_id.id
        return ['|', ('petugas_id', '=', rid), ('tps_id.relawan_id', '=', rid)]

    def _voter_domain(self, user):
        rid = user.relawan_id.id
        return ['|', ('dpt_id.petugas_id', '=', rid), ('dpt_id.tps_id.relawan_id', '=', rid)]

    def _dpt_allowed(self, user, dpt_id):
        Dpt = request.env['smartpolling.dpt'].sudo()
        domain = ['&', ('id', '=', int(dpt_id))] + self._dpt_domain(user)
        return Dpt.search(domain, limit=1)

    # ─────────────────────────────────────────────────────────────
    # PAGE ROUTES
    # ─────────────────────────────────────────────────────────────
    @http.route('/mobile', type='http', auth='public', csrf=False, website=False)
    def sm_index(self, **kwargs):
        if self._auth_check():
            return request.redirect('/mobile/app')
        return request.redirect('/mobile/login')

    @http.route('/mobile/login', type='http', auth='public', csrf=False, website=False, methods=['GET'])
    def sm_login_get(self, error=None, redirect=None, **kwargs):
        if self._auth_check():
            return request.redirect(redirect or '/mobile/app')
        return request.render('smartpolling.template_relawan_login', {
            'error': error,
            'redirect': redirect or '/mobile/app',
        })

    @http.route('/mobile/login', type='http', auth='public', csrf=False, website=False, methods=['POST'])
    def sm_login_post(self, login='', password='', redirect=None, **kwargs):
        try:
            credential = {'type': 'password', 'login': (login or '').strip(), 'password': password}
            request.session.authenticate(request.env, credential)
            uid = request.session.uid
            _logger.info('SmartPolling mobile login: user="%s" uid=%s', login, uid)
            if uid:
                user = request.env['res.users'].sudo().browse(uid)
                if not user.relawan_id:
                    request.session.logout(keep_db=True)
                    return request.redirect('/mobile/login?error=unauthorized')
                return request.redirect(redirect or '/mobile/app')
        except Exception as e:
            _logger.warning('SmartPolling mobile login gagal untuk "%s": %s', login, e)
        return request.redirect('/mobile/login?error=invalid')

    @http.route('/mobile/logout', type='http', auth='public', csrf=False, website=False)
    def sm_logout(self, **kwargs):
        request.session.logout(keep_db=True)
        return request.redirect('/mobile/login')

    @http.route('/mobile/app', type='http', auth='public', csrf=False, website=False)
    def sm_app(self, **kwargs):
        user = self._auth_check()
        if not user:
            return request.redirect('/mobile/login?redirect=/mobile/app')
        relawan = user.relawan_id
        init_data = {
            'user_id': user.id,
            'relawan_id': relawan.id,
            'relawan_name': relawan.name,
            'relawan_hp': relawan.hp or '',
            'relawan_has_foto': bool(relawan.foto),
        }
        return request.render('smartpolling.template_relawan_app', {
            'init_data': json.dumps(init_data),
        })

    # ─────────────────────────────────────────────────────────────
    # API: KPI + AKTIVITAS TERBARU (Beranda)
    # ─────────────────────────────────────────────────────────────
    @http.route('/mobile/api/kpi', type='jsonrpc', auth='public', csrf=False)
    def api_kpi(self, **kwargs):
        user = self._auth_check()
        if not user:
            return {'error': 'unauthorized'}

        Dpt = request.env['smartpolling.dpt'].sudo()
        Voter = request.env['smartpolling.voter'].sudo()
        Tps = request.env['smartpolling.tps'].sudo()
        dpt_domain = self._dpt_domain(user)

        total_dpt = Dpt.search_count(dpt_domain)
        total_terverifikasi = Dpt.search_count(['&', ('state', '=', 'terverifikasi')] + dpt_domain)
        total_belum_survey = Dpt.search_count(['&', ('voter_count', '=', 0)] + dpt_domain)
        total_tps = Tps.search_count([('relawan_id', '=', user.relawan_id.id)])

        recent = Voter.search_read(
            self._voter_domain(user), ['tanggal', 'dpt_id', 'pilihan'],
            order='tanggal desc', limit=5)
        recent_list = [{
            'id': r['id'],
            'tanggal': r['tanggal'],
            'dpt_id': r['dpt_id'][0] if r['dpt_id'] else None,
            'dpt_name': r['dpt_id'][1] if r['dpt_id'] else '-',
            'pilihan': r['pilihan'],
        } for r in recent]

        Event = request.env['smartpolling.event'].sudo()
        event_perlu_laporan = Event.search_count([
            ('pic_id', '=', user.relawan_id.id), ('state', '=', 'disetujui'),
            ('tanggal_selesai', '<', datetime.utcnow()),
        ])

        return {
            'total_dpt': total_dpt,
            'total_terverifikasi': total_terverifikasi,
            'total_belum_survey': total_belum_survey,
            'total_tps': total_tps,
            'recent': recent_list,
            'event_perlu_laporan': event_perlu_laporan,
        }

    @http.route('/mobile/api/weekly', type='jsonrpc', auth='public', csrf=False)
    def api_weekly(self, **kwargs):
        user = self._auth_check()
        if not user:
            return {'error': 'unauthorized'}
        Voter = request.env['smartpolling.voter'].sudo()
        voter_domain = self._voter_domain(user)

        now_wib = datetime.utcnow() + _WIB_OFFSET
        today_wib = now_wib.date()
        day_names = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
        days = []
        for i in range(6, -1, -1):
            d = today_wib - timedelta(days=i)
            wib_s = datetime(d.year, d.month, d.day, 0, 0, 0)
            wib_e = datetime(d.year, d.month, d.day, 23, 59, 59)
            utc_s = (wib_s - _WIB_OFFSET).strftime('%Y-%m-%d %H:%M:%S')
            utc_e = (wib_e - _WIB_OFFSET).strftime('%Y-%m-%d %H:%M:%S')
            dom = ['&', ('tanggal', '>=', utc_s), ('tanggal', '<=', utc_e)] + voter_domain
            count = Voter.search_count(dom)
            days.append({'label': day_names[d.weekday()], 'date': str(d), 'count': count})
        return {'days': days}

    # ─────────────────────────────────────────────────────────────
    # API: DPT
    # ─────────────────────────────────────────────────────────────
    @http.route('/mobile/api/dpt/list', type='jsonrpc', auth='public', csrf=False)
    def api_dpt_list(self, offset=0, limit=20, search=None, state=None, belum_survey=False, **kwargs):
        user = self._auth_check()
        if not user:
            return {'error': 'unauthorized'}

        domain = self._dpt_domain(user)
        if search:
            domain = ['&'] + domain + ['|', ('nama', 'ilike', search), ('nik', 'ilike', search)]
        if state and state in STATE_VALUES:
            domain = ['&'] + domain + [('state', '=', state)]
        if belum_survey:
            domain = ['&'] + domain + [('voter_count', '=', 0)]

        Dpt = request.env['smartpolling.dpt'].sudo()
        total = Dpt.search_count(domain)
        records = Dpt.search_read(
            domain, ['nama', 'nik', 'jenis_kelamin', 'state', 'tps_id', 'voter_count'],
            order='nama asc', offset=int(offset or 0), limit=int(limit or 20))

        return {
            'total': total,
            'records': [{
                'id': r['id'],
                'nama': r['nama'],
                'nik': r['nik'],
                'jenis_kelamin': r['jenis_kelamin'],
                'state': r['state'],
                'tps_name': r['tps_id'][1] if r['tps_id'] else '-',
                'voter_count': r['voter_count'],
            } for r in records],
        }

    @http.route('/mobile/api/dpt/record', type='jsonrpc', auth='public', csrf=False)
    def api_dpt_record(self, dpt_id=None, **kwargs):
        user = self._auth_check()
        if not user:
            return {'error': 'unauthorized'}
        rec = self._dpt_allowed(user, dpt_id)
        if not rec:
            return {'error': 'not_found'}

        voters = request.env['smartpolling.voter'].sudo().search_read(
            [('dpt_id', '=', rec.id)], ['tanggal', 'pilihan'], order='tanggal desc', limit=20)

        return {
            'id': rec.id,
            'nama': rec.nama,
            'nik': rec.nik,
            'hp': rec.hp or '',
            'alamat': rec.alamat or '',
            'jenis_kelamin': rec.jenis_kelamin,
            'agama': rec.agama or '',
            'pekerjaan': rec.pekerjaan or '',
            'tempat_lahir': rec.tempat_lahir or '',
            'tanggal_lahir': rec.tanggal_lahir and str(rec.tanggal_lahir) or '',
            'state': rec.state,
            'tps_name': rec.tps_id.name if rec.tps_id else '-',
            'kecamatan_name': rec.kecamatan_id.name if rec.kecamatan_id else '-',
            'kabupaten_name': rec.kabupaten_id.name if rec.kabupaten_id else '-',
            'latitude': rec.latitude,
            'longitude': rec.longitude,
            'pilihan_terakhir': rec.pilihan_terakhir or '',
            'voter_count': rec.voter_count,
            'voters': [{'tanggal': v['tanggal'], 'pilihan': v['pilihan']} for v in voters],
        }

    @http.route('/mobile/api/dpt/tps_options', type='jsonrpc', auth='public', csrf=False)
    def api_dpt_tps_options(self, **kwargs):
        user = self._auth_check()
        if not user:
            return {'error': 'unauthorized'}
        tps_list = request.env['smartpolling.tps'].sudo().search_read(
            [('relawan_id', '=', user.relawan_id.id), ('state', '=', 'aktif')],
            ['name', 'code'], order='name asc')
        return {'records': [{'id': t['id'], 'name': f"{t['name']} ({t['code']})"} for t in tps_list]}

    def _validate_dpt_data(self, data):
        if not isinstance(data, dict):
            return 'Data tidak valid.'
        nama = (data.get('nama') or '').strip()
        nik = (data.get('nik') or '').strip()
        jk = data.get('jenis_kelamin')
        tps_id = data.get('tps_id')
        if not nama or len(nama) > 200:
            return 'Nama wajib diisi (maks 200 karakter).'
        if not nik or not nik.isdigit() or len(nik) != 16:
            return 'NIK wajib 16 digit angka.'
        if jk not in JENIS_KELAMIN_VALUES:
            return 'Jenis kelamin wajib dipilih.'
        if not tps_id:
            return 'TPS wajib dipilih.'
        return None

    @http.route('/mobile/api/dpt/create', type='jsonrpc', auth='public', csrf=False)
    def api_dpt_create(self, data=None, **kwargs):
        user = self._auth_check()
        if not user:
            return {'error': 'unauthorized'}
        err = self._validate_dpt_data(data or {})
        if err:
            return {'error': err}

        Tps = request.env['smartpolling.tps'].sudo()
        tps = Tps.search([
            ('id', '=', int(data['tps_id'])),
            ('relawan_id', '=', user.relawan_id.id),
        ], limit=1)
        if not tps:
            return {'error': 'TPS tidak valid atau bukan cakupan Anda.'}

        lat = data.get('latitude') or 0
        lng = data.get('longitude') or 0
        try:
            lat, lng = float(lat), float(lng)
            if not (-90 <= lat <= 90 and -180 <= lng <= 180):
                lat, lng = 0, 0
        except (TypeError, ValueError):
            lat, lng = 0, 0

        vals = {
            'nama': data['nama'].strip()[:200],
            'nik': data['nik'].strip(),
            'jenis_kelamin': data['jenis_kelamin'],
            'tps_id': tps.id,
            'petugas_id': user.relawan_id.id,
            'alamat': (data.get('alamat') or '').strip()[:2000],
            'hp': (data.get('hp') or '').strip()[:50],
            'agama': data.get('agama') or False,
            'pekerjaan': (data.get('pekerjaan') or '').strip()[:200],
            'tempat_lahir': (data.get('tempat_lahir') or '').strip()[:200],
            'tanggal_lahir': data.get('tanggal_lahir') or False,
            'latitude': lat,
            'longitude': lng,
        }
        try:
            rec = request.env['smartpolling.dpt'].sudo().create(vals)
        except Exception as e:
            msg = str(e)
            if 'nik_unique' in msg or 'smartpolling_dpt_nik' in msg:
                return {'error': 'NIK ini sudah terdaftar di DPT.'}
            _logger.exception('Gagal membuat DPT dari mobile app')
            return {'error': 'Gagal menyimpan data, silakan coba lagi.'}

        return {'success': True, 'id': rec.id}

    @http.route('/mobile/api/dpt/set_state', type='jsonrpc', auth='public', csrf=False)
    def api_dpt_set_state(self, dpt_id=None, state=None, **kwargs):
        user = self._auth_check()
        if not user:
            return {'error': 'unauthorized'}
        if not user.has_group('smartpolling.group_admin'):
            return {'error': 'Hanya administrator yang dapat mengubah status verifikasi DPT.'}
        if state not in STATE_VALUES:
            return {'error': 'Status tidak valid.'}
        rec = self._dpt_allowed(user, dpt_id)
        if not rec:
            return {'error': 'not_found'}
        rec.write({'state': state})
        return {'success': True}

    # ─────────────────────────────────────────────────────────────
    # API: SURVEY (Voter)
    # ─────────────────────────────────────────────────────────────
    @http.route('/mobile/api/survey/list', type='jsonrpc', auth='public', csrf=False)
    def api_survey_list(self, offset=0, limit=20, **kwargs):
        user = self._auth_check()
        if not user:
            return {'error': 'unauthorized'}
        Voter = request.env['smartpolling.voter'].sudo()
        domain = self._voter_domain(user)
        total = Voter.search_count(domain)
        records = Voter.search_read(
            domain, ['tanggal', 'dpt_id', 'nik', 'pilihan'],
            order='tanggal desc', offset=int(offset or 0), limit=int(limit or 20))
        return {
            'total': total,
            'records': [{
                'id': r['id'],
                'tanggal': r['tanggal'],
                'dpt_id': r['dpt_id'][0] if r['dpt_id'] else None,
                'dpt_name': r['dpt_id'][1] if r['dpt_id'] else '-',
                'nik': r['nik'] or '',
                'pilihan': r['pilihan'],
            } for r in records],
        }

    @http.route('/mobile/api/survey/create', type='jsonrpc', auth='public', csrf=False)
    def api_survey_create(self, dpt_id=None, pilihan=None, foto=None, event_id=None, **kwargs):
        user = self._auth_check()
        if not user:
            return {'error': 'unauthorized'}
        if pilihan not in PILIHAN_VALUES:
            return {'error': 'Pilihan wajib dipilih.'}
        rec = self._dpt_allowed(user, dpt_id)
        if not rec:
            return {'error': 'DPT tidak ditemukan atau bukan cakupan Anda.'}

        vals = {'dpt_id': rec.id, 'pilihan': pilihan}
        if event_id:
            event = self._event_active(user).filtered(lambda e: e.id == int(event_id))
            if not event:
                return {'error': 'Event tidak aktif atau bukan milik Anda.'}
            vals['event_id'] = event.id
        if foto:
            if len(foto) > 900_000 or not _is_valid_image(foto):
                return {'error': 'Foto tidak valid atau terlalu besar.'}
            vals['foto'] = foto

        voter = request.env['smartpolling.voter'].sudo().create(vals)
        return {'success': True, 'id': voter.id}

    # ─────────────────────────────────────────────────────────────
    # API: PROFIL
    # ─────────────────────────────────────────────────────────────
    @http.route('/mobile/api/profile/update_photo', type='jsonrpc', auth='public', csrf=False)
    def api_profile_update_photo(self, foto=None, **kwargs):
        user = self._auth_check()
        if not user:
            return {'error': 'unauthorized'}
        if not foto or not _is_valid_image(foto):
            return {'error': 'Foto tidak valid.'}
        user.relawan_id.sudo().write({'foto': foto})
        return {'success': True}

    # ─────────────────────────────────────────────────────────────
    # API: BERITA & AGENDA (hanya yang diterbitkan admin)
    # ─────────────────────────────────────────────────────────────
    _BERITA_DOMAIN = [('state', '=', 'terbit')]
    _AGENDA_DOMAIN = [('state', 'in', ('terbit', 'batal'))]

    def _berita_summary(self, rec):
        teks = (rec.ringkasan or '').strip()
        if not teks and rec.isi:
            # Tag diganti spasi (bukan dibuang) supaya <li>/<p> berurutan tidak menempel
            teks = ' '.join(htmllib.unescape(re.sub(r'<[^>]+>', ' ', rec.isi)).split())
            teks = re.sub(r'\s+([.,:;!?])', r'\1', teks)
            if len(teks) > 160:
                teks = teks[:157].rstrip() + '...'
        return {
            'id': rec.id,
            'judul': rec.name,
            'ringkasan': teks,
            'tanggal': rec.tanggal_terbit and rec.tanggal_terbit.strftime('%Y-%m-%d %H:%M:%S'),
            'is_pinned': rec.is_pinned,
            # bin_size=True → field berisi ukuran (string), bukan isi biner
            'has_gambar': bool(rec.gambar),
        }

    def _agenda_upcoming_domain(self):
        """Agenda dianggap 'akan datang' kalau belum selesai. Agenda tanpa waktu
        selesai dianggap berlangsung sampai akhir hari mulainya (WIB)."""
        now = datetime.utcnow()
        today_wib = (now + _WIB_OFFSET).date()
        today_start_utc = datetime(today_wib.year, today_wib.month, today_wib.day) - _WIB_OFFSET
        return ['|',
                ('tanggal_selesai', '>=', now),
                '&', ('tanggal_selesai', '=', False), ('tanggal_mulai', '>=', today_start_utc)]

    def _agenda_dict(self, rec, with_detail=False):
        data = {
            'id': rec.id,
            'nama': rec.name,
            'mulai': rec.tanggal_mulai.strftime('%Y-%m-%d %H:%M:%S'),
            'selesai': rec.tanggal_selesai and rec.tanggal_selesai.strftime('%Y-%m-%d %H:%M:%S'),
            'lokasi': rec.lokasi or '',
            'state': rec.state,
        }
        if with_detail:
            data['deskripsi'] = rec.deskripsi or ''
        return data

    @http.route('/mobile/api/info/home', type='jsonrpc', auth='public', csrf=False)
    def api_info_home(self, **kwargs):
        """Ringkasan untuk Beranda: 3 berita terbaru + 3 agenda terdekat."""
        if not self._auth_check():
            return {'error': 'unauthorized'}
        Berita = request.env['smartpolling.berita'].sudo().with_context(bin_size=True)
        Agenda = request.env['smartpolling.agenda'].sudo()
        berita = Berita.search(self._BERITA_DOMAIN, limit=3)
        agenda = Agenda.search(
            [('state', '=', 'terbit')] + self._agenda_upcoming_domain(),
            order='tanggal_mulai asc', limit=3)
        return {
            'berita': [self._berita_summary(b) for b in berita],
            'agenda': [self._agenda_dict(a) for a in agenda],
        }

    @http.route('/mobile/api/berita/list', type='jsonrpc', auth='public', csrf=False)
    def api_berita_list(self, offset=0, limit=20, search=None, **kwargs):
        if not self._auth_check():
            return {'error': 'unauthorized'}
        Berita = request.env['smartpolling.berita'].sudo().with_context(bin_size=True)
        domain = list(self._BERITA_DOMAIN)
        if search:
            domain += [('name', 'ilike', search)]
        total = Berita.search_count(domain)
        records = Berita.search(domain, offset=int(offset or 0), limit=min(int(limit or 20), 50))
        return {'total': total, 'records': [self._berita_summary(b) for b in records]}

    @http.route('/mobile/api/berita/record', type='jsonrpc', auth='public', csrf=False)
    def api_berita_record(self, berita_id=None, **kwargs):
        if not self._auth_check():
            return {'error': 'unauthorized'}
        rec = request.env['smartpolling.berita'].sudo().with_context(bin_size=True).search(
            [('id', '=', int(berita_id or 0))] + self._BERITA_DOMAIN, limit=1)
        if not rec:
            return {'error': 'not_found'}
        data = self._berita_summary(rec)
        data.update({'isi': rec.isi or '', 'penulis': rec.penulis_id.name or ''})
        return data

    @http.route('/mobile/api/agenda/list', type='jsonrpc', auth='public', csrf=False)
    def api_agenda_list(self, mode='upcoming', offset=0, limit=20, **kwargs):
        if not self._auth_check():
            return {'error': 'unauthorized'}
        Agenda = request.env['smartpolling.agenda'].sudo()
        upcoming = self._agenda_upcoming_domain()
        if mode == 'past':
            domain = self._AGENDA_DOMAIN + ['!'] + upcoming
            order = 'tanggal_mulai desc'
        else:
            domain = self._AGENDA_DOMAIN + upcoming
            order = 'tanggal_mulai asc'
        total = Agenda.search_count(domain)
        records = Agenda.search(domain, order=order, offset=int(offset or 0), limit=min(int(limit or 20), 50))
        return {'total': total, 'records': [self._agenda_dict(a) for a in records]}

    @http.route('/mobile/api/agenda/record', type='jsonrpc', auth='public', csrf=False)
    def api_agenda_record(self, agenda_id=None, **kwargs):
        if not self._auth_check():
            return {'error': 'unauthorized'}
        rec = request.env['smartpolling.agenda'].sudo().search(
            [('id', '=', int(agenda_id or 0))] + self._AGENDA_DOMAIN, limit=1)
        if not rec:
            return {'error': 'not_found'}
        return self._agenda_dict(rec, with_detail=True)

    # ─────────────────────────────────────────────────────────────
    # API: EVENT (pengajuan → persetujuan admin → berita acara → evaluasi)
    # Semua perubahan lewat sini (sudo) dengan validasi PIC & status;
    # transisi status memakai method model (action_ajukan, action_kirim_laporan).
    # ─────────────────────────────────────────────────────────────
    _EVENT_GROUPS = {
        'proses': ('draft', 'diajukan'),
        'berjalan': ('disetujui',),
        'selesai': ('laporan', 'selesai'),
        'ditolak': ('ditolak',),
    }
    _MAX_LINES = 30

    @staticmethod
    def _dt_str(dt):
        return dt.strftime('%Y-%m-%d %H:%M:%S') if dt else None

    @staticmethod
    def _parse_dt(value):
        try:
            return fields.Datetime.to_datetime(value) if value else None
        except (ValueError, TypeError):
            return None

    @staticmethod
    def _to_float(value):
        try:
            v = float(value or 0)
        except (TypeError, ValueError):
            return None
        return v if v >= 0 else None

    def _event_mine(self, user, event_id, states=None):
        domain = [('id', '=', int(event_id or 0)), ('pic_id', '=', user.relawan_id.id)]
        if states:
            domain.append(('state', 'in', states))
        return request.env['smartpolling.event'].sudo().search(domain, limit=1)

    def _event_active(self, user):
        """Event milik PIC yang sedang berlangsung → boleh dipakai menandai survey.
        Toleransi 1 hari setelah selesai untuk input survey yang terlambat."""
        now = datetime.utcnow()
        return request.env['smartpolling.event'].sudo().search([
            ('pic_id', '=', user.relawan_id.id),
            ('state', '=', 'disetujui'),
            ('tanggal_mulai', '<=', now),
            ('tanggal_selesai', '>=', now - timedelta(days=1)),
        ], order='tanggal_mulai asc')

    def _event_summary(self, rec):
        return {
            'id': rec.id,
            'code': rec.code,
            'nama': rec.name,
            'state': rec.state,
            'mulai': self._dt_str(rec.tanggal_mulai),
            'selesai': self._dt_str(rec.tanggal_selesai),
            'lokasi': rec.lokasi or '',
            'target_dpt': rec.target_dpt,
            'realisasi_dpt': rec.realisasi_dpt,
            'realisasi_memilih': rec.realisasi_memilih,
            'total_anggaran': rec.total_anggaran,
            'dana_disetujui': rec.dana_disetujui,
            'total_realisasi': rec.total_realisasi,
        }

    def _event_detail(self, rec, user):
        now = datetime.utcnow()
        data = self._event_summary(rec)
        data.update({
            'deskripsi': rec.deskripsi or '',
            'catatan_admin': rec.catatan_admin or '',
            'tanggal_diajukan': self._dt_str(rec.tanggal_diajukan),
            'tanggal_disetujui': self._dt_str(rec.tanggal_disetujui),
            'anggaran': [{
                'uraian': a.uraian, 'qty': a.qty, 'satuan': a.satuan or '',
                'harga_satuan': a.harga_satuan, 'subtotal': a.subtotal,
            } for a in rec.anggaran_ids],
            'ba_ringkasan': rec.ba_ringkasan or '',
            'ba_jumlah_peserta': rec.ba_jumlah_peserta,
            'ba_tanggal': self._dt_str(rec.ba_tanggal),
            'has_foto_kegiatan': bool(rec.ba_foto_kegiatan),
            'realisasi': [{
                'id': r.id, 'uraian': r.uraian, 'jumlah': r.jumlah, 'has_bukti': bool(r.bukti),
            } for r in rec.realisasi_ids],
            'selisih_dana': rec.selisih_dana,
            'persen_serapan': round(rec.persen_serapan, 1),
            'persen_target': round(rec.persen_target, 1),
            'persen_memilih': round(rec.persen_memilih, 1),
            'biaya_per_suara': rec.biaya_per_suara,
            'can_edit': rec.state == 'draft',
            'can_lapor': rec.state == 'disetujui' and now >= rec.tanggal_mulai,
            'can_survey': rec in self._event_active(user),
        })
        return data

    @http.route('/mobile/api/event/list', type='jsonrpc', auth='public', csrf=False)
    def api_event_list(self, group=None, offset=0, limit=20, **kwargs):
        user = self._auth_check()
        if not user:
            return {'error': 'unauthorized'}
        Event = request.env['smartpolling.event'].sudo()
        domain = [('pic_id', '=', user.relawan_id.id)]
        if group in self._EVENT_GROUPS:
            domain.append(('state', 'in', self._EVENT_GROUPS[group]))
        total = Event.search_count(domain)
        records = Event.search(domain, offset=int(offset or 0), limit=min(int(limit or 20), 50))
        return {'total': total, 'records': [self._event_summary(e) for e in records]}

    @http.route('/mobile/api/event/record', type='jsonrpc', auth='public', csrf=False)
    def api_event_record(self, event_id=None, **kwargs):
        user = self._auth_check()
        if not user:
            return {'error': 'unauthorized'}
        rec = self._event_mine(user, event_id)
        if not rec:
            return {'error': 'not_found'}
        return self._event_detail(rec.with_context(bin_size=True), user)

    @http.route('/mobile/api/event/active', type='jsonrpc', auth='public', csrf=False)
    def api_event_active(self, **kwargs):
        user = self._auth_check()
        if not user:
            return {'error': 'unauthorized'}
        return {'records': [{'id': e.id, 'nama': e.name} for e in self._event_active(user)]}

    def _validate_event_data(self, data):
        nama = (data.get('nama') or '').strip()
        if not nama:
            return 'Nama event wajib diisi.', None
        mulai, selesai = self._parse_dt(data.get('mulai')), self._parse_dt(data.get('selesai'))
        if not mulai or not selesai:
            return 'Waktu mulai dan selesai wajib diisi.', None
        if selesai < mulai:
            return 'Waktu selesai tidak boleh lebih awal dari waktu mulai.', None
        try:
            target = int(data.get('target_dpt') or 0)
        except (TypeError, ValueError):
            return 'Target DPT harus berupa angka.', None
        if target < 0:
            return 'Target DPT tidak boleh negatif.', None
        lines = data.get('anggaran') or []
        if len(lines) > self._MAX_LINES:
            return f'Rincian anggaran maksimal {self._MAX_LINES} baris.', None
        cmds = [Command.clear()]
        for i, line in enumerate(lines, 1):
            uraian = (line.get('uraian') or '').strip()
            qty, harga = self._to_float(line.get('qty')), self._to_float(line.get('harga_satuan'))
            if not uraian:
                return f'Uraian anggaran baris {i} wajib diisi.', None
            if qty is None or harga is None:
                return f'Jumlah/harga anggaran baris {i} tidak valid.', None
            cmds.append(Command.create({
                'sequence': i, 'uraian': uraian[:200], 'qty': qty,
                'satuan': (line.get('satuan') or '').strip()[:50], 'harga_satuan': harga,
            }))
        return None, {
            'name': nama[:200],
            'tanggal_mulai': mulai,
            'tanggal_selesai': selesai,
            'lokasi': (data.get('lokasi') or '').strip()[:200],
            'deskripsi': (data.get('deskripsi') or '').strip()[:5000],
            'target_dpt': target,
            'anggaran_ids': cmds,
        }

    @http.route('/mobile/api/event/save', type='jsonrpc', auth='public', csrf=False)
    def api_event_save(self, event_id=None, data=None, ajukan=False, **kwargs):
        """Buat/ubah event draft; ajukan=True langsung mengajukan ke admin pusat."""
        user = self._auth_check()
        if not user:
            return {'error': 'unauthorized'}
        err, vals = self._validate_event_data(data or {})
        if err:
            return {'error': err}
        rec = None
        if event_id:
            rec = self._event_mine(user, event_id, states=('draft',))
            if not rec:
                return {'error': 'Event tidak ditemukan atau sudah tidak bisa diubah.'}
        try:
            with request.env.cr.savepoint():
                if rec:
                    rec.write(vals)
                else:
                    rec = request.env['smartpolling.event'].sudo().create(
                        dict(vals, pic_id=user.relawan_id.id))
                if ajukan:
                    rec.action_ajukan()
        except (UserError, ValidationError) as e:
            return {'error': e.args[0]}
        return {'success': True, 'id': rec.id}

    @http.route('/mobile/api/event/ajukan', type='jsonrpc', auth='public', csrf=False)
    def api_event_ajukan(self, event_id=None, **kwargs):
        user = self._auth_check()
        if not user:
            return {'error': 'unauthorized'}
        rec = self._event_mine(user, event_id, states=('draft',))
        if not rec:
            return {'error': 'Event tidak ditemukan atau sudah diajukan.'}
        try:
            with request.env.cr.savepoint():
                rec.action_ajukan()
        except (UserError, ValidationError) as e:
            return {'error': e.args[0]}
        return {'success': True}

    @http.route('/mobile/api/event/delete', type='jsonrpc', auth='public', csrf=False)
    def api_event_delete(self, event_id=None, **kwargs):
        user = self._auth_check()
        if not user:
            return {'error': 'unauthorized'}
        rec = self._event_mine(user, event_id, states=('draft',))
        if not rec:
            return {'error': 'Hanya event berstatus draft yang bisa dihapus.'}
        rec.unlink()
        return {'success': True}

    @http.route('/mobile/api/event/laporan', type='jsonrpc', auth='public', csrf=False)
    def api_event_laporan(self, event_id=None, data=None, **kwargs):
        """Kirim berita acara: ringkasan, peserta, foto kegiatan, rincian penggunaan dana.
        Baris realisasi dengan 'id' = baris lama (bukti lama dipertahankan kalau tidak diganti)."""
        user = self._auth_check()
        if not user:
            return {'error': 'unauthorized'}
        rec = self._event_mine(user, event_id, states=('disetujui',))
        if not rec:
            return {'error': 'Event tidak ditemukan atau belum/tidak lagi bisa dilaporkan.'}
        data = data or {}
        lines = data.get('realisasi') or []
        if not lines:
            return {'error': 'Rincian penggunaan dana minimal 1 baris.'}
        if len(lines) > self._MAX_LINES:
            return {'error': f'Rincian penggunaan dana maksimal {self._MAX_LINES} baris.'}
        try:
            peserta = int(data.get('jumlah_peserta') or 0)
        except (TypeError, ValueError):
            return {'error': 'Jumlah peserta harus berupa angka.'}
        if peserta < 0:
            return {'error': 'Jumlah peserta tidak boleh negatif.'}

        def _img_ok(b64):
            return bool(b64) and len(b64) <= 900_000 and _is_valid_image(b64)

        existing = set(rec.realisasi_ids.ids)
        cmds, keep = [], set()
        for i, line in enumerate(lines, 1):
            uraian = (line.get('uraian') or '').strip()
            jumlah = self._to_float(line.get('jumlah'))
            if not uraian:
                return {'error': f'Uraian penggunaan dana baris {i} wajib diisi.'}
            if jumlah is None:
                return {'error': f'Jumlah dana baris {i} tidak valid.'}
            line_vals = {'sequence': i, 'uraian': uraian[:200], 'jumlah': jumlah}
            if line.get('bukti'):
                if not _img_ok(line['bukti']):
                    return {'error': f'Foto bukti baris {i} tidak valid atau terlalu besar.'}
                line_vals['bukti'] = line['bukti']
            line_id = int(line.get('id') or 0)
            if line_id in existing:
                keep.add(line_id)
                cmds.append(Command.update(line_id, line_vals))
            else:
                cmds.append(Command.create(line_vals))
        cmds += [Command.delete(lid) for lid in existing - keep]

        vals = {
            'ba_ringkasan': (data.get('ringkasan') or '').strip()[:5000],
            'ba_jumlah_peserta': peserta,
            'realisasi_ids': cmds,
        }
        if data.get('foto_kegiatan'):
            if not _img_ok(data['foto_kegiatan']):
                return {'error': 'Foto kegiatan tidak valid atau terlalu besar.'}
            vals['ba_foto_kegiatan'] = data['foto_kegiatan']
        try:
            with request.env.cr.savepoint():
                rec.write(vals)
                rec.action_kirim_laporan()
        except (UserError, ValidationError) as e:
            return {'error': e.args[0]}
        return {'success': True}
