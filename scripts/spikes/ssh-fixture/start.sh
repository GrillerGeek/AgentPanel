#!/bin/sh
set -eu
# The only mounted file is an ephemeral public key, never a private credential.
ssh-keygen -A
install -d -m 700 -o agentpanel -g agentpanel /home/agentpanel/.ssh
install -m 600 -o agentpanel -g agentpanel /test-key.pub /home/agentpanel/.ssh/authorized_keys
exec /usr/sbin/sshd -D -e \
  -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no \
  -o PermitRootLogin=no -o AllowUsers=agentpanel
