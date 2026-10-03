# codingway-claude-mods

Claude Code の mod 集です。
このリポジトリ自体が plugin marketplace になっています。

## mod 一覧

| mod | 内容 |
| --- | --- |
| [usage-band](plugins/usage-band/README.md) | プロンプト入力欄の上に、コンテキストと 5 時間制限・週間制限の使用率を表示する |
| [ui-sampler](plugins/ui-sampler/README.md) | mod が描ける場所、呼べる API、受け取れる値を一通り試す見本。表示はすべて出どころの名前付き |

## インストール

Claude Code のプロンプトで、次の 3 つを順に実行します。

```text
/plugin marketplace add natsume-777/claude-mods
/plugin install usage-band@codingway-claude-mods
/reload-plugins
```

mod には、mod に対応した Claude Code が必要です。
各 mod の README に、動作を確認したバージョンを書いています。

## 注意

mod は Claude Code と同じ権限で、サンドボックスなしに手元のマシンで動きます。
インストールする前に、`plugins/` 以下のコードに目を通してください。

## ライセンス

[MIT](LICENSE)
