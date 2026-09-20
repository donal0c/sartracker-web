#!/usr/bin/env python3
"""Direct Linux regression tests for supervisor PID ownership boundaries."""

import importlib.util
import os
import signal
import unittest
from pathlib import Path
from unittest.mock import patch


SUPERVISOR_PATH = Path(__file__).parents[2] / "scripts" / "qualification" / "owned-process-supervisor.py"
SPEC = importlib.util.spec_from_file_location("owned_process_supervisor", SUPERVISOR_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load owned process supervisor module")
SUPERVISOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SUPERVISOR)


class SupervisorOwnershipRegression(unittest.TestCase):
    """Keep unrelated process-table rows outside the owned PID set."""

    def test_unrelated_pid_is_never_inserted_or_signalled(self) -> None:
        unrelated_pid = os.getpid() + 100_000
        table = {unrelated_pid: (os.getpid() + 1, 12345)}
        known = {}
        conflicts = set()
        signals = []

        with patch.object(SUPERVISOR, "process_table", return_value=table), patch.object(
            SUPERVISOR, "signal_identity", side_effect=lambda *args: signals.append(args)
        ):
            SUPERVISOR.terminate_owned(unrelated_pid, known, conflicts, signal.SIGTERM)
            SUPERVISOR.cleanup_verified(known, conflicts, unrelated_pid)

        self.assertNotIn(unrelated_pid, known)
        self.assertEqual(signals, [])


if __name__ == "__main__":
    unittest.main()
