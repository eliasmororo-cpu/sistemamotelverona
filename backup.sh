#!/bin/sh
# Copia o banco de dados com segurança (pode rodar com o sistema ligado).
# Uso: ./backup.sh /caminho/motel.db /pasta/de/backups
DB="${1:-/data/motel.db}"; DEST="${2:-/data/backups}"
mkdir -p "$DEST"
ARQ="$DEST/motel-$(date +%Y%m%d-%H%M).db"
node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync(process.argv[1]).exec(\"VACUUM INTO '\"+process.argv[2]+\"'\")" "$DB" "$ARQ" 2>/dev/null
# Mantém só os últimos 30 backups
ls -1t "$DEST"/motel-*.db | tail -n +31 | xargs -r rm --
echo "Backup salvo em $ARQ"
