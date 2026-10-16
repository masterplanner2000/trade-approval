"""Central, environment-driven connection settings for the local IBKR API."""

from __future__ import annotations

import os
from dataclasses import dataclass


DEFAULT_HOST = "127.0.0.1"
PAPER_PORTS = {"gateway": 4002, "tws": 7497}


@dataclass(frozen=True)
class IbkrConnection:
    host: str
    port: int
    application: str


def paper_connection(environ: dict[str, str] | None = None) -> IbkrConnection:
    """Return the paper-only socket target, defaulting to IB Gateway.

    The caller may explicitly select ``gateway`` or ``tws`` with
    ``IBKR_APPLICATION``. ``IBKR_PAPER_PORT`` is available for a deliberately
    configured custom socket port; live-account defaults are never inferred.
    """
    env = os.environ if environ is None else environ
    application = env.get("IBKR_APPLICATION", "gateway").strip().lower()
    if application not in PAPER_PORTS:
        raise ValueError("IBKR_APPLICATION must be 'gateway' or 'tws'")

    host = env.get("IBKR_HOST", DEFAULT_HOST).strip()
    if host not in {"127.0.0.1", "localhost"}:
        raise ValueError("IBKR_HOST must remain localhost")

    raw_port = env.get("IBKR_PAPER_PORT", str(PAPER_PORTS[application])).strip()
    try:
        port = int(raw_port)
    except ValueError as error:
        raise ValueError("IBKR_PAPER_PORT must be an integer") from error
    if not 1 <= port <= 65535:
        raise ValueError("IBKR_PAPER_PORT must be between 1 and 65535")

    return IbkrConnection(host=host, port=port, application=application)
