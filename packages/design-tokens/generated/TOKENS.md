<!-- 生成物。packages/design-tokens/src/tokens.ts から `mise run gen` で作る。手で編集しない -->

# デザイントークン

色は役割の名前で選ぶ。Tailwind のクラスでは `bg-<名前>`、`text-<名前>`、`border-<名前>` のように書く(例: `bg-surface text-fg border-border`)。明暗は OS の設定で自動で切り替わるので、`dark:` は書かない。

## 色

| 名前 | 使う場面 | 明 | 暗 |
| --- | --- | --- | --- |
| `canvas` | 画面の地 | `#eff1f5` | `#1e1e2e` |
| `surface` | 品目の一覧、入力欄、カード、シートなど、地の上に置く面 | `#fdfdff` | `#282839` |
| `surface-muted` | 控えめな塗り(見出しの帯、押している行) | `#e6e9ef` | `#313244` |
| `surface-strong` | 控えめな塗りの上で押したとき | `#d5d9e2` | `#404255` |
| `fg` | 本文の文字 | `#3d405a` | `#d7dff8` |
| `fg-muted` | 補足の文字(件数、入力の説明、買った品目) | `#5c5f75` | `#a9b0cb` |
| `border` | 区切り線、面の枠 | `#dadee6` | `#3d3e51` |
| `border-strong` | 入力欄と、押せる部品の枠 | `#828599` | `#7b7f95` |
| `primary` | 主なボタンの塗り、選んでいる印 | `#be43a2` | `#f1aadc` |
| `primary-pressed` | 主なボタンを押している間の塗り | `#a9358f` | `#e18ec9` |
| `on-primary` | primary の塗りの上の文字 | `#ffffff` | `#2e1a28` |
| `primary-soft` | 主な色の淡い塗り(選んでいるチップ、知らせ) | `#fbe6f4` | `#4d2c44` |
| `primary-fg` | 主な色の文字(primary-soft の上の文字)、選んでいる印の線、フォーカスの枠 | `#8d3077` | `#f5c2e7` |
| `accent` | ピーチの差し色の塗り(新しいものの印、件数の印など、主な操作でないもの) | `#c24e00` | `#fab387` |
| `on-accent` | accent の塗りの上の文字 | `#ffffff` | `#311c0e` |
| `accent-soft` | 差し色の淡い塗り。注意の知らせの地 | `#fee8de` | `#4e301b` |
| `accent-fg` | 差し色の文字。注意の文字 | `#933d08` | `#fec29d` |
| `success` | 買った。チェックの塗り | `#1d802b` | `#92d98e` |
| `on-success` | success の塗りの上の文字とチェックの印 | `#ffffff` | `#162715` |
| `success-soft` | 成功の淡い塗り | `#ddf4dd` | `#273d25` |
| `success-fg` | 成功の文字 | `#1a6323` | `#a8e3a4` |
| `danger` | 削除など取り返しのつかない操作の塗り、入力の誤りの枠 | `#d0183a` | `#f38ba8` |
| `on-danger` | danger の塗りの上の文字 | `#ffffff` | `#2f171d` |
| `danger-soft` | 誤り・失敗の淡い塗り | `#fde7e6` | `#512a35` |
| `danger-fg` | 誤り・失敗の文字 | `#a8112d` | `#fbb8c9` |
| `cat-1` | カテゴリの札の地。赤系(生肉など) | `#fce0e0` | `#502828` |
| `cat-1-fg` | cat-1 の上の文字 | `#822b31` | `#fac5c4` |
| `cat-2` | カテゴリの札の地。ピーチ系(惣菜、パンなど) | `#fee2cf` | `#4d2c15` |
| `cat-2-fg` | cat-2 の上の文字 | `#753b07` | `#f9c9a9` |
| `cat-3` | カテゴリの札の地。クリーム系(乳製品など) | `#f4e8bb` | `#3e3510` |
| `cat-3-fg` | cat-3 の上の文字 | `#5c4c02` | `#e4d498` |
| `cat-4` | カテゴリの札の地。緑系(青果など) | `#d0f3d0` | `#203d21` |
| `cat-4-fg` | cat-4 の上の文字 | `#1c5c23` | `#b4e3b4` |
| `cat-5` | カテゴリの札の地。青緑系(冷凍など) | `#c2f3f2` | `#0c3d3d` |
| `cat-5-fg` | cat-5 の上の文字 | `#055959` | `#9de3e2` |
| `cat-6` | カテゴリの札の地。青系(鮮魚など) | `#d8eafd` | `#1b3753` |
| `cat-6-fg` | cat-6 の上の文字 | `#0e4f86` | `#b7d8fb` |
| `cat-7` | カテゴリの札の地。紫系(飲み物など) | `#ebe3fc` | `#3a2e50` |
| `cat-7-fg` | cat-7 の上の文字 | `#583a84` | `#dacbf9` |
| `cat-8` | カテゴリの札の地。ピンク系(日用品など) | `#fedeec` | `#4c283a` |
| `cat-8-fg` | cat-8 の上の文字 | `#7e2757` | `#f9c2db` |
| `overlay` | ダイアログとシートの後ろに敷く幕 | `#2a2c3d73` | `#05050da6` |

## 角丸

| クラス | 大きさ |
| --- | --- |
| `rounded-sm` | 6px |
| `rounded-md` | 12px |
| `rounded-lg` | 16px |
| `rounded-xl` | 24px |

`rounded-full` も使える。余白と文字の大きさは Tailwind の既定(`p-4`、`text-sm` など)を使う。書体は OS のものを使うので、トークンに無い。
