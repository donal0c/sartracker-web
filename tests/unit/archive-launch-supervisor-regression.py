"""Identity and interruption controls exercised without real process signals."""
import importlib.util
from pathlib import Path
import signal
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).parents[2] / 'scripts' / 'qualification' / 'archive-launch-supervisor.py'
SPEC = importlib.util.spec_from_file_location('archive_launch_supervisor', SOURCE)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ArchiveLaunchIdentityTests(unittest.TestCase):
    """A stale PID, unrelated PID or missing main never permits interruption."""

    def test_bind_rejects_unrelated_process(self):
        with patch.object(MODULE.owner, 'process_table', return_value={10: (1, 100), 20: (10, 200), 30: (1, 300)}), patch.object(MODULE.os, 'getpid', return_value=10):
            with self.assertRaisesRegex(RuntimeError, 'owned'):
                MODULE.bind_main(30)

    def test_bind_requires_a_positive_main_identity(self):
        with self.assertRaises(RuntimeError):
            MODULE.bind_main(0)

    def test_process_table_gap_cannot_claim_no_children(self):
        with patch.object(MODULE.os, 'waitid', return_value=None, create=True):
            self.assertFalse(MODULE.children_exhausted())
        with patch.object(MODULE.os, 'waitid', side_effect=ChildProcessError, create=True):
            self.assertTrue(MODULE.children_exhausted())

    def test_exhaustion_does_not_consume_the_main_wait_status(self):
        with patch.object(MODULE.os, 'waitid', return_value=object(), create=True) as wait, patch.object(MODULE.os, 'waitpid') as reap:
            self.assertFalse(MODULE.children_exhausted())
            reap.assert_not_called()
            self.assertTrue(wait.call_args.args[2] & MODULE.os.WNOWAIT)

    def test_interruption_checks_identity_before_any_signal(self):
        with patch.object(MODULE.owner, 'process_table', return_value={10: (1, 100), 20: (10, 201)}), patch.object(MODULE.os, 'getpid', return_value=10), patch.object(MODULE, 'send_exact_signal') as send:
            with self.assertRaisesRegex(RuntimeError, 'identity'):
                MODULE.interrupt_main((20, 200))
            send.assert_not_called()

    def test_wrapper_is_stopped_before_main_kill_and_then_killed_for_adoption(self):
        table = {10: (1, 100), 20: (10, 200), 30: (20, 300), 99: (1, 990)}
        with patch.object(MODULE.owner, 'process_table', return_value=table), patch.object(MODULE.os, 'getpid', return_value=10), patch.object(MODULE, 'send_exact_signal') as send, patch.object(MODULE, 'wait_stopped'):
            MODULE.interrupt_main((30, 300))
        self.assertEqual(send.call_args_list, [
            unittest.mock.call(20, 200, signal.SIGSTOP),
            unittest.mock.call(30, 300, signal.SIGKILL),
            unittest.mock.call(20, 200, signal.SIGKILL),
        ])


if __name__ == '__main__':
    unittest.main()
