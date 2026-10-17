#!/bin/sh
# Fetches the two CC0 sword sound packs (OpenGameArt, by StarNinjas) into assets/packs3. Run from the repo root.
set -e
mkdir -p assets/_dl3/oga-swords assets/_dl3/oga-clash assets/packs3/oga-swords assets/packs3/oga-clash
curl -sSL -A 'Mozilla/5.0' -o assets/_dl3/oga-swords/sword.zip https://opengameart.org/sites/default/files/sword_-_starninjas_1.zip
curl -sSL -A 'Mozilla/5.0' -o assets/_dl3/oga-clash/clash.zip https://opengameart.org/sites/default/files/sword_clash_-_starninjas_0.zip
unzip -q -o assets/_dl3/oga-swords/sword.zip -d assets/packs3/oga-swords
unzip -q -o assets/_dl3/oga-clash/clash.zip -d assets/packs3/oga-clash
echo "ok: 20 sword sounds in assets/packs3"
