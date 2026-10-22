#!/bin/sh
set -eu
. "$(dirname -- "$0")/common.sh"
[ -n "${BACKUP_S3_BUCKET:-}" ] || fail 'Set BACKUP_S3_BUCKET.'
export AWS_PAGER='' AWS_EC2_METADATA_DISABLED=true
# AWS CLI stderr can include endpoint credentials. Report only the failed operation.
put() {
  aws s3 cp "$1" "$2" --only-show-errors >/dev/null 2>&1 || fail 'S3 upload failed; local backup retained. Check endpoint, credentials and bucket permissions.'
}
upload() (
  lock
  backup_names | while IFS= read -r name; do
    target="s3://$BACKUP_S3_BUCKET/${BACKUP_S3_PREFIX:+${BACKUP_S3_PREFIX%/}/}$name"
    destination=$(printf '%s\n%s\n' "${AWS_ENDPOINT_URL:-}" "$target" | sha256sum)
    if [ -f "$BACKUP_DIR/$name.uploaded" ] && [ "$(cat "$BACKUP_DIR/$name.uploaded")" = "$destination" ]; then continue; fi
    expected=$(cat "$BACKUP_DIR/$name.sha256")
    actual=$(cd "$BACKUP_DIR" && sha256sum "$name")
    [ "$actual" = "$expected" ] || fail 'Checksum mismatch before upload.'
    put "$BACKUP_DIR/$name" "$target"
    # Remote consumers also treat the checksum as the completion marker.
    put "$BACKUP_DIR/$name.sha256" "$target.sha256"
    printf '%s\n' "$destination" > "$BACKUP_DIR/$name.uploaded"
    echo "Uploaded: $name"
  done
)
case "${1:-once}" in
  once) upload ;;
  watch)
    while :; do
      # A scheduled/manual dump may hold the lock. Retry pending uploads in a minute.
      if ! upload; then echo 'S3 upload deferred; retrying in 60 seconds.' >&2; fi
      sleep 60 & wait $!
    done
    ;;
  *) fail 'Usage: upload.sh [once|watch]' ;;
esac
