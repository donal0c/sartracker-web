"""Identity and interruption controls exercised without real process signals."""
import importlib.util
from pathlib import Path
import json
import signal
from types import SimpleNamespace
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


class FakeClock:
    """Deterministic monotonic time advanced only by the supervisor's sleeps."""

    def __init__(self):
        self.now = 0.0

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


class FakeWorld:
    """Simulated owned process tree; no real process is created or signalled."""

    def __init__(self, clock):
        self.clock = clock
        self.procs = {}
        self.signals = []
        self.reaped = {}

    def add(self, pid, start, parent=10, on_term='ignore', appear_at=0.0):
        self.procs[pid] = {'start': start, 'parent': parent, 'on_term': on_term,
                           'appear_at': appear_at, 'status': None}

    def visible(self, pid):
        proc = self.procs[pid]
        return self.clock.now >= proc['appear_at'] and proc['status'] is None

    def table(self):
        return {pid: (proc['parent'], proc['start']) for pid, proc in self.procs.items() if self.visible(pid)}

    def exit(self, pid, returncode):
        self.procs[pid]['status'] = returncode

    def signal(self, pid, start, signum):
        self.signals.append((pid, start, signum))
        proc = self.procs.get(pid)
        if proc is None or proc['start'] != start or not self.visible(pid):
            return
        if signum == signal.SIGKILL:
            self.exit(pid, -signal.SIGKILL)
        elif signum == signal.SIGTERM and proc['on_term'] == 'exit':
            self.exit(pid, 0)

    def count(self, pid, signum):
        return sum(1 for sent_pid, _start, sent in self.signals if sent_pid == pid and sent == signum)


class FakeProducer:
    """Popen-shaped producer whose poll() reaps and caches like subprocess."""

    def __init__(self, world, pid):
        self.world = world
        self.pid = pid
        self.returncode = None

    def poll(self):
        if self.returncode is None and self.world.procs[self.pid]['status'] is not None:
            self.returncode = self.world.procs[self.pid]['status']
            self.world.reaped[self.pid] = self.returncode
        return self.returncode


def drive(world, producer_pid=100, commands=(), stop=False, grace_ms=5000, cleanup_ms=10000,
          interrupt=None, waitpid=None):
    """Run the real supervisor loop against the simulated world."""
    clock = world.clock
    events = []
    pending = [json.dumps(command).encode() + b'\n' for command in commands]
    producer = FakeProducer(world, producer_pid)
    args = SimpleNamespace(command=['app'], cwd='.', controller_pid=1, runtime_timeout_ms=10 ** 9,
                           termination_grace_ms=grace_ms, cleanup_timeout_ms=cleanup_ms)

    def install(state):
        state['stop_requested'] = stop

    def exhausted():
        adopted = [pid for pid in world.procs if pid != producer_pid and world.clock.now >= world.procs[pid]['appear_at']]
        return (all(pid in world.reaped for pid in adopted) and producer.returncode is not None)

    def reap(_producer_pid, known):
        for pid in known:
            if pid != producer_pid and world.procs[pid]['status'] is not None:
                world.reaped[pid] = world.procs[pid]['status']
        return True

    with patch.multiple(MODULE.owner, parse_args=lambda: args, install_signal_handlers=install,
                        set_subreaper=lambda: None, require_pidfd_support=lambda: None,
                        set_parent_death_signal=lambda _pid: None,
                        stat_identity=lambda pid: (10, world.procs[pid]['start']),
                        send_protocol=lambda event, **payload: events.append((event, payload)) or True,
                        process_table=world.table, descendants=lambda _root, table: {pid: row[1] for pid, row in table.items()},
                        signal_identity=world.signal, reap_children=reap), \
            patch.object(MODULE, 'time', SimpleNamespace(monotonic=clock.monotonic, sleep=clock.sleep)), \
            patch.object(MODULE, 'select', SimpleNamespace(select=lambda r, _w, _x, _t: (r if pending else [], [], []))), \
            patch.object(MODULE.os, 'read', lambda _fd, _n: pending.pop(0)), \
            patch.object(MODULE.os, 'set_blocking', lambda *_a: None), \
            patch.object(MODULE.os, 'chdir', lambda _path: None), \
            patch.object(MODULE.os, 'waitpid', waitpid or (lambda *_a: (_ for _ in ()).throw(ChildProcessError()))), \
            patch.object(MODULE.subprocess, 'Popen', lambda *_a, **_k: producer), \
            patch.object(MODULE, 'children_exhausted', exhausted), \
            patch.object(MODULE, 'bind_main', lambda pid: (pid, world.procs[pid]['start'])), \
            patch.object(MODULE, 'interrupt_main', interrupt or (lambda main: world.exit(main[0], -signal.SIGKILL))):
        code = MODULE.run()
    complete = [payload for event, payload in events if event == 'complete']
    return code, complete[-1] if complete else None


class ArchiveLaunchStopPhaseTests(unittest.TestCase):
    """Mocked Linux loop logic: one request per identity per phase, not native proof."""

    def test_graceful_stop_sends_one_sigterm_across_the_grace_period_then_one_sigkill(self):
        world = FakeWorld(FakeClock())
        world.add(100, 1000, on_term='ignore')
        code, complete = drive(world, stop=True)
        self.assertEqual(world.count(100, signal.SIGTERM), 1)
        self.assertEqual(world.count(100, signal.SIGKILL), 1)
        self.assertGreaterEqual(world.clock.now, 5.0)
        self.assertTrue(complete['cleanupVerified'])
        self.assertEqual(code, 0)

    def test_early_clean_exit_is_never_escalated(self):
        world = FakeWorld(FakeClock())
        world.add(100, 1000, on_term='exit')
        world.add(200, 2000, parent=100, on_term='exit')
        code, complete = drive(world, stop=True)
        for pid in (100, 200):
            self.assertEqual(world.count(pid, signal.SIGTERM), 1)
            self.assertEqual(world.count(pid, signal.SIGKILL), 0)
        self.assertLess(world.clock.now, 1.0)
        self.assertTrue(complete['cleanupVerified'])
        self.assertEqual(code, 0)

    def test_descendant_arriving_during_grace_gets_one_request_then_escalation(self):
        world = FakeWorld(FakeClock())
        world.add(100, 1000, on_term='ignore')
        world.add(300, 3000, parent=100, on_term='ignore', appear_at=2.0)
        code, complete = drive(world, stop=True)
        for pid in (100, 300):
            self.assertEqual(world.count(pid, signal.SIGTERM), 1)
            self.assertEqual(world.count(pid, signal.SIGKILL), 1)
        self.assertTrue(complete['cleanupVerified'])
        self.assertEqual(code, 0)

    def test_reused_pid_identity_is_never_signalled_and_cleanup_fails_closed(self):
        world = FakeWorld(FakeClock())
        world.add(100, 1000, on_term='exit')
        world.add(200, 2000, parent=100, on_term='ignore')
        original = world.table

        def reused_table():
            table = original()
            if world.clock.now > 0 and 200 in table:
                world.procs[200]['start'] = 2001
                table[200] = (100, 2001)
            return table
        world.table = reused_table
        code, complete = drive(world, stop=True)
        self.assertEqual([entry for entry in world.signals if entry[1] == 2001], [])
        self.assertFalse(complete['cleanupVerified'])
        self.assertEqual(code, 1)

    def test_direct_main_sigkill_status_survives_cleanup_poll_reaping(self):
        # The producer is main; interrupt kills it in the same pass, so the
        # cleanup-branch poll() is the first reap and must retain the status.
        world = FakeWorld(FakeClock())
        world.add(100, 1000, on_term='ignore')
        code, complete = drive(world, commands=[{'command': 'bind', 'pid': 100}, {'command': 'interrupt'}])
        self.assertIsNone(complete['error'])
        self.assertEqual(complete['mainExit'], {'code': None, 'signal': 'SIGKILL'})
        self.assertTrue(complete['cleanupVerified'])
        self.assertEqual(world.count(100, signal.SIGTERM), 0)
        self.assertEqual(code, 0)

    def test_wrapper_main_status_is_read_from_its_exact_wait_status(self):
        world = FakeWorld(FakeClock())
        world.add(100, 1000, on_term='ignore')
        world.add(200, 2000, parent=100, on_term='ignore')
        statuses = {}

        def interrupt(main):
            world.exit(main[0], -signal.SIGKILL)
            statuses[main[0]] = signal.SIGKILL  # raw wait status for a SIGKILL death
            world.exit(100, -signal.SIGKILL)

        def waitpid(pid, _flags):
            if pid in statuses:
                world.reaped[pid] = world.procs[pid]['status']
                return pid, statuses.pop(pid)
            raise ChildProcessError()
        code, complete = drive(world, commands=[{'command': 'bind', 'pid': 200}, {'command': 'interrupt'}],
                               interrupt=interrupt, waitpid=waitpid)
        self.assertIsNone(complete['error'])
        self.assertEqual(complete['mainExit'], {'code': None, 'signal': 'SIGKILL'})
        self.assertEqual(code, 0)

    def test_pid_absence_without_a_wait_status_is_not_sigkill_proof(self):
        world = FakeWorld(FakeClock())
        world.add(100, 1000, on_term='ignore')
        world.add(200, 2000, parent=100, on_term='ignore')

        def interrupt(main):
            # Main vanishes, but no wait status is ever observed for it.
            world.exit(main[0], -signal.SIGKILL)
            world.reaped[main[0]] = None
            world.exit(100, -signal.SIGKILL)
        code, complete = drive(world, commands=[{'command': 'bind', 'pid': 200}, {'command': 'interrupt'}],
                               interrupt=interrupt)
        self.assertIsNone(complete['mainExit'])
        self.assertRegex(complete['error'], 'SIGKILL')
        self.assertEqual(code, 1)


if __name__ == '__main__':
    unittest.main()
