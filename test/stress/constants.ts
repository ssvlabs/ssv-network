export {
  BPS_DENOMINATOR,
  ETH_DEDUCTED_DIGITS,
  DEDUCTED_DIGITS,
  DEFAULT_OPERATOR_ETH_FEE,
  CLUSTER_VERSION_SSV as VERSION_SSV,
  CLUSTER_VERSION_ETH as VERSION_ETH,
  NETWORK_FEE_ETH as INIT_NETWORK_FEE_ETH,
  NETWORK_FEE as INIT_NETWORK_FEE_SSV,
  MINIMUM_LIQUIDATION_PERIOD_COLLATERAL as INIT_MIN_LIQ_COLLATERAL,
  MINIMUM_BLOCKS_BEFORE_LIQUIDATION as INIT_MIN_BLOCKS_LIQ,
  MINIMAL_OPERATOR_FEE_SSV as INIT_MIN_OPERATOR_SSV_FEE,
  STAKE_AMOUNT as DEFAULT_STAKE_AMOUNT,
} from '../common/constants.ts';

export const PRECISION           = 10n ** 18n;   // staking accumulator

export const TARGET_NETWORK_FEE_ETH      = 3_550_900_000n;  // wei/block (target average, ±7%)
export const TARGET_OPERATOR_ETH_FEE     = 1_778_800_000n;  // wei/block (target average, ±7%)
export const FEE_DEVIATION_BPS           = 700n;             // 7% max deviation
export const STRESS_MIN_OPERATOR_ETH_FEE = 1_654_200_000n;  // wei/block (~7% below target)

export const STRESS_TARGET_WRITE_TXS = 1000;      // total write TXs across the run

export const STRESS_OPERATORS_PRE_UPGRADE         = Math.max(4,  Math.floor(STRESS_TARGET_WRITE_TXS * 0.025));
export const STRESS_OPERATORS_REMOVED_PRE_UPGRADE = Math.floor(STRESS_OPERATORS_PRE_UPGRADE * 0.15);
export const STRESS_SSV_CLUSTERS                  = Math.max(4,  Math.floor(STRESS_TARGET_WRITE_TXS * 0.040));
export const STRESS_SSV_OWNERS                    = Math.max(2,  Math.floor(STRESS_SSV_CLUSTERS / 5));
export const STRESS_SSV_CLUSTERS_LIQUIDATED       = Math.max(0,  Math.floor(STRESS_SSV_CLUSTERS * 0.20));
export const STRESS_OPERATORS_POST_UPGRADE        = Math.max(4,  Math.floor(STRESS_TARGET_WRITE_TXS * 0.0025));
export const STRESS_ETH_CLUSTERS                  = Math.max(2,  Math.floor(STRESS_TARGET_WRITE_TXS * 0.010));
export const STRESS_STAKERS_EOA                   = Math.max(2,  Math.floor(STRESS_TARGET_WRITE_TXS * 0.008));
export const STRESS_STAKERS_CONTRACT              = Math.max(1,  Math.floor(STRESS_TARGET_WRITE_TXS * 0.002));
export const STRESS_SAC_CLUSTERS                  = Math.max(3,  Math.floor(STRESS_TARGET_WRITE_TXS * 0.001));
export const STRESS_SSV_CLUSTERS_SHORTRUN         = Math.max(2,  Math.floor(STRESS_TARGET_WRITE_TXS * 0.001));

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

export const STRESS_FEE_PERIOD_SECS    = 604_800n; // declare + execute fee period (seconds, 7 days)
export const STRESS_COOLDOWN_SECS      = 500n;   // unstake cooldown (seconds)

export const DEFAULT_SSV_CLUSTER_DEPOSIT = 100n * 10n ** 18n;       // 100 SSV per cluster (100 SSV tokens in wei)

export const DEFAULT_CLUSTER_DEPOSIT = 2_000_000_000_000_000_000n;  // 2 ETH per cluster (~900 days runway)

export const SEED_ETH = 100n * 10n ** 18n;  // 100 ETH seeded directly
export const SEED_SSV = 100n * 10n ** 18n;  // 100 SSV seeded directly (for network SSV earnings)

export const MINIMAL_STAKING_AMOUNT = 1_000_000_000n;     // absolute minimum

export const HARDHAT_MNEMONIC =
  "test test test test test test test test test test test junk";

export const VALID_OP_SET_SIZES = [4, 7, 10, 13] as const;

export const MIN_EB_PER_VALIDATOR  = 32n;
export const MAX_EB_PER_VALIDATOR  = 2048n;

export const GAS_PRICE_FOR_REPORT   = 30_000_000_000n; // 30 gwei

export const DEFAULT_RNG_SEED = 0xdeadbeefn;
