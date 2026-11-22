from odoo import models, fields, api, _
from odoo.exceptions import AccessError, UserError, ValidationError


class Event(models.Model):
    """Event penggalangan massa/suara yang diajukan petugas (PIC), disetujui admin
    pusat untuk pendanaan, lalu ditutup dengan berita acara penggunaan dana.

    Alur status:
        draft → diajukan → disetujui → laporan → selesai
                        ↘ ditolak
        diajukan → draft   (admin minta revisi)
        laporan  → disetujui (admin kembalikan berita acara)
    """
    _name = 'smartpolling.event'
    _description = 'Event Penggalangan Suara'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'tanggal_mulai desc, id desc'

    # ── Pengajuan ────────────────────────────────────────────────────
    code = fields.Char('Kode', readonly=True, copy=False, default='New')
    name = fields.Char('Nama Event', required=True, tracking=True)
    pic_id = fields.Many2one(
        'smartpolling.relawan', string='PIC', required=True, tracking=True, index=True,
        default=lambda self: self.env.user.relawan_id,
    )
    tanggal_mulai = fields.Datetime('Mulai', required=True, tracking=True)
    tanggal_selesai = fields.Datetime('Selesai', required=True, tracking=True)
    lokasi = fields.Char('Lokasi', tracking=True)
    deskripsi = fields.Text('Deskripsi & Tujuan')
    target_dpt = fields.Integer(
        'Target DPT Tersurvey', tracking=True,
        help='Jumlah DPT yang ditargetkan mengisi survey selama event.',
    )

    currency_id = fields.Many2one(
        'res.currency', default=lambda self: self.env.company.currency_id, required=True,
    )
    anggaran_ids = fields.One2many('smartpolling.event.anggaran', 'event_id', string='Rincian Anggaran', copy=True)
    total_anggaran = fields.Monetary('Total Anggaran Diajukan', compute='_compute_total_anggaran', store=True)

    state = fields.Selection([
        ('draft', 'Draft'),
        ('diajukan', 'Diajukan'),
        ('disetujui', 'Disetujui'),
        ('ditolak', 'Ditolak'),
        ('laporan', 'Laporan Masuk'),
        ('selesai', 'Selesai'),
    ], string='Status', required=True, default='draft', tracking=True, copy=False, index=True)
    tanggal_diajukan = fields.Datetime('Tanggal Diajukan', readonly=True, copy=False)

    # ── Keputusan admin ──────────────────────────────────────────────
    dana_disetujui = fields.Monetary('Dana Disetujui', tracking=True, copy=False)
    catatan_admin = fields.Text(
        'Catatan Admin', tracking=True, copy=False,
        help='Wajib diisi saat menolak, minta revisi, atau mengembalikan berita acara. Tampil di app petugas.',
    )
    disetujui_oleh = fields.Many2one('res.users', 'Disetujui Oleh', readonly=True, copy=False)
    tanggal_disetujui = fields.Datetime('Tanggal Disetujui', readonly=True, copy=False)

    # ── Berita acara ─────────────────────────────────────────────────
    ba_ringkasan = fields.Text('Ringkasan Pelaksanaan', copy=False)
    ba_jumlah_peserta = fields.Integer('Jumlah Peserta Hadir', copy=False)
    ba_foto_kegiatan = fields.Image('Foto Kegiatan', max_width=1600, max_height=1600, copy=False)
    ba_tanggal = fields.Datetime('Tanggal Laporan', readonly=True, copy=False)
    realisasi_ids = fields.One2many('smartpolling.event.realisasi', 'event_id', string='Rincian Penggunaan Dana', copy=False)
    total_realisasi = fields.Monetary('Total Realisasi Dana', compute='_compute_total_realisasi', store=True)

    # ── Evaluasi ─────────────────────────────────────────────────────
    selisih_dana = fields.Monetary(
        'Sisa / (Lebih) Dana', compute='_compute_evaluasi', store=True,
        help='Dana disetujui dikurangi realisasi. Negatif berarti pengeluaran melebihi dana.',
    )
    persen_serapan = fields.Float('Serapan Dana (%)', compute='_compute_evaluasi', store=True, aggregator='avg')
    voter_ids = fields.One2many('smartpolling.voter', 'event_id', string='Survey Event')
    realisasi_dpt = fields.Integer('Realisasi DPT Tersurvey', compute='_compute_realisasi_survey', store=True)
    realisasi_memilih = fields.Integer('Realisasi Suara (Memilih)', compute='_compute_realisasi_survey', store=True)
    persen_target = fields.Float('Capaian Target (%)', compute='_compute_evaluasi', store=True, aggregator='avg')
    persen_memilih = fields.Float(
        'Suara Memilih (%)', compute='_compute_evaluasi', store=True, aggregator='avg',
        help='Persentase DPT tersurvey di event ini yang menyatakan Memilih.',
    )
    biaya_per_suara = fields.Monetary(
        'Biaya per Suara', compute='_compute_evaluasi', store=True,
        help='Realisasi dana dibagi jumlah suara Memilih.',
    )
    active = fields.Boolean(default=True)

    # ── Compute ──────────────────────────────────────────────────────
    @api.depends('anggaran_ids.subtotal')
    def _compute_total_anggaran(self):
        for rec in self:
            rec.total_anggaran = sum(rec.anggaran_ids.mapped('subtotal'))

    @api.depends('realisasi_ids.jumlah')
    def _compute_total_realisasi(self):
        for rec in self:
            rec.total_realisasi = sum(rec.realisasi_ids.mapped('jumlah'))

    @api.depends('voter_ids', 'voter_ids.dpt_id', 'voter_ids.pilihan', 'voter_ids.tanggal')
    def _compute_realisasi_survey(self):
        for rec in self:
            # Pilihan yang dihitung = survey TERAKHIR per DPT di event ini
            latest = {}
            for v in rec.voter_ids.sorted('tanggal'):
                latest[v.dpt_id.id] = v.pilihan
            rec.realisasi_dpt = len(latest)
            rec.realisasi_memilih = sum(1 for p in latest.values() if p == 'memilih')

    @api.depends('dana_disetujui', 'total_realisasi', 'target_dpt', 'realisasi_dpt', 'realisasi_memilih')
    def _compute_evaluasi(self):
        for rec in self:
            rec.selisih_dana = rec.dana_disetujui - rec.total_realisasi
            rec.persen_serapan = (rec.total_realisasi / rec.dana_disetujui * 100) if rec.dana_disetujui else 0.0
            rec.persen_target = (rec.realisasi_dpt / rec.target_dpt * 100) if rec.target_dpt else 0.0
            rec.persen_memilih = (rec.realisasi_memilih / rec.realisasi_dpt * 100) if rec.realisasi_dpt else 0.0
            rec.biaya_per_suara = (rec.total_realisasi / rec.realisasi_memilih) if rec.realisasi_memilih else 0.0

    # ── Constraint & ORM ─────────────────────────────────────────────
    @api.constrains('tanggal_mulai', 'tanggal_selesai')
    def _check_tanggal(self):
        for rec in self:
            if rec.tanggal_selesai < rec.tanggal_mulai:
                raise ValidationError(_('Waktu selesai event tidak boleh lebih awal dari waktu mulai.'))

    @api.constrains('target_dpt', 'dana_disetujui')
    def _check_angka(self):
        for rec in self:
            if rec.target_dpt < 0 or rec.dana_disetujui < 0:
                raise ValidationError(_('Target DPT dan dana disetujui tidak boleh negatif.'))

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('code', 'New') == 'New':
                vals['code'] = self.env['ir.sequence'].next_by_code('smartpolling.event.sequence') or 'New'
        return super().create(vals_list)

    # ── Helper ───────────────────────────────────────────────────────
    def _check_admin(self):
        if not (self.env.su or self.env.user.has_group('smartpolling.group_admin')):
            raise AccessError(_('Hanya administrator pusat yang dapat melakukan aksi ini.'))

    def _check_state(self, *allowed):
        for rec in self:
            if rec.state not in allowed:
                label = dict(self._fields['state'].selection).get(rec.state)
                raise UserError(_('Aksi tidak dapat dilakukan pada event "%(name)s" berstatus %(state)s.',
                                  name=rec.name, state=label))

    def _require_catatan(self):
        for rec in self:
            if not (rec.catatan_admin or '').strip():
                raise UserError(_('Isi "Catatan Admin" terlebih dahulu sebagai alasan untuk petugas.'))

    # ── Aksi petugas (PIC) ───────────────────────────────────────────
    def action_ajukan(self):
        self._check_state('draft')
        for rec in self:
            if rec.target_dpt <= 0:
                raise UserError(_('Target DPT tersurvey wajib diisi (lebih dari 0).'))
            if not rec.anggaran_ids:
                raise UserError(_('Rincian anggaran minimal 1 baris.'))
            if rec.total_anggaran <= 0:
                raise UserError(_('Total anggaran harus lebih dari 0.'))
        self.write({'state': 'diajukan', 'tanggal_diajukan': fields.Datetime.now()})

    def action_kirim_laporan(self):
        self._check_state('disetujui')
        for rec in self:
            if fields.Datetime.now() < rec.tanggal_mulai:
                raise UserError(_('Berita acara baru bisa dikirim setelah event dimulai.'))
            if not (rec.ba_ringkasan or '').strip():
                raise UserError(_('Ringkasan pelaksanaan wajib diisi.'))
            if not rec.realisasi_ids:
                raise UserError(_('Rincian penggunaan dana minimal 1 baris.'))
        self.write({'state': 'laporan', 'ba_tanggal': fields.Datetime.now()})

    # ── Aksi admin pusat ─────────────────────────────────────────────
    def action_setujui(self):
        self._check_admin()
        self._check_state('diajukan')
        for rec in self:
            rec.write({
                'state': 'disetujui',
                'dana_disetujui': rec.dana_disetujui or rec.total_anggaran,
                'disetujui_oleh': self.env.user.id,
                'tanggal_disetujui': fields.Datetime.now(),
            })

    def action_tolak(self):
        self._check_admin()
        self._check_state('diajukan')
        self._require_catatan()
        self.write({'state': 'ditolak'})

    def action_minta_revisi(self):
        self._check_admin()
        self._check_state('diajukan')
        self._require_catatan()
        self.write({'state': 'draft'})

    def action_kembalikan_laporan(self):
        self._check_admin()
        self._check_state('laporan')
        self._require_catatan()
        self.write({'state': 'disetujui'})

    def action_selesai(self):
        self._check_admin()
        self._check_state('laporan')
        self.write({'state': 'selesai'})

    def action_view_survey(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Survey — %s', self.name),
            'res_model': 'smartpolling.voter',
            'view_mode': 'list,form',
            'domain': [('event_id', '=', self.id)],
        }


class EventAnggaran(models.Model):
    _name = 'smartpolling.event.anggaran'
    _description = 'Rincian Anggaran Event'
    _order = 'event_id, sequence, id'

    event_id = fields.Many2one('smartpolling.event', required=True, ondelete='cascade', index=True)
    sequence = fields.Integer(default=10)
    uraian = fields.Char('Uraian', required=True)
    qty = fields.Float('Jumlah', default=1.0, digits=(12, 2))
    satuan = fields.Char('Satuan', help='mis. orang, paket, unit, hari')
    harga_satuan = fields.Monetary('Harga Satuan')
    subtotal = fields.Monetary('Subtotal', compute='_compute_subtotal', store=True)
    currency_id = fields.Many2one(related='event_id.currency_id')

    @api.depends('qty', 'harga_satuan')
    def _compute_subtotal(self):
        for rec in self:
            rec.subtotal = rec.qty * rec.harga_satuan

    @api.constrains('qty', 'harga_satuan')
    def _check_positif(self):
        for rec in self:
            if rec.qty < 0 or rec.harga_satuan < 0:
                raise ValidationError(_('Jumlah dan harga satuan anggaran tidak boleh negatif.'))


class EventRealisasi(models.Model):
    _name = 'smartpolling.event.realisasi'
    _description = 'Rincian Penggunaan Dana Event'
    _order = 'event_id, sequence, id'

    event_id = fields.Many2one('smartpolling.event', required=True, ondelete='cascade', index=True)
    sequence = fields.Integer(default=10)
    uraian = fields.Char('Uraian', required=True)
    jumlah = fields.Monetary('Jumlah Dana')
    bukti = fields.Image('Bukti / Nota', max_width=1600, max_height=1600)
    currency_id = fields.Many2one(related='event_id.currency_id')

    @api.constrains('jumlah')
    def _check_positif(self):
        for rec in self:
            if rec.jumlah < 0:
                raise ValidationError(_('Jumlah dana realisasi tidak boleh negatif.'))
