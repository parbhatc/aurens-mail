#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then echo "Run as root." >&2; exit 1; fi
NETWORK_NAME="${AURENS_DOCKER_NETWORK:-aurens-mail_default}"
SUBNET="$(docker network inspect "${NETWORK_NAME}" --format '{{(index .IPAM.Config 0).Subnet}}')"
GATEWAY="$(docker network inspect "${NETWORK_NAME}" --format '{{(index .IPAM.Config 0).Gateway}}')"
if [[ -z "${SUBNET}" || -z "${GATEWAY}" ]]; then echo "Unable to resolve the Aurens Docker network." >&2; exit 1; fi

cp -a /etc/postfix/master.cf "/etc/postfix/master.cf.backup.$(date +%Y%m%d%H%M%S)"
sed -i '/# BEGIN AURENS OUTBOUND/,/# END AURENS OUTBOUND/d' /etc/postfix/master.cf
cat >> /etc/postfix/master.cf <<EOF
# BEGIN AURENS OUTBOUND
${GATEWAY}:2587 inet n - y - - smtpd
  -o syslog_name=postfix/aurens-outbound
  -o smtpd_tls_security_level=none
  -o smtpd_sasl_auth_enable=no
  -o mynetworks=${SUBNET}
  -o smtpd_client_restrictions=permit_mynetworks,reject
  -o smtpd_relay_restrictions=permit_mynetworks,reject
  -o smtpd_recipient_restrictions=permit_mynetworks,reject
# END AURENS OUTBOUND
EOF

postconf -e 'smtp_tls_security_level = may'
postconf -e 'smtp_tls_CAfile = /etc/ssl/certs/ca-certificates.crt'
postfix check
systemctl reload postfix

# Docker's host-gateway alias can resolve to docker0 instead of this Compose
# network's gateway. Pin the app to the gateway Postfix is actually bound to.
if [[ -f .env ]]; then
  if grep -q '^OUTBOUND_SMTP_HOST=' .env; then
    sed -i "s|^OUTBOUND_SMTP_HOST=.*|OUTBOUND_SMTP_HOST=${GATEWAY}|" .env
  else
    printf '\nOUTBOUND_SMTP_HOST=%s\n' "${GATEWAY}" >> .env
  fi
fi

# Keep submission private while permitting containers on this network through
# hosts that enforce UFW on bridge traffic.
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
  ufw allow from "${SUBNET}" to "${GATEWAY}" port 2587 proto tcp comment 'Aurens app SMTP submission'
fi

echo "Private outbound submission is listening on ${GATEWAY}:2587 for ${SUBNET}."
echo "OUTBOUND_SMTP_HOST was set to ${GATEWAY}; recreate the app container to apply it."
