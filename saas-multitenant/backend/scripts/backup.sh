#!/bin/sh
# =============================================================================
# backup.sh — Backup do PostgreSQL do LocaCore (pg_dump comprimido + retenção).
# Requer: PGHOST/POSTGRES_* (ou DATABASE_URL) e diretório /backups montado.
# Uso (container backup do compose) ou cron do host:
#   sh backup.sh
# =============================================================================
set -eu

DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$DIR/locacore-$STAMP.sql.gz"

mkdir -p "$DIR"

# Fonte de conexão: DATABASE_URL tem prioridade; senão, POSTGRES_*.
if [ -n "${DATABASE_URL:-}" ]; then
  pg_dump "$DATABASE_URL" | gzip > "$FILE"
else
  export PGPASSWORD="${POSTGRES_PASSWORD:-}"
  pg_dump -h "${PGHOST:-postgres}" -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-locacore}" | gzip > "$FILE"
fi

echo "Backup gerado: $FILE ($(du -h "$FILE" | cut -f1))"

# Retenção: remove backups mais antigos que N dias.
find "$DIR" -name 'locacore-*.sql.gz' -type f -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true

# (Opcional) enviar para object storage externo, se configurado:
#   [ -n "${BACKUP_S3_BUCKET:-}" ] && aws s3 cp "$FILE" "s3://$BACKUP_S3_BUCKET/"
