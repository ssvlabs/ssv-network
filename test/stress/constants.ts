// Stress test constants
// All fee values follow the same encoding as the main protocol:
//   PACKED raw (uint64) = unpacked wei / ETH_DEDUCTED_DIGITS
// Getters return UNPACKED wei. Setters take UNPACKED wei.
// Fee calculations use PACKED raw values.

// ─── Protocol precision constants (mirrors SSVCoreTypes.sol) ───────────────
export const BPS_DENOMINATOR     = 10_000n;
export const ETH_DEDUCTED_DIGITS = 100_000n;
export const DEDUCTED_DIGITS     = 10_000_000n;
export const PRECISION           = 10n ** 18n;   // staking accumulator
export const VERSION_SSV         = 0n;
export const VERSION_ETH         = 1n;

// ─── Default ETH fee for operators without explicit ETH fee ───────────────
// Used when a pre-migration operator hasn't declared an ETH fee.
// The contract substitutes this when computing migration burnRate.
export const DEFAULT_OPERATOR_ETH_FEE = 1_778_800_000n;  // wei/block/validator (= INIT_MIN_OPERATOR_ETH_FEE)

// ─── Fee randomisation targets ─────────────────────────────────────────────
// Network fee and operator fees are randomised ±FEE_DEVIATION_BPS around these centres.
export const TARGET_NETWORK_FEE_ETH      = 3_550_900_000n;  // wei/block (target average, ±7%)
export const TARGET_OPERATOR_ETH_FEE     = 1_778_800_000n;  // wei/block (target average, ±7%)
export const FEE_DEVIATION_BPS           = 700n;             // 7% max deviation
// Minimum fee set on-chain so operators can declare fees down to -7% of the target.
// = floor(TARGET_OPERATOR_ETH_FEE * (1 - FEE_DEVIATION_BPS/10000) / ETH_DEDUCTED_DIGITS) * ETH_DEDUCTED_DIGITS
export const STRESS_MIN_OPERATOR_ETH_FEE = 1_654_200_000n;  // wei/block (~7% below target)

// ─── Single control knob ──────────────────────────────────────────────────
// Everything else autoscales from this value.
export const STRESS_TARGET_WRITE_TXS = 10000;     // total write TXs across the run

// ─── Autoscaled simulation scale ──────────────────────────────────────────
// All counts derived from STRESS_TARGET_WRITE_TXS so changing that one constant
// proportionally scales the entire simulation.
export const STRESS_OPERATORS_PRE_UPGRADE         = Math.max(4,  Math.floor(STRESS_TARGET_WRITE_TXS * 0.050));
export const STRESS_OPERATORS_REMOVED_PRE_UPGRADE = Math.floor(STRESS_OPERATORS_PRE_UPGRADE * 0.15);
export const STRESS_SSV_CLUSTERS                  = Math.max(4,  Math.floor(STRESS_TARGET_WRITE_TXS * 0.080));
export const STRESS_SSV_OWNERS                    = Math.max(2,  Math.floor(STRESS_SSV_CLUSTERS / 5));
export const STRESS_SSV_CLUSTERS_LIQUIDATED       = Math.max(0,  Math.floor(STRESS_SSV_CLUSTERS * 0.20));
export const STRESS_OPERATORS_POST_UPGRADE        = Math.max(4,  Math.floor(STRESS_TARGET_WRITE_TXS * 0.005));
export const STRESS_ETH_CLUSTERS                  = Math.max(2,  Math.floor(STRESS_TARGET_WRITE_TXS * 0.020));
export const STRESS_STAKERS_EOA                   = Math.max(2,  Math.floor(STRESS_TARGET_WRITE_TXS * 0.016));
export const STRESS_STAKERS_CONTRACT              = Math.max(1,  Math.floor(STRESS_TARGET_WRITE_TXS * 0.004));
export const STRESS_SAC_CLUSTERS                  = Math.max(3,  Math.floor(STRESS_TARGET_WRITE_TXS * 0.002));
export const STRESS_SSV_CLUSTERS_SHORTRUN         = Math.max(2,  Math.floor(STRESS_TARGET_WRITE_TXS * 0.002));

// ─── Signer layout (all indices derived from scaled constants) ────────────
// 0             = deployer
// 1             = liquidator
// [2 .. OPS_END)               = pre-upgrade operator owners (one per operator)
// [OPS_END .. SSV_END)         = SSV cluster owners (STRESS_SSV_OWNERS, shared across clusters)
// [SSV_END .. POST_OPS_END)    = post-upgrade ETH operator owners (fresh accounts)
// [POST_OPS_END .. ETH_END)    = dedicated ETH cluster setup owners (can also reuse earlier)
// [ETH_END .. SAC_END)         = STRESS_SAC_CLUSTERS sacrifice (collateral-liquidatable) ETH cluster owners
// [SAC_END .. DOOMED_END)      = doomed SSV cluster owners (STRESS_SSV_CLUSTERS_LIQUIDATED)
// [DOOMED_END .. ORC_END)      = 3 oracle signers
// ORC_END                      = oracle staker
// [ORC_END+1 .. EOA_END)       = EOA stakers
// [EOA_END .. TOTAL)           = contract stakers
export const _SL_PRE_OPS_START    = 2;
export const _SL_PRE_OPS_END      = _SL_PRE_OPS_START    + STRESS_OPERATORS_PRE_UPGRADE;
export const _SL_SSV_OWN_START    = _SL_PRE_OPS_END;
export const _SL_SSV_OWN_END      = _SL_SSV_OWN_START    + STRESS_SSV_OWNERS;
export const _SL_POST_OPS_START   = _SL_SSV_OWN_END;
export const _SL_POST_OPS_END     = _SL_POST_OPS_START   + STRESS_OPERATORS_POST_UPGRADE;
export const _SL_ETH_CLU_START    = _SL_POST_OPS_END;
export const _SL_ETH_CLU_END      = _SL_ETH_CLU_START    + STRESS_ETH_CLUSTERS;
export const _SL_SAC_START        = _SL_ETH_CLU_END;
export const _SL_SAC_END          = _SL_SAC_START         + STRESS_SAC_CLUSTERS;
export const _SL_DOOMED_START     = _SL_SAC_END;
export const _SL_DOOMED_END       = _SL_DOOMED_START      + STRESS_SSV_CLUSTERS_LIQUIDATED;
export const _SL_ORC_SIG_START    = _SL_DOOMED_END;
export const _SL_ORC_SIG_END      = _SL_ORC_SIG_START     + 3;
export const ORACLE_STAKER_INDEX  = _SL_ORC_SIG_END;        // single oracle staker
export const _SL_EOA_START        = ORACLE_STAKER_INDEX    + 1;
export const _SL_EOA_END          = _SL_EOA_START          + STRESS_STAKERS_EOA;
export const _SL_CON_START        = _SL_EOA_END;
export const _SL_CON_END          = _SL_CON_START          + STRESS_STAKERS_CONTRACT;
export const STRESS_TOTAL_SIGNERS = _SL_CON_END;

// ─── Random staker pool (referenced from actions.ts) ─────────────────────
export const STRESS_STAKER_START_IDX = _SL_EOA_START;
export const STRESS_STAKER_COUNT     = STRESS_STAKERS_EOA;

// ─── Block budget ─────────────────────────────────────────────────────────
// (STRESS_TARGET_WRITE_TXS defined above — kept as the single knob)

// ─── Fixture initial values (UNPACKED wei, matches test/common/constants.ts) ─
export const INIT_NETWORK_FEE_ETH       = 3_000_000_000n;           // wei per block (UNPACKED)
export const INIT_NETWORK_FEE_SSV       = 382_640_000_000n;         // SSV wei per block (UNPACKED)
export const INIT_MIN_LIQ_COLLATERAL    = 1_000_000_000_000_000n;   // 0.001 ETH in wei
export const INIT_MIN_BLOCKS_LIQ        = 214_800n;                  // blocks (~30 days)
export const INIT_MAX_OPERATOR_FEE      = 76_528_650_000_000n;      // wei per block (UNPACKED)
export const INIT_MIN_OPERATOR_ETH_FEE  = 1_778_800_000n;           // wei per block (UNPACKED)
export const INIT_OPERATOR_MAX_INCREASE = 10_000n;                   // BPS (100%)
export const INIT_VALIDATORS_PER_OP     = 3_000n;
export const INIT_COOLDOWN_DURATION     = 604_800n;                  // 7 days in seconds
export const INIT_QUORUM_BPS            = 7_500n;                    // 75%
export const INIT_DECLARE_PERIOD        = 604_800n;                  // 7 days
export const INIT_EXECUTE_PERIOD        = 604_800n;                  // 7 days

// ─── Stress-test overrides (applied after fixture initialization) ──────────
// Reduce time-based gates so fee changes and unstakes can be tested
export const STRESS_FEE_PERIOD_SECS    = 604_800n; // declare + execute fee period (seconds, 7 days)
export const STRESS_COOLDOWN_SECS      = 500n;   // unstake cooldown (seconds)

// ─── Oracle configuration ─────────────────────────────────────────────────
export const ORACLE_SLOT_COUNT = 3;              // slots 1, 2, 3 (slot 4 left unset)

// ─── Minimum viable deposit to survive the default liquidation window ─────
// burnRate per validator with 4 operators @ MIN_ETH_FEE + NETWORK_FEE
// = (4 * 17788 + 30000) * 100000 = 4778800000 wei per block per 32-ETH validator
// 214800 blocks * 4778800000 = 1.027 * 10^15 wei ≈ 0.001 ETH per validator
// We deposit much more to survive the full 5-year run with top-ups.
// SSV-specific constants (pre-migration operators and clusters)
export const INIT_MIN_OPERATOR_SSV_FEE  = 1_000_000_000n;          // SSV wei/block/validator (unpacked)
export const DEFAULT_SSV_CLUSTER_DEPOSIT = 100n * 10n ** 18n;       // 100 SSV per cluster (100 SSV tokens in wei)

export const DEFAULT_CLUSTER_DEPOSIT = 2_000_000_000_000_000_000n;  // 2 ETH per cluster (~900 days runway)
export const MIN_SAFE_BALANCE        = 5_000_000_000_000_000n;      // 0.005 ETH (below liq threshold so actDeposit competes with liquidate)
export const TOP_UP_AMOUNT           = 500_000_000_000_000_000n;    // 0.5 ETH top-up

// ─── Seed funds (sent directly to contract, not through protocol) ──────────
export const SEED_ETH = 100n * 10n ** 18n;  // 100 ETH seeded directly
export const SEED_SSV = 100n * 10n ** 18n;  // 100 SSV seeded directly (for network SSV earnings)

// ─── Staking amounts ──────────────────────────────────────────────────────
export const DEFAULT_STAKE_AMOUNT   = 10n * 10n ** 18n;   // 10 SSV per staker
export const MINIMAL_STAKING_AMOUNT = 1_000_000_000n;     // absolute minimum

// ─── Oracle staker (allSigners index and initial stake amount) ────────────
export const ORACLE_STAKER_STAKE       = 10n * 10n ** 18n;  // STAKE_AMOUNT from test/common/constants.ts
export const UNSTAKE_COOLDOWN_BLOCKS   = 500n;              // matches setup updateUnstakeCooldownDuration(500n)

// ─── Dust tolerance ───────────────────────────────────────────────────────
export const MAX_ACCEPTABLE_DUST = 100_000_000_000_000n;  // 0.0001 ETH in wei

// ─── Hardhat mnemonic for generating extra signers ────────────────────────
export const HARDHAT_MNEMONIC =
  "test test test test test test test test test test test junk";

// ─── Operator set sizes supported by the protocol ─────────────────────────
export const VALID_OP_SET_SIZES = [4, 7, 10, 13] as const;

// ─── Effective balance per validator (whole ETH) ─────────────────────────
export const MIN_EB_PER_VALIDATOR  = 32;    // whole ETH, minimum
export const MAX_EB_PER_VALIDATOR  = 2048;  // whole ETH, maximum
export const DEFAULT_EB_PER_VALIDATOR = 32; // whole ETH, implicit assumption

// ─── CoinGecko ETH price fallback ─────────────────────────────────────────
export const FALLBACK_ETH_PRICE_USD = 3000;
export const GAS_PRICE_FOR_REPORT   = 30_000_000_000n; // 30 gwei

// ─── RNG seed ────────────────────────────────────────────────────────────
export const DEFAULT_RNG_SEED = 0xdeadbeefn;
