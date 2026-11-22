from markupsafe import Markup

from odoo import models, fields, api, _
from odoo.exceptions import ValidationError
from odoo.tools import format_datetime


class Voter(models.Model):
    _name = 'smartpolling.voter'
    _description = 'Survey Preferensi Pemilih'
    _order = 'tanggal desc'
    _rec_name = 'tanggal'

    dpt_id = fields.Many2one('smartpolling.dpt', string='DPT', required=True, ondelete='cascade')
    nik = fields.Char('NIK', related='dpt_id.nik', store=True, readonly=True)
    petugas_id = fields.Many2one(
        'smartpolling.relawan', string='Petugas Pendata',
        related='dpt_id.petugas_id', store=True, readonly=True,
    )
    tps_id = fields.Many2one(
        'smartpolling.tps', string='TPS',
        related='dpt_id.tps_id', store=True, readonly=True,
    )
    desa_id = fields.Many2one(
        'smartpolling.desa', string='Desa/Kelurahan',
        related='dpt_id.tps_id.desa_id', store=True, readonly=True,
    )
    kecamatan_id = fields.Many2one(
        'smartpolling.kecamatan', string='Kecamatan',
        related='dpt_id.kecamatan_id', store=True, readonly=True,
    )
    kabupaten_id = fields.Many2one(
        'smartpolling.kabupaten', string='Kabupaten/Kota',
        related='dpt_id.kabupaten_id', store=True, readonly=True,
    )
    tanggal = fields.Datetime('Tanggal Kunjungan', required=True, default=fields.Datetime.now)
    foto = fields.Binary('Foto Dokumentasi', attachment=True)
    foto_filename = fields.Char('Nama File Foto')
    pilihan = fields.Selection([
        ('memilih', 'Memilih'),
        ('ragu_ragu', 'Ragu-ragu'),
        ('belum_menentukan', 'Belum Menentukan'),
        ('tidak_memilih', 'Tidak Memilih'),
    ], string='Pilihan', required=True)
    event_id = fields.Many2one(
        'smartpolling.event', string='Event', index=True, ondelete='set null',
        help='Survey yang dilakukan dalam rangka event ini dihitung sebagai realisasi target event.',
    )

    @api.constrains('event_id')
    def _check_event(self):
        for rec in self:
            if rec.event_id and rec.event_id.state not in ('disetujui', 'laporan', 'selesai'):
                raise ValidationError(_('Survey hanya bisa dikaitkan ke event yang sudah disetujui.'))

    def _pilihan_label(self):
        return dict(self._fields['pilihan'].selection).get(self.pilihan, self.pilihan)

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        for rec in records:
            if not rec.dpt_id:
                continue
            tanggal_str = format_datetime(self.env, rec.tanggal, dt_format='dd/MM/yyyy HH:mm')
            rec.dpt_id.message_post(
                body=Markup(
                    '<b>Survey Ditambahkan</b><br/>'
                    '<b>Tanggal:</b> %s<br/>'
                    '<b>Pilihan:</b> %s'
                ) % (tanggal_str, rec._pilihan_label()),
                message_type='comment',
                subtype_xmlid='mail.mt_note',
            )
        return records

    def unlink(self):
        logs = []
        for rec in self:
            if rec.dpt_id:
                tanggal_str = format_datetime(self.env, rec.tanggal, dt_format='dd/MM/yyyy HH:mm') if rec.tanggal else '-'
                logs.append((rec.dpt_id, tanggal_str, rec._pilihan_label()))
        result = super().unlink()
        for dpt_id, tanggal_str, pilihan_label in logs:
            dpt_id.message_post(
                body=Markup(
                    '<b>Survey Dihapus</b><br/>'
                    '<b>Tanggal:</b> %s<br/>'
                    '<b>Pilihan:</b> %s'
                ) % (tanggal_str, pilihan_label),
                message_type='comment',
                subtype_xmlid='mail.mt_note',
            )
        return result
