import logging

from odoo import api, SUPERUSER_ID
from odoo.fields import Command

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    """Ubah akun petugas (grup Relawan murni) dari Internal User menjadi Portal,
    supaya tidak bisa masuk backend /odoo dan hanya memakai app /mobile."""
    env = api.Environment(cr, SUPERUSER_ID, {})
    group_relawan = env.ref('smartpolling.group_relawan')
    group_portal = env.ref('base.group_portal')
    users = env['res.users'].with_context(active_test=False).search([
        ('group_ids', 'in', group_relawan.id),
        ('relawan_id', '!=', False),
    ])
    for user in users:
        if (
            not user._is_internal()
            or user.has_group('smartpolling.group_admin')
            or user.has_group('smartpolling.group_viewer')
            or user.has_group('base.group_system')
        ):
            continue
        user.write({'group_ids': [Command.set([group_portal.id, group_relawan.id])]})
        _logger.info('SmartPolling: user %s (%s) diubah menjadi Portal', user.login, user.id)
