from odoo import models, fields, api


class Desa(models.Model):
    _name = 'smartpolling.desa'
    _description = 'Desa/Kelurahan'
    _order = 'name asc'

    code = fields.Char(string="Kode", required=True, size=10)
    name = fields.Char(string="Nama", required=True)
    kecamatan_id = fields.Many2one('smartpolling.kecamatan', string='Kecamatan', required=True)
    kabupaten_id = fields.Many2one(
        'smartpolling.kabupaten', string='Kabupaten/Kota',
        related='kecamatan_id.kabupaten_id', store=True, readonly=True
    )
    type = fields.Selection(
        [('KELURAHAN', 'Kelurahan'), ('DESA', 'Desa')],
        string="Tipe", required=True
    )
    geometry = fields.Text(string="GeoJSON Geometry (Peta)")
    has_geometry = fields.Boolean(
        string='Ada Peta', compute='_compute_has_geometry', store=True
    )
    tps_ids = fields.One2many('smartpolling.tps', 'desa_id', string='Daftar TPS')
    tps_count = fields.Integer(
        string='Total TPS', compute='_compute_tps_count', store=True
    )

    @api.depends('geometry')
    def _compute_has_geometry(self):
        for rec in self:
            rec.has_geometry = bool(rec.geometry and rec.geometry.strip())

    @api.depends('tps_ids')
    def _compute_tps_count(self):
        for rec in self:
            rec.tps_count = len(rec.tps_ids)

    def action_view_tps(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': f'TPS — {self.name}',
            'res_model': 'smartpolling.tps',
            'view_mode': 'list,form',
            'domain': [('desa_id', '=', self.id)],
            'context': {'default_desa_id': self.id},
        }
