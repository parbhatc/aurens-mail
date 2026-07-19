#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
backup_dir="${BACKUP_DIR:-/var/backups/aurens-mail}"
mkdir -p "${backup_dir}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
docker compose exec -T postgres pg_dump -U aurens_mail -d aurens_mail -Fc > "${backup_dir}/database-${stamp}.dump"
docker run --rm -v aurens-mail_minio_data:/data:ro -v "${backup_dir}:/backup" alpine tar -czf "/backup/objects-${stamp}.tar.gz" -C /data .
find "${backup_dir}" -type f -mtime +14 -delete

