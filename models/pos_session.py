# -*- coding: utf-8 -*-
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models, SUPERUSER_ID, _
from odoo.exceptions import UserError, ValidationError

import logging
import json

_logger = logging.getLogger(__name__)

class PosSession(models.Model):
    _inherit = 'pos.session'

    @api.multi
    def action_pos_session_close(self):
        # validate cashback statemet
        for session in self:
            company_id = session.config_id.company_id.id
            ctx = dict(self.env.context, force_company=company_id, company_id=company_id)
            for st in session.cashback_statement_ids:
                st.with_context(ctx).sudo().button_confirm_bank()

        return super(PosSession, self).action_pos_session_close()

    def _confirm_orders(self):
        for session in self:
            company_id = session.config_id.journal_id.company_id.id
            orders = session.order_ids.filtered(lambda order: order.state == 'paid')
            journal_id = self.env['ir.config_parameter'].sudo().get_param(
                'pos.closing.journal_id_%s' % company_id, default=session.config_id.journal_id.id)
            if not journal_id:
                raise UserError(_("You have to set a Sale Journal for the POS:%s") % (session.config_id.name,))

            move = self.env['pos.order'].with_context(force_company=company_id)._create_account_move(session.start_at, session.name, int(journal_id), company_id)
            orders.with_context(force_company=company_id)._create_account_move_line(session, move)
            for order in session.order_ids.filtered(lambda o: o.state not in ['done', 'invoiced']):
                if order.state not in ('paid'):
                    raise UserError(_("You cannot confirm all orders of this session, because they have not the 'paid' status"))
                order.action_pos_order_done()
            orders_to_reconcile = session.order_ids._filtered_for_reconciliation()
            orders_to_reconcile.sudo()._reconcile_payments()

    @api.model
    def create(self, values):
        config_id = values.get('config_id') or self.env.context.get('default_config_id')
        if not config_id:
            raise UserError(_("You should assign a Point of Sale to your session."))

        pos_config = self.env['pos.config'].browse(config_id)
        ctx = dict(self.env.context, company_id=pos_config.company_id.id)
        uid = SUPERUSER_ID if self.env.user.has_group('point_of_sale.group_pos_user') else self.env.user.id
        res = super(PosSession, self.with_context(ctx).sudo(uid)).create(values)

        if pos_config.cashback_id :
            cashback_statements = []
            PCS = self.env['pos.cashback.statement']
            cashback_journal = self.env['account.journal'].search([('id', '=', pos_config.cashback_id.journal_id.id ) ])
            st_values = {
                'journal_id': cashback_journal.id,
                'user_id': self.env.user.id,
                'name': res.name
            }

            cashback_statements.append(PCS.with_context(ctx).sudo(uid).create(st_values).id)
            res.update({
                'cashback_statement_ids': [( 6, 0, cashback_statements )],
                'config_id': config_id,
                "cashback_id" : pos_config.cashback_id
            })
        
        if not pos_config.cash_control:
            res.action_pos_session_open()
        return res

    @api.depends('config_id', 'cashback_statement_ids')
    def _compute_cashback_journal(self):
        for session in self:
            session.cashback_journal_id = False
            for cashback_statement in session.cashback_statement_ids:
                    session.cashback_journal_id = cashback_statement.journal_id.id


    @api.multi
    def unlink(self):
        for session in self.filtered(lambda s: s.cashback_statement_ids):
            session.cashback_statement_ids.unlink()
        return super(PosSession, self).unlink()

    cashback_statement_ids = fields.One2many('pos.cashback.statement', 'pos_session_id', string='Cash Back Statement', readonly=True)
    cashback_journal_id = fields.Many2one('account.journal', compute='_compute_cashback_journal', string='Cash Back Journal', store=True)
    cashback_id = fields.Many2one(
        'pos.cashback',
        string='Cash Back',
        help=" cashback.",
        store=True
        )