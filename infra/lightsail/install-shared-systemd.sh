#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root: sudo sh infra/lightsail/install-shared-systemd.sh" >&2
  exit 2
fi
test -f /opt/opensidebar/infra/lightsail/compose.shared.yaml || { echo "reviewed release missing at /opt/opensidebar" >&2; exit 2; }
test -f /etc/opensidebar/playground.env || { echo "root-only environment file is missing" >&2; exit 2; }
docker network inspect playscenario_default >/dev/null
chmod 0600 /etc/opensidebar/playground.env
install -m 0644 /opt/opensidebar/infra/lightsail/systemd/opensidebar-shared.service /etc/systemd/system/
install -m 0644 /opt/opensidebar/infra/lightsail/systemd/opensidebar-backup@.service /etc/systemd/system/
install -m 0644 /opt/opensidebar/infra/lightsail/systemd/opensidebar-backup-daily.timer /etc/systemd/system/
install -m 0644 /opt/opensidebar/infra/lightsail/systemd/opensidebar-backup-weekly.timer /etc/systemd/system/
install -m 0644 /opt/opensidebar/infra/lightsail/systemd/opensidebar-cert-renew.service /etc/systemd/system/
install -m 0644 /opt/opensidebar/infra/lightsail/systemd/opensidebar-cert-renew.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable opensidebar-shared.service opensidebar-backup-daily.timer opensidebar-backup-weekly.timer opensidebar-cert-renew.timer
echo "Units enabled but not started. Start opensidebar-shared after database and Nginx preparation."
