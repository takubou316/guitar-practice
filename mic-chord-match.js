/* ── mic-chord-match.js ──────────────────────────────────────────────
 * マイクで弾いたコードを判定するための純粋ロジック(DOM操作・AudioContext生成なし)。
 * index.html の ALL_CHORDS と同じ形({fingers,open,muted,barre})のコードオブジェクトを
 * 受け取って動く。mic-debug.html(実験・実機調整用) と、将来的に index.html 本体の
 * どちらからも読み込んで使う共通ロジック。
 *
 * 設計の背景・文献調査・リスク一覧は Obsidian Vault の
 * 作業日記\01 ギター練習ツール\プラン\2026-08-06_マイク自動判定機能_再設計ロードマップ.md を参照。
 * 旧実装(音名だけに丸めるクロマベクトル方式)は当たり外れが不安定で2026-07-31に削除済み。
 * このファイルは「弦ごとの実周波数(オクターブ込み)＋倍音畳み込み＋紛らわしいコードとの
 * 陰性証拠」という新方式の実装。
 * ──────────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  // 開放弦(1-6弦=e,B,G,D,A,E)の基準周波数(Hz)。標準チューニング(A4=440Hz)。
  const OPEN_STRING_FREQ = [null, 329.63, 246.94, 196.0, 146.83, 110.0, 82.41];

  // 実機調整用の可変パラメータ。mic-debug.html のスライダーから上書きされる想定なので
  // オブジェクトの参照を直接いじれるようにしている(再代入ではなくプロパティ変更で使う)。
  const params = {
    minFreq: 70,
    maxFreq: 1200,
    peakFloorRelDb: 45, // 範囲内最大ピークよりこの値(dB)以上低いピークは無視
    peakFloorAbsDb: -85, // 絶対的な下限(無音・環境ノイズの遮断)
    baseCentsTolerance: 35, // 基音の周波数許容誤差(セント)。ナイロン弦はチューニングが
    // 安定しにくいため広めに設定してある
    harmonicToleranceGrowth: 0.6, // 倍音次数が上がるごとに許容誤差を広げる係数
    // (実弦の倍音は整数倍からわずかにシャープにズレる=インハーモニシティの対策)
    harmonicWeights: [1, 0.6, 0.35, 0.2], // 基音・2倍音・3倍音・4倍音への重み
    negativePenalty: 1.8, // 紛らわしいコードの差分音エネルギーへのペナルティ係数
    // (2026-08-06の自己テストで、平行調の混同を十分抑えるには初期値1.0では弱いと判明し調整)
    minCoverageFraction: 0.12, // 各ターゲット音が「均等に鳴っていた場合の取り分(1/音数)」の
    // 何割以上を持っていれば「その音は鳴っている」とみなすか。これを下回る音が1つでもあれば
    // 他がどれだけ良くてもハードに不合格にする(2026-08-07: Amの2弦をミュートしたまま弾いても
    // 残り4音で合格してしまうバグを実機テストで発見し、ソフトな減点からハードな足切りに変更)。
    // 7thコード(例: E7)がベースの三和音(E)を含む部分集合関係にあるため、紛らわしいコードとの
    // 差分だけでは検出できない「音の欠け」もこれで拾える(2026-08-06の自己テストで発見した穴)。
    // 【2026-08-13再調整】このチェックは倍音込みのtargetEvidenceから基音だけのfundamentalEvidence
    // に変更した(下記参照)。基音だけだと数値が全体的に小さくなるため、0.35のままだと本当に
    // 鳴っている音まで誤って「欠落」判定してしまっていた。「鳴っていない音の取り分は常にほぼ0」
    // 「鳴っている音の取り分は0.03以上」という実測の差が大きいことを確認した上で0.12に調整。
    matchThreshold: 0.5, // この値以上で「合格」
  };

  function centsDiff(f1, f2) {
    return 1200 * Math.log2(f1 / f2);
  }
  function dbToLinear(db) {
    return isFinite(db) ? Math.pow(10, db / 20) : 0;
  }
  function freqToPitchClass(freq) {
    const midi = 69 + 12 * Math.log2(freq / 440);
    return ((Math.round(midi) % 12) + 12) % 12;
  }

  // コードデータ(fingers/open/barre)から、実際に鳴るはずの「弦ごとの基音周波数」を機械的に
  // 算出する。バレーの範囲内でも別の指で押さえ直されている弦(fingersに個別エントリがある弦)は
  // 実際にはその指のフレットの音が鳴るため、バレー側の計算から除外する
  // (旧実装で発見・修正した「バレーの音名が重複して残る」バグと同じ考慮)。
  function chordExpectedFreqs(chord) {
    const freqs = [];
    const overridden = new Set(chord.fingers.filter((fi) => fi.f !== 'B').map((fi) => fi.s));
    (chord.open || []).forEach((s) => freqs.push(OPEN_STRING_FREQ[s]));
    if (chord.barre) {
      for (let s = chord.barre.from; s <= chord.barre.to; s++) {
        if (overridden.has(s)) continue;
        freqs.push(OPEN_STRING_FREQ[s] * Math.pow(2, chord.barre.fret / 12));
      }
    }
    chord.fingers.forEach((fi) => {
      if (fi.f === 'B') return;
      freqs.push(OPEN_STRING_FREQ[fi.s] * Math.pow(2, fi.fr / 12));
    });
    return freqs;
  }

  function chordPitchClassSet(chord) {
    const set = new Set();
    chordExpectedFreqs(chord).forEach((f) => set.add(freqToPitchClass(f)));
    return set;
  }

  // dB値の配列(AnalyserNode.getFloatFrequencyData()の出力)からスペクトルのピーク(局所的な山)を
  // 検出し、放物線補間(QIFFT)でbin幅以上の周波数精度を安く得る。全帯域を生合算していた旧実装と
  // 違い、ピック音・環境音のような「山になっていない広帯域成分」に強い。
  function findPeaks(dbArray, sampleRate, fftSize, opts) {
    opts = opts || {};
    const minFreq = opts.minFreq != null ? opts.minFreq : params.minFreq;
    const maxFreq = opts.maxFreq != null ? opts.maxFreq : params.maxFreq;
    const len = dbArray.length;
    const iLo = Math.max(1, Math.floor((minFreq * fftSize) / sampleRate));
    const iHi = Math.min(len - 2, Math.ceil((maxFreq * fftSize) / sampleRate));
    let maxDb = -Infinity;
    for (let i = iLo; i <= iHi; i++) {
      if (isFinite(dbArray[i]) && dbArray[i] > maxDb) maxDb = dbArray[i];
    }
    const floor = Math.max(params.peakFloorAbsDb, maxDb - params.peakFloorRelDb);
    const peaks = [];
    for (let i = iLo; i <= iHi; i++) {
      const b = dbArray[i];
      if (!isFinite(b) || b < floor) continue;
      const a = isFinite(dbArray[i - 1]) ? dbArray[i - 1] : b - 60;
      const c = isFinite(dbArray[i + 1]) ? dbArray[i + 1] : b - 60;
      if (b < a || b < c) continue; // 局所的な山(3点の中央が一番高い)でなければ棄却
      const denom = a - 2 * b + c;
      const p = denom !== 0 ? 0.5 * ((a - c) / denom) : 0;
      const freq = (sampleRate / fftSize) * (i + p);
      const peakDb = b - 0.25 * (a - c) * p; // 放物線補間による推定ピーク高さ
      peaks.push({ freq, db: peakDb });
    }
    return peaks;
  }

  // ターゲット周波数(基音)について、倍音(最大4倍音、harmonicWeightsの数だけ)を重み付きで
  // 畳み込んだ「証拠エネルギー」を返す。次数が上がるほど許容誤差を広げるのは、実弦の倍音が
  // 整数倍から徐々にシャープにズレていく物理特性(インハーモニシティ)に対応するため。
  function targetEvidence(targetFreq, peaks) {
    let evidence = 0;
    params.harmonicWeights.forEach((w, h) => {
      const harmonicFreq = targetFreq * (h + 1);
      const tolerance = params.baseCentsTolerance * (1 + h * params.harmonicToleranceGrowth);
      let best = null;
      peaks.forEach((pk) => {
        const d = Math.abs(centsDiff(pk.freq, harmonicFreq));
        if (d <= tolerance && (!best || pk.db > best.db)) best = pk;
      });
      if (best) evidence += w * dbToLinear(best.db);
    });
    return evidence;
  }

  // chordに対して紛らわしい(ピッチクラスの重なりが大きい)コードをallChordsから自動算出する。
  // 手作業の「紛らわしいペア」データは持たず、既存のコードデータから機械的に導出する
  // (Am⇔C、Em⇔G、Dm⇔Fのような平行調のペアが自動的に見つかる)。
  // 同点で複数の候補がある場合(例: Amに対してAとCが同率で紛らわしい)、1件だけ選ぶと
  // 「たまたま先に見つかった方」としか比較できず、もう一方との混同を見逃す
  // (自己テストで実際に発生を確認済み、2026-08-06)。そのため margin 以内の同率候補は
  // 全部まとめて返す。allChordsのプールはアプリ実行中に変わらない前提で、結果をchord名で
  // キャッシュする(判定中は同じコードに対して40msごとに呼ばれるため、2026-08-13のレビューで
  // 指摘された「判定ウィンドウ中の無駄な再計算」を避ける)。
  const _confusableCache = new Map();
  function confusableChords(chord, allChords, opts) {
    const cacheable = !opts;
    if (cacheable && _confusableCache.has(chord.name)) return _confusableCache.get(chord.name);
    const margin = opts && opts.margin != null ? opts.margin : 0.001;
    const pcs = chordPitchClassSet(chord);
    const scored = [];
    allChords.forEach((other) => {
      if (other === chord || other.name === chord.name) return;
      const otherPcs = chordPitchClassSet(other);
      let overlap = 0;
      otherPcs.forEach((pc) => {
        if (pcs.has(pc)) overlap++;
      });
      const ratio = overlap / Math.max(pcs.size, otherPcs.size, 1);
      scored.push({ chord: other, overlapRatio: ratio });
    });
    let result;
    if (!scored.length) {
      result = [];
    } else {
      scored.sort((a, b) => b.overlapRatio - a.overlapRatio);
      const best = scored[0].overlapRatio;
      // 重なりが実質ゼロの候補まで「一番紛らわしい」扱いにすると、無関係なコードの音が
      // 陰性証拠として紛れ込んでしまう(2026-08-13、Codexのレビューで指摘)。
      result = best > 0 ? scored.filter((s) => s.overlapRatio >= best - margin) : [];
    }
    if (cacheable) _confusableCache.set(chord.name, result);
    return result;
  }

  // 基音(倍音を畳み込まない)だけの証拠。カバレッジチェック(その音が本当に鳴っているかの
  // ハードな足切り)専用。targetEvidence(倍音込み)をそのまま流用すると、和音内の別の音の
  // 周波数がこの音の倍音の周波数とたまたま一致してしまうことがある
  // (例: Amで5弦(110Hz)がミュートされていても、実際に鳴っている3弦(220Hz)を110Hzの2倍音
  // として拾ってしまい、本当は鳴っていない音に証拠がついて足切りをすり抜けてしまう)。
  // 2026-08-13、Codexのレビューで指摘。足切り判定だけは基音そのものの有無に絞ることで、
  // 「他の音の倍音経由で鳴っていることにされる」のを防ぐ。
  function fundamentalEvidence(targetFreq, peaks) {
    let best = null;
    peaks.forEach((pk) => {
      const d = Math.abs(centsDiff(pk.freq, targetFreq));
      if (d <= params.baseCentsTolerance && (!best || pk.db > best.db)) best = pk;
    });
    return best ? dbToLinear(best.db) : 0;
  }

  // 後方互換・表示用: 一番紛らわしい候補を1件だけ返す(同点の場合は先頭のもの)。
  function mostConfusableChord(chord, allChords) {
    const list = confusableChords(chord, allChords);
    return list.length ? list[0] : null;
  }

  // 弾いた音のピーク一覧と、判定したいコード・比較候補プールから一致スコア(0〜1目安)を算出する。
  // 「陽性証拠(期待する音がどれだけ鳴っているか)」から「陰性証拠(紛らわしいコード群との
  // 差分音=そのコードだと分かる決め手の音がどれだけ鳴っているか)」を引く形にすることで、
  // 平行調の混同(旧実装最大の弱点)を構造的に防ぐ。紛らわしい候補が同点で複数ある場合は
  // その全員分の決め手の音をまとめてチェックする(1件だけだと見逃しが起きるため)。
  function matchScore(peaks, chord, allChords) {
    const totalPeakEnergy = peaks.reduce((s, pk) => s + dbToLinear(pk.db), 0);
    const targets = chordExpectedFreqs(chord);
    // 倍音込みの証拠は1音につき1回だけ計算し、陽性証拠の合計に使い回す
    // (以前はここと後述のカバレッジ判定用sharesの2箇所で同じ計算を重複していた、
    // 2026-08-13のレビューで指摘)。
    const targetEvidences = targets.map((f) => targetEvidence(f, peaks));
    const positiveEvidence = targetEvidences.reduce((s, e) => s + e, 0);

    let negativeEvidence = 0;
    let confusables = [];
    if (allChords && allChords.length) {
      confusables = confusableChords(chord, allChords);
      if (confusables.length) {
        const chordPcs = chordPitchClassSet(chord);
        // 複数の紛らわしい候補の「決め手の音」を集める。ピッチクラス単位で1オクターブ分だけに
        // 絞ると、紛らわしいコードがそのオクターブと違う位置で決め手の音を鳴らした時に見逃す
        // (2026-08-13、Codexのレビューで指摘)ため、周波数そのもの(全オクターブ分)で重複を除く。
        const telltaleFreqs = new Set();
        confusables.forEach(({ chord: other }) => {
          chordExpectedFreqs(other).forEach((f) => {
            if (!chordPcs.has(freqToPitchClass(f))) telltaleFreqs.add(f);
          });
        });
        negativeEvidence = Array.from(telltaleFreqs).reduce(
          (s, f) => s + targetEvidence(f, peaks),
          0
        );
      }
    }

    const confusable = confusables.length ? confusables[0] : null;
    if (totalPeakEnergy <= 0) {
      return {
        score: 0,
        positiveRatio: 0,
        negativeRatio: 0,
        missingNote: true,
        weakestShare: 0,
        confusable,
        confusableCount: confusables.length,
      };
    }
    const positiveRatio = Math.min(1, positiveEvidence / totalPeakEnergy);
    const negativeRatio = Math.min(1, negativeEvidence / totalPeakEnergy);

    // カバレッジチェック: 「紛らわしいコードとの差分」だけでは、7thコードのように
    // 自分がベースの三和音を丸ごと含む(=差分がない)関係を検出できない
    // (2026-08-06の自己テストでE7がE単体の音にも部分点を出す穴として発見)。
    // さらに2026-08-07の実機テストで、Amの2弦(本来1フレットを押さえるべき)を弾かず
    // ミュートしたまま弾いても、残り4音が強く鳴っていれば合格してしまうことが判明した。
    // このアプリの目的は「全部の指が正しく押さえられているか」の確認なので、1音でも
    // 期待した取り分を大きく下回っているなら、他がどれだけ良くてもハードに不合格にする
    // (ソフトな減点だと、4/5音が強ければ1音の欠落を帳消しにできてしまっていた)。
    // ここは倍音込みのtargetEvidenceではなく基音だけのfundamentalEvidenceを使う
    // (理由は同関数のコメント参照、2026-08-13のCodexレビューで指摘)。
    const shares = targets.map((f) => fundamentalEvidence(f, peaks) / totalPeakEnergy);
    const weakestShare = shares.length ? Math.min(...shares) : 0;
    const expectedMinShare = (1 / Math.max(targets.length, 1)) * params.minCoverageFraction;
    const missingNote = weakestShare < expectedMinShare;

    const score = missingNote
      ? 0
      : Math.max(0, positiveRatio - params.negativePenalty * negativeRatio);
    return {
      score,
      positiveRatio,
      negativeRatio,
      missingNote,
      weakestShare,
      confusable,
      confusableCount: confusables.length,
    };
  }

  global.MicChordMatch = {
    params,
    OPEN_STRING_FREQ,
    chordExpectedFreqs,
    chordPitchClassSet,
    freqToPitchClass,
    findPeaks,
    targetEvidence,
    fundamentalEvidence,
    mostConfusableChord,
    confusableChords,
    matchScore,
  };
})(window);
