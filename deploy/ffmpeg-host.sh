#!/bin/sh

exec /host/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2 \
  --library-path /host/usr/lib/x86_64-linux-gnu:/host/usr/lib/x86_64-linux-gnu/blas:/host/usr/lib/x86_64-linux-gnu/lapack:/host/usr/lib/x86_64-linux-gnu/vdpau:/host/usr/lib/x86_64-linux-gnu/vpl:/host/lib/x86_64-linux-gnu \
  /host/usr/bin/ffmpeg "$@"
