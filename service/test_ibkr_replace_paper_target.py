import unittest
from decimal import Decimal
from types import SimpleNamespace

import ibkr_replace_paper_target


class TargetReplacementAcknowledgementTests(unittest.TestCase):
    def order(self, price):
        return SimpleNamespace(
            permId=123,
            clientId=74,
            lmtPrice=price,
        )

    def test_old_submitted_callback_does_not_acknowledge_replacement(self):
        app = ibkr_replace_paper_target.TargetReplace()
        app.expected_order_id = 29
        app.expected_limit_price = Decimal("274.45")
        contract = SimpleNamespace()

        app.openOrder(29, contract, self.order(295.78), SimpleNamespace(status="Submitted"))

        self.assertFalse(app.ack.is_set())
        self.assertIsNone(app.result)

    def test_exact_replacement_price_is_required_for_acknowledgement(self):
        app = ibkr_replace_paper_target.TargetReplace()
        app.expected_order_id = 29
        app.expected_limit_price = Decimal("274.45")
        contract = SimpleNamespace()

        app.openOrder(29, contract, self.order(274.45), SimpleNamespace(status="Submitted"))

        self.assertTrue(app.ack.is_set())
        self.assertEqual(app.result["limitPrice"], 274.45)

    def test_status_without_exact_terms_does_not_acknowledge(self):
        app = ibkr_replace_paper_target.TargetReplace()
        app.expected_order_id = 29
        app.expected_limit_price = Decimal("274.45")

        app.orderStatus(29, "Submitted", 0, 3, 0, 123, 0, 0, 74, "", 0)

        self.assertFalse(app.ack.is_set())


if __name__ == "__main__":
    unittest.main()
