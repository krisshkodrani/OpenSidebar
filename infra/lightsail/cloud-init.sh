#!/bin/sh
set -eu

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  age awscli ca-certificates curl docker.io docker-compose-v2 jq unattended-upgrades
apt-get clean
rm -rf /var/lib/apt/lists/*

systemctl enable --now docker
if id ubuntu >/dev/null 2>&1; then
  usermod -aG docker ubuntu
fi

# Keep container logs bounded on the 60 GB host. This is a fresh OS-only
# instance, so no pre-existing daemon configuration is replaced.
if [ ! -e /etc/docker/daemon.json ]; then
  install -m 0755 -d /etc/docker
  cat >/etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
JSON
  systemctl restart docker
fi

# Emergency survival only. Sustained swap use is an upgrade signal, not normal
# operating capacity.
if ! swapon --show=NAME --noheadings | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 0600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || printf '%s\n' '/swapfile none swap sw 0 0' >>/etc/fstab
fi
cat >/etc/sysctl.d/60-opensidebar-memory.conf <<'EOF'
vm.swappiness=10
vm.vfs_cache_pressure=50
EOF
sysctl --system >/dev/null

cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
systemctl enable --now unattended-upgrades

install -m 0755 -d /opt/opensidebar /var/lib/opensidebar
touch /var/lib/opensidebar/cloud-init-complete
