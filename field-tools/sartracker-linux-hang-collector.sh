#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
COLLECTOR="$SCRIPT_DIR/sartracker-linux-hang-collector.cjs"

if command -v node >/dev/null 2>&1; then
  exec node "$COLLECTOR" "$@"
fi

PID=""
PREVIOUS=""
for ARG in "$@"; do
  if [ "$PREVIOUS" = "--pid" ]; then
    PID="$ARG"
    break
  fi
  PREVIOUS="$ARG"
done

if [ -z "$PID" ]; then
  for PROC in /proc/[0-9]*; do
    [ -r "$PROC/cmdline" ] || continue
    CMD=$(tr '\000' ' ' < "$PROC/cmdline")
    case "$CMD" in
      *sartracker*|*"SAR Tracker"*)
        case "$CMD" in
          *--type=*) ;;
          *) PID=${PROC##*/}; break ;;
        esac
        ;;
    esac
  done
fi

if [ -z "$PID" ] || [ ! -e "/proc/$PID/exe" ]; then
  echo "Could not locate SAR Tracker. Pass --pid <main-pid>." >&2
  exit 1
fi

APP_EXE=$(readlink -f "/proc/$PID/exe")
export ELECTRON_RUN_AS_NODE=1
exec "$APP_EXE" "$COLLECTOR" "$@"
