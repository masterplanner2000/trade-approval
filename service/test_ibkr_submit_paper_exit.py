import unittest
import contextlib
import io
import json
from unittest.mock import patch
import ibkr_submit_paper_exit

class PaperExitGuards(unittest.TestCase):
    def test_only_valid_sell_exits_are_accepted(self):
        self.assertTrue(ibkr_submit_paper_exit.valid_exit("NVDA", "SELL", 25, 200))
        self.assertFalse(ibkr_submit_paper_exit.valid_exit("NVDA", "BUY", 25, 200))
        self.assertFalse(ibkr_submit_paper_exit.valid_exit("../NVDA", "SELL", 25, 200))
        self.assertFalse(ibkr_submit_paper_exit.valid_exit("NVDA", "SELL", 0, 200))

    def test_cancel_then_submit_is_blocked_before_any_broker_connection(self):
        request = {"symbol": "NVDA", "action": "SELL", "quantity": 5,
                   "limitPrice": 200, "account": "DUR…217", "decisionId": "test",
                   "cancelOrderIds": [1234]}
        output = io.StringIO()
        with patch.object(ibkr_submit_paper_exit.sys, "argv", ["script", json.dumps(request)]), \
             patch.object(ibkr_submit_paper_exit, "ExitSubmit", side_effect=AssertionError("broker contacted")), \
             contextlib.redirect_stdout(output):
            code = ibkr_submit_paper_exit.main()
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(output.getvalue())["error"], "unsafe_cancel_replace_not_supported")

    def test_direct_exit_is_blocked_before_any_broker_connection(self):
        request = {"symbol": "CVX", "action": "SELL", "quantity": 3,
                   "limitPrice": 200, "account": "DUR…217", "decisionId": "test"}
        output = io.StringIO()
        with patch.object(ibkr_submit_paper_exit.sys, "argv", ["script", json.dumps(request)]), \
             patch.object(ibkr_submit_paper_exit, "ExitSubmit", side_effect=AssertionError("broker contacted")), \
             contextlib.redirect_stdout(output):
            code = ibkr_submit_paper_exit.main()
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(output.getvalue())["error"], "protected_exit_lifecycle_not_ready")

if __name__ == "__main__": unittest.main()
