#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then echo "Run as root." >&2; exit 1; fi
DOMAIN="${EMAIL_DOMAIN:-aurens.app}"
MAIL_HOST="mail.${DOMAIN}"

export DEBIAN_FRONTEND=noninteractive
echo "postfix postfix/mailname string ${DOMAIN}" | debconf-set-selections
echo "postfix postfix/main_mailer_type string 'Internet Site'" | debconf-set-selections
apt-get update
apt-get install -y postfix postfix-pcre

cp -a /etc/postfix/main.cf "/etc/postfix/main.cf.backup.$(date +%Y%m%d%H%M%S)"
postconf -e "myhostname = ${MAIL_HOST}"
postconf -e "mydomain = ${DOMAIN}"
postconf -e 'myorigin = $mydomain'
postconf -e 'inet_interfaces = all'
postconf -e 'inet_protocols = ipv4'
postconf -e 'mydestination = localhost'
postconf -e "relay_domains = ${DOMAIN}"
postconf -e 'transport_maps = hash:/etc/postfix/transport'
postconf -e 'smtpd_relay_restrictions = permit_mynetworks,reject_unauth_destination'
postconf -e 'smtpd_recipient_restrictions = permit_mynetworks,reject_unauth_destination'
postconf -e 'disable_vrfy_command = yes'
postconf -e 'smtpd_helo_required = yes'
postconf -e 'message_size_limit = 26214400'
postconf -e 'mailbox_size_limit = 0'
postconf -e 'smtp_tls_security_level = may'

printf '%s smtp:[127.0.0.1]:2525\n' "${DOMAIN}" > /etc/postfix/transport
postmap /etc/postfix/transport
postfix check
systemctl enable --now postfix
systemctl reload postfix

