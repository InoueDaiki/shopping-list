# shopping-list

2人で共有する、軽い買い物リストのモバイルアプリ。バックエンドを持たず、Google スプレッドシートにデータを置く。

設計は [docs/設計メモ.md](docs/設計メモ.md) を参照。

## できること(予定)

- リストを複数持つ(スーパー、コストコ、無印など)
- 品目、カテゴリ、メモ、買ったかを記録する
- リストごとに、よく追加する品目から選んで足す
- 過去の品目か端末の中の推定で、カテゴリを自動で入れる
- 店舗を GPS で候補に出し、チェックのときに記録する
- 買い物の履歴から店舗ごとの回る順を学び、カテゴリの並びに反映する。逆回りも自動で見分ける

## 構成

| パス | 内容 |
| --- | --- |
| `apps/mobile` | モバイル版(React Native。Expo の開発ビルドと Expo Router)。`android/` は prebuild で作り、コミットしない |
| `apps/mobile/plugins` | prebuild の結果を変える設定プラグイン(リリースの署名) |
| `packages/core` | リスト、カテゴリの決定、順番の学習、同期(画面を持たない TypeScript) |
| `packages/sheets` | Sheets API の呼び出しとスキーマ、入力規則の定義 |
| `packages/design-tokens` | デザイントークン。Uniwind のテーマと React Native の値を生成し、生成物もコミットする |
| `packages/ui-native` | UI 部品(Uniwind) |

## セットアップ

ホスト(Apple Silicon の Mac)で開発する。

1. [mise](https://mise.jdx.dev)(`brew install mise`)と Android Studio を入れる。Android SDK は Android Studio が `~/Library/Android/sdk` に入れたものを使う。
2. `mise install` で Node、pnpm、Java を入れ、`mise run setup` で依存関係を入れる。
3. `cp .env.example .env` を実行し、下の「Google Cloud の設定」で作ったクライアント ID を `GOOGLE_OAUTH_CLIENT_ID` に書く。
4. `mise run mobile:android` でエミュレーターか実機にビルドして入れる。2回目からは `mise run mobile` で Metro だけを起動する。

### Google Cloud の設定

スプレッドシートを読み書きするために、Google Cloud のプロジェクトに OAuth クライアントを作る。クライアント ID は `.env` にだけ書き、リポジトリに入れない。

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作り、「API とサービス」のライブラリで **Google Sheets API** を有効にする。
2. 「Google Auth Platform」を開く。
   - ブランディング: アプリ名とサポートのメールを入れる。
   - 対象: ユーザーの種類を「外部」にする。公開ステータスは「本番環境」にする(「テスト」だとリフレッシュトークンが7日で切れる)。理由は設計メモの「OAuth のスコープ」。
   - データアクセス: `https://www.googleapis.com/auth/spreadsheets`、`openid`、`email` を足す。
3. 「クライアント」で OAuth クライアントを作る。
   - 種類は Android。パッケージ名は `io.github.inouedaiki.shoppinglist`。
   - SHA-1 は、署名に使う鍵のものを入れる(下の「SHA-1 の確認と OAuth クライアントへの登録」)。
   - 作ったクライアントの詳細設定で、カスタム URI スキームを有効にする。アプリは `io.github.inouedaiki.shoppinglist:/oauth2redirect` で戻る。Android のクライアントでは既定で無効になっている。
4. クライアント ID を `.env` の `GOOGLE_OAUTH_CLIENT_ID` に書く。ID はビルドのときに APK に入るので、変えたらビルドし直す。

ログインのときに未確認アプリの警告が出るので、各自が1回通す。

## よく使うコマンド

| コマンド | 内容 |
| --- | --- |
| `mise run setup` | 依存関係を入れる |
| `mise run gen` | デザイントークンから Uniwind のテーマ、React Native の値、一覧を生成する |
| `mise run lint` | 型検査(各パッケージの `typecheck`)とデザインの規則(oxlint) |
| `mise run test` | テスト(Vitest) |
| `mise run mobile` | Metro を起動する |
| `mise run mobile:android` | 開発ビルドを Android 向けにビルドして入れる |
| `mise run build:android` | 配布用のリリース APK をビルドする(下の「配布」) |

## CI(GitHub Actions)

ツールは mise で `mise.toml` と同じ版を入れ、ジョブの中身は上の `mise run` のタスクとそろえてある。リポジトリは公開で、フォークの PR でも動くので Secrets は使わない。

| ワークフロー | 動くとき | 内容 |
| --- | --- | --- |
| `ci.yml` | PR と main への push | `mise run lint`、`mise run test` |
| `gen.yml` | PR と main への push | 生成物が古ければ落とす |
| `android.yml` | main への push | `mise run build:android`。開発用の鍵で署名し、成果物は残さず成功だけを見る |

## 配布

ストアは使わず、署名したリリースの APK を2台に直接入れる。大きさの実測は設計メモの「配布」。

### ビルドする

```sh
mise run build:android
```

毎回 `android/` を作り直してビルドし、`apps/mobile/android/app/build/outputs/apk/release/app-release.apk` に置く。署名は `.env` で決まる。

| 環境変数 | 内容 |
| --- | --- |
| `ANDROID_KEYSTORE_PATH` | 鍵のファイルの絶対パス。空なら開発用の鍵で署名する |
| `ANDROID_KEYSTORE_PASSWORD` | 鍵のファイルのパスワード |
| `ANDROID_KEY_ALIAS` | 鍵の別名 |
| `ANDROID_KEY_PASSWORD` | 鍵のパスワード |

`ANDROID_KEYSTORE_PATH` があるのに、ほかが足りなければビルドを止める。開発用の鍵はテンプレートに入っている公開の鍵なので、配布には使わない。

配布のたびに `apps/mobile/app.config.ts` の `android.versionCode` を増やし、USB でつないだ端末に `adb install -r` で入れるか、APK を端末に送って開く。

### 配布用の鍵を作る

最初に1回だけ作る。リポジトリの外に置く(`*.jks` と `*.keystore` は `.gitignore` にあるが、公開のリポジトリなので中に置かない)。Android の APK に入る証明書の名前には実名を入れなくてよい。

```sh
mkdir -p ~/.config/shopping-list
mise exec -- keytool -genkeypair -v \
  -storetype PKCS12 \
  -keystore ~/.config/shopping-list/release.jks \
  -alias shopping-list \
  -keyalg RSA -keysize 2048 -validity 36500 \
  -dname "CN=shopping-list"
```

パスワードを聞かれる。PKCS12 では鍵のファイルと鍵のパスワードが同じになるので、`.env` の2つに同じ値を書く。

```sh
ANDROID_KEYSTORE_PATH=/Users/<ユーザー名>/.config/shopping-list/release.jks
ANDROID_KEYSTORE_PASSWORD=<作ったパスワード>
ANDROID_KEY_ALIAS=shopping-list
ANDROID_KEY_PASSWORD=<作ったパスワード>
```

### 鍵の保管

- **失くすと更新できない。** 別の鍵で署名した APK は上書きで入らず、アンインストールすると端末の中の送信待ちも消える。SHA-1 も変わるので、OAuth クライアントも作り直しになる。
- 鍵のファイルとパスワードをパスワードマネージャーに保管し、手元のファイルが消えても戻せるようにする。
- リポジトリ、GitHub の Secrets、チャットに置かない。CI は開発用の鍵でビルドするので、配布用の鍵を渡さない。

### SHA-1 の確認と OAuth クライアントへの登録

Android の OAuth クライアントは、パッケージ名と SHA-1 の組で1つなので、鍵ごとに作る。開発用の鍵のクライアントと配布用の鍵のクライアントを分け、ビルドする方の ID を `.env` の `GOOGLE_OAUTH_CLIENT_ID` に書く。

```sh
# 配布用の鍵
mise exec -- keytool -list -v -keystore ~/.config/shopping-list/release.jks -alias shopping-list | grep SHA1

# 開発用の鍵(prebuild の後にできる。パスワードは android)
mise exec -- keytool -list -v -keystore apps/mobile/android/app/debug.keystore -alias androiddebugkey -storepass android | grep SHA1

# ビルドした APK の署名を確かめる
~/Library/Android/sdk/build-tools/36.0.0/apksigner verify --print-certs apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

出た SHA-1 を、「Google Auth Platform」の「クライアント」で Android クライアントに入れる(コロンの区切りのまま貼れる)。SHA-1 は秘密ではないが、リポジトリには書かない。

## ライセンス

[MIT](LICENSE)
