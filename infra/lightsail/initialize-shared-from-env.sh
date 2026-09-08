#!/bin/sh
set -eu

test "$(id -u)" -eq 0 || {
  echo "run as root" >&2
  exit 2
}

ENV_FILE=${ENV_FILE:-/etc/opensidebar/playground.env}
test -r "$ENV_FILE" || { echo "environment file is missing" >&2; exit 2; }
set -a
# The root-owned file contains simple KEY=value deployment settings.
. "$ENV_FILE"
set +a
exec "$(dirname "$0")/init-shared-database.sh"
