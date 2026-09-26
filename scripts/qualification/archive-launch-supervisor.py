#!/usr/bin/env python3
"""Interactive Linux ownership boundary for exactly one archive-smoke launch.

fd 3 carries bounded evidence, fd 4 carries controller commands. Neither is
inherited by Electron. The existing qualification supervisor supplies Linux
subreaper, pidfd and process-identity primitives; its producer API is unchanged.
"""
import importlib.util
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import time

SPEC = importlib.util.spec_from_file_location('archive_process_owner', Path(__file__).with_name('owned-process-supervisor.py'))
owner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(owner)


def bind_main(pid):
    """Bind the inspector-reported main to an observed owned start identity."""
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        raise RuntimeError('Archive main process identity is invalid.')
    owned = owner.descendants(os.getpid(), owner.process_table())
    if pid not in owned:
        raise RuntimeError('Archive main process is not owned by this launch.')
    return pid, owned[pid]


def send_exact_signal(pid, start, signum):
    """Signal through a pidfd only after checking the captured start identity."""
    fd = os.pidfd_open(pid)
    try:
        identity = owner.stat_identity(pid)
        if identity is None or identity[1] != start:
            raise RuntimeError('Archive process start identity changed.')
        signal.pidfd_send_signal(fd, signum)
    finally:
        os.close(fd)


def wait_stopped(pid, start):
    """Verify an ancestor stopped before it can reap the interrupted main."""
    deadline = time.monotonic() + 1
    while time.monotonic() < deadline:
        identity = owner.stat_identity(pid)
        if identity is None or identity[1] != start:
            raise RuntimeError('Archive ancestor identity changed while stopping.')
        text = Path(f'/proc/{pid}/stat').read_text()
        if text[text.rfind(')') + 2:].split()[0] in ('T', 't'):
            return
        time.sleep(0.001)
    raise RuntimeError('Archive ancestor stop was not verified.')


def children_exhausted():
    """Require kernel ECHILD, covering forks missed by a procfs snapshot."""
    try:
        os.waitid(os.P_ALL, 0, os.WEXITED | os.WNOHANG | os.WNOWAIT)
        return False
    except ChildProcessError:
        return True


def interrupt_main(main):
    """Preserve the real main wait status even when an AppImage wrapper reaps.

    Stop only its owned ancestors before killing main, then kill those wrappers
    so the subreaper adopts main and reads its exact SIGKILL wait status. No
    process group or executable-name signalling is used.
    """
    table = owner.process_table()
    pid, start = main
    owned = owner.descendants(os.getpid(), table)
    if owned.get(pid) != start:
        raise RuntimeError('Archive main process identity is no longer owned.')
    ancestors = []
    parent = table[pid][0]
    while parent != os.getpid():
        if parent not in owned:
            raise RuntimeError('Archive main ancestor ownership is incomplete.')
        ancestors.append((parent, owned[parent]))
        parent = table[parent][0]
    try:
        for ancestor in reversed(ancestors):
            send_exact_signal(*ancestor, signal.SIGSTOP)
            wait_stopped(*ancestor)
        send_exact_signal(pid, start, signal.SIGKILL)
    finally:
        # A partial interruption must never strand a stopped owned wrapper.
        for ancestor in ancestors:
            send_exact_signal(*ancestor, signal.SIGKILL)


def run():
    """Hold custody until explicit stop or interruption and positive reaping."""
    args = owner.parse_args()
    state = {'stop_requested': False, 'stop_signal': None}
    owner.install_signal_handlers(state)
    owner.set_subreaper()
    owner.require_pidfd_support()
    owner.set_parent_death_signal(args.controller_pid)
    os.chdir(args.cwd)
    os.set_blocking(4, False)
    producer = subprocess.Popen(args.command, stdin=subprocess.DEVNULL,
                                stdout=subprocess.DEVNULL, stderr=sys.stderr.buffer,
                                close_fds=True, preexec_fn=owner.arm_producer_parent_death_signal)
    identity = owner.stat_identity(producer.pid)
    known = {}
    conflicts = set()
    main = None
    main_status = None
    interrupted = False
    failure = None
    buffer = b''
    stopping_at = None
    deadline = time.monotonic() + args.runtime_timeout_ms / 1000
    if identity is None:
        failure = 'Archive launcher identity was not observable.'
        state['stop_requested'] = True
    else:
        known[producer.pid] = identity[1]
        if not owner.send_protocol('started', producerPid=producer.pid, producerStartTicks=identity[1]):
            state['stop_requested'] = True
    while True:
        try:
            code = producer.poll()
            if main is not None and main_status is None:
                if main[0] == producer.pid and code is not None:
                    main_status = {'code': code if code >= 0 else None,
                                   'signal': signal.Signals(-code).name if code < 0 else None}
                elif main[0] != producer.pid:
                    try:
                        pid, status = os.waitpid(main[0], os.WNOHANG)
                        if pid:
                            main_status = {'code': os.WEXITSTATUS(status) if os.WIFEXITED(status) else None,
                                           'signal': signal.Signals(os.WTERMSIG(status)).name if os.WIFSIGNALED(status) else None}
                    except ChildProcessError:
                        pass  # A live wrapper still parents main until interruption.
            if time.monotonic() >= deadline:
                raise RuntimeError('Archive owned launch exceeded its runtime bound.')
            if not state['stop_requested'] and select.select([4], [], [], 0)[0]:
                data = os.read(4, 4096)
                if not data:
                    state['stop_requested'] = True
                buffer += data
                if len(buffer) > 4096:
                    raise RuntimeError('Archive ownership command exceeded its bound.')
                while b'\n' in buffer:
                    line, buffer = buffer.split(b'\n', 1)
                    request = json.loads(line)
                    command = request.get('command')
                    if command == 'bind' and main is None:
                        main = bind_main(request.get('pid'))
                        owner.send_protocol('bound', pid=main[0], startTicks=main[1])
                    elif command == 'interrupt' and main is not None and not interrupted:
                        interrupt_main(main)
                        interrupted = True
                        state['stop_requested'] = True
                    elif command == 'stop':
                        state['stop_requested'] = True
                    else:
                        raise RuntimeError('Archive ownership command is invalid.')
            # A wrapper exit does not end a launch while its descendants live.
            if code is not None and not owner.descendants(os.getpid(), owner.process_table()):
                state['stop_requested'] = True
        except Exception:
            failure = failure or 'Archive owned launch identity or control failed.'
            state['stop_requested'] = True

        if state['stop_requested']:
            if stopping_at is None:
                stopping_at = time.monotonic()
            elapsed = time.monotonic() - stopping_at
            try:
                owner.terminate_owned(producer.pid, known, conflicts,
                                      signal.SIGKILL if interrupted or elapsed >= args.termination_grace_ms / 1000 else signal.SIGTERM)
                # Main status must be read before the generic adopted-child reaper.
                reapable = {pid: start for pid, start in known.items() if main is None or pid != main[0] or main_status is not None}
                owner.reap_children(producer.pid, reapable)
                table = owner.process_table()
                owner.merge_owned(known, owner.descendants(os.getpid(), table), conflicts)
                remaining = sorted(pid for pid, start in known.items() if table.get(pid, (None, None))[1] == start)
                verified = (not remaining and not conflicts
                            and producer.poll() is not None and children_exhausted())
            except Exception:
                verified, remaining = False, []
                failure = failure or 'Archive descendant cleanup could not be verified.'
            if verified or elapsed >= args.cleanup_timeout_ms / 1000:
                if interrupted and (main_status is None or main_status['signal'] != 'SIGKILL'):
                    failure = failure or 'Archive real-main SIGKILL wait status was not verified.'
                owner.send_protocol('complete', cleanupVerified=verified, remainingPids=remaining,
                                    mainIdentity=None if main is None else {'pid': main[0], 'startTicks': main[1]},
                                    mainExit=main_status, interrupted=interrupted, error=failure)
                return 0 if verified and failure is None else 1
        time.sleep(0.01)


if __name__ == '__main__':
    try:
        sys.exit(run())
    except Exception:
        owner.send_protocol('error', message='Archive launch supervisor failed; cleanup is unverified.')
        sys.exit(125)
