#!/bin/sh
# Called under the directory lock, after a successful backup.
set -eu
. "$(dirname -- "$0")/common.sh"
keep=${BACKUP_KEEP_LAST:-7}
days=${BACKUP_KEEP_DAYS:-30}
printf '%s:%s\n' "$keep" "$days" | grep -Eq '^[1-9][0-9]*:(0|[1-9][0-9]*)$' || fail 'Retention must use decimal integers: keepLast >= 1, keepDays >= 0.'
if [ "$keep" -gt 100000 ] || [ "$days" -gt 36500 ]; then fail 'Retention values are out of range.'; fi
# An explicit cutoff makes the selection deterministic in the rotation test.
cutoff=${BACKUP_CUTOFF:-$(date -u -d "@$(( $(date -u +%s) - days * 86400 ))" +%Y%m%dT%H%M%SZ)}
backup_names | {
  index=0
  while IFS= read -r name; do
    index=$((index + 1))
    timestamp=${name#bestbudget-}
    timestamp=${timestamp%%Z*}Z
    if [ "$index" -gt "$keep" ] && awk -v stamp="$timestamp" -v cutoff="$cutoff" 'BEGIN { exit !(stamp < cutoff) }'; then
      rm -- "$BACKUP_DIR/$name.sha256" "$BACKUP_DIR/$name"
      # Upload receipts are local state, never arbitrary wildcard deletions.
      rm -f -- "$BACKUP_DIR/$name.uploaded"
      echo "Removed: $name"
    fi
  done
}
