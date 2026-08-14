FROM erigontech/erigon:v3.5.5

COPY --chmod=755 erigon/docker-entrypoint.sh /usr/local/bin/zoltar-erigon-entrypoint

ENTRYPOINT ["/usr/local/bin/zoltar-erigon-entrypoint"]
CMD ["--help"]
