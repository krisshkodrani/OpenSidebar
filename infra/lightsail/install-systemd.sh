#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root: sudo sh infra/lightsail/install-systemd.sh" >&2
  exit 2
fi
if [ ! -f /opt/opensidebar/infra/lightsail/compose.yaml ]; then
  echo "the reviewed release must exist at /opt/opensidebar" >&2
  exit 2
fi
if [ ! -f /etc/opensidebar/playground.env ]; then
  echo "create /etc/opensidebar/playground.env from .env.example first" >&2
  exit 2
fi
chmod 0600 /etc/opensidebar/playground.env
install -m 0644 /opt/opensidebar/infra/lightsail/systemd/*.service /etc/systemd/system/
install -m 0644 /opt/opensidebar/infra/lightsail/systemd/*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable opensidebar-stack.service
systemctl enable opensidebar-backup-daily.timer opensidebar-backup-weekly.timer

echo "Units installed. Inspect 'systemctl cat opensidebar-stack' and run:"
echo "  systemctl start opensidebar-stack"
echo "After the stack and a manual backup pass:"
echo "  systemctl start opensidebar-backup-daily.timer opensidebar-backup-weekly.timer"
echo "The installer deliberately starts neither public traffic nor backup timers."
