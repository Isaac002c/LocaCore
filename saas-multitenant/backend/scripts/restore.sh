#!/bin/sh
# =============================================================================
# restore.sh — Restauração de um backup (teste de restore OBRIGATÓRIO §21).
# ATENÇÃO: aplica o dump no banco alvo. Use um banco de HOMOLOGAÇÃO para o teste.
#   sh restore.sh /backups/locacore-YYYYMMDD-HHMMSS.sql.gz
# =============================================================================
set -eu

FILE="${1:?informe o arquivo .sql.gz do backup}"
[ -f "$FILE" ] || { echo "Arquivo não encontrado: $FILE"; exit 1; }

echo "Restaurando $FILE no banco alvo..."
if [ -n "${DATABASE_URL:-}" ]; then
  gunzip -c "$FILE" | psql "$DATABASE_URL"
else
  export PGPASSWORD="${POSTGRES_PASSWORD:-}"
  gunzip -c "$FILE" | psql -h "${PGHOST:-postgres}" -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-locacore}"
fi
echo "Restore concluído. Valide contagem de tabelas/registros e rode os testes de fumaça."
