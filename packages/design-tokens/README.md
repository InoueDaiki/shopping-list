# @shopping-list/design-tokens

モバイル版のデザイントークン(色、角丸)。正は [src/tokens.ts](src/tokens.ts) で、`mise run gen` で `generated/` を作る(生成物は手で編集せずにコミットする)。

| 生成物 | 使う所 |
| --- | --- |
| [generated/theme.native.css](generated/theme.native.css) | Uniwind のテーマ。`apps/mobile/src/global.css` が読み込む |
| [generated/native.ts](generated/native.ts) | JS から色を使うとき(アイコンの色、入力欄の placeholder など)。`@shopping-list/design-tokens/native` |
| [generated/TOKENS.md](generated/TOKENS.md) | トークンの一覧と使う場面。名前を選ぶときに読む |

## 決まり

- **色は役割の名前で持つ。** 「ピンク」ではなく「主な操作(`primary`)」「補足の文字(`fg-muted`)」のように名前を付け、画面ではこの名前だけを使う。
- **明暗の両方の値を持つ。** OS の設定で切り替える。画面で `dark:` は書かない。
- **色は OKLCH で書く。** 明るさをそろえて色相を変えやすいため。React Native は OKLCH を解釈できないので、`native.ts` には HEX に変換して出す。
- **配色は [Catppuccin](https://github.com/catppuccin/palette)(MIT)を下敷きにする。** 明るい配色は Latte、暗い配色は Mocha。色相を保ち、文字とのコントラストのために明るさを調整する。
  - 明るい配色の `primary` は、白い文字(`on-primary`)で AA に届くよう、Latte の pink より暗い。
  - 暗い配色の塗りは淡い色なので、上の文字(`on-*`)は暗い色にする。
- **カテゴリの札は `cat-1` から `cat-8`。** 地(`cat-N`)と文字(`cat-N-fg`)の組で使う。色相で売り場を思い出せるようにし、どのカテゴリにどの組を当てるかはアプリが決める。
- **テストで確かめる**(`src/tokens.test.ts`、`mise run test` で動く)。
  - どの色も sRGB に収まる(収まらないと、端末ごとに見え方がずれる)。
  - 文字と地の組み合わせ(`contrastPairs`)が WCAG 2 の AA のコントラスト比(本文 4.5、線 3)を満たす。組み合わせを足したら `contrastPairs` にも足す。
- **書体は持たない。** OS の書体を使う(設計メモの「軽さのための決まり」)。
- **余白と文字の大きさは Tailwind の既定を使う。**

## トークンを足す・変える

1. `src/tokens.ts` の `colors` に足す(`light`・`dark`・`usage`)。文字に使う色なら `contrastPairs` にも足す。
2. `mise run gen` を実行し、`generated/` をコミットする。
3. `mise run test` で範囲とコントラスト比を確かめる。
