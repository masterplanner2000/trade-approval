import unittest

from ibkr_submit_paper import build_bracket_orders


class BracketOrderTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
