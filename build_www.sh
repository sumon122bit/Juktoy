#!/data/data/com.termux/files/usr/bin/bash
# APK build এর আগে চালাও: ./build_www.sh
# templates/ + static/ → www/ rebuild করে
set -e
cd "$(dirname "$0")"

echo "🔄 Rebuilding www/..."
rm -rf www/
mkdir -p www
cp templates/index.html www/index.html
cp -r static www/static
echo "✅ www/ rebuilt — APK build ready"
