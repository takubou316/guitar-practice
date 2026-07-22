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
- **状態**: モジュールレベル変数（`pool`, `queue`, `current`, `hist`, `bpm`, `beats`, `chordStatus`, `currentProfile`など）。フレームワークなし。
- **出題順（`queue`）**: 「ランダムだが同じコードが極端に連続/長期間出ない」ようにするため、poolを1周ぶんシャッフルしたものを`queue`にまとめて積む方式（1回ずつ独立に抽選しない）。`ensureQueue(n)`で常に`LOOKAHEAD`(5)手先まで積まれた状態を保証し、`peekChord(n)`（1-indexed、次の1手先から）で先読みする。`nextChord()`は`queue.shift()`、`prevChord()`は`hist`から戻して`queue.unshift()`（▶で完全に元の状態に戻る対称設計）。コードタブの「次のコード」欄も「流れる」タブも同じ`queue`を見るため表示がズレない。
- **永続化はすべてlocalStorage、プロフィール単位**: `guitar-selected-chords[-プロフィール名]`（選択コード）、`guitar-profile-<名前>`（コードごとの習熟度`chordStatus`）、`guitar-custom-layout[-プロフィール名]`（自由配置）、`guitar-streak-<名前>`（連続日数、`{last, count}`）。複数人／複数用途で使い分けられるよう、練習記録一式がプロフィールごとに独立している。
- **finger色マップ**（`FC`）: 指1=緑、2=青、3=茶、4=紫、B(バレー)=アクセントオレンジ。
- **「流れる」タブ**（コードタブとは別画面）: 現在＋この先3つ、常に`FLOW_N`(4)個の固定タイル(`flow-track`の子要素0..3、それぞれ内部に名前とフレット図SVGを持つ)を、位置は毎フレーム`transform: translate()`で計算し直す方式（DOMのタイルを増減させない）。切替の瞬間（`nextChord`/`prevChord`→`render()`→`syncFlowQueue()`）に各タイルの内容（名前＋`drawFret`で描くフレット図）だけ`current`/`peekChord(1..3)`から差し替える。位置計算式（`layoutFlow`の`-(0.5+frac)*w`、各タイルの不透明度も`FLOW_REST_OPACITY`を使って同様に連続的に補間）は切替の瞬間に見た目がジャンプしないよう数学的に連続になるよう設計してある。
  - **アニメーションが動く区間は「もうすぐ切り替わる」ウィンドウ(`flowApproachStart`/`flowApproachDur`)だけ**で、これは既存の`markSoon()`（次コードプレビューを光らせる仕組み）と同じ起点・同じ長さ（`barsPerSwitch===1`なら半小節、それ以外は1小節）を共有している。`barsPerSwitch`全体（最大8小節）を通しで流そうとすると1コードの表示時間が数十秒になり「ほとんど動いて見えない」不具合があったため、常に「1小節ぶんの時間で動く→残りは静止」という一定の体感速度になるよう設計を変えた。`unmarkSoon()`が呼ばれる（＝コードが切り替わった直後）と`flowApproachStart=null`に戻り静止状態になる。
  - 小節ベース自動切替(`barsPerSwitch>0`)かつメトロノーム再生中のみ流れ、それ以外（手動送りのみ）は静止表示になる。マーカー線(`#flow-marker`)は`sched()`が実際に音を鳴らす拍タイミングで`pulseFlowMarker()`により毎拍光り、その拍でコード切替が起きるかを`sched()`側で先読み(`willSwitch`)して`onBeatUI`に渡すことで、切替の拍だけ大きく光らせて区別している。
- **マイクで自動判定→自動でnextChord()**（フッターの🎤ボタン、`toggleMic()`）: メトロノームとは`updateMetroUI()`/`updateMicUI()`が互いのボタンを`disabled`にし合う形で完全排他。判定成功時は既存の`nextChord()`をそのまま呼ぶだけで、`render()`経由でコードタブ・流れるタブ両方に自動反映される（両タブ用に別々の実装は存在しない）。
  - **AnalyserNodeを2つ使い分ける**: `micOnsetAnalyser`（`fftSize=512`、反応の速さ重視）でストラム＝音量急上昇を`setInterval(40ms)`の`micMonitorTick()`で監視し、`micChromaAnalyser`（`fftSize=16384`、周波数分解能重視）でコード一致判定用のFFTを取る。1つのAnalyserで両方を兼ねると「オンセット検出は素早く反応してほしいが、コード判定は半音を分離できる分解能がほしい」という相反する要求を満たせない。**低音弦の半音間隔は数Hz〜十数Hzしかなく、`fftSize=4096`（1bin≒10.8Hz）では半音1つに1〜2binしか割り当たらず隣の音名に漏れる**ことを合成音（`OscillatorNode`）でのテストで実測確認済み。`16384`（1bin≒2.7Hz）に上げて解消した。
  - **コードの期待音名(`chordPitchClasses`)はコードデータから機械的に算出**（新しい正解データを持たない）。バレーコードで、範囲内の弦が別の指で押さえ直されている場合（例: Fコードの3〜5弦）はバレーのフレットではなく押さえ直した方のフレットが実際に鳴る音になるため、`fingers`に個別エントリがある弦はバレー側の計算から除外する必要がある（除外し忘れて誤った音名が混ざるバグを実装時に発見・修正）。
  - **実機のギター・マイクなしでも合成音（`OscillatorNode`）でロジックを自動検証できる**: 期待音名に一致する周波数を鳴らして`chordMatchScore()`が高スコアを返すこと、無関係な周波数では低スコアになることを確認する。ただし実際のギターでの精度・しきい値調整（`MIC_MATCH_THRESHOLD`等）は自動テスト不可、実機での調整が必要（詳細は`作業日記\01 ギター練習ツール\プラン\2026-07-21_マイク自動判定機能実装計画.md`）。

## 記録・弾ける曲判定の仕組み

- 「記録」タブで各コードを **未評価→できた(ok)→要練習(ng)→未評価** の3状態でサイクル切り替え（`cycleStatus`）。
- 設定の「できてないコードだけ」プリセットは、**`ng`だけでなく`未評価`も含めて選択する**（`applyPreset('weak')`）。記録タブを一度も触っていなくても「できてないコードだけ」で全コードが選ばれる設計。
- 「曲」タブは、`chordStatus`が全て`ok`の曲を「弾ける」と判定する（`songChordInfo`）。あくまで**進行(`progression`)から導出した使用コード**を見ているので、`SONGS`に新しい曲を足すときは`progression`だけ書けばよい。

## 実装上の注意・過去のバグパターン

- **カスタムレイアウトのインラインstyle残留バグ**: 自由配置(`custom-layout`)を解除する時、`left/top/width/height/zIndex`のインラインstyleを明示的に空文字へ戻さないと、`!important`のない通常CSSより優先され続けてしまい、回転などで通常レイアウトに戻っても崩れたまま残る（`applyLayoutToPane`のコメント参照）。
- **iOSの向き変更タイミング**: `orientationchange`は`resize`より確定が遅れる（400ms以上）ことがあるため、`applyCustomLayouts`とスケール再計算を**50ms/400ms/700msの3段階**で重ねて呼ぶことで、早すぎる/遅すぎるどちらのケースにも対応している。`resize`と`visualViewport`のresizeもフォールバックとして併用。
- **メトロノームの無音化バグ対策**: 画面ロックやアプリ切り替えでタイマーが間引かれ`nextT`が現在時刻より大きく遅れると、負の時刻でAudioParamがエラーになり無音のまま止まる、または溜まった拍が一気に鳴る不具合があった。`nextT`が`ctx.currentTime`より0.5秒以上過去なら現在時刻から再スタートするガードで対処（`sched()`冒頭）。`visibilitychange`でも`AudioContext`の`resume()`と`nextT`再同期を行う。
- **プロフィールキーの命名規則**: 選択コード・記録・カスタムレイアウトはいずれも`ベースキー + '-' + currentProfile`という同じ命名規則でlocalStorageに保存されている。新しい「プロフィール単位で持たせたい設定」を追加するときはこのパターンを踏襲する。
- **「流れる」タブのアニメーションはrequestAnimationFrame単独に依存させない**: `layoutFlow()`（位置・不透明度の更新）は元は`flowLoop()`のrAF再帰だけで駆動していたが、rAFは`document.hidden`が真になる（タブが非アクティブ扱いになる等）と一切発火しなくなり、その間ずっと表示が固まる回帰を確認した。メトロノーム動作中は`sched()`が`setInterval(20ms)`で確実に回っているため、`sched()`の先頭でも`layoutFlow()`を呼んで二重に駆動することで、rAFが間引かれる環境でも固まらないようにしている（rAFが正常な環境では単に同じ内容を2回描くだけで害はない）。同様の理由で、マーカーの点滅(`pulseFlowMarker`)のアニメーション再始動も`requestAnimationFrame`で1フレーム遅らせる方式は同じ理由で機能しないことがあるため使わず、同期的な`void el.offsetWidth`による強制リフロー方式のままにしている。

## 自動コミットHook（takutolibraryルートに移設済み）

以前はこのリポジトリの`.claude/settings.json`にWrite/Edit後の自動コミットHookを個別に設定していたが、**takutolibraryをcwdにして作業するセッションではこのフォルダ単体のHooksが読み込まれず発動しない**ことが判明したため、同等のHookをルート(`takutolibrary/.claude/settings.json`・`takutolibrary/.claude/hooks/auto-commit.ps1`)に統合した。このリポジトリ内の`.claude/settings.json`のHook設定自体は残っているが、ルート起点で作業する場合は使われない（guitar-practiceフォルダ単体をcwdにした場合のみ有効）。
