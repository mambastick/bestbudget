#!/bin/sh
set -eu
. "$(dirname -- "$0")/common.sh"
# BusyBox crond uses the daemon timezone. UTC avoids DST gaps and duplicates.
export TZ=UTC
schedule=${BACKUP_SCHEDULE:-0 3 * * *}
[ "$(printf '%s\n' "$schedule" | wc -l)" -eq 1 ] || fail 'Schedule must be one line.'
# Only five-field numeric cron syntax; disallow shell code in the generated crontab.
printf '%s\n' "$schedule" | grep -Eq '^([0-9*/,-]+[[:blank:]]+){4}[0-9*/,-]+$' || fail 'Use a five-field numeric cron expression.'
printf '%s\n' "$schedule" | awk '
  BEGIN { split("0 0 1 1 0", min); split("59 23 31 12 6", max) }
  {
    for (field = 1; field <= 5; field++) {
      count = split($field, items, ",")
      for (item = 1; item <= count; item++) {
        parts = split(items[item], step, "/")
        if (parts > 2 || (parts == 2 && (step[2] !~ /^[0-9]+$/ || step[2] + 0 < 1))) exit 1
        if (step[1] == "*") continue
        bounds = split(step[1], range, "-")
        if (bounds > 2 || range[1] !~ /^[0-9]+$/ || range[1] < min[field] || range[1] > max[field]) exit 1
        if (bounds == 2 && (range[2] !~ /^[0-9]+$/ || range[2] < range[1] || range[2] > max[field])) exit 1
      }
    }
  }
' || fail 'Cron field is out of range (weekdays: 0-6).'
mkdir -p "$BACKUP_DIR" /run/bestbudget
[ -w "$BACKUP_DIR" ] || fail 'Backup directory is not writable.'
printf '%s sh %s/backup.sh now >> /proc/1/fd/1 2>> /proc/1/fd/2\n' "$schedule" "$SCRIPT_DIR" > /run/bestbudget/root
exec crond -f -l 6 -L /dev/stdout -c /run/bestbudget
