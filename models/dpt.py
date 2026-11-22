from odoo import models, fields, api


class Dpt(models.Model):
    _name = 'smartpolling.dpt'
    _description = 'Daftar Pemilih Tetap'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'nama asc'
    _rec_name = 'nama'

    nik = fields.Char('NIK', required=True, size=16, tracking=True)
    nama = fields.Char('Nama', required=True, tracking=True)
    alamat = fields.Text('Alamat', tracking=True)
    hp = fields.Char('No. HP', tracking=True)

    petugas_id = fields.Many2one('smartpolling.relawan', string='Petugas Pendata', required=True, tracking=True)
    tps_id = fields.Many2one('smartpolling.tps', string='TPS', required=True, tracking=True)
    kecamatan_id = fields.Many2one(
        'smartpolling.kecamatan', string='Kecamatan',
        related='tps_id.kecamatan_id', store=True, readonly=True,
    )
    kabupaten_id = fields.Many2one(
        'smartpolling.kabupaten', string='Kabupaten/Kota',
        related='tps_id.kabupaten_id', store=True, readonly=True,
    )

    jenis_kelamin = fields.Selection([
        ('L', 'Laki-laki'),
        ('P', 'Perempuan'),
    ], string='Jenis Kelamin', required=True, tracking=True)
    agama = fields.Selection([
        ('islam', 'Islam'),
        ('kristen', 'Kristen'),
        ('katolik', 'Katolik'),
        ('hindu', 'Hindu'),
        ('buddha', 'Buddha'),
        ('konghucu', 'Konghucu'),
        ('lainnya', 'Lainnya'),
    ], string='Agama', tracking=True)
    pekerjaan = fields.Char('Pekerjaan', tracking=True)
    tempat_lahir = fields.Char('Tempat Lahir')
    tanggal_lahir = fields.Date('Tanggal Lahir', tracking=True)

    latitude = fields.Float('Latitude', digits=(10, 6), aggregator=False)
    longitude = fields.Float('Longitude', digits=(10, 6), aggregator=False)

    state = fields.Selection([
        ('baru', 'Baru'),
        ('terverifikasi', 'Terverifikasi'),
        ('ditolak', 'Ditolak'),
    ], string='Status', required=True, default='baru', tracking=True)

    voter_ids = fields.One2many('smartpolling.voter', 'dpt_id', string='Riwayat Survey')
    voter_count = fields.Integer('Total Survey', compute='_compute_voter_count', store=True)
    pilihan_terakhir = fields.Selection([
        ('memilih', 'Memilih'),
        ('ragu_ragu', 'Ragu-ragu'),
        ('belum_menentukan', 'Belum Menentukan'),
        ('tidak_memilih', 'Tidak Memilih'),
    ], string='Pilihan Terakhir', compute='_compute_pilihan_terakhir', store=True)

    _nik_unique = models.Constraint('UNIQUE(nik)', 'NIK ini sudah terdaftar di DPT!')

    @api.depends('voter_ids')
    def _compute_voter_count(self):
        for rec in self:
            rec.voter_count = len(rec.voter_ids)

    @api.depends('voter_ids.pilihan', 'voter_ids.tanggal')
    def _compute_pilihan_terakhir(self):
        for rec in self:
            latest = rec.voter_ids.sorted('tanggal', reverse=True)[:1]
            rec.pilihan_terakhir = latest.pilihan if latest else False

    def action_set_terverifikasi(self):
        self.write({'state': 'terverifikasi'})

    def action_set_ditolak(self):
        self.write({'state': 'ditolak'})

    def action_set_baru(self):
        self.write({'state': 'baru'})

    def action_view_voter(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': f'Survey — {self.nama}',
            'res_model': 'smartpolling.voter',
            'view_mode': 'list,form',
            'domain': [('dpt_id', '=', self.id)],
            'context': {'default_dpt_id': self.id},
        }

    @api.onchange('tps_id')
    def _onchange_tps_id(self):
        if self.tps_id and self.tps_id.relawan_id and not self.petugas_id:
            self.petugas_id = self.tps_id.relawan_id
