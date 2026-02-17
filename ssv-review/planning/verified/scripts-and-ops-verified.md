# Deployment Scripts, Operational Readiness & Docs — Verification Report

**Branch:** `verify/scripts-and-ops` | **Date:** 2026-02-17
**Scope:** All files in `scripts/`, upgrade initializer, deployment configs, docs, dead code scan

---

## 1. Deployment Scripts Audit

### 1.1 `scripts/deploy-all.ts` — FRESH DEPLOYMENT (BROKEN)

**Status: Has known bugs (H-2 from prior audit)**

| Issue | Severity | Details |
|-------|----------|---------|
| Wrong `initializeSSVStaking` signature | **HIGH** | Line 108: uses `"initializeSSVStaking(address,uint64)"` with `[cssvTokenAddr, cooldown]`. Actual contract signature is `initializeSSVStaking(uint64,uint32[4])` with params `(cooldownDuration, defaultOracleIds)`. Will fail at runtime. |
| Missing constructor args for 3 modules | **HIGH** | Line 49-53: `SSVDAO`, `SSVViews`, `SSVStaking` all require `_cssv` address as constructor arg. Script deploys all with `deployContract(ethers, mod)` (no args). Will fail at deploy time. |
| `CSSVToken` constructor arg may be wrong | **MEDIUM** | Line 91: passes `networkProxyAddr` to `CSSVToken`. But `CSSVToken(address ssvStaking_)` expects the SSV staking module address, not the network proxy. Since delegatecall routes through the proxy, `msg.sender` during `onCSSVTransfer` will be the proxy address — so this is actually correct for the proxy pattern. No bug here. |

**Impact:** Fresh full deployments via `deploy-all.ts` will fail. This script needs fixes before mainnet use.

**What needs fixing:**
1. Change signature to `"initializeSSVStaking(uint64,uint32[4])"`
2. Change params to `[cooldown, defaultOracleIds]` (where `defaultOracleIds = [1,2,3,4]`)
3. Deploy `CSSVToken` before modules, then pass `cssvTokenAddr` as constructor arg to `SSVDAO`, `SSVViews`, `SSVStaking`

### 1.2 `scripts/staking-upgrade.ts` — UPGRADE EXISTING DEPLOYMENT (CORRECT)

**Status: Correct signature and params**

- Line 30: `"initializeSSVStaking(uint64,uint32[4])"` ✅
- Line 31: `[cooldown, defaultOracles]` where `defaultOracles = [1,2,3,4]` ✅
- Uses `DEFAULT_UNSTAKE_COOLDOWN = 604800` (7 days in seconds) ✅
- Does NOT set `quorumBps` — see M-2 below

**Known gap (M-2):** `quorumBps` is NOT initialized by this script. After upgrade, `quorumBps` defaults to 0 in storage until DAO calls `setQuorumBps()`. Combined with C-1 (`setQuorumBps(0)` being valid), any oracle can commit roots unilaterally in the gap.

### 1.3 `scripts/upgrade-fork.ts` — FORK UPGRADE SCRIPT (CORRECT + COMPREHENSIVE)

**Status: Well-engineered, production-quality**

- Correct signature at line 435: `"initializeSSVStaking(uint64,uint32[4])"` ✅
- Deploys all modules with correct constructor args (lines 412-418):
  - `SSVOperators([upgradeTimestamp])` ✅
  - `SSVDAO([cssvAddr])` ✅
  - `SSVViews([cssvAddr])` ✅
  - `SSVStaking([cssvAddr])` ✅
  - `SSVClusters([])`, `SSVOperatorsWhitelist([])`, `SSVValidators([])` ✅
- Sets `quorumBps` via config if provided (line 481-483) ✅
- Full verification pass via SSVViews queries (lines 491-592) ✅
- Writes deployed config with all addresses/params ✅
- **Note:** Lines 404, 439 — SSVNetwork base implementation deploy/upgrade are commented out. Only the staking upgrade is applied. This may be intentional (staking upgrade inherits SSVNetwork).

### 1.4 Other Scripts (All Correct)

| Script | Purpose | Status |
|--------|---------|--------|
| `upgrade-contract.ts` | Generic proxy upgrade | ✅ Correct |
| `update-module.ts` | Deploy + attach module | ✅ Correct, supports `--args` JSON |
| `deploy-module.ts` | Deploy module only | ✅ Correct |
| `deploy-implementation.ts` | Deploy impl only | ✅ Correct |
| `attach-module.ts` | Attach pre-deployed module | ✅ Correct |
| `upgrade-with-impl.ts` | Upgrade with pre-deployed impl | ✅ Correct |
| `deploy-ssv-network.ts` | Deploy SSVNetwork proxy | ✅ Correct |
| `deploy-ssv-network-views.ts` | Deploy SSVNetworkViews proxy | ✅ Correct |
| `run-forked-local-tests.ts` | Run tests against fork | ✅ Well-built, passes fork config |
| `gas-compare.ts` | Compare gas reports | ✅ Utility, correct |
| `contract-sizes.ts` | Report contract sizes | ✅ Utility, correct |
| `common/export-abis.ts` | Export ABIs | ✅ Utility, correct |
| `common/helpers.ts` | Shared deploy helpers | ✅ Correct |
| `common/modules.ts` | Module enum | ✅ Matches contract enum |
| `common/address-book.ts` | Save/load deployment addresses | ✅ Correct |

---

## 2. Upgrade Initializer

### `contracts/upgrades/stage/hoodi/SSVNetworkSSVStakingUpgrade.sol`

**Status: Correct but incomplete**

- `reinitializer(3)` ✅ (current version, following v1 and v2)
- `onlyOwner` modifier ✅
- Sets `cooldownDuration` ✅
- Sets `defaultOracleIds` ✅
- Emits `CooldownDurationUpdated` ✅
- Emits `SSVNetworkUpgradeBlock("v2.0.0", block.number)` ✅

**Gap:** Does NOT set `quorumBps`. After upgrade, staking storage `quorumBps` is 0 (uninitialized). This MUST be set via a separate `setQuorumBps()` DAO call immediately after upgrade, or a front-running oracle can commit arbitrary roots.

---

## 3. Deployment Parameters Cross-Reference

### `deployments/hoodi-fork.config.json` vs DIP-X Spec (SPEC.md §11)

| Parameter | Config Value | DIP-X Spec Value | Match? |
|-----------|-------------|-------------------|--------|
| `ethNetworkFee` | `3550900000` | `0.000000003550929823 ETH/block` = `3,550,929,823` wei | ⚠️ Close but rounded: config=`3,550,900,000` vs spec=`3,550,929,823` |
| `minimumLiquidationCollateral` | `940000000000000` (0.00094 ETH) | 0.00094 ETH | ✅ |
| `liquidationThresholdPeriod` | `35800` | 50,190 blocks | ❌ Mismatch: config=35,800 vs spec=50,190 |
| `cooldownDuration` | `604800` (7 days in seconds) | 50,120 blocks (~7 days) | ✅ Consistent (contract uses `block.timestamp`, so seconds is correct) |
| `quorumBps` | `7500` | 7,500 (75%) | ✅ |
| `defaultOracleIds` | `[1, 2, 3, 4]` | 4 oracles | ✅ |
| `maxOperatorEthFee` | `5326300000` | TBD in spec | ⚠️ Value set but spec says TBD |
| `minOperatorEthFee` | `1065200000` | TBD in spec | ⚠️ Value set but spec says TBD |
| `defaultOperatorEthFee` | `1775464912` | 1,770,000,000 wei | ⚠️ Slight mismatch: config=1,775,464,912 vs spec=1,770,000,000 |
| `upgradeTimestamp` | `2212800` | Not in spec | ℹ️ Network-specific |
| Oracle addresses | 4 addresses set | Required | ✅ |

### `.env.example` vs Production — STALE

The `.env.example` contains old v1 values:
- `MINIMUM_BLOCKS_BEFORE_LIQUIDATION=100800` (v1 value, not v2)
- `MINIMUM_LIQUIDATION_COLLATERAL=200000000` (SSV-denominated, not ETH)
- `OPERATOR_MAX_FEE_INCREASE=3` (v1 value)
- `QUORUM_BPS=6700` (v1 value, DIP-X proposes 7500)
- Missing: all ETH-specific params (`NETWORK_FEE_ETH`, `MIN_OPERATOR_ETH_FEE`, `MAX_OPERATOR_ETH_FEE`, etc.)

**Impact:** `.env.example` needs updating for v2.0.0 but is low priority since the fork config JSON is the actual deployment source.

### `test/common/constants.ts` — Defaults for Tests

| Constant | Value | Notes |
|----------|-------|-------|
| `DEFAULT_UNSTAKE_COOLDOWN` | `604800` (7 days) | ✅ Correct |
| `NETWORK_FEE_ETH` | `3000000000` | ⚠️ Test default differs from config (3,550,900,000) |
| `MINIMUM_BLOCKS_BEFORE_LIQUIDATION` | `214800` | Test value, differs from config (35,800) |
| `MINIMUM_LIQUIDATION_PERIOD_COLLATERAL` | `1_000_000_000_000_000` | Test default, config uses 940,000,000,000,000 |
| `MINIMAL_OPERATOR_ETH_FEE` | `1770_000_000` | Close to spec default |
| `MAXIMUM_OPERATORS_FEE` | `76528650000000` | Much larger than config (5,326,300,000) — test ceiling |

Test defaults diverge from production config, which is acceptable since tests override via `envBigInt` and fork tests use config values.

---

## 4. Dead Code Scan

### Contracts (`contracts/`)

| Category | Finding |
|----------|---------|
| TODO/FIXME/HACK/XXX | **None found** ✅ |
| Commented-out code | **None found** ✅ |
| Unused errors | 2 unused error declarations in `ISSVNetworkCore.sol`: `NotAuthorized()` (line 185), `InvalidContractAddress()` (line 235) — declared but never reverted |
| Unused events | **None** — all events are emitted ✅ |
| Unused structs | **None** ✅ |
| Unused imports | **None** ✅ |

### Scripts (`scripts/`)

| Category | Finding |
|----------|---------|
| TODO/FIXME | **None** ✅ |
| Commented-out code | `upgrade-fork.ts` has 4 commented-out lines (lines 404, 439, 608, 644) related to SSVNetwork base implementation deploy — intentional, staking upgrade inherits base |

### Tests (`test/`)

| Category | Finding |
|----------|---------|
| TODO/FIXME | **None** ✅ |

---

## 5. Operational Readiness

### Documentation

| Item | Status | Location |
|------|--------|----------|
| Deployment steps doc | ✅ Exists | `scripts/deployment.md` |
| Architecture doc | ✅ Exists | `docs/architecture.md` |
| Local dev guide | ✅ Exists | `docs/local-dev.md` |
| Full technical spec | ✅ Exists | `docs/SPEC.md` |
| Contract flows & invariants | ✅ Exists | `docs/FLOWS.md` |
| Justfile recipes | ✅ Exists | `Justfile` (16 recipes) |
| Gas comparison tooling | ✅ Exists | `scripts/gas-compare.ts` |
| Contract size check | ✅ Exists | `scripts/contract-sizes.ts` |
| ABI export | ✅ Exists | `scripts/common/export-abis.ts` |

### Missing Operational Items

| Item | Status | Recommendation |
|------|--------|----------------|
| Mainnet deployment checklist | ❌ Missing | Create step-by-step runbook for mainnet upgrade |
| Emergency rollback procedure | ❌ Missing | Document how to downgrade modules if issues found |
| Post-deployment verification script | ✅ Exists | `upgrade-fork.ts` has built-in verification |
| Oracle address verification | ✅ In config | `hoodi-fork.config.json` has 4 oracle addresses |
| Etherscan verification step | ✅ In Justfile | `just verify <address> <network>` |
| Fork test pipeline | ✅ Exists | `just deploy-test-fork <rpc>` |
| `.env.example` for v2.0.0 | ❌ Stale | Still contains v1 values |

---

## 6. Summary of Action Items

### Must Fix Before Mainnet

| # | Item | Severity | File |
|---|------|----------|------|
| 1 | Fix `deploy-all.ts` signature + constructor args | HIGH | `scripts/deploy-all.ts:49-110` |
| 2 | Set `quorumBps` during upgrade (either in initializer or immediately after) | MEDIUM | `SSVNetworkSSVStakingUpgrade.sol` or ops runbook |
| 3 | Verify `liquidationThresholdPeriod` value (config=35,800 vs spec=50,190) | MEDIUM | `deployments/hoodi-fork.config.json` |
| 4 | Verify `ethNetworkFee` rounding (config=3,550,900,000 vs spec=3,550,929,823) | LOW | `deployments/hoodi-fork.config.json` |

### Should Fix (Non-Blocking)

| # | Item | File |
|---|------|------|
| 5 | Remove unused errors `NotAuthorized` and `InvalidContractAddress` | `contracts/interfaces/ISSVNetworkCore.sol` |
| 6 | Update `.env.example` with v2.0.0 params | `.env.example` |
| 7 | Create mainnet deployment checklist / runbook | New doc |
| 8 | Create emergency rollback procedure doc | New doc |
| 9 | Resolve commented-out SSVNetwork impl deploy in `upgrade-fork.ts` | `scripts/upgrade-fork.ts:404,439` |

### Already Correct

- `staking-upgrade.ts` — correct signature and params ✅
- `upgrade-fork.ts` — comprehensive, with verification ✅
- All other scripts — correct ✅
- Upgrade initializer — correct `reinitializer(3)` + params ✅
- No dead code in contracts ✅
- No TODO/FIXME comments anywhere ✅
- `CSSVToken` constructor with proxy address is correct for delegatecall pattern ✅
- `cooldownDuration` uses seconds (block.timestamp), config value 604800 is correct ✅
