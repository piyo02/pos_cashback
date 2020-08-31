# -*- coding: utf-8 -*-
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models, _

class PosConfig(models.Model):
    _inherit = 'pos.config'

    cashback_id = fields.Many2one(
        'pos.cashback',
        string='Cash Back',
        help=" cashback.",
        )
    