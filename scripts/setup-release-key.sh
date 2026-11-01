#!/usr/bin/env bash
# 配布用の鍵を作り、.env と GitHub の Secrets に入れる。最初に1回だけ手元で実行する。
# 鍵を作り直すと上書きで更新できなくなるので、鍵があれば止める。パスワードは画面に出さない
set -euo pipefail
umask 077

cd "$(dirname "$0")/.."
repo=InoueDaiki/shopping-list
keystore="$HOME/.config/shopping-list/release.jks"
alias=shopping-list

if [[ -e $keystore ]]; then
  echo "$keystore はすでにあります。作り直すと更新できなくなるので止めます" >&2
  exit 1
fi
client_id=$(sed -n 's/^GOOGLE_OAUTH_CLIENT_ID=//p' .env)
if [[ -z $client_id ]]; then
  echo ".env の GOOGLE_OAUTH_CLIENT_ID が空です" >&2
  exit 1
fi

password=$(openssl rand -hex 24)
mkdir -p "$(dirname "$keystore")"
mise exec -- keytool -genkeypair -storetype PKCS12 -keystore "$keystore" -alias "$alias" \
  -keyalg RSA -keysize 4096 -validity 36500 -dname "CN=$alias" \
  -storepass "$password" -keypass "$password" 2>/dev/null

# 前の署名の設定を除いてから足す
grep -v -E '^(ANDROID_KEY|# リリースの APK の署名)' .env > .env.tmp
cat >> .env.tmp <<ENV
# リリースの APK の署名(GitHub の Secrets と同じ鍵)
ANDROID_KEYSTORE_PATH=$keystore
ANDROID_KEYSTORE_PASSWORD=$password
ANDROID_KEY_ALIAS=$alias
ANDROID_KEY_PASSWORD=$password
ENV
mv .env.tmp .env

base64 -i "$keystore" | gh secret set ANDROID_KEYSTORE_BASE64 -R "$repo"
printf %s "$password" | gh secret set ANDROID_KEYSTORE_PASSWORD -R "$repo"
printf %s "$password" | gh secret set ANDROID_KEY_PASSWORD -R "$repo"
printf %s "$alias" | gh secret set ANDROID_KEY_ALIAS -R "$repo"
printf %s "$client_id" | gh secret set GOOGLE_OAUTH_CLIENT_ID -R "$repo"

echo
echo "鍵: $keystore"
echo "Google Auth Platform の Android クライアントの SHA-1 を次の値に替える:"
mise exec -- keytool -list -v -keystore "$keystore" -alias "$alias" -storepass "$password" 2>/dev/null | sed -n 's/.*SHA1: //p'
