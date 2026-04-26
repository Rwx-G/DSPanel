#!/usr/bin/env bash
# Audit action-name uniqueness check (QA-14.6-002).
#
# Every audit_service.log_success("X", ...) and audit_service.log_failure("X", ...)
# call site uses a string literal `X` to identify the action in the audit chain.
# SOC consumers tail/grep on these strings to filter Critical-severity events
# (e.g. `DisabledUnconstrainedDelegation` from Story 14.6) so the strings MUST
# be globally unique across `src-tauri/src/commands/`.
#
# This script extracts every action-name literal and fails CI if any appears more
# than once - a future story accidentally copy-pasting `DisabledUnconstrainedDelegation`
# elsewhere would silently break the SOC's ability to identify Critical events.
#
# Run locally: `bash scripts/check-audit-action-names.sh`
# Exit code 0 = all unique. Exit code 1 = duplicate found.

set -euo pipefail

cd "$(dirname "$0")/.."

# Extract the first string-literal argument of every log_success / log_failure call
# in commands/*.rs. Match `state.audit_service.log_success("...` or
# `audit_service.log_failure("...` allowing whitespace and newlines.
#
# Strategy: grep -P with PCRE multiline lookahead is fragile; instead we use
# tr to fold the file into one logical line per call, then a simple sed.
#
# Actually simpler: every log_* call in this codebase fits on a few lines with the
# string literal as the first argument. We grep for the call, then peel off the
# next non-whitespace string-literal token.

declare -a duplicates=()
declare -A seen=()

# Load allowlist (one name per line, # comments stripped)
declare -A allowlist=()
if [[ -f scripts/audit-action-names.allowlist ]]; then
  while IFS= read -r line; do
    line="${line%%#*}"      # strip inline comment
    line="${line//[[:space:]]/}"
    [[ -z "$line" ]] && continue
    allowlist[$line]=1
  done < scripts/audit-action-names.allowlist
fi

# Walk every .rs file under src-tauri/src/commands/, excluding test code.
while IFS= read -r -d '' rs_file; do
  # awk extracts log_success / log_failure call sites. We exclude lines
  # that are inside a `#[cfg(test)]` mod or `mod tests {` block so test
  # assertions like `e.action == "X"` are NOT counted as call sites.
  while IFS= read -r action_name; do
    [[ -z "$action_name" ]] && continue
    if [[ -n "${seen[$action_name]:-}" ]]; then
      # Already-seen name - allowed only if explicitly whitelisted
      if [[ -z "${allowlist[$action_name]:-}" ]]; then
        duplicates+=("$action_name")
      fi
    else
      seen[$action_name]=1
    fi
  done < <(awk '
    # Track entry into a test mod (skip the rest of the file)
    /^[[:space:]]*#\[cfg\(test\)\]/ { in_test = 1 }
    /^[[:space:]]*mod tests / { in_test = 1 }
    in_test { next }

    /\.log_(success|failure)\(/ {
      # Collect tokens forward until we find the first quoted string
      buffer = $0
      while (buffer !~ /"[^"]+"/ && (getline next_line) > 0) {
        buffer = buffer " " next_line
      }
      if (match(buffer, /"[^"]+"/)) {
        print substr(buffer, RSTART + 1, RLENGTH - 2)
      }
    }
  ' "$rs_file")
done < <(find src-tauri/src/commands -name '*.rs' -not -name 'mod.rs' -print0)

if [[ ${#duplicates[@]} -gt 0 ]]; then
  echo "FAIL: unwhitelisted duplicate audit action names found:" >&2
  for dup in "${duplicates[@]}"; do
    echo "  - $dup" >&2
    grep -rn --include='*.rs' "\.log_\(success\|failure\)(\s*\"$dup\"" src-tauri/src/commands/ | sed 's/^/      /' >&2
  done
  echo "" >&2
  echo "If these duplicates are intentional (e.g. single + bulk variants" >&2
  echo "of the same operation), add them to scripts/audit-action-names.allowlist" >&2
  echo "with a comment explaining why." >&2
  exit 1
fi

total=${#seen[@]}
allowed=${#allowlist[@]}
echo "OK: $total unique audit action names across src-tauri/src/commands/ ($allowed allowlisted duplicates)."
