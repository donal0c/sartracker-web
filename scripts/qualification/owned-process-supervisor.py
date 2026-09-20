#!/usr/bin/env python3
"""Bounded Linux child supervisor for candidate qualification processes.

The supervisor is deliberately small and has one ownership boundary: it is a
Linux child subreaper, so descendants that detach or double-fork are adopted
by this process instead of being reparented to init.  fd 3 is a private,
line-bounded JSON protocol back to the Node controller; it is closed in the
producer child and is never inherited by producer descendants.
"""

from __future__ import annotations

import argparse
import ctypes
import json
import os
import signal
import subprocess
import sys
import time
from typing import Dict, Optional, Tuple


PR_SET_CHILD_SUBREAPER = 36
MAX_PROTOCOL_LINE = 64 * 1024
POLL_INTERVAL_SECONDS = 0.01


class SupervisorFailure(RuntimeError):
    """A failure that prevents a positive ownership proof."""


def send_protocol(event: str, **payload: object) -> bool:
    """Write one bounded JSON protocol line to the private controller fd."""
    message = {"schema": "sartracker-owned-process-v1", "event": event, **payload}
    encoded = (json.dumps(message, separators=(",", ":"), ensure_ascii=True) + "\n").encode("utf-8")
    if len(encoded) > MAX_PROTOCOL_LINE:
        return False
    try:
        written = os.write(3, encoded)
        return written == len(encoded)
    except (BrokenPipeError, OSError):
        return False


def set_subreaper() -> None:
    """Make this process the Linux subreaper for all descendants it starts."""
    libc = ctypes.CDLL(None, use_errno=True)
    result = libc.prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0)
    if result != 0:
        error = ctypes.get_errno()
        raise SupervisorFailure(f"PR_SET_CHILD_SUBREAPER failed: errno {error}")


def stat_identity(pid: int) -> Optional[Tuple[int, int]]:
    """Read ``(parent_pid, start_ticks)`` for a live Linux process."""
    try:
        with open(f"/proc/{pid}/stat", "r", encoding="utf-8") as handle:
            text = handle.read()
        closing = text.rfind(")")
        if closing < 0:
            return None
        fields = text[closing + 2 :].split()
        if len(fields) < 20:
            return None
        parent = int(fields[1])
        start_ticks = int(fields[19])
        return parent, start_ticks
    except (FileNotFoundError, PermissionError, ValueError, OSError):
        return None


def require_pidfd_support() -> None:
    """Require race-free Linux signalling before launching a producer."""
    if not callable(getattr(os, "pidfd_open", None)) or not callable(getattr(signal, "pidfd_send_signal", None)):
        raise SupervisorFailure("Linux pidfd signalling is unavailable; ownership proof is unverified")
    try:
        pidfd = os.pidfd_open(os.getpid())
        try:
            signal.pidfd_send_signal(pidfd, 0)
        finally:
            os.close(pidfd)
    except OSError as error:
        raise SupervisorFailure(f"Linux pidfd signalling is unavailable: errno {error.errno}; ownership proof is unverified") from error


def process_table() -> Dict[int, Tuple[int, int]]:
    """Return a bounded identity table for visible Linux processes."""
    table: Dict[int, Tuple[int, int]] = {}
    try:
        names = os.listdir("/proc")
    except OSError as error:
        raise SupervisorFailure(f"Linux /proc process identity table is unavailable: {error}") from error
    for name in names:
        if not name.isdigit():
            continue
        pid = int(name)
        identity = stat_identity(pid)
        if identity is not None:
            table[pid] = identity
    return table


def descendants(root_pid: int, table: Dict[int, Tuple[int, int]]) -> Dict[int, int]:
    """Return visible descendant PIDs and their start identities."""
    children: Dict[int, list[int]] = {}
    for pid, (parent, _start_ticks) in table.items():
        children.setdefault(parent, []).append(pid)
    owned: Dict[int, int] = {}
    pending = list(children.get(root_pid, []))
    while pending:
        pid = pending.pop()
        if pid in owned:
            continue
        identity = table.get(pid)
        if identity is None:
            continue
        owned[pid] = identity[1]
        pending.extend(children.get(pid, []))
    return owned


def reap_children(producer_pid: int) -> bool:
    """Reap adopted descendants and report whether no waitable children remain."""
    while True:
        try:
            pid, _status = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            return True
        except InterruptedError:
            continue
        if pid == 0:
            return False
        # Popen.poll owns the producer wait status.  It should already have
        # reaped this pid; seeing it here is a supervisor consistency failure.
        if pid == producer_pid:
            return False


def signal_identity(pid: int, expected_start_ticks: int, signum: int) -> None:
    """Signal a process through a pidfd after verifying its start identity."""
    try:
        pidfd = os.pidfd_open(pid)
    except (FileNotFoundError, ProcessLookupError, PermissionError, OSError):
        return
    try:
        identity = stat_identity(pid)
        if identity is None or identity[1] != expected_start_ticks:
            return
        try:
            signal.pidfd_send_signal(pidfd, signum)
        except (ProcessLookupError, PermissionError, OSError):
            return
    finally:
        os.close(pidfd)


def merge_owned(known: Dict[int, int], current: Dict[int, int], conflicts: set[int]) -> None:
    """Merge descendants without replacing a recorded PID identity."""
    for pid, start_ticks in current.items():
        if pid in known and known[pid] != start_ticks:
            conflicts.add(pid)
        elif pid not in known:
            known[pid] = start_ticks


def terminate_owned(producer_pid: int, known: Dict[int, int], conflicts: set[int], signum: int) -> None:
    """Signal the producer and every currently visible owned descendant."""
    table = process_table()
    current = descendants(os.getpid(), table)
    merge_owned(known, current, conflicts)
    producer_identity = table.get(producer_pid)
    if producer_identity is not None and producer_pid not in known:
        known[producer_pid] = producer_identity[1]
    for pid, start_ticks in list(known.items()):
        if pid in conflicts:
            continue
        signal_identity(pid, start_ticks, signum)


def cleanup_verified(known: Dict[int, int], conflicts: set[int], producer_pid: int) -> Tuple[bool, list[int]]:
    """Return whether all owned children disappeared and were reaped."""
    table = process_table()
    current = descendants(os.getpid(), table)
    merge_owned(known, current, conflicts)
    producer_identity = table.get(producer_pid)
    if producer_identity is not None and producer_pid not in known:
        known[producer_pid] = producer_identity[1]
    live = []
    for pid, start_ticks in known.items():
        identity = table.get(pid)
        if identity is not None and identity[1] == start_ticks:
            live.append(pid)
    no_waitable_children = reap_children(producer_pid)
    return len(live) == 0 and no_waitable_children and not conflicts, sorted(live)


def install_signal_handlers(state: dict[str, object]) -> None:
    """Record controller termination without doing unsafe work in a handler."""
    def request(signum: int, _frame: object) -> None:
        state["stop_requested"] = True
        state["stop_signal"] = signal.Signals(signum).name

    signal.signal(signal.SIGTERM, request)
    signal.signal(signal.SIGINT, request)


def parse_args() -> argparse.Namespace:
    """Parse only fixed supervisor bounds and the producer command."""
    argv = sys.argv[1:]
    try:
        separator = argv.index("--")
    except ValueError as error:
        raise SupervisorFailure("owned producer command separator is missing") from error
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument("--cwd", required=True)
    parser.add_argument("--termination-grace-ms", required=True, type=int)
    parser.add_argument("--cleanup-timeout-ms", required=True, type=int)
    result = parser.parse_args(argv[:separator])
    result.command = argv[separator + 1:]
    if not result.command:
        raise SupervisorFailure("owned producer command is missing")
    if result.termination_grace_ms <= 0 or result.cleanup_timeout_ms <= 0:
        raise SupervisorFailure("owned supervisor bounds must be positive")
    return result


def producer_returncode(producer: subprocess.Popen[bytes]) -> Tuple[Optional[int], Optional[str]]:
    """Convert the producer's Popen result into the retained exit shape."""
    code = producer.poll()
    if code is None:
        return None, None
    if code < 0:
        try:
            return None, signal.Signals(-code).name
        except ValueError:
            return None, f"SIG{-code}"
    return code, None


def run() -> int:
    """Run the producer and prove bounded descendant cleanup."""
    args = parse_args()
    state: dict[str, object] = {"stop_requested": False, "stop_signal": None}
    install_signal_handlers(state)
    set_subreaper()
    require_pidfd_support()
    try:
        os.chdir(args.cwd)
    except OSError as error:
        raise SupervisorFailure(f"owned supervisor cwd unavailable: {error}") from error
    if os.getpid() not in process_table():
        raise SupervisorFailure("Linux /proc process identity table is unavailable; ownership proof is unverified")

    producer = subprocess.Popen(
        args.command,
        stdin=sys.stdin.buffer,
        stdout=sys.stdout.buffer,
        stderr=sys.stderr.buffer,
        close_fds=True,
        start_new_session=False,
    )
    producer_pid = producer.pid
    identity = stat_identity(producer_pid)
    if identity is None:
        producer.kill()
        producer.wait()
        raise SupervisorFailure("producer start identity could not be observed")
    if not send_protocol("started", producerPid=producer_pid, producerStartTicks=identity[1]):
        producer.kill()
        producer.wait()
        raise SupervisorFailure("owned supervisor protocol became unavailable")

    known: Dict[int, int] = {producer_pid: identity[1]}
    identity_conflicts: set[int] = set()
    cleanup_started = False
    kill_sent = False
    cleanup_deadline = 0.0
    kill_deadline = 0.0

    while True:
        exit_code, exit_signal = producer_returncode(producer)
        if not cleanup_started and (exit_code is not None or exit_signal is not None or bool(state["stop_requested"])):
            cleanup_started = True
            cleanup_deadline = time.monotonic() + args.cleanup_timeout_ms / 1000
            kill_deadline = time.monotonic() + args.termination_grace_ms / 1000
            terminate_owned(producer_pid, known, identity_conflicts, signal.SIGTERM)
        if cleanup_started:
            table = process_table()
            merge_owned(known, descendants(os.getpid(), table), identity_conflicts)
            if not kill_sent and time.monotonic() >= kill_deadline:
                terminate_owned(producer_pid, known, identity_conflicts, signal.SIGKILL)
                kill_sent = True
            verified, remaining = cleanup_verified(known, identity_conflicts, producer_pid)
            if verified:
                if not send_protocol(
                    "complete",
                    exitCode=exit_code,
                    signal=exit_signal,
                    cleanupVerified=True,
                    remainingPids=[],
                    producerPid=producer_pid,
                    terminationRequested=bool(state["stop_requested"]),
                ):
                    return 125
                return 0 if exit_code == 0 and exit_signal is None else 1
            if time.monotonic() >= cleanup_deadline:
                if not send_protocol(
                    "complete",
                    exitCode=exit_code,
                    signal=exit_signal,
                    cleanupVerified=False,
                    remainingPids=remaining,
                    producerPid=producer_pid,
                    error="owned descendant cleanup exceeded its bounded timeout",
                ):
                    return 125
                return 125
        time.sleep(POLL_INTERVAL_SECONDS)


def main() -> int:
    """Retain protocol-safe errors without printing unbounded diagnostics."""
    try:
        return run()
    except BaseException as error:  # The Node controller must receive a bounded failure.
        message = str(error).replace("\n", " ")[:512]
        send_protocol("error", code="SUPERVISOR_FAILED", message=message)
        return 125


if __name__ == "__main__":
    raise SystemExit(main())
