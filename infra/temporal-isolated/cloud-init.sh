#!/bin/sh
set -eu
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends age ca-certificates docker.io docker-compose-v2 jq snapd unattended-upgrades
apt-get clean
if ! command -v aws >/dev/null 2>&1; then
  snap install aws-cli --classic
fi
systemctl enable --now docker
if ! swapon --show=NAME --noheadings | grep -q .; then
  fallocate -l 1G /swapfile
  chmod 0600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || printf '%s\n' '/swapfile none swap sw 0 0' >>/etc/fstab
fi
cat >/etc/sysctl.d/60-opensidebar-temporal-memory.conf <<'EOF'
vm.swappiness=10
vm.vfs_cache_pressure=75
EOF
sysctl --system >/dev/null
install -m 0700 -d /opt/opensidebar-temporal /etc/opensidebar-temporal /var/lib/opensidebar-temporal
touch /var/lib/opensidebar-temporal/cloud-init-complete
