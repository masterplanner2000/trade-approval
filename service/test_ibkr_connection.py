import unittest

from ibkr_connection import paper_connection


class IbkrConnectionTests(unittest.TestCase):
    def test_defaults_to_gateway_paper_port(self):
        connection = paper_connection({})
        self.assertEqual(connection.application, "gateway")
        self.assertEqual(connection.host, "127.0.0.1")
        self.assertEqual(connection.port, 4002)

    def test_tws_fallback_uses_tws_paper_port(self):
        connection = paper_connection({"IBKR_APPLICATION": "tws"})
        self.assertEqual(connection.port, 7497)

    def test_explicit_custom_paper_port_is_supported(self):
        connection = paper_connection({"IBKR_PAPER_PORT": "4102"})
        self.assertEqual(connection.port, 4102)

    def test_remote_hosts_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "localhost"):
            paper_connection({"IBKR_HOST": "100.71.195.42"})

    def test_unknown_application_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "gateway"):
            paper_connection({"IBKR_APPLICATION": "live"})


if __name__ == "__main__":
    unittest.main()
