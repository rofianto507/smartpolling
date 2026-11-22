from odoo import models, fields


class Berita(models.Model):
    _name = 'smartpolling.berita'
    _description = 'Berita'
    _inherit = ['mail.thread']
    _order = 'is_pinned desc, tanggal_terbit desc, id desc'

    name = fields.Char('Judul', required=True, tracking=True)
    ringkasan = fields.Text(
        'Ringkasan',
        help='Teks singkat di daftar berita app petugas. Kosongkan untuk memakai potongan awal isi berita.',
    )
    isi = fields.Html('Isi Berita', sanitize=True)
    gambar = fields.Image('Gambar Sampul', max_width=1280, max_height=1280)
    tanggal_terbit = fields.Datetime('Tanggal Terbit', tracking=True, copy=False)
    penulis_id = fields.Many2one(
        'res.users', string='Penulis', readonly=True, copy=False,
        default=lambda self: self.env.user,
    )
    is_pinned = fields.Boolean('Sematkan', help='Berita yang disematkan tampil paling atas di app petugas.')
    state = fields.Selection([
        ('draft', 'Draft'),
        ('terbit', 'Terbit'),
    ], string='Status', required=True, default='draft', tracking=True, copy=False)
    active = fields.Boolean(default=True)

    def action_terbitkan(self):
        now = fields.Datetime.now()
        for rec in self:
            rec.write({'state': 'terbit', 'tanggal_terbit': rec.tanggal_terbit or now})

    def action_draft(self):
        self.write({'state': 'draft'})
