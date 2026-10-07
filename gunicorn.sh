#!/data/data/com.termux/files/usr/bin/bash
cd "$(dirname "$0")"
exec gunicorn \
  --bind 127.0.0.1:5000 \
  --workers 2 \
  --threads 4 \
  --timeout 180 \
  --access-logfile - \
  --error-logfile - \
  app:app
