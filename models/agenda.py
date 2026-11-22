from odoo import models, fields, api, _
from odoo.exceptions import ValidationError


class Agenda(models.Model):
    _name = 'smartpolling.agenda'
    _description = 'Agenda Kegiatan'
    _inherit = ['mail.thread']
    _order = 'tanggal_mulai desc, id desc'

    name = fields.Char('Nama Kegiatan', required=True, tracking=True)
    tanggal_mulai = fields.Datetime('Mulai', required=True, tracking=True)
    tanggal_selesai = fields.Datetime('Selesai', tracking=True)
    lokasi = fields.Char('Lokasi', tracking=True)
    deskripsi = fields.Html('Deskripsi', sanitize=True)
    state = fields.Selection([
        ('draft', 'Draft'),
        ('terbit', 'Terbit'),
        ('batal', 'Dibatalkan'),
    ], string='Status', required=True, default='draft', tracking=True, copy=False)
    active = fields.Boolean(default=True)

    @api.constrains('tanggal_mulai', 'tanggal_selesai')
    def _check_tanggal(self):
        for rec in self:
            if rec.tanggal_selesai and rec.tanggal_selesai < rec.tanggal_mulai:
                raise ValidationError(_('Waktu selesai tidak boleh lebih awal dari waktu mulai.'))

    def action_terbitkan(self):
        self.write({'state': 'terbit'})

    def action_batalkan(self):
        self.write({'state': 'batal'})

    def action_draft(self):
        self.write({'state': 'draft'})
