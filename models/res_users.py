from odoo import models, fields


class ResUsers(models.Model):
    _inherit = 'res.users'

    relawan_id = fields.Many2one('smartpolling.relawan', string='Relawan Terkait')
