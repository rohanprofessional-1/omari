// Pure scoring for the extraction eval — no app/network dependencies, so it's
// unit-testable on its own. Classifies each (variable, case) into TP / FN
// (missed) / FP (spurious) / SUB (substitution: predicted the wrong option),
// then rolls up per-variable and micro-averaged precision / recall / F1, plus a
// confusion matrix (expected option × predicted option, ∅ = absent).

export const ABSENT = '∅'

/**
 * @param {Array<{id:string, expected:Record<string,string>, predicted:Record<string,{value:any,confidence:number}>}>} cases
 * @param {string[]} variableKeys - the variables in scope for this tree
 */
export function scoreExtraction(cases, variableKeys) {
  /** @type {Record<string, {tp:number,fn:number,fp:number,sub:number,confusion:Record<string,Record<string,number>>}>} */
  const perVar = {}
  for (const k of variableKeys) {
    perVar[k] = { tp: 0, fn: 0, fp: 0, sub: 0, confusion: {} }
  }

  const bump = (conf, e, p) => {
    conf[e] = conf[e] || {}
    conf[e][p] = (conf[e][p] || 0) + 1
  }

  for (const c of cases) {
    for (const k of variableKeys) {
      const stats = perVar[k]
      const e = c.expected?.[k]
      const p = c.predicted?.[k]?.value
      const eVal = e === undefined || e === null ? undefined : String(e)
      const pVal = p === undefined || p === null ? undefined : String(p)

      if (eVal !== undefined && pVal !== undefined && eVal === pVal) stats.tp++
      else if (eVal !== undefined && pVal !== undefined) stats.sub++ // wrong option
      else if (eVal !== undefined && pVal === undefined) stats.fn++ // missed
      else if (eVal === undefined && pVal !== undefined) stats.fp++ // spurious
      // eVal && pVal both undefined → true negative, uncounted

      if (eVal !== undefined || pVal !== undefined) {
        bump(stats.confusion, eVal ?? ABSENT, pVal ?? ABSENT)
      }
    }
  }

  const rows = {}
  const micro = { tp: 0, fn: 0, fp: 0, sub: 0 }
  for (const k of variableKeys) {
    const { tp, fn, fp, sub, confusion } = perVar[k]
    micro.tp += tp
    micro.fn += fn
    micro.fp += fp
    micro.sub += sub
    rows[k] = { tp, fn, fp, sub, confusion, ...prf(tp, fp, fn, sub) }
  }

  return {
    perVariable: rows,
    overall: { ...micro, ...prf(micro.tp, micro.fp, micro.fn, micro.sub) },
  }
}

// Substitutions count against BOTH precision (a wrong positive) and recall (a
// missed correct), which is the conservative, honest way to score them.
function prf(tp, fp, fn, sub) {
  const precision = tp + fp + sub === 0 ? 1 : tp / (tp + fp + sub)
  const recall = tp + fn + sub === 0 ? 1 : tp / (tp + fn + sub)
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  return { precision, recall, f1 }
}

export const pct = (x) => `${(x * 100).toFixed(1)}%`

/**
 * Reliability of the extractor's confidence: bin predictions by confidence and
 * compare each bin's mean confidence to its measured accuracy. Returns the bins
 * plus ECE (Expected Calibration Error) — the n-weighted average gap between
 * "how sure the model said it was" and "how often it was right". 0 = perfect.
 *
 * @param {Array<{confidence:number, correct:boolean}>} preds - one per predicted value
 * @param {number} width - bin width (default 0.1 → ten bins)
 */
export function calibration(preds, width = 0.1) {
  const nBins = Math.round(1 / width)
  const acc = Array.from({ length: nBins }, () => ({ n: 0, correct: 0, confSum: 0 }))
  for (const p of preds) {
    const c = Math.max(0, Math.min(0.999999, p.confidence))
    const i = Math.min(nBins - 1, Math.floor(c / width))
    acc[i].n++
    acc[i].confSum += p.confidence
    if (p.correct) acc[i].correct++
  }
  const N = preds.length || 1
  let ece = 0
  const bins = []
  for (let i = 0; i < nBins; i++) {
    const a = acc[i]
    if (a.n === 0) continue
    const confidence = a.confSum / a.n
    const accuracy = a.correct / a.n
    ece += (a.n / N) * Math.abs(accuracy - confidence)
    bins.push({ lo: i * width, hi: (i + 1) * width, n: a.n, confidence, accuracy })
  }
  return { n: preds.length, ece, bins }
}
