from odoo import http
from odoo.http import request
from odoo.addons.web.controllers.home import Home


class SmartPollingHome(Home):
    """Petugas (user Portal dengan relawan_id) yang login lewat /web/login atau
    membuka /odoo diarahkan ke app mobile, bukan ke halaman generik
    'login successful' milik Odoo."""

    @http.route()
    def login_successful_external_user(self, **kwargs):
        if request.env.user.relawan_id:
            return request.redirect('/mobile/app')
        return super().login_successful_external_user(**kwargs)
