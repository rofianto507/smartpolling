from odoo import models, fields, api


class Relawan(models.Model):
    _name = 'smartpolling.relawan'
    _description = 'Relawan'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'name asc'

    name = fields.Char('Nama', required=True, tracking=True)
    hp = fields.Char('No. HP', tracking=True)
    alamat = fields.Text('Alamat')
    foto = fields.Binary('Foto', attachment=True)
    foto_filename = fields.Char('Nama File Foto')

    state = fields.Selection([
        ('aktif', 'Aktif'),
        ('non_aktif', 'Non Aktif'),
    ], string='Status', required=True, default='aktif', tracking=True)

    tps_ids = fields.One2many('smartpolling.tps', 'relawan_id', string='TPS Koordinasi', readonly=True)
    tps_count = fields.Integer('Total TPS', compute='_compute_tps_count', store=True)

    dpt_ids = fields.One2many('smartpolling.dpt', 'petugas_id', string='DPT Terdata', readonly=True)
    dpt_count = fields.Integer('Total DPT', compute='_compute_dpt_count', store=True)

    voter_ids = fields.One2many('smartpolling.voter', 'petugas_id', string='Survey', readonly=True)
    voter_count = fields.Integer('Total Survey', compute='_compute_voter_count', store=True)

    user_ids = fields.One2many('res.users', 'relawan_id', string='Akun Pengguna', readonly=True)
    has_user = fields.Boolean('Ada Username', compute='_compute_user_info', store=True)
    linked_username = fields.Char('Username', compute='_compute_user_info', store=True)

    _hp_unique = models.Constraint('UNIQUE(hp)', 'No. HP ini sudah terdaftar pada relawan lain!')

    @api.depends('tps_ids')
    def _compute_tps_count(self):
        for rec in self:
            rec.tps_count = len(rec.tps_ids)

    @api.depends('dpt_ids')
    def _compute_dpt_count(self):
        for rec in self:
            rec.dpt_count = len(rec.dpt_ids)

    @api.depends('voter_ids')
    def _compute_voter_count(self):
        for rec in self:
            rec.voter_count = len(rec.voter_ids)

    @api.depends('user_ids.login')
    def _compute_user_info(self):
        for rec in self:
            user = rec.user_ids[:1]
            rec.has_user = bool(user)
            rec.linked_username = user.login if user else False

    def action_set_aktif(self):
        self.write({'state': 'aktif'})

    def action_set_non_aktif(self):
        self.write({'state': 'non_aktif'})

    def action_view_tps(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': f'TPS — {self.name}',
            'res_model': 'smartpolling.tps',
            'view_mode': 'list,form',
            'domain': [('relawan_id', '=', self.id)],
        }

    def action_view_dpt(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': f'DPT — {self.name}',
            'res_model': 'smartpolling.dpt',
            'view_mode': 'list,form',
            'domain': [('petugas_id', '=', self.id)],
        }

    def action_view_voter(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': f'Survey — {self.name}',
            'res_model': 'smartpolling.voter',
            'view_mode': 'list,form',
            'domain': [('petugas_id', '=', self.id)],
        }

    def action_view_user(self):
        self.ensure_one()
        user = self.user_ids[:1]
        form_view = self.env.ref('base.view_users_form')
        return {
            'type': 'ir.actions.act_window',
            'name': f'User — {self.name}',
            'res_model': 'res.users',
            'res_id': user.id,
            'views': [[form_view.id, 'form']],
            'target': 'new',
        }

    def action_open_create_user_wizard(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': f'Buat User — {self.name}',
            'res_model': 'smartpolling.relawan.create.user.wizard',
            'view_mode': 'form',
            'target': 'new',
            'context': {
                'default_relawan_id': self.id,
                'default_username': self.hp or '',
            },
        }
