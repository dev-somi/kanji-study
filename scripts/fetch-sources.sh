#!/bin/sh
# 데이터 원본 내려받기 (public/data/*.json 을 다시 만들 때만 필요)
set -e
cd "$(dirname "$0")/.."
mkdir -p data-src/kanjidic data-src/kanjivg data-src/wiki
curl -sSL https://www.edrdg.org/kanjidic/kanjidic2.xml.gz | gunzip > data-src/kanjidic/kanjidic2.xml
curl -sSL -o data-src/kanjivg/kv.zip https://github.com/KanjiVG/kanjivg/releases/download/r20260714/kanjivg-20260714-main.zip
(cd data-src/kanjivg && unzip -oq kv.zip)
curl -sSL -A 'kanji-study-builder' -o data-src/wiki/joyo.json \
  'https://ja.wikipedia.org/w/api.php?action=parse&page=%E5%B8%B8%E7%94%A8%E6%BC%A2%E5%AD%97%E4%B8%80%E8%A6%A7&prop=wikitext&format=json&formatversion=2'
echo "done → npm run build-data"
