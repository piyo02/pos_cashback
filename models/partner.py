from odoo import api, fields, models
import string
import random
import logging

_logger = logging.getLogger(__name__)


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
    card_number = fields.Char(string="Card Number") #, readonly=True
    barcode = fields.Char(string="Barcode") #, readonly=True

    @api.multi
    @api.onchange('member')
    def _generate_card_number(self):
        if(self.card_number == False and self.barcode == False):
            generate_number =  '%' + ''.join(random.choice(string.ascii_lowercase + string.digits) for _ in range(6)) + '%'
            self.card_number = generate_number
            self.barcode = generate_number