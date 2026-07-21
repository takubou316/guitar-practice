# CLAUDE.md

このファイルはClaude Code（claude.ai/code）がこのリポジトリで作業する際のガイドです。

## アプリ概要

自分専用のギターコード練習アプリ（フラッシュカード＋メトロノーム＋記録＋弾ける曲判定）。ビルドステップなし・依存ライブラリなしのvanilla HTML/JS/CSS単一ファイル。

## ローカル起動

`serve.bat`を実行（`python -m http.server 8080`）し、`http://localhost:8080`を開く。または`index.html`を直接ブラウザで開いてもよいが、Web Audio APIがブラウザによってはサーバー経由のオリジンを要求することがある。

## アーキテクチャ

`index.html`（同一内容のコピー: `guitar-practice.html`）に全てが入っている単一ファイル構成:

- **コードデータ**（`ALL_CHORDS`、26種類）: `beginner`/`intermediate`/`advanced`の3段階。各要素は運指(`fingers`)・開放弦(`open`)・ミュート弦(`muted`)・バレー情報(`barre`)を持つ。追加するときは同じ形で拡張する。
- **曲データ**（`SONGS`）: 各曲は`progression`（セクションごとの実際のコード進行の並び、繰り返し込み）だけを持つ。**使用コード一覧は`songChords()`が`progression`から一意に導出**しており、別途「使用コード」フィールドは持たない（進行と使用コード一覧がズレるのを防ぐため）。曲に使うコードは`ALL_CHORDS`に実在するものだけに限定（カポ使用・分数コードは除外）。
- **フレット図SVGレンダラー**: `drawFretV`（縦）と`drawFretH`（横）の2種類。`fretIsHoriz`で切替。
- **メトロノーム**: Web Audio APIで前もってスケジューリングする方式（`sched()`が`nextT`を先読みして`click()`を予約、20msごとにポーリング）。ジッター防止のための標準的なやり方。
- **自由配置レイアウトエディタ**（`le*`系関数）: コード名/フレット図/指使いの3ブロックを、縦画面・横画面それぞれ独立にドラッグ＆リサイズで配置できる。位置は比率(`x,y,w,h`は0〜1の割合)で保存するため画面サイズが変わっても再現できる。z-order（重なり順）もレイアウトデータに含めて保存・復元する。
- **自動スケール**（`computeAutoScale`）: 実際のDOM実寸（`getBoundingClientRect`）と`matchMedia('(orientation:...)')`から表示倍率を逆算する。`window.innerW/H`ではなくDOM実寸を使うのは、CSSレイアウト確定後に発火するResizeObserverと組み合わせてタイミング依存を減らすため。
- **状態**: モジュールレベル変数（`pool`, `deck`, `idx`, `hist`, `bpm`, `beats`, `chordStatus`, `currentProfile`など）。フレームワークなし。
- **永続化はすべてlocalStorage、プロフィール単位**: `guitar-selected-chords[-プロフィール名]`（選択コード）、`guitar-profile-<名前>`（コードごとの習熟度`chordStatus`）、`guitar-custom-layout[-プロフィール名]`（自由配置）、`guitar-streak-<名前>`（連続日数、`{last, count}`）。複数人／複数用途で使い分けられるよう、練習記録一式がプロフィールごとに独立している。
- **finger色マップ**（`FC`）: 指1=緑、2=青、3=茶、4=紫、B(バレー)=アクセントオレンジ。
- **「流れる」タブ**（コードタブとは別画面）: 現在/直前/次の3コードだけを常時保持する固定3タイル(`flow-track`の子要素0,1,2)を、位置は毎フレーム`transform: translate()`で計算し直す方式（DOMのタイルを増減させない）。切替の瞬間（`nextChord`/`prevChord`→`render()`→`syncFlowQueue()`）にタイル内テキストだけ差し替えてアニメーション起点(`flowStartAt`)をリセットするため、位置計算式（`layoutFlow`の`-(1.5+frac)*w`）が数学的に連続になるよう設計してあり、切替の瞬間に見た目がジャンプしない。小節ベース自動切替(`barsPerSwitch>0`)かつメトロノーム再生中のみ流れ、それ以外（手動送りのみ）は静止表示になる。マーカー線(`#flow-marker`)は`sched()`が実際に音を鳴らす拍タイミングで`pulseFlowMarker()`により毎拍光り、その拍でコード切替が起きるかを`sched()`側で先読み(`willSwitch`)して`onBeatUI`に渡すことで、切替の拍だけ大きく光らせて区別している。

## 記録・弾ける曲判定の仕組み

- 「記録」タブで各コードを **未評価→できた(ok)→要練習(ng)→未評価** の3状態でサイクル切り替え（`cycleStatus`）。
- 設定の「できてないコードだけ」プリセットは、**`ng`だけでなく`未評価`も含めて選択する**（`applyPreset('weak')`）。記録タブを一度も触っていなくても「できてないコードだけ」で全コードが選ばれる設計。
- 「曲」タブは、`chordStatus`が全て`ok`の曲を「弾ける」と判定する（`songChordInfo`）。あくまで**進行(`progression`)から導出した使用コード**を見ているので、`SONGS`に新しい曲を足すときは`progression`だけ書けばよい。

## 実装上の注意・過去のバグパターン

- **カスタムレイアウトのインラインstyle残留バグ**: 自由配置(`custom-layout`)を解除する時、`left/top/width/height/zIndex`のインラインstyleを明示的に空文字へ戻さないと、`!important`のない通常CSSより優先され続けてしまい、回転などで通常レイアウトに戻っても崩れたまま残る（`applyLayoutToPane`のコメント参照）。
- **iOSの向き変更タイミング**: `orientationchange`は`resize`より確定が遅れる（400ms以上）ことがあるため、`applyCustomLayouts`とスケール再計算を**50ms/400ms/700msの3段階**で重ねて呼ぶことで、早すぎる/遅すぎるどちらのケースにも対応している。`resize`と`visualViewport`のresizeもフォールバックとして併用。
- **メトロノームの無音化バグ対策**: 画面ロックやアプリ切り替えでタイマーが間引かれ`nextT`が現在時刻より大きく遅れると、負の時刻でAudioParamがエラーになり無音のまま止まる、または溜まった拍が一気に鳴る不具合があった。`nextT`が`ctx.currentTime`より0.5秒以上過去なら現在時刻から再スタートするガードで対処（`sched()`冒頭）。`visibilitychange`でも`AudioContext`の`resume()`と`nextT`再同期を行う。
- **プロフィールキーの命名規則**: 選択コード・記録・カスタムレイアウトはいずれも`ベースキー + '-' + currentProfile`という同じ命名規則でlocalStorageに保存されている。新しい「プロフィール単位で持たせたい設定」を追加するときはこのパターンを踏襲する。

## 自動コミットHook（takutolibraryルートに移設済み）

以前はこのリポジトリの`.claude/settings.json`にWrite/Edit後の自動コミットHookを個別に設定していたが、**takutolibraryをcwdにして作業するセッションではこのフォルダ単体のHooksが読み込まれず発動しない**ことが判明したため、同等のHookをルート(`takutolibrary/.claude/settings.json`・`takutolibrary/.claude/hooks/auto-commit.ps1`)に統合した。このリポジトリ内の`.claude/settings.json`のHook設定自体は残っているが、ルート起点で作業する場合は使われない（guitar-practiceフォルダ単体をcwdにした場合のみ有効）。
