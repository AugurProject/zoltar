#!/bin/sh
set -eu

for app in zoltar statoblast trading; do
    echo "$app build CID: $(cat "/ipfs_hash_${app}.txt")"
done

exec /bin/sh /publish.sh
