#!/bin/sh
dir="${XDG_RUNTIME_DIR:-/tmp/tokenfall-$(id -u)}/tokenfall"
[ -d "$dir" ] || exit 0
payload=$(cat)

for socket in "$dir"/*.sock; do
  [ -S "$socket" ] || continue
  printf '%s' "$payload" | curl --silent --max-time 1 --unix-socket "$socket" \
    -H 'content-type: application/json' -H "x-herdr-pane: ${HERDR_PANE_ID:-}" \
    --data-binary @- http://tokenfall/hook >/dev/null 2>&1 || true
done

exit 0
