#!/usr/bin/env python3
"""Direct Linux regression tests for supervisor PID ownership boundaries."""

import importlib.util
from contextlib import ExitStack
import os
import signal
import unittest
from pathlib import Path
from types import SimpleNamespace
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

    def test_exited_producer_observed_after_deadline_is_timed_out(self) -> None:
        """A sampled zero exit after the deadline must not become on-time proof."""
        events = []
        args = SimpleNamespace(
            cwd="/tmp", runtime_timeout_ms=1000, termination_grace_ms=100,
            cleanup_timeout_ms=1000, controller_pid=os.getppid(), command=["unused"],
        )
        patches = {
            "parse_args": {"return_value": args},
            "install_signal_handlers": {},
            "set_subreaper": {},
            "require_pidfd_support": {},
            "set_parent_death_signal": {},
            "process_table": {"return_value": {os.getpid(): (os.getppid(), 1)}},
            "stat_identity": {"return_value": (os.getpid(), 5)},
            "producer_returncode": {"return_value": (0, None)},
            "terminate_owned": {},
            "cleanup_verified": {"return_value": (True, [])},
            "send_protocol": {"side_effect": lambda event, **values: events.append((event, values)) or True},
        }
        with ExitStack() as stack:
            for name, options in patches.items():
                stack.enter_context(patch.object(SUPERVISOR, name, **options))
            stack.enter_context(patch.object(SUPERVISOR.os, "chdir"))
            stack.enter_context(patch.object(SUPERVISOR.subprocess, "Popen", return_value=SimpleNamespace(pid=888)))
            stack.enter_context(patch.object(SUPERVISOR.time, "monotonic", side_effect=[0, 2, 2, 2, 2, 2]))
            SUPERVISOR.run()
        completion = next(values for event, values in events if event == "complete")
        self.assertTrue(completion["cleanupVerified"])
        self.assertTrue(completion["timedOut"])
        self.assertTrue(completion["deadlineExceeded"])


if __name__ == "__main__":
    unittest.main()
