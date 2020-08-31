# -*- coding: utf-8 -*-
# Copyright 2014-2018 Tecnativa - Pedro M. Baeza
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo import api, fields, models
from odoo.exceptions import UserError, RedirectWarning, ValidationError


class AccountInvoice(models.Model):
    """Invoice inherit to add salesman"""
    _inherit = "account.invoice"

    @api.depends('amount_total', 'cashback_id')
    def _compute_cashback(self):
        for order in self:
            if order.amount_total >= order.cashback_id.minimal_amount :
                order.cashback_total = order.cashback_id.cashback
            else :
                order.cashback_total = 0


    cashback_id = fields.Many2one(
        'sale.cashback', 
        string='Cash Back Type', 
        domain=[ ('active','=',True)],
        store=True)

    cashback_total = fields.Float(
            string="Cash Back",
            compute="_compute_cashback",
            store=True,
            default=0)

    