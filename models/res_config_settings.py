import logging

import requests

from odoo import _, fields, models
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)

GEMINI_MODELS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    smartpolling_gemini_api_key = fields.Char(
        string='Gemini API Key',
        config_parameter='smartpolling.gemini_api_key',
        help="API Key dari Google AI Studio, dipakai panel 'Analisis AI' di Dashboard SmartPolling.",
    )

    def action_test_smartpolling_gemini(self):
        """Tes koneksi ke Gemini API dengan API Key yang sedang diisi di form."""
        api_key = self.smartpolling_gemini_api_key
        if not api_key:
            raise UserError(_('Isi Gemini API Key terlebih dahulu sebelum tes koneksi.'))
        try:
            resp = requests.get(GEMINI_MODELS_ENDPOINT, headers={'x-goog-api-key': api_key}, timeout=10)
            resp.raise_for_status()
        except requests.exceptions.RequestException as e:
            detail = str(e).replace(api_key, '***')
            _logger.warning('SmartPolling: tes Gemini API key gagal: %s', detail)
            raise UserError(_('Gagal terhubung ke Gemini API. Periksa API Key Anda.\n\nDetail: %s') % detail)
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': _('Berhasil'),
                'message': _('API Key valid dan terhubung ke Gemini API.'),
                'type': 'success',
                'sticky': False,
            },
        }
