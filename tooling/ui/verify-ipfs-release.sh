#!/usr/bin/env bash
# Compare files from the publisher image with bytes served by an independent HTTPS gateway.
set -euo pipefail
export_root=${1:?Expected publisher export directory}
gateway=${IPFS_GATEWAY:-https://ipfs.io}
workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT
download="$workdir/response"
curl_args=(--globoff --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --retry 3 --max-time 60)
for app in zoltar statoblast trading openoracle; do
    variable=${app^^}_IPFS_CID
    cid=${!variable}
    [[ "$cid" =~ ^bafy[a-z2-7]+$ ]]
    root="$export_root/$app"
    test -s "$root/index.html"
    # Also request the directory entry point used by the links in the release notes.
    url="${gateway%/}/ipfs/$cid"
    curl "${curl_args[@]}" "$url/" -o "$download"
    cmp "$root/index.html" "$download"
    find "$root" -type f -print0 > "$workdir/files"
    while IFS= read -r -d '' file; do
        relative=${file#"$root"/}
        curl "${curl_args[@]}" "$url/$relative" -o "$download"
        cmp "$file" "$download"
    done < "$workdir/files"
done
