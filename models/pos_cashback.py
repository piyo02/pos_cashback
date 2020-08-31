from odoo import api, exceptions, fields, models, _


class PosCashback(models.Model):
    _name = "pos.cashback"

    name = fields.Char(string="Name", size=100 , required=True)
    journal_id = fields.Many2one(
        'account.journal', 
        string='Cash Back Journal',
        help="Accounting journal used to post sales entries.",
        )

    account_id = fields.Many2one('account.account', string='Cash Account', domain=[('deprecated', '=', False)], required=True,
        help="This technical field can be used at the statement line creation/import time in order to avoid the reconciliation"
             " process on it later on. The statement line will simply create a counterpart on this account")
    
    minimal_amount = fields.Float(string="Minimum Amount", required=True)
    cashback_pc = fields.Float(string='Cash Back Percentage', default=10, help='The default discount percentage')
    # active = fields.Boolean(default=True)
    state = fields.Selection([('all', 'All Orders'), ('selected', 'Selected Orders')], string='Status', required=True,  default='all')