# -*- coding: utf-8 -*-

import time
from collections import OrderedDict
from odoo import api, fields, models, _
from odoo.osv import expression
from odoo.exceptions import RedirectWarning, UserError, ValidationError
from odoo.tools.misc import formatLang
from odoo.tools import float_is_zero, float_compare
from odoo.tools.safe_eval import safe_eval
import odoo.addons.decimal_precision as dp
from lxml import etree

#----------------------------------------------------------
# Entries
#----------------------------------------------------------


class AccountMove(models.Model):
    _inherit = "account.move"
    
    cashback_statement_line_id = fields.Many2one('pos.cashback.statement.line', index=True, string='Cash Back statement line reconciled with this entry', copy=False, readonly=True)


class AccountMoveLine(models.Model):
    _inherit = "account.move.line"

    cashback_statement_id = fields.Many2one('pos.cashback.statement', string='Cash Back Statement',
        help="The bank statement used for bank reconciliation", index=True, copy=False)
