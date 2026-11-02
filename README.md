# shopping-list

2人で共有する、軽い買い物リストのモバイルアプリ。バックエンドを持たず、Google スプレッドシートにデータを置く。

設計は [docs/設計メモ.md](docs/設計メモ.md) を参照。

## できること(予定)

- リストを複数持つ(スーパー、コストコ、無印など)
- 品目、カテゴリ、メモ、買ったかを記録する
- リストごとに、よく追加する品目から選んで足す
- 過去の品目か端末の中の推定で、カテゴリを自動で入れる
- 店舗をリストごとに持ち、GPS で近い順に候補に出して、チェックのときに記録する
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
| `mise run e2e` | デモモードのリリース APK をビルドし、動いているエミュレーターで E2E(Maestro)を走らせる。ビルド済みなら `mise run e2e:test` |

E2E はアプリのデータを消すので、エミュレーターでしか動かない。先に `emulator -avd Medium_Phone` などで起動しておき、2台以上動いていれば `ANDROID_SERIAL` で選ぶ。結果は `e2e/output/results` に出る。

## CI(GitHub Actions)

ツールは mise で `mise.toml` と同じ版を入れ、ジョブの中身は上の `mise run` のタスクとそろえてある。リポジトリは公開で、フォークの PR でも動くので、`release.yml` のほかは Secrets を使わない。

| ワークフロー | 動くとき | 内容 |
| --- | --- | --- |
| `ci.yml` | PR と main への push | `mise run lint`、`mise run test` |
| `gen.yml` | PR と main への push | 生成物が古ければ落とす |
| `android.yml` | main への push | `mise run build:android`。開発用の鍵で署名し、成果物は残さず成功だけを見る |
| `e2e.yml` | main への push | x86_64 のデモの APK(`E2E_ABI`)を作り、エミュレーターで `mise run e2e:test` |
| `release.yml` | `v1.2.3` のタグの push、手動の実行 | 署名済みの APK を作り、Actions の artifact に置く(下の「配布」) |

## 配布

ストアは使わず、署名済みの APK を GitHub Actions の artifact からスマートフォンで受け取って入れる。大きさの実測は設計メモの「配布」。

| きっかけ | 版 | 置き場所 |
| --- | --- | --- |
| `v1.2.3` のタグを push | `1.2.3` | Actions の artifact |
| Release のワークフローを手動で実行 | `0.0.0-dev.<実行番号>` | Actions の artifact |
| 手元の `mise run build:android` | `0.1.0` | `apps/mobile/android/app/build/outputs/apk/release/app-release.apk` |

`versionCode` は Release のワークフローの実行番号を使う。ワークフローのファイル名を変えると番号が振り直されるので変えない。手元のビルドの `versionCode` は 1 なので、Actions の版の上には入らない。

APK は実行ごとに、zip せず `shopping-list-<版>-arm64.apk` として置く。保持は 90 日で、過ぎると消える。リポジトリが公開なので、GitHub にログインしている人なら取得できる。APK にはクライアント ID が入るが、秘密の値は入らない。

スマートフォンでは次の手順で受け取る。

1. ブラウザで GitHub にログインする
2. リポジトリの Actions から Release のワークフローを開き、成功した実行を選ぶ
3. ページの Artifacts にある APK を押してダウンロードし、開いてインストールする(初回は、ブラウザに提供元不明のアプリの許可が要る)

### 配布用の鍵を作る

最初に1回だけ手元で実行する。

```sh
scripts/setup-release-key.sh
```

鍵を `~/.config/shopping-list/release.jks` に作り、`.env` と GitHub の Secrets に入れる。最後に SHA-1 を表示する。鍵があれば止まる。

| Secret | 内容 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | 鍵のファイルを base64 にしたもの |
| `ANDROID_KEYSTORE_PASSWORD` | 鍵のファイルのパスワード |
| `ANDROID_KEY_ALIAS` | 鍵の別名 |
| `ANDROID_KEY_PASSWORD` | 鍵のパスワード |
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth クライアントの ID |

`.env` の同じ名前の値で、手元のビルドも同じ鍵で署名する。

### 鍵の保管

- **失くすと更新できない。** 別の鍵で署名した APK は上書きで入らず、アンインストールすると端末の中の送信待ちも消える。SHA-1 も変わるので、OAuth クライアントも直すことになる。
- Secrets の値は読み出せない。鍵のファイルと `.env` のパスワードをパスワードマネージャーにも保管する。
- リポジトリとチャットに置かない。

### SHA-1 の確認と OAuth クライアントへの登録

Android の OAuth クライアントには、配布用の鍵の SHA-1 を入れる。開発用の鍵でビルドしたアプリも試すなら、クライアントを別に作り、ビルドする方の ID を `.env` の `GOOGLE_OAUTH_CLIENT_ID` に書く。

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
