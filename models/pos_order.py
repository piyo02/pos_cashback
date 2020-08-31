import logging
from datetime import timedelta
from functools import partial

import psycopg2
import pytz

from odoo import api, fields, models, tools, _
from odoo.tools import float_is_zero
from odoo.exceptions import UserError
from odoo.http import request
import odoo.addons.decimal_precision as dp

_logger = logging.getLogger(__name__)

class PosOrder(models.Model):
    _inherit = 'pos.order'

    def _default_session(self):
        return self.env['pos.session'].search([('state', '=', 'opened'), ('user_id', '=', self.env.uid)], limit=1)

    def _default_cashback(self):
        if ( self._default_session().cashback_id ) :
            return self._default_session().cashback_id
        else :
            return False

    cashback_id = fields.Many2one('pos.cashback', string='Cashback', states={
                                   'draft': [('readonly', False)]}, readonly=True, default=_default_cashback, store=True )
    amount_cashback = fields.Float(
        compute='_compute_amount_all', 
        string='Caskback', digits=0
        )
    amount_total_with_cashback = fields.Float(compute='_compute_amount_all', string='Total With Cashback', digits=0)
    cashback_statement_ids = fields.One2many('pos.cashback.statement.line', 'pos_cashback_statement_id', string='Cash Back Return', states={'draft': [('readonly', False)]}, readonly=True)
    has_cashback = fields.Boolean( default=False )

    def _compute_amount_all(self):
        super(PosOrder, self)._compute_amount_all()
        for order in self:
            order.amount_cashback = 0.0
            order.amount_total_with_cashback = 0.0
            if order.cashback_id and order.has_cashback :
                currency = order.pricelist_id.currency_id
                amount_untaxed = currency.round(sum(line.price_subtotal for line in order.lines))

                if( amount_untaxed >= order.cashback_id.minimal_amount ):
                    order.amount_cashback = amount_untaxed * order.cashback_id.cashback_pc / 100
                
            order.amount_total_with_cashback = order.amount_total - order.amount_cashback

    @api.model
    def _order_fields(self, ui_order):
        process_line = partial(self.env['pos.order.line']._order_line_fields)
        return {
            'name':         ui_order['name'],
            'user_id':      ui_order['user_id'] or False,
            'session_id':   ui_order['pos_session_id'],
            'lines':        [process_line(l) for l in ui_order['lines']] if ui_order['lines'] else False,
            'pos_reference': ui_order['name'],
            'partner_id':   ui_order['partner_id'] or False,
            'date_order':   ui_order['creation_date'],
            'fiscal_position_id': ui_order['fiscal_position_id'],
            'has_cashback':   ui_order['has_cashback'] or False,
        } 

    @api.model
    def _process_order(self, pos_order):
        order = super(PosOrder, self)._process_order(pos_order)

        prec_acc = self.env['decimal.precision'].precision_get('Account')
        pos_session = self.env['pos.session'].browse(pos_order['pos_session_id'])
        
        if order.cashback_id and order.has_cashback :
            if not float_is_zero(pos_order['cashback_amount'], prec_acc):
                cashback_journal_id = pos_session.cashback_journal_id.id
                if not cashback_journal_id:
                        raise UserError(_("No cash back statement found for this session. Unable to record returned cash back."))

                if cashback_journal_id:
                    order.add_cashback({
                        'amount': pos_order['cashback_amount'],
                        'cashback_date': fields.Datetime.now(),
                        'cashback_name': _('Cashback'),
                        'journal': cashback_journal_id,
                    })

                # cashback adjustment
                cash_journal_id = pos_session.cash_journal_id.id
                if not cash_journal_id:
                    cash_journal = [statement.journal_id for statement in pos_session.statement_ids if statement.journal_id.type == 'cash']
                    if not cash_journal:
                        raise UserError(_("No cash statement found for this session. Unable to record cashback adjustment."))

                    cash_journal_id = cash_journal[0].id

                order.add_payment({
                    'amount': pos_order['cashback_amount'],
                    'payment_date': fields.Datetime.now(),
                    'payment_name': _('Income Adjustment'),
                    'journal': cash_journal_id,
                })
        return order

    def add_cashback(self, data):
        """Create a new payment for the order"""
        args = self._prepare_cashback_statement_line_return_values(data)
        context = dict(self.env.context)
        context.pop('pos_session_id', False)
        self.env['pos.cashback.statement.line'].with_context(context).create(args)
        return args.get('cashback_statement_id', False)

    def _prepare_cashback_statement_line_return_values(self, data):
        """Create a new payment for the order"""
        args = {
            'amount': data['amount'],
            'date': data.get('cashback_date', fields.Date.today()),
            'name': self.name + ': ' + (data.get('cashback_name', '') or ''),
            'partner_id': self.env["res.partner"]._find_accounting_partner(self.partner_id).id or False,
        }

        journal_id = data.get('journal', False)
        cashback_statement_id = data.get('cashback_statement_id', False)
        assert journal_id or cashback_statement_id, "No cashback_statement_id or journal_id passed to the method!"

        # journal = self.env['account.journal'].browse(journal_id)
        # use the company of the journal and not of the current user
        # company_cxt = dict(self.env.context, force_company=journal.company_id.id)
        # account_def = self.env['ir.property'].with_context(company_cxt).get('property_account_receivable_id', 'res.partner')
        args['account_id'] = self.cashback_id.account_id.id or False

        if not args['account_id']:
            if not args['partner_id']:
                msg = _('There is no cash account defined to make payment.')
            else:
                msg = _('There is no cash account defined to make payment ') % (
                    self.partner_id.name, self.partner_id.id,)
            raise UserError(msg)

        context = dict(self.env.context)
        context.pop('pos_session_id', False)
        for cashback_statement in self.session_id.cashback_statement_ids:
            if cashback_statement.id == cashback_statement_id:
                journal_id = cashback_statement.journal_id.id
                break
            elif cashback_statement.journal_id.id == journal_id:
                cashback_statement_id = cashback_statement.id
                break
        if not cashback_statement_id:
            raise UserError(_('You have no cashback statement.'))

        args.update({
            'cashback_statement_id':cashback_statement_id,
            'pos_cashback_statement_id': self.id,
            'journal_id': journal_id,
            'ref': self.session_id.name,
        })

        return args

    