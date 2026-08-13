# HANDOFF.md（guitar-practice）

- **最終更新日時**: 2026-08-13（Claude追記）
- **変更主体**: Claude（タスク整理／マイク判定機能のバグ修正）

## 追記: マイク判定機能のバグ修正（2026-08-13、Claude単独作業・Codexへの委譲なし）

以下のP1タスクとは別に、同日中にClaudeが`code-review`スキル＋Codex CLI(読み取り専用レビュー)を
使って`index.html`のマイク判定機能・`mic-chord-match.js`・`mic-debug.html`を精査し、
初期化/停止処理の堅牢化(P2項目)を含む複数のバグを直接修正・push済み。詳細は
`作業日記\01 ギター練習ツール\プラン\2026-08-06_マイク自動判定機能_再設計ロードマップ.md`の10節、
および`アイデアまとめ\01 ギター練習ツール\ロードマップ.md`の該当P2項目を参照。
実機(iPhone)での最終確認は未実施。

このファイルは長期の設計方針（`CLAUDE.md`）ではなく、今どこまで進んでいて次に何をするかの短期メモ。ClaudeとCodexの併用運用の一環（詳細はルート`CLAUDE.md`の「Claude/Codexの併用について」、`Obsidian Vault\メモ\Claude-Codex併用ルール.md`を参照）。**このリポジトリには`AGENTS.md`もあるので先に読んでください。**

## 現在の目的

2026-08-11のレビューで見つかったP1（優先度高）バグ2件を修正する。training-menuでのClaude/Codex併用の試運転に続く、guitar-practiceでの初めてのタスク依頼。

## 現在の実装状態

プロフィール機能は`index.html`内（単一ファイル構成）に実装済み。`currentProfile`（グローバル変数）と、`guitar-profile-<名前>`（chordStatus）・`guitar-selected-chords-<名前>`（選択コード）・`guitar-custom-layout-<名前>`（自由配置）・`guitar-streak-<名前>`（連続日数）という命名規則のlocalStorageキー、および`guitar-current-profile`（最後に開いていたプロフィール名、次回起動時の自動復元用）で構成されている。

Claudeがコードを確認し、以下2件のバグを実際に再現確認済み（再調査不要）。

## Codexに任せる作業

### バグ1: プロフィール削除が不完全（`deleteProfile`, 2113行目付近）

現在の`deleteProfile(name)`は`profileKey(name)`（`guitar-profile-<名前>`のchordStatus）しか削除していない。以下も削除するよう修正する:

- `guitar-selected-chords-<name>`（選択コード。`selectedChordsKey()`関数は現在`currentProfile`グローバル変数依存で名前を受け取らない実装になっているので、削除処理では直接キー名を組み立てるか、関数を引数対応させる）
- `guitar-custom-layout-<name>`（自由配置。同様に`leLayoutKey()`も`currentProfile`依存）
- `guitar-streak-<name>`（連続日数、`streakKey(name)`で取得可能）
- **削除対象が現在アクティブなプロフィール(`currentProfile === name`)だった場合、`localStorage.removeItem(LS_CURRENT)`（`guitar-current-profile`キー）も削除すること。** 現状はここが漏れているため、削除した直後は画面上「👤 —」に見えても、ページを再読み込みすると`init`処理（ファイル末尾、`_last = localStorage.getItem(LS_CURRENT); if(_last) loadProfile(_last);`）が削除済みの名前を再度呼び出し、空のchordStatusで「幽霊プロフィール」が復活してしまう（Claude確認済み・実際にこの流れで再現する）。

### バグ2: プロフィール名がエスケープされずHTML/onclickに埋め込まれている（`buildProfileModal`, 2126行目付近）

```js
list.innerHTML = profiles.map(n=>`
  <div class="profile-item-name..." onclick="loadProfile('${n}')">...${n}</div>
  <span class="profile-del" onclick="deleteProfile('${n}')">削除</span>
`).join('');
```

プロフィール名`n`をエスケープせず`innerHTML`とインラインの`onclick`属性に直接埋め込んでいる。`'`・`"`・`<`・`>`を含む名前（例: `O'Brien`）を付けると、生成されるHTML/JS文字列が壊れて正しく動作しない。

- 修正方針はどちらでもよい: (a) HTML/属性値エスケープ用の関数を追加してから埋め込む、(b) インラインonclickをやめて`data-profile-name`属性＋イベント委譲（addEventListener）に置き換える。後者の方が同種の不具合を将来的にも防げるが、既存コードの書き方（ファイル全体でインラインonclickが多用されている）との一貫性も考慮して判断してよい。判断に迷ったら確認すること。

## 今回やらない作業

- ロードマップの他のP2/P3項目（マイク判定の堅牢化、連続日数の意味の見直し、アクセシビリティ改善など）。今回はP1の2件のみ。
- ロードマップ・アイデアまとめ・Claude側の作業日記の編集。
- Git commit・push。

## 完了条件

- プロフィールを削除すると、記録・選択コード・カスタムレイアウト・連続日数のすべてが削除される。
- 現在アクティブなプロフィールを削除した場合、ページを再読み込みしても削除済みのプロフィールが復活しない（「👤 —」のまま、または未選択状態になる）。
- `'`、`"`、`<`、`>`を含む名前のプロフィールを作成・切り替え・削除しても、正常に動作する（画面が壊れない、コンソールエラーが出ない）。
- 既存の通常のプロフィール名（記号を含まない）での動作に影響がない。

## 確認方法

1. PCプレビューでプロフィールを2つ作り、片方を削除して選択コード・カスタムレイアウト・連続日数がすべて消えていることをlocalStorageで確認する。
2. アクティブなプロフィールを削除し、ページをリロードして削除済みプロフィールが復活しないことを確認する。
3. `O'Brien`のような記号を含む名前でプロフィールを作成し、一覧表示・切り替え・削除が正常に動作することを確認する。

## Codex作業結果（2026-08-13）

- **変更主体**: Codex
- **実装内容**:
  - `deleteProfile`で記録・選択コード・カスタムレイアウト・連続日数のプロフィール別localStorageキーをすべて削除するよう修正。
  - アクティブプロフィール削除時に`guitar-current-profile`も削除し、画面状態（記録・選択コード・カスタムレイアウト）を未選択状態へリセット。
  - プロフィール一覧をDOM APIと`textContent`で構築し、インライン`onclick`へのプロフィール名埋め込みを廃止。特殊文字を含む名前でも切り替え・削除できるイベントリスナーを登録。
- **検証結果**:
  - `index.html`のインラインJavaScript構文チェック: 成功。
  - `git diff --check`: 成功。
  - Nodeの軽量DOM/localStorageスタブによるプロフィール削除・アクティブ削除・特殊文字名のイベント登録テスト: 成功。
- **次にやること**: 今回のP1修正について追加のコード作業はなし。必要に応じてClaude側でPCプレビューの見た目を確認する。
- **未確認事項**: 実ブラウザ上での手動操作（PCプレビュー、ページ再読み込み、コンソール確認）は未実施。

## 未確認事項・既知の問題

- バグ2の修正方針（エスケープ関数 vs data属性+イベント委譲）で迷う場合は実装前に確認すること。
- スマホ実機確認は今回は必須としない（表示ロジックの変更ではなくデータ整合性・堅牢性の修正のため）。ただしプロフィールモーダルの見た目に影響する変更をした場合はClaude側で判断する。

## 参照

- [CLAUDE.md](CLAUDE.md)
- [AGENTS.md](AGENTS.md)
- `index.html`（`deleteProfile`, `buildProfileModal`, `loadProfile`, `selectedChordsKey`, `leLayoutKey`, `streakKey`, ファイル末尾の初期化処理）
- Obsidian Vault/アイデアまとめ/01 ギター練習ツール/ロードマップ.md（「レビューで追加した改善課題（2026-08-11）」のP1 2件）
