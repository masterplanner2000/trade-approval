import unittest
from decimal import Decimal
from types import SimpleNamespace

import ibkr_restore_paper_target


def row(order_type, status, *, permanent_id, oca_group="pair-1", oca_type=3, price=441.19):
    return {
        "orderId": permanent_id,
        "permanentId": permanent_id,
        "clientId": 74,
        "contract": SimpleNamespace(conId=13497, symbol="VLO"),
        "status": status,
        "order": SimpleNamespace(
            action="SELL", orderType=order_type, totalQuantity=Decimal("2"),
            lmtPrice=price, ocaGroup=oca_group, ocaType=oca_type,
            orderRef=f"trade-approval-test-{'target' if order_type == 'LMT' else 'stop'}",
        ),
    }


class RestoreTargetValidationTests(unittest.TestCase):
    def setUp(self):
        self.request = {"symbol": "VLO", "quantity": Decimal("2"), "limitPrice": Decimal("441.19")}
        self.stop = row("STP", "PreSubmitted", permanent_id=1668550077)
        self.target = row("LMT", "Cancelled", permanent_id=1668550076)

    def test_accepts_exact_cancelled_target_and_surviving_oca_stop(self):
        self.assertTrue(ibkr_restore_paper_target.validate_pair(self.stop, self.target, self.request))

    def test_rejects_mismatched_oca_group(self):
        self.target["order"].ocaGroup = "other"
        self.assertFalse(ibkr_restore_paper_target.validate_pair(self.stop, self.target, self.request))

    def test_rejects_wrong_quantity_or_price(self):
        self.stop["order"].totalQuantity = Decimal("1")
        self.assertFalse(ibkr_restore_paper_target.validate_pair(self.stop, self.target, self.request))
        self.stop["order"].totalQuantity = Decimal("2")
        self.target["order"].lmtPrice = 442.00
        self.assertFalse(ibkr_restore_paper_target.validate_pair(self.stop, self.target, self.request))

    def test_accepts_normalized_completed_client_id_with_exact_strategy_pair(self):
        self.target["clientId"] = 0
        self.assertTrue(ibkr_restore_paper_target.validate_pair(self.stop, self.target, self.request))

    def test_rejects_unpaired_order_reference(self):
        self.target["clientId"] = 0
        self.target["order"].orderRef = "trade-approval-other-target"
        self.assertFalse(ibkr_restore_paper_target.validate_pair(self.stop, self.target, self.request))


if __name__ == "__main__":
    unittest.main()
