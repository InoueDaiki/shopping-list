#!/usr/bin/env bash
# 動いているエミュレーターにデモの APK を入れ、Maestro を走らせる。
# 複数のエミュレーターが動いているときは ANDROID_SERIAL で選ぶ
set -euo pipefail

cd "$(dirname "$0")"
app_id=io.github.inouedaiki.shoppinglist
apk=output/demo.apk
adb="$ANDROID_HOME/platform-tools/adb"

if [[ ! -f $apk ]]; then
  echo "$apk がありません。mise run e2e:build でビルドしてください" >&2
  exit 1
fi

"$adb" start-server
serial=${ANDROID_SERIAL:-}
if [[ -z $serial ]]; then
  devices=$("$adb" devices | awk '$2 == "device" { print $1 }')
  if [[ $(printf '%s\n' "$devices" | grep -c .) -ne 1 ]]; then
    echo "端末を1台に決められません。ANDROID_SERIAL で選んでください: ${devices:-(無し)}" >&2
    exit 1
  fi
  serial=$devices
fi

# テストはアプリのデータを消す。実機の本物のデータを壊さないよう、エミュレーターでしか動かさない
if [[ $("$adb" -s "$serial" shell getprop ro.boot.qemu | tr -d '\r') != 1 ]]; then
  echo "$serial はエミュレーターではありません" >&2
  exit 1
fi

# 署名が違う版が入っていると上書きできない
"$adb" -s "$serial" uninstall "$app_id" >/dev/null 2>&1 || true
"$adb" -s "$serial" install "$apk"

export MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
maestro --device "$serial" test --test-output-dir output/results flows
