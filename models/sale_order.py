from odoo import api, exceptions, fields, models, _


class SaleOrder(models.Model):
    _inherit = "sale.order"

    @api.depends('amount_total', 'cashback_id')
    def _compute_cashback(self):
        for order in self:
            if order.amount_total >= order.cashback_id.minimal_amount :
                order.cashback_total = order.cashback_id.cashback
            else :
                order.cashback_total = 0

    @api.multi
    def _prepare_invoice(self):
        dict_obj = super(SaleOrder, self)._prepare_invoice()
        dict_obj.update({'cashback_id': self.cashback_id.id })
        return dict_obj

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