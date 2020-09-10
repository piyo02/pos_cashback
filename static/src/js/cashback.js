odoo.define('pos_cashback.pos_cashback', function (require) {
    "use strict";

    var core = require('web.core');
    var screens = require('point_of_sale.screens');
    var models = require('point_of_sale.models');

    var QWeb = core.qweb;


    // At POS Startup, load the floors, and add them to the pos model
    models.load_models({
        model:  'pos.session',
        fields: ['id', 'journal_ids','name','user_id','config_id','start_at','stop_at','sequence_number','login_number', 'cashback_id' ],
        domain: function(self){ return [['state','=','opened'],['id','=',self.pos_session.id ]]; },
        loaded: function(self,pos_sessions){
            self.pos_session = pos_sessions[0];
        },
    });

    models.load_models({
        model: 'pos.cashback',
        fields: ['name','journal_id','minimal_amount', 'state'],
        ids:    function(self){
            if( self.pos_session.cashback_id )
                return [self.pos_session.cashback_id[0]]; 
            else 
                return [];
        },
        loaded: function(self,cashbacks){
            if( cashbacks.length > 0 )
                self.cashback = cashbacks[0];
            else 
                self.cashback = null;
        },
    });

    models.load_models({
        model: 'res.partner',
        fields: ['cashback_pc','member','card_number', 'id'],
        domain: function(self){ return [['customer','=',true], ['member', '=', true]]; },
        loaded: function(self,partners){
            self.partners_cashback = partners;
        },
    });

    models.load_models({
        model: 'account.journal',
        fields: [],
        ids:    function(self){ 
            if( self.cashback )
                return [self.cashback.journal_id[0]]; 
            else 
                return [];
        },
        loaded: function(self,journals){
            if( journals.length > 0 )
                self.cashback_journal = journals[0];
            else 
                self.cashback_journal = null;
        },
    });

    var _super_order = models.Order.prototype;
    models.Order = models.Order.extend({
        initialize: function(attributes,options) {
            this.pos                = options.pos; 
            this.cashback           = this.pos.cashback;
            this.has_cashback       = false;
            this.partners_cashback  = options.pos.partners_cashback

            if( this.cashback )
                if( this.cashback.state == "all" ) this.has_cashback = true;

            return _super_order.initialize.call(this,attributes,options);
        },
        export_as_JSON: function() {
            var order               = _super_order.export_as_JSON.call(this);
            
            order.has_cashback      = this.has_cashback;
            order.cashback_amount   = this.get_cashback_amount();
            return order;
        },

        export_for_printing: function(){
            var receipt                    = _super_order.export_for_printing.call(this);
            
            receipt.cashback_amount        = this.get_cashback_amount();
            receipt.total_with_tax         = receipt.total_with_tax + receipt.cashback_amount;
            receipt.total_after_cashback   = receipt.total_with_tax - receipt.cashback_amount;
            
            return receipt;
        },
        get_total_with_tax: function() {
            return this.get_total_without_tax() + this.get_total_tax() - this.get_cashback_amount();
        },
        get_cashback_amount: function() {
            var cashback_amount = 0.0;
            var amount = this.get_total_without_tax();
            var order = this.pos.get_order();

            let partner_id = 0;
            if(order !== null)
                if(order.attributes.client !== null)
                    partner_id = order.attributes.client.id;

            const cashback = this.filterIt(this.partners_cashback, partner_id);
            const isMember = (cashback[0] !== undefined) ? cashback[0].member : false;
            
            // if user give a discount then not set the cashback
            if( this.get_total_discount() > 0 || this.check_price_change() ) 
                this.has_cashback =false;
            else if( this.cashback )
                if( this.cashback.state == "all" ) this.has_cashback = true;

            if( this.has_cashback &&  this.cashback && isMember && order.isMember && partner_id )
            {
                if( amount >= this.cashback.minimal_amount )
                {
                    cashback_amount = amount * cashback[0].cashback_pc / 100;
                }
            }
            return cashback_amount;
        },
        check_price_change: function() {
            var lines = this.get_orderlines();
            for (var i = 0; i < lines.length; i++) {
                if (lines[i].get_product().price != lines[i].price ) {
                    return true;
                }
            }
            return false;
        },
        filterIt(arr, partner_id) {
            return arr.filter(function(obj) {
                return Object.keys(obj).some(function(key) {
                    if(obj.id == partner_id) return obj;
                })
            });
        }
    });

    screens.PaymentScreenWidget.include({

        init: function(parent, options) {
            this._super(parent, options);
            this.cashback_amount = 0;
            this.cashback_button_state = 0;
        },
        renderElement: function() {
            var self = this;
            this._super();

            this.set_cashback_button();

            this.$('.back').click(function(){
                self.reset_cashback();
            });

            this.$('.next').click(function(){
                if (self.order_is_valid()) {
                    self.reset_cashback();
                }
            });
        },

        set_cashback_button: function(){
            var self = this;
            this.$('.js_custom_add_cashback').addClass('oe_hidden');
            this.$('.js_custom_remove_cashback').addClass('oe_hidden');

            var cashback = this.pos.cashback;
            if( this.pos.cashback )
            {
                if( cashback.state == "all" )
                {
                    this.cashback_button_state = 1;
                }
                else if ( cashback.state == "selected" )
                {
                    this.$('.js_custom_add_cashback').removeClass('oe_hidden');
                    this.$('.js_custom_add_cashback').click(function(){
                        // if user give a discount then not set the cashback
                        if( self.pos.get_order().get_total_discount() > 0 ||  self.pos.get_order().check_price_change() ) 
                        {
                            self.disable_cashback();
                            return;
                        }

                        self.pos.get_order().has_cashback = true;
                        self.cashback_button_state = 1;

                        self.$('.js_custom_add_cashback').addClass('oe_hidden');
                        self.$('.js_custom_remove_cashback').removeClass('oe_hidden');

                        self.render_paymentlines();
                    });

                    // this.$('.js_custom_remove_cashback').removeClass('oe_hidden');
                    this.$('.js_custom_remove_cashback').click(function(){
                        // if user give a discount then not set the cashback
                        if( self.pos.get_order().get_total_discount() > 0 ||  self.pos.get_order().check_price_change() ) 
                        {
                            self.disable_cashback();
                            return;
                        }
                        self.pos.get_order().has_cashback = false;
                        self.cashback_button_state = 0;

                        self.$('.js_custom_remove_cashback').addClass('oe_hidden');
                        self.$('.js_custom_add_cashback').removeClass('oe_hidden');

                        self.render_paymentlines();
                    });
                }
            }
        },
        disable_cashback: function() {
            this.$('.js_custom_add_cashback').addClass('oe_hidden');
            this.$('.js_custom_remove_cashback').addClass('oe_hidden');
        },
        reset_cashback: function() {
            if( this.pos.cashback )
            {
                if( this.pos.cashback.state == "all" )
                {
                    this.cashback_button_state = 1;
                }
                else if ( this.pos.cashback.state == "selected" )
                {

                    this.cashback_button_state = 0;
                    this.pos.get_order().has_cashback = false;
            
                    this.$('.js_custom_remove_cashback').addClass('oe_hidden');
                    // this.$('.js_custom_add_cashback').addClass('oe_hidden');
                    this.$('.js_custom_add_cashback').removeClass('oe_hidden');

                    // this.set_cashback_button();
                }
            }
        },

        render_paymentlines: function() {
            this._super();
            this.render_cashback();
        },

        render_cashback: function() {
            var order = this.pos.get_order();
            var cashback = this.pos.cashback;
            const members = this.pos.partners_cashback;
            
            this.$('.cashback-lines').empty();
            if( order != undefined && cashback != undefined )
                if( order.has_cashback )
                {
                    if( this.cashback_button_state == 1 )
                    {
                        var total_amount = order.get_total_without_tax();
                        var cashback_amount = 0;
                        
                        if( total_amount >= cashback.minimal_amount )
                        {
                            const partner_id = (order.attributes.client !== null) ? order.attributes.client.id : 0;
                            const partner_cashback = this.filterIt(members, partner_id);
                            const cashback_pc = (partner_cashback[0] !== undefined) ? partner_cashback[0].cashback_pc / 100 : 0;

                            cashback_amount = total_amount * cashback_pc;
                        }
                        var cashbackWidget = $(QWeb.render('PaymentScreen-PaymentCashback2', { 
                            widget:this ,
                            cashback: cashback_amount ,
                            name: cashback.name ,
                        }));
                        this.cashback_amount = cashback_amount;
                        cashbackWidget.appendTo(this.$('.paymentlines-container'));
                    }
                }
        },

        filterIt(arr, partner_id) {
            return arr.filter(function(obj) {
                return Object.keys(obj).some(function(key) {
                    if(obj.id == partner_id) return obj;
                })
            });
        }

    });

    screens.OrderWidget.include({

        update_summary: function(){
            var order = this.pos.get_order();
            const partner_id = (order.attributes.client !== null) ? order.attributes.client.id : 0;
            
            if (!order.get_orderlines().length) {
                return;
            }

            var total     = order ? order.get_total_with_tax() : 0;
            var taxes     = order ? order.get_total_tax() : 0;

            this.el.querySelector('.summary .total > .value').textContent = this.format_currency(total);
            this.el.querySelector('.summary .total .subentry .value').textContent = this.format_currency(taxes);

            if( this.pos.cashback )
            {
                var cashback  = order ? order.get_cashback_amount() * (-1) : 0;
                this.el.querySelector('.summary .total .cashback .value').textContent = this.format_currency(cashback);
                this.el.querySelector('.summary .total .cashback .cashback_name').textContent = this.pos.cashback.name;
            }
        },
    });

    screens.ClientListScreenWidget.include({

        init: function(parent, options) {
            this._super(parent, options);
        },

        show: function() {
            var self = this;
            this._super();

            var order = this.pos.get_order();

            this.$('.searchbox input').on('keypress', function(event) {
                var searchbox = this;

                if(event.which === 13 && searchbox.value[0] === '%' && searchbox.value.length === 9){
                    order.isMember = true;
                }
            });

            this.$('.next').click(function(){
                order.isMember = false;
            });
        },

        
    });

});
