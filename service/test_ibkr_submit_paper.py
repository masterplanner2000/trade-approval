import unittest

from ibkr_submit_paper import PaperSubmit, build_bracket_orders


class BracketOrderTests(unittest.TestCase):
    def test_outside_hours_notice_is_warning_not_error(self):
        app = PaperSubmit()
        app.error(12, 399, "Order Message: Warning: Your order will not be placed at the exchange until tomorrow.")

        self.assertEqual(app.errors, [])
        self.assertEqual(app.warnings[0]["code"], 399)

    def test_builds_buy_with_two_automatic_sell_exits(self):
        parent, target, stop = build_bracket_orders(
            parent_order_id=100,
            account="DU123456",
            quantity=4,
            limit_price=100.0,
            target_price=104.0,
            stop_price=98.0,
            decision_id="decision-1234567890",
        )

        self.assertEqual((parent.orderId, target.orderId, stop.orderId), (100, 101, 102))
        self.assertEqual(parent.action, "BUY")
        self.assertEqual(parent.orderType, "LMT")
        self.assertEqual(parent.tif, "DAY")
        self.assertFalse(parent.transmit)

        self.assertEqual(target.action, "SELL")
        self.assertEqual(target.orderType, "LMT")
        self.assertEqual(target.parentId, parent.orderId)
        self.assertEqual(target.tif, "GTC")
        self.assertFalse(target.transmit)

        self.assertEqual(stop.action, "SELL")
        self.assertEqual(stop.orderType, "STP")
        self.assertEqual(stop.parentId, parent.orderId)
        self.assertEqual(stop.tif, "GTC")
        self.assertTrue(stop.transmit)

        self.assertEqual(str(parent.totalQuantity), "4")
        self.assertEqual(str(target.totalQuantity), "4")
        self.assertEqual(str(stop.totalQuantity), "4")
        self.assertEqual(parent.lmtPrice, 100.0)
        self.assertEqual(target.lmtPrice, 104.0)
        self.assertEqual(stop.auxPrice, 98.0)

        for order in (parent, target, stop):
            self.assertFalse(order.eTradeOnly)
            self.assertFalse(order.firmQuoteOnly)


if __name__ == "__main__":
    unittest.main()
