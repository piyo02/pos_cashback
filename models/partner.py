# -*- coding: utf-8 -*-

from odoo import api, fields, models


class ResPartner(models.Model):
    """Add some fields related to member"""
    _inherit = "res.partner"

    members = fields.Many2many(
        comodel_name="res.partner", relation="partner_member_rel",
        column1="partner_id", column2="member_id",
        domain=[('member', '=', True)])
    cashback_pc = fields.Float(string='Cash Back Percentage', default=3, help='The default discount percentage')
    member = fields.Boolean(
        string="Member",
        help="Check this field if the partner is a member.")
    card_number = fields.Char(string="Card Number")