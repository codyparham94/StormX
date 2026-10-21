#!/usr/bin/env bash
# Uploads every file under DIR to the R2 bucket, keyed by its path under DIR, with a content type
# the data Worker passes on. Needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
set -euo pipefail
dir="${1:?usage: upload-r2.sh DIR}"
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto
endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
cd "$dir"
find . -type f | sed 's#^\./##' | sort | while read -r key; do
  case "$key" in
    *.geojson) type="application/geo+json" ;;
    *.json) type="application/json" ;;
    *.pmtiles) type="application/vnd.pmtiles" ;;
    *.parquet) type="application/vnd.apache.parquet" ;;
    *.csv) type="text/csv" ;;
    *) type="application/octet-stream" ;;
  esac
  aws s3 cp "$key" "s3://${R2_BUCKET}/${key}" --endpoint-url "$endpoint" --content-type "$type" --only-show-errors
  echo "uploaded $key ($(stat -c %s "$key") bytes)"
done
