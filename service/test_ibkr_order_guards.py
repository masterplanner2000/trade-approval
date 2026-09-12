"""Tests for the final instrument/action guards in both IBKR adapters."""

import unittest

import ibkr_submit_paper
import ibkr_what_if


class IbkrOrderGuardTests(unittest.TestCase):
    def test_scanner_symbols_are_not_limited_to_the_old_three_symbol_pilot(self):
        for symbol in ("QCOM", "MRVL", "BRK.B", "BF-B"):
            self.assertTrue(ibkr_what_if.valid_authorized_buy(symbol, "BUY"))
            self.assertTrue(ibkr_submit_paper.valid_authorized_buy(symbol, "BUY"))

    def test_non_buy_actions_remain_blocked(self):
        for action in ("SELL", "SSHORT", ""):
            self.assertFalse(ibkr_what_if.valid_authorized_buy("QCOM", action))
            self.assertFalse(ibkr_submit_paper.valid_authorized_buy("QCOM", action))

    def test_malformed_symbols_remain_blocked(self):
        for symbol in ("", "../QCOM", "QCOM;SELL", "TOO-LONG-SYMBOL"):
            self.assertFalse(ibkr_what_if.valid_authorized_buy(symbol, "BUY"))
            self.assertFalse(ibkr_submit_paper.valid_authorized_buy(symbol, "BUY"))


if __name__ == "__main__":
    unittest.main()
