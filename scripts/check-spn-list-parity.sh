#!/usr/bin/env bash
# Cross-language SYSTEM_SPN_PREFIXES parity check (QA-14.5-002).
#
# Story 14.5's system-SPN guard is enforced both client-side
# (src/utils/spn.ts hides system SPNs from the dialog) and server-side
# (src-tauri/src/services/spn.rs filters them out of the LDAP write
# regardless of what the UI sent). Defense in depth fails if the two
# lists drift - a system prefix added to the Rust list but forgotten in
# TS would render the system SPN in the dialog (UX bug); a prefix added
# to TS but forgotten in Rust would let a forged IPC bypass the guard.
#
# The cross-language verbatim-port test suite (19 Rust + 21 TS) catches
# drift after the fact, but only if a developer adds tests for the new
# prefix on both sides. This CI check catches any list divergence
# directly so the developer is forced to keep the lists aligned.
#
# Run locally: `bash scripts/check-spn-list-parity.sh`
# Exit code 0 = parity. Exit code 1 = drift.

set -euo pipefail

cd "$(dirname "$0")/.."

RUST_FILE="src-tauri/src/services/spn.rs"
TS_FILE="src/utils/spn.ts"

# Extract Rust list: between "SYSTEM_SPN_PREFIXES: &[&str] = &[" and the closing "];"
# Each entry is on its own line as `    "name",`
rust_list=$(awk '
  /SYSTEM_SPN_PREFIXES.*=.*\[/ { in_list = 1; next }
  in_list && /^\];/ { exit }
  in_list { print }
' "$RUST_FILE" | grep -oE '"[^"]+"' | tr -d '"' | sort)

# Extract TS list: between "SYSTEM_SPN_PREFIXES: readonly string[] = [" and the closing "];"
ts_list=$(awk '
  /SYSTEM_SPN_PREFIXES.*=.*\[/ { in_list = 1; next }
  in_list && /^\];/ { exit }
  in_list { print }
' "$TS_FILE" | grep -oE '"[^"]+"' | tr -d '"' | sort)

if [[ -z "$rust_list" ]]; then
  echo "FAIL: could not extract SYSTEM_SPN_PREFIXES from $RUST_FILE" >&2
  exit 1
fi
if [[ -z "$ts_list" ]]; then
  echo "FAIL: could not extract SYSTEM_SPN_PREFIXES from $TS_FILE" >&2
  exit 1
fi

if [[ "$rust_list" != "$ts_list" ]]; then
  echo "FAIL: SYSTEM_SPN_PREFIXES drift between Rust and TS:" >&2
  echo "  Rust ($RUST_FILE):" >&2
  echo "$rust_list" | sed 's/^/    /' >&2
  echo "  TS ($TS_FILE):" >&2
  echo "$ts_list" | sed 's/^/    /' >&2
  echo "  Diff (rust > ts):" >&2
  diff <(echo "$rust_list") <(echo "$ts_list") | sed 's/^/    /' >&2 || true
  exit 1
fi

count=$(echo "$rust_list" | wc -l)
echo "OK: SYSTEM_SPN_PREFIXES list matches across Rust + TS ($count prefixes)."
