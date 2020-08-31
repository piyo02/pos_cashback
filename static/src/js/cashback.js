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
    fields: ['name','journal_id','minimal_amount', 'cashback_pc', 'state'],
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


// We need to change the way the regular UI sees the orders, it
// needs to only see the orders associated with the current table,
// and when an order is validated, it needs to go back to the floor map.
// And when we change the table, we must create an order for that table
// if there is none.

// var _super_posmodel = models.PosModel.prototype;
// models.PosModel = models.PosModel.extend({
//     initialize: function(session, attributes) {
//         this.table = null;
//         return _super_posmodel.initialize.call(this,session,attributes);
//     },
    
//     // _save_to_server: function (orders, options) {
//     //     var cashback = this.cashback;
//     //     if( cashback != undefined )
//     //     {
//     //         var orders_with_cashback = _.map( orders , function ( order ) {

//     //             var total_amount = order.data.amount_total - order.data.amount_tax;
//     //             var cashback_amount = 0;
//     //             if( cashback.state == "all" ) order.data.has_cashback = true;

//     //             if( total_amount >= cashback.minimal_amount && order.data.has_cashback )
//     //             {
//     //                 cashback_amount = total_amount * cashback.cashback_pc / 100;
//     //             }
    
//     //             order.data.cashback_amount = cashback_amount;
//     //             return order;
//     //         });
//     //         return _super_posmodel._save_to_server.call(this,orders_with_cashback, options);
//     //     }
//     //     else
//     //     {
//     //         return _super_posmodel._save_to_server.call(this,orders, options);
//     //     }
//     // },
// });


// var _super_orderline = models.Orderline.prototype;
// models.Orderline = models.Orderline.extend({
//     initialize: function(attr,options){
//         return _super_orderline.initialize.call(this,attr,options);
//     },
//     set_unit_price: function(price){
//         console.log("set_unit_price" + price );
//         console.log("get_product price " + this.get_product().price );
//         // console.log("has_cashback " + this.order.has_cashback );
//         _super_orderline.set_unit_price.call(this, price);
//         console.log("this.price " + this.price );

//     },
// })

var _super_order = models.Order.prototype;
models.Order = models.Order.extend({
    initialize: function(attributes,options) {
        this.pos            = options.pos; 
        this.has_cashback = false;
        this.cashback = this.pos.cashback;

        if( this.cashback )
            if( this.cashback.state == "all" ) this.has_cashback = true;

        return _super_order.initialize.call(this,attributes,options);
    },
    export_as_JSON: function() {
        var order               = _super_order.export_as_JSON.call(this);
        order.has_cashback      = this.has_cashback;
        order.cashback_amount   = this.get_cashback_amount();
        // order.amount_total      = order.amount_total + order.cashback_amount;
        // order.amount_paid       = order.amount_paid + order.cashback_amount;
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

        // if user give a discount then not set the cashback
        if( this.get_total_discount() > 0 || this.check_price_change() ) 
            this.has_cashback =false;
        else if( this.cashback )
            if( this.cashback.state == "all" ) this.has_cashback = true;

        if( this.has_cashback &&  this.cashback )
        {
            if( amount >= this.cashback.minimal_amount )
            {
                cashback_amount = amount * this.cashback.cashback_pc / 100;
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
        // if user give a discount then not set the cashback
        // if( self.pos.get_order() ) 
        //     if( self.pos.get_order().get_total_discount() > 0 ||  self.pos.get_order().check_price_change() ) 
        //     {
        //         self.disable_cashback();
        //     }else

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

                    // self.render_cashback();
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

                    // self.render_cashback();
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
                        cashback_amount = total_amount * cashback.cashback_pc / 100;
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

});

screens.OrderWidget.include({

    update_summary: function(){
        var order = this.pos.get_order();
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

   

});
