from odoo import models, fields, api, _
from odoo.fields import Command
from odoo.exceptions import ValidationError


class RelawanCreateUserWizard(models.TransientModel):
    _name = 'smartpolling.relawan.create.user.wizard'
    _description = 'Wizard Buat User dari Relawan'

    relawan_id = fields.Many2one('smartpolling.relawan', string='Relawan', required=True, readonly=True)
    username = fields.Char('Username', required=True)
    password = fields.Char('Password', required=True)
    password_confirm = fields.Char('Konfirmasi Password', required=True)

    @api.constrains('password', 'password_confirm')
    def _check_password_match(self):
        for rec in self:
            if rec.password and rec.password_confirm and rec.password != rec.password_confirm:
                raise ValidationError(_('Password dan konfirmasi password tidak sama.'))

    def action_confirm(self):
        self.ensure_one()
        if self.password != self.password_confirm:
            raise ValidationError(_('Password dan konfirmasi password tidak sama.'))
        if self.env['res.users'].sudo().search_count([('login', '=', self.username)]):
            raise ValidationError(_('Username "%s" sudah digunakan, silakan pilih username lain.') % self.username)

        group_relawan = self.env.ref('smartpolling.group_relawan')
        group_internal = self.env.ref('base.group_user')
        self.env['res.users'].sudo().create({
            'name': self.relawan_id.name,
            'login': self.username,
            'password': self.password,
            'phone': self.username,
            'image_1920': self.relawan_id.foto,
            'relawan_id': self.relawan_id.id,
            'group_ids': [Command.link(group_internal.id), Command.link(group_relawan.id)],
        })
        return {
            'type': 'ir.actions.act_window',
            'name': self.relawan_id.name,
            'res_model': 'smartpolling.relawan',
            'res_id': self.relawan_id.id,
            'views': [[False, 'form']],
            'target': 'current',
        }