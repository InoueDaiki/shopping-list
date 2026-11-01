# @shopping-list/ui-native

モバイル版(`apps/mobile`)の UI 部品。[Uniwind](https://docs.uniwind.dev/) で Tailwind のクラスを書く。色などの値は [design-tokens](../design-tokens/README.md) から来る。

## 見た目の方向

明るくかわいい買い物メモ。2人が店の中で、片手でスマートフォンを持って使う。

- **地はやわらかく、色は少しだけ。** 明るい地に白い面を置き、ピンクは主な操作と選んでいる印だけに使う。
- **色の意味を守る。** ピンク(`primary`)は主な操作、緑(`success`)は買った印、赤(`danger`)は削除と誤り、ピーチ(`accent`)は差し色と注意。カテゴリの札(`cat-1`〜`cat-8`)はカテゴリの見分けだけに使う。
- **丸く、やわらかく。** ボタンとチップは `rounded-full`、面は `rounded-lg`、シートとダイアログは `rounded-xl`。影は使わず、地と面の色の差と線で分ける。
- **目立たせるのは1か所。** `primary` のボタンは1画面に1つ。ほかは `secondary` か `ghost` にする。
- **指で押せる大きさにする。** 行とボタンの高さは 44 以上を目安にする(`Button` の `md` は 44、`lg` と入力欄と `Checkbox` は 48)。
- **カードを並べない。** 品目のような同じものの並びは、1枚の面を線で区切る。`Card` はまとまりに意味があるときに使う。
- **書体は OS のもの。** 太さ(`font-medium`、`font-bold`)と大きさで階層を作る。
- **リンクは下線で示す。** 文字の色は変えない(ピンクは主な操作のために取っておく)。

## 画面を書くときの決まり

人も AI もこの決まりで書く。`mise run lint` の `pnpm lint:design`(oxlint。設定は [/.oxlintrc.json](../../.oxlintrc.json))が守れていないものを落とす。

1. **まず部品を使う。** ボタン・入力欄・札・知らせ・カード・画面の題は、下の部品を使う。`Pressable` や `TextInput` に直にクラスを付けない。
2. **見た目は Tailwind のクラスで書く。** CSS のファイルを足さない。`apps/mobile/src/global.css` はテーマを読み込むだけにする。
3. **色はトークンの名前だけを使う。** `bg-surface`、`text-fg-muted`、`border-border` のように書く。一覧は [TOKENS.md](../design-tokens/generated/TOKENS.md)。
   - Tailwind の既定の色(`bg-red-500`、`text-white` など)は消してあり、使うと lint が落とす(`no-unknown-classes`)。
   - `text-[#fff]`、`rounded-[3px]` のような任意の値で色・角丸・書体を決めない(`no-restricted-classes`)。余白や幅の任意の値は使ってよい。
   - `dark:` は書かない。トークンが明暗を切り替える。
   - HEX や `rgb()` などの色を文字列に書かない。`style` で色・線・影を決めない(`design/no-raw-color`、`design/no-style-color`)。値で決まるものだけを `style` に書く。
4. **クラスを変数に入れるときは、名前を `...Class` か `...Classes` で終える。** lint がその中身も検査する。条件で付け外しするときは `cx()` を使う。クラスの文字列は組み立てずに全部書く(Uniwind はソースの文字列から拾うので、`` `bg-${tone}` `` は効かない)。
5. **アイコンは Lucide(`lucide-react-native`)を使う。** 絵文字をアイコンの代わりにしない。
6. **足りない部品は、ここに足す。** 2つ以上の画面で使うものはここに置く。1画面でしか使わないもの(品目の1行など)は、アプリに置いてよい。

## React Native での書き方

- **文字は必ず `Text` に書く。** React Native は文字の色や大きさを親から引き継がない。`Text` は既定で `text-base` と周りの色を付ける。`Text` の中の `Text` は親を引き継ぐ。
  - ボタンや札の中では、文字列をそのまま書いてよい(部品が `Text` に包む)。
- **アイコンは `<Icon icon={Plus} />`。** SVG の色はクラスで決まらないので、色はトークンの名前で渡す(`color="fg-muted"`)。渡さなければ、周り(ボタンや札)の色になる。大きさは px。
- **イベントは React Native の名前。** `onPress`、入力欄は `onChangeText`。
- **読み上げは `accessibility*`。** アイコンだけのボタンには `accessibilityLabel` を付ける。
- **`cx` はぶつかるクラスを後ろのもので上書きする**(tailwind-merge)。部品が既定のクラスを付け、呼び出し側が `className` で変えられるようにするため。
- **安全な領域**(カメラの穴、ナビゲーションのバー)は Uniwind のクラスで避ける(`pb-safe`、`pb-safe-or-4` など)。
- **開け閉めは呼び出し側が持つ。** ダイアログとシートは `open` と `onXxx` のコールバックで動かす。

## 部品

| 部品 | 使う場面 |
| --- | --- |
| `Text`、`wrapText()` | 文字。`wrapText` は、子のうち文字列を `Text` に包む(部品を作るときに使う) |
| `Icon` | Lucide のアイコン。`color` はトークンの名前 |
| `ForegroundProvider`、`useForeground()` | 中の `Text` と `Icon` の色を決める。部品を作るときに使う |
| `useTokenColor()` | トークンの色の値(OS の明暗に合わせる)。クラスを書けないところ(ナビゲーションのヘッダーなど)で使う |
| `cx()` | クラスをつなぐ |
| `Button` | 操作。`variant` は `primary`(画面の主な操作)、`secondary`(既定)、`ghost`、`danger`(削除)、`link`(文字だけ)。`size` は `sm`・`md`・`lg`。`icon` はアイコンだけの丸いボタン |
| `Field` + `Input`・`Textarea`・`Select` | ラベル・説明(`hint`)・誤り(`error`)と入力欄の組。`Select` は `options`・`value`・`onChange`・`placeholder` を取り、押すと一覧を重ねて出す |
| `Checkbox` | ラベル付きのチェックボックス。`onChange` は `checked` を受け取る。`strike` を付けると、チェックしたら取り消し線で薄くする(買った品目) |
| `Chip` | 丸い小さな操作。よく使う品目を押して追加する。絞り込みなら `selected` |
| `Badge` | 短い札。`tone` は `neutral`・`primary`・`accent`・`success`・`danger` と、カテゴリの `cat-1`〜`cat-8`(一覧は `categoryTones`) |
| `Alert` | 画面の中の知らせ(同期の失敗など)。`tone` は `info`・`success`・`warning`・`danger`。`action` にボタン |
| `Card` | 地の上に置く面。`tone="danger"` は削除をまとめる面 |
| `PageHeader` | 画面の題。`actions`(右の操作)、`description` |
| `FullScreenMessage` | 画面全体の真ん中の知らせ(読み込み中、ログインの失敗)。`action` にボタン |
| `ConfirmDialog` | 確定か取りやめかを選ばせるダイアログ。`tone="danger"` は取り返しのつかない操作。確定の文言は動詞で書く(「削除する」) |
| `ActionSheet` | 画面の下に出す操作の一覧。`items` は `label`・`onPress`・`tone`。項目の `onPress` は閉じ終えてから呼ぶ |
| `Sheet` | 画面の下から出す面(メモを読む、カテゴリを直すなど)。`title`・`onClose`・`footer`。中身はスクロールし、キーボードに隠れない |
