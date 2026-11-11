#!/bin/sh
set -u

old_pid="$1"
target="$2"
incoming="$3"
stage="$4"
executable="$5"
profile="$6"
token="$7"
lock="$8"
old_executable="$9"
backup="$stage/previous.app"
receipt="$profile/updates/mac-install-status"
new_pid=''
completed=false

finish() {
  if [ "$completed" != true ] && [ -d "$backup" ]; then
    if [ -n "$new_pid" ]; then
      kill "$new_pid" 2>/dev/null || true
      stopped=0
      while kill -0 "$new_pid" 2>/dev/null && [ "$stopped" -lt 10 ]; do
        sleep 1
        stopped=$((stopped + 1))
      done
      kill -9 "$new_pid" 2>/dev/null || true
      wait "$new_pid" 2>/dev/null || true
    fi
    if [ -d "$target" ] && ! mv "$target" "$stage/failed.app"; then
      printf 'recovery-required\n' > "$receipt"
      echo "Failed to move the unsuccessful update out of $target; previous application is at $backup"
      rm -f "$lock"
      exit 1
    fi
    if mv "$backup" "$target"; then
      printf 'rolled-back\n' > "$receipt"
      DOLA_DATA_DIR="$profile" "$target/Contents/MacOS/$old_executable" &
    else
      printf 'recovery-required\n' > "$receipt"
      echo "Failed to restore the previous application at $backup"
      rm -f "$lock"
      exit 1
    fi
  fi
  rm -f "$lock"
  rm -rf "$stage"
}
trap finish EXIT
trap 'exit 1' HUP INT TERM

printf '%s' "$$" > "$lock"
printf '%s' "$token" > "$stage/ready"
echo "Waiting for application $old_pid to quit"
attempt=0
while kill -0 "$old_pid" 2>/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    printf 'quit-timeout\n' > "$receipt"
    exit 1
  fi
  sleep 1
done

printf 'installing\n' > "$receipt"
if ! mv "$target" "$backup"; then
  printf 'replace-failed\n' > "$receipt"
  exit 1
fi
if ! mv "$incoming" "$target"; then exit 1; fi
DOLA_DATA_DIR="$profile" "$target/Contents/MacOS/$executable" "--dola-update-token=$token" &
new_pid=$!

attempt=0
while [ "$attempt" -lt 45 ]; do
  if [ -f "$stage/started" ] && [ "$(cat "$stage/started")" = "$token" ]; then
    printf 'installed\n' > "$receipt"
    completed=true
    echo 'The updated application opened its workspace successfully'
    exit 0
  fi
  if ! kill -0 "$new_pid" 2>/dev/null; then exit 1; fi
  attempt=$((attempt + 1))
  sleep 1
done
echo 'The updated application did not open its workspace in time'
exit 1
