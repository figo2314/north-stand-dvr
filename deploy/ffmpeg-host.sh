#!/bin/sh

library_path="$(
  find /host/usr/lib /host/lib/x86_64-linux-gnu -type f -name '*.so*' -printf '%h\n' 2>/dev/null |
    sort -u |
    tr '\n' ':'
)"

exec /host/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2 \
  --library-path "${library_path}" \
  /host/usr/bin/ffmpeg "$@"
