#!/bin/sh
set -eu

cadence="${1:-}"
case "$cadence" in
  daily) retention_days="${BACKUP_DAILY_RETENTION_DAYS:-7}" ;;
  weekly) retention_days="${BACKUP_WEEKLY_RETENTION_DAYS:-28}" ;;
  *) echo "usage: prune-backups.sh daily|weekly" >&2; exit 2 ;;
esac
: "${BACKUP_BUCKET:?set BACKUP_BUCKET}"
case "$BACKUP_BUCKET" in *[!a-z0-9.-]*|"") echo "invalid BACKUP_BUCKET" >&2; exit 2 ;; esac

cutoff="$(date -u -d "${retention_days} days ago" +%Y-%m-%dT%H:%M:%SZ)"
prefix="postgres/${cadence}/"
aws s3api list-object-versions --bucket "$BACKUP_BUCKET" --prefix "$prefix" --output json |
  jq -r --arg cutoff "$cutoff" '
    (.Versions[]?, .DeleteMarkers[]?)
    | select(.LastModified < $cutoff)
    | [.Key, .VersionId]
    | @tsv
  ' |
  while IFS="$(printf '\t')" read -r key version_id; do
    case "$key" in
      "${prefix}"opensidebar-*.dump.age)
        aws s3api delete-object --bucket "$BACKUP_BUCKET" --key "$key" --version-id "$version_id" >/dev/null
        ;;
      *) echo "refusing unexpected backup key: $key" >&2; exit 3 ;;
    esac
  done
