/**
 * @fileoverview Types for the Kairos Edge Lab data artifact.
 * Shape verified against the actual artifact from regime_edge v1.
 */

/**
 * @typedef {"trend_up" | "trend_down" | "neutral"} RegimeLabel
 */

/**
 * @typedef {"PROVEN-FAIL" | "PROVEN-OK" | "MEASURED"} VerdictKind
 */

/**
 * @typedef {"FIXED-LIVE" | "FIXED (migration)" | "MEASURED-ONLY"} FixStatus
 */

/**
 * @typedef {"er_abs" | "chop" | "vol" | "hurst" | "adx"} FeatureKey
 */

/**
 * @typedef {Object} MetaInfo
 * @property {string} run_id
 * @property {string} generated_at
 * @property {string} engine
 * @property {string[]} symbols
 * @property {string} period_start
 * @property {string} period_end
 * @property {Object.<string, number>} bars_per_symbol
 * @property {{file: string, lines: number}} band_source
 * @property {string[]} approximation_notes
 * @property {string} fix_manifest_note
 */

/**
 * @typedef {number | string | number[] | Record<string, number|string>} VerdictNumber
 */

/**
 * @typedef {Object} VerdictItem
 * @property {string} id
 * @property {string} title
 * @property {VerdictKind} verdict
 * @property {string} evidence
 * @property {Object.<string, VerdictNumber>} numbers
 * @property {"engine" | "repo-measured"} source
 * @property {FixStatus} fix_status
 * @property {string | null} fix_summary
 */

/**
 * @typedef {Object} HmmRow
 * @property {string} symbol
 * @property {number} n_decided
 * @property {number} acc
 * @property {number} majority
 * @property {number} skill
 * @property {number} flip_rate_low_er
 * @property {number} flip_rate_high_er
 * @property {number} conf_low_er
 */

/**
 * @typedef {Object} HmmBlock
 * @property {HmmRow[]} per_symbol
 * @property {string} approximation_note
 */

/**
 * @typedef {Object} RegimeBar
 * @property {string} t
 * @property {number} close
 * @property {number} trend
 * @property {number} chop
 * @property {number} vol
 * @property {RegimeLabel} regime
 */

/**
 * @typedef {Object} RegimeValuesBlock
 * @property {{symbol: string, bars: RegimeBar[] }[]} per_symbol
 */

/**
 * @typedef {Object} SurfaceBin
 * @property {number} bin_lo
 * @property {number} bin_hi
 * @property {number} n
 * @property {number} tp_rate
 * @property {number} sl_rate
 * @property {number} exp_rate
 * @property {number} mean_r
 * @property {number} ci_lo
 * @property {number} ci_hi
 */

/**
 * @typedef {Object} SpearmanCell
 * @property {number} rho
 * @property {number} p
 */

/**
 * @typedef {Object} EdgeSurfaceSymbol
 * @property {string} symbol
 * @property {Record<FeatureKey, SurfaceBin[]>} by_feature
 * @property {Record<FeatureKey, SpearmanCell>} spearman
 */

/**
 * @typedef {Object} EdgeSurfaceBlock
 * @property {EdgeSurfaceSymbol[]} per_symbol
 */

/**
 * @typedef {Object} BookStats
 * @property {number} n
 * @property {number} tp
 * @property {number} sl
 * @property {number} exp
 * @property {number} mean_r
 * @property {number} sharpe_r
 * @property {number} maxdd_r
 * @property {number[]} equity
 */

/**
 * @typedef {Object} DmCell
 * @property {number} kc_p_raw
 * @property {number | null} kc_p_holm
 * @property {number} cn_p_raw
 * @property {number | null} cn_p_holm
 */

/**
 * @typedef {Object} GateBacktestBlock
 * @property {{er_gate: Object.<string, number>, chosen_on: string}} thresholds
 * @property {Object[]} per_symbol
 * @property {Object} pooled
 */

/**
 * @typedef {Object} CalibrationMetrics
 * @property {number} auc
 * @property {number} brier
 * @property {number} ece
 */

/**
 * @typedef {Object} ReliabilityCell
 * @property {number} pred
 * @property {number} emp
 * @property {number} n
 */

/**
 * @typedef {Object} CalibrationSymbol
 * @property {string} symbol
 * @property {CalibrationMetrics} base_rate
 * @property {CalibrationMetrics} regime_conditional
 * @property {ReliabilityCell[]} reliability_base
 * @property {ReliabilityCell[]} reliability_regime
 */

/**
 * @typedef {Object} CalibrationBlock
 * @property {CalibrationSymbol[]} per_symbol
 */

/**
 * @typedef {Object} BarrierGeometry
 * @property {number} tp_atr
 * @property {number} sl_atr
 * @property {number} expiry
 * @property {number} pi_tp
 * @property {number} pi_sl
 * @property {number} pi_e
 * @property {number} ev_null
 * @property {number} ev_drift
 */

/**
 * @typedef {Object} BarrierSymbol
 * @property {string} symbol
 * @property {BarrierGeometry} current
 * @property {BarrierGeometry} corrected
 * @property {number} mu_hat_atr_bar
 * @property {number} cost_atr
 */

/**
 * @typedef {Object} BarrierCrosscheckRow
 * @property {string} case
 * @property {number} repo_pi
 * @property {number} our_mc_pi
 * @property {number} abs_diff
 */

/**
 * @typedef {Object} BarrierBlock
 * @property {BarrierCrosscheckRow[]} crosscheck
 * @property {BarrierSymbol[]} per_symbol
 */

/**
 * @typedef {Object} TsfmReframeBlock
 * @property {{har_beats_naive_holm_cells: string, har_ewma_beats_naive: string, chronos_beats_har_sig_cells: number, qlike_best_by_arm: Object.<string, number>, n_cells: number}} vol_backtest
 * @property {{accepted: string, mean_b: number, mean_k: number}} recalib
 * @property {string} conclusion
 */

/**
 * @typedef {Object} FixItem
 * @property {string} id
 * @property {string} weakness
 * @property {string} fix
 * @property {string[]} files
 * @property {string} test
 * @property {"FIXED-LIVE" | "FIXED (migration)"} status
 * @property {"live"} mode
 */

/**
 * @typedef {Object} EdgeLabEnvelope
 * What /api/edge-lab returns: the nt_edge_lab_run columns plus the payload
 * JSONB spread at the top level (meta, verdicts, hmm, fixes, ...).
 * @property {string} run_id
 * @property {string} generated_at
 * @property {string} engine
 * @property {string[]} symbols
 * @property {string} period_start
 * @property {string} period_end
 * @property {number} bars_total
 * @property {string|null} note
 * @property {MetaInfo} meta
 * @property {VerdictItem[]} verdicts
 * @property {HmmBlock} hmm
 * @property {RegimeValuesBlock} regime_values
 * @property {EdgeSurfaceBlock} edge_surface
 * @property {GateBacktestBlock} gate_backtest
 * @property {CalibrationBlock} calibration
 * @property {BarrierBlock} barrier
 * @property {TsfmReframeBlock} tsfm_reframe
 * @property {FixItem[]} fixes
 */
