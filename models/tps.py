from odoo import models, fields, api


class Tps(models.Model):
    _name = 'smartpolling.tps'
    _description = 'Tempat Pemungutan Suara'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'name asc'
    _rec_name = 'code'

    code = fields.Char('Kode', readonly=True, copy=False, default='New', tracking=True)
    name = fields.Char('Nama TPS', required=True, tracking=True)

    desa_id = fields.Many2one('smartpolling.desa', string='Desa/Kelurahan', required=True, tracking=True)
    kecamatan_id = fields.Many2one(
        'smartpolling.kecamatan', string='Kecamatan',
        related='desa_id.kecamatan_id', store=True, readonly=True,
    )
    kabupaten_id = fields.Many2one(
        'smartpolling.kabupaten', string='Kabupaten/Kota',
        related='desa_id.kabupaten_id', store=True, readonly=True,
    )

    relawan_id = fields.Many2one('smartpolling.relawan', string='Koordinator Relawan', tracking=True)

    dpt_ids = fields.One2many('smartpolling.dpt', 'tps_id', string='Daftar DPT')
    total_dpt = fields.Integer('Total DPT Terdata', compute='_compute_total_dpt', store=True)
    total_target = fields.Integer('Target DPT', tracking=True)

    state = fields.Selection([
        ('aktif', 'Aktif'),
        ('non_aktif', 'Non Aktif'),
    ], string='Status', required=True, default='aktif', tracking=True)

    @api.depends('dpt_ids')
    def _compute_total_dpt(self):
        for rec in self:
            rec.total_dpt = len(rec.dpt_ids)

    def action_set_aktif(self):
        self.write({'state': 'aktif'})

    def action_set_non_aktif(self):
        self.write({'state': 'non_aktif'})

    def action_view_dpt(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': f'DPT — {self.name}',
            'res_model': 'smartpolling.dpt',
            'view_mode': 'list,form',
            'domain': [('tps_id', '=', self.id)],
            'context': {'default_tps_id': self.id},
        }

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if not vals.get('code') or vals['code'] == 'New':
                vals['code'] = self.env['ir.sequence'].next_by_code('smartpolling.tps.sequence') or 'New'
        return super().create(vals_list)
