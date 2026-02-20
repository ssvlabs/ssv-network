# Proposing Effective balance oracles and SSV staking to support new ETH-denominated network fees

*Everything discussed below is a work in progress, intended to spark discussion within the ssv.network DAO and beyond. Implementation details and binding steps will be submitted to the ssv.network DAO snapshot after community feedback is gathered.*

# Introduction

The ssv.network DAO ("DAO") proposes introducing SSV Staking as part of a *broader set of protocol upgrades* designed to support ETH-denominated payments and native effective balance accounting within the SSV Network.

The transition to ETH payments simplifies the protocol's economic model by aligning fee settlement with the asset in which validator rewards are generated. Moving fee payments to ETH removes cross-asset dependencies, reduces operational complexity, and enables more direct and predictable protocol-level accounting.

In parallel, supporting Ethereum's post-Pectra validator model requires effective balance-aware accounting. Effective Balance Accounting ensures that fees, runway calculations, and liquidation logic scale with the actual stake secured by validators, rather than relying on fixed assumptions. Implementing this model natively requires the protocol to reflect validator effective balances on-chain throughout their lifecycle.

To bridge the gap between Ethereum's consensus layer and on-chain accounting, the protocol introduces Effective Balance Oracles, which track validator balances and update protocol state. Operating this oracle system in a decentralized and resilient manner requires participation and delegation by parties economically aligned with the protocol.

SSV Staking provides such a delegation mechanism, allowing SSV holders to stake their tokens and delegate stake toward the selection of Effective Balance Oracles. In doing so, protocol fee flows are reflected through the staking mechanism in proportion to protocol usage, strengthening alignment between token holders and the network.

---

# Components of SSV Staking

SSV Staking is enabled through three tightly coupled components:

* **ETH Payments** introduces native ETH-denominated fees at the protocol level, allowing network and operator fees to be paid and settled in ETH.

* **Effective Balance Accounting** upgrades the protocol's accounting model to calculate fees, runway consumption, and liquidation conditions based on validators' actual effective balance, rather than assuming a fixed 32 ETH per validator. This enables stake-aware accounting that natively aligns the protocol with Ethereum's post-Pectra validator model.

* **SSV Staking** introduces staking and delegation functionality for SSV holders. Through staking, participants lock SSV and support the protocol's operation by participating in the distributed selection of *Effective Balance Oracles*. In turn, they are rewarded in ETH for their effort based on the amount of SSV staked.

---

# ETH Payments

ETH Payments introduce a fundamental change to how economic accounting is handled within the SSV Network. With such payments, operator fees and network fees are paid in ETH, replacing the existing SSV-denominated payment model.

## Motivation

The SSV Network operates at the validator layer of Ethereum, where rewards are generated exclusively in ETH. However, the current fee model requires participants to manage and pay fees in SSV, creating a structural mismatch between where value is produced and how costs are paid.

Transitioning to ETH payments addresses this mismatch and delivers several standalone benefits:

* **Asset alignment** - Clusters pay fees in the same asset that their validators earn. This removes the need for conversions, hedging, or the complexities of using another token in order to operate validators.

* **Economic predictability** - SSV-denominated fees fluctuate independently of validator rewards, forcing frequent adjustments to pricing and governance parameters.

* **Operational simplicity** - Paying fees in ETH simplifies accounting, budgeting, and automation for cluster owners and operators. ETH balances directly represent the operational runway without requiring additional token management.

* **Institutional accessibility** - ETH-denominated payments remove a major adoption barrier for institutional and regulated participants, who often prefer or require minimizing exposure to additional tokens and non-native protocol tokens.

## ETH as the Native Payment Asset

Transitioning to ETH payments defines a clear separation between how new clusters are created and how existing SSV-based clusters are handled going forward:

### New Clusters

All new clusters will operate with ETH payments from the outset:

* Operator fees are paid in ETH

* Network fees are paid in ETH

* ETH must be deposited upfront to fund the cluster's operational runway

### Existing Clusters (SSV-based)

Existing SSV-based clusters are treated as **legacy**, and support for actively operating them under the SSV payment model is removed. While these clusters may continue running as long as they have sufficient runway, they can no longer be maintained through operational changes.

This means that adding new validators, removing existing validators, reactivating liquidated clusters or depositing additional SSV to extend a cluster's runway is no longer supported. As a result, **the only path forward for maintaining an existing cluster is migration to ETH payments**, which restores full cluster functionality under the new payment and accounting model.

For cluster owners who do not wish to migrate or are unable to do so, the remaining option is to voluntarily liquidate the cluster. Self-liquidation returns the remaining cluster balance to the owner and signals operators to stop operating the cluster's validators. However, if the intention is to continue operating the validators in the future, migration to ETH payments will be required in order to do so.

For cluster owners who anticipate needing more time to migrate but intend to continue operating their validators, it is critical to deposit sufficient SSV in advance to ensure enough operational runway until migration can be completed.

*To guarantee all users have the option to top up their clusters before the transition to ETH payments, the SSV Foundation is requested to publish a prominent message on DAO-managed channels and assets relevant to disseminating information regarding the future inability to fund clusters with SSV.*

## Cluster Migration

Cluster migration allows existing SSV-based clusters to transition into ETH payments. Migration applies at the cluster level, and each cluster can be migrated in a single interaction, which upgrades it to ETH payments immediately.

To migrate, the cluster owner initiates the migration and deposits sufficient ETH to fund the cluster's future operation runway under the ETH payment model. As part of the migration, the cluster's accounting is switched from SSV to ETH, and any remaining SSV balance is returned to the cluster owner.

Migration is a one-way process - once a cluster is migrated to ETH payments, it cannot revert back to SSV-based payments.

## Operator Payments & Fee Transition

Transitioning to ETH payments defines a clear separation between how new operators are onboarded and how existing operators transition from SSV-based fees to ETH-based fees.

### New Operators

New operators onboard directly with ETH-denominated fees. From launch onward, operators registering in the network will not be able to define or configure fees in SSV and will operate exclusively under the ETH payment model.

### Existing Operators

Existing operators continue earning SSV-denominated fees only for clusters that have not yet migrated. These SSV fees continue to accrue, but operators are no longer able to modify or adjust their SSV fee configuration. Accrued fees can still be withdrawn.

Once clusters migrate to ETH payments, or when new ETH-denominated clusters are onboarded, operators begin earning fees in ETH based on their assigned *default ETH fee* configuration.

#### Default ETH Fee

At launch, **all existing operators are assigned a default ETH fee** to ensure that operator pricing does not become a blocker for cluster migration:

* Operators with a **0 SSV** fee default to a **0 ETH** fee

* Operators with a **non-zero SSV fee** default to a network-defined ETH fee

We propose setting the default ETH fee for non-zero SSV operators to an amount equivalent to approximately 0.5% of Ethereum staking rewards per 32 ETH validator. Based on a 2.9% ETH staking APR, this corresponds to:

* 0.00928 ETH per validator per year

Under this default:

* A standard 4-operator cluster pays ~2% of staking rewards to operators, with each operator earning ~0.5%

* Clusters with more than four operators pay proportionally more (e.g., a 7-operator cluster pays ~3.5%)

The proposed default ETH operator fee was evaluated by examining the current fee structure on the SSV Network. At present, the weighted average fee charged by public operators is approximately **0.761 SSV**, which corresponds to roughly **0.1%** of Ethereum staking rewards.

Over time, SSV-denominated operator fees have converged toward very low levels, resulting in a fee structure that no longer reflects the underlying cost, responsibility, or risk associated with operating validators.

Against this backdrop, the proposed default ETH operator fee - set at **0.5%** of Ethereum staking rewards per operator, is intentionally and materially higher than the current network average. This higher starting point establishes a new baseline under the ETH-based model, from which operators can subsequently reprice based on market dynamics and competition. Any such fee adjustments remain subject to the existing fee update constraints and limitations.

## Governance Parameters

The transition to ETH payments introduces a set of new governance-controlled parameters that define the economic and risk boundaries of the protocol. A detailed evaluation of these parameters, including assumptions and methodology, is provided in the [Liquidation Collateral Parameter Evaluation](#liquidation-collateral-parameter-evaluation) and [Network Fee Implications](#network-fee-implications) sections of this proposal The values for the parameters discussed in the aforementioned sections are mentioned in those sections and below only as examples.

| Variable | Description | Update function | Initial Value |
| :---- | :---- | :---- | :---- |
| *ethNetworkFee* | Protocol network fee charged in ETH. | updateNetworkFee(uint256 fee) | 0.000000003550929823 ETH (0.00928 ETH - annual) |
| *minimumLiquidationCollateral* | Minimum ETH collateral an ETH-denominated cluster must maintain; falling below this level contributes to liquidation eligibility. | updateMinimumLiquidationCollateral(uint256 amount) | 0.00094 ETH |
| *minimumBlocksBeforeLiquidation* | Minimum number of blocks an ETH-denominated cluster must maintain sufficient balance before becoming eligible for liquidation. | updateLiquidationThresholdPeriod(uint64 blocks) | 50190 (7 days) |
| *operatorMaxFee* | Maximum operator fee cap, setting a technical upper bound on operator fees denominated in ETH. This parameter exists as a protocol safety constraint to prevent extreme fee configurations and is not intended to express economic policy or target fee levels. | updateMaximumOperatorFee(uint64 maxFee) |   |
| *defaultOperatorETHFee* | Default ETH-denominated operator fee applied to existing operators during the transition from SSV-denominated fees to ETH-denominated fees. | Not governance-controlled. The default value is defined in the contract and applied automatically; it exists solely to facilitate operator migration and ensure continuity during the transition period. | 0.000000001775464912 ETH (0.00464 ETH - annual) |

---

# Effective Balance Accounting

Effective Balance Accounting updates how fees, cluster runway, and liquidations are calculated across the SSV Network by aligning them with validators' actual effective balance, rather than assuming a fixed 32 ETH per validator.

This change is required to natively support Ethereum's post-Pectra validator model, where a single validator can secure and earn rewards on significantly more than 32 ETH. Historically, this gap was partially addressed through off-chain mechanisms, but Effective Balance Accounting brings this logic fully on-chain and applies it consistently across network fees, operator fees, and cluster payments.

Specifically, this issue was partially mitigated through the Incentivized Mainnet (IM) program, which relied on an off-chain script to calculate validator balances and deduct unpaid network fees from monthly incentive rewards. This approach had several limitations: it did not apply to operator fees, it relied on periodic off-chain reconciliation, and it would not function once fees are denominated in ETH, as ETH fees cannot be deducted from SSV-based rewards.

As a result, validators with higher effective balances have remained only partially accounted for. With the transition to ETH payments, natively supporting effective balance accounting is no longer optional \- it is required to ensure all fees are correctly calculated, collected, and enforced within the protocol.

## Motivation

Moving to effective balance accounting is a long-overdue evolution of the SSV Network's core accounting model, following Ethereum's Pectra upgrade and the introduction of validators with variable effective balances. As validator structures on Ethereum have matured, the protocol must move beyond fixed assumptions and provide native support that improves correctness, reliability, and long-term sustainability across operators, clusters, and the network itself.

* **Native support for consolidated validators** - With effective balance accounting in place, the protocol natively adjusts its accounting to validators with varying effective balances. Fees, runway calculations, and safety checks all scale directly with effective balance, eliminating the need for off-chain tools to fill this gap.

* **Fair operator compensation** - Effective balance accounting enables operators to be compensated according to the actual effective balance they manage, rather than being paid under a fixed 32 ETH assumption, ensuring correct compensation for operators managing consolidated validators.

* **Preserving network revenue** - Without native effective balance support, the network would be unable to correctly collect network fees from ETH-based clusters operating consolidated validators. The Incentivized Mainnet program previously mitigated this through off-chain deductions, but this approach cannot be applied to ETH-denominated fees. Supporting effective balance accounting natively is therefore critical to prevent revenue loss as the network transitions to ETH payments.

## Accounting Changes

Effective Balance Accounting changes how fees are calculated at the cluster level by replacing validator count as a proxy with the cluster's effective balance.

### Existing Clusters (SSV-based)

In the SSV-based model, validators act as a proxy for effective balance.

Each validator is implicitly assumed to represent a fixed 32 ETH of effective balance. Fees therefore scale linearly with the number of validators in the cluster, regardless of how much effective balance those validators actually secure.

![image|690x88, 50%](upload://p2BelvkqZe0zO4ofvF91O7Zpzp7.png)

Under this model:

* Fees are defined per validator

* Total fees scale with validator count

* Consolidated validators are not fully accounted for

This model continues to apply to all SSV-based clusters. As a result:

* Network fee deduction for compensation via the Incentivized Mainnet script continues to operate

* Operators managing SSV-based clusters are not compensated based on the amount of stake they manage

### New clusters (ETH-based)

In the ETH-based model, effective balance becomes the billing unit.

Fees are defined per 32 ETH of effective balance and scale with a cluster's total effective balance, rather than with validator count:

![image|690x111, 50%](upload://uWnpB7vC9bYmwDXRceiHDTJHj9i.png)

Here, *total effective balance* refers to the **cumulative effective balance of all validators belonging to the cluster**. All accounting is performed using this aggregated cluster-level value.

As a result, ETH-based clusters pay fees proportional to the actual effective balance they secure, independent of how that balance is distributed across validator keys.

Effective balance-based accounting applies only to ETH-based clusters. SSV-based clusters continue operating under the validator-count model until they migrate, after which this becomes the only accounting model used by the protocol.

## Effective Balance Oracles

In order to achieve the DAO's stated goal of decentralizing Ethereum but doing so in the most ETH aligned way, this document suggests for the DAO to adopt Effective Balance Oracles that will perform Effective Balance Accounting. In this regard, the Effective Balance Oracles on ssv.network play a similar role to that of validators on the Ethereum blockchain, both requiring a staking mechanism and possibly a delegation to a third-party performing the needed duties, thus fulfilling a crucial part of the process. While oracles don't validate transactions as validators do, they do maintain the integrity and security of the protocol by accurately attesting what validator effective balance is, which is key for the safety of the ssv.network as discussed below.

For Effective Balance accounting to work natively, the protocol must be able to track the effective balance of validators across the network and reflect this data on-chain. Validator effective balances, however, exist only on Ethereum's consensus layer and cannot be accessed directly by smart contracts efficiently in a way that serves the purpose of this protocol.

To fill this gap, it is proposed that the protocol will rely on a dedicated set of **Effective Balance Oracles**.

Effective Balance Oracles are responsible for tracking validator effective balances on the beacon chain and enabling the protocol to keep its on-chain accounting aligned with real validator state as balances evolve over time.

### Oracle Set Composition and Evolution

#### Initial Permissioned Oracle Set

At launch, the protocol will operate with a permissioned set of four Effective Balance Oracles, operating under a 3-of-4 threshold for oracle commitments.

This initial configuration is intentionally temporary and is designed to mitigate early-stage operational and correctness risks. Effective Balance Oracles play a critical role in protocol accounting and liquidation safety, and incorrect or inconsistent balance updates could have direct and dire  consequences.

Beginning with a permissioned set allows the protocol to validate, in production, the full oracle workflow under controlled conditions. This approach reduces the risk associated with unproven implementations, misconfigured clients, or adversarial behavior during the initial rollout of effective balance accounting.

Once the oracle workflow and assumptions have been validated and observed to operate reliably over time, the protocol is intended to transition toward a permissionless oracle model, as described in subsequent sections.

**The DAO is responsible for electing the initial oracle set and overseeing its composition over time, including making changes if required to maintain correctness, availability, and operational reliability during the early phase of effective balance accounting.**

#### Oracle Compensation (Initial Phase)

During the initial permissioned phase, oracle operators will be compensated to cover the operational costs of running the Effective Balance Oracle infrastructure.

Each oracle will receive a fixed compensation of **$250 per month denominated in SSV, with a 30-day trailing average calculated on the first of the month, transferred on each consequent first msig batch** to cover infrastructure and operational costs associated with running the oracle client. In addition, oracle operators will be **fully reimbursed by the DAO for all Ethereum transaction costs** incurred as part of their oracle duties, including balance updates and Merkle root submissions. This compensation model is intended to ensure operational sustainability at launch while keeping the system simple and avoiding premature complexity around protocol-level incentives.

#### Future Permissionless Oracle Set

After the initial permissioned phase, the oracle set is intended to transition to a permissionless model. In this phase, any participant will be able to operate an Effective Balance Oracle, and the composition of the active oracle set will be determined automatically through SSV staking delegation rather than direct DAO selection.

Under this model, SSV stakers delegate their staking weight to oracle operators, using stake as voting power. The oracle set is then composed of the operators with the highest delegated stake, allowing the set to evolve and rotate over time based on staker preferences and observed performance.

Stake-based delegation is a critical component of this design. Effective Balance Oracles directly influence protocol accounting and liquidation behavior, making correctness and reliability essential. By tying oracle selection to delegated stake, the protocol ensures that oracle operators are economically aligned with the system: operators with higher delegated stake are incentivized to behave correctly, while stakers can reallocate delegation away from underperforming or untrusted oracles.

This mechanism enables the protocol to maintain decentralization and security without relying on manual selection by a trusted entity, while allowing the oracle set to adapt dynamically as conditions change. In this phase, a protocol-level compensation mechanism will also be introduced to sustainably reward oracle operators for their ongoing duties.

### Effective Balance Updates

Effective balance updates are performed in two steps, moving from global observation to cluster-level updates.

#### Step 1: Snapshot and consensus

Effective Balance Oracles continuously track validator effective balances on the beacon chain. At defined intervals, they take a snapshot of all validator balances, aggregate them per cluster, and construct a Merkle tree representing the effective balances of all clusters at that snapshot.

To reach consensus on this snapshot, each oracle independently commits the Merkle root representing this snapshot. Once a threshold of oracle commitments is reached, the snapshot is accepted by the protocol as the authoritative and accurate view of effective balances for that point in time. This threshold-based mechanism ensures both the correctness of the data and that no single oracle can dictate balance updates.

#### Step 2: Cluster balance updates

Once a snapshot is accepted, cluster-level effective balances can be updated on-chain by submitting a proof derived from the committed Merkle tree for a specific cluster.

Updating cluster balances is **permissionless**: anyone can submit a valid proof and bear the transaction cost. As a failsafe, Effective Balance Oracles are expected to periodically perform these updates themselves to ensure cluster balances remain current even if third parties do not act.

When a cluster's effective balance is updated, the protocol updates all related accounting based on the new value. This affects cluster runway calculations as well as future network and operator fee accruals tied to the amount of effective balance being managed. If an update causes a cluster to fall below liquidation thresholds, the cluster can be liquidated as part of the same process, ensuring that increases in effective balance are always matched by sufficient funding and collateral.

#### Operational Considerations for Balance Updates

Because updates are performed through periodic cluster-level sweeps, validators added to or removed from a cluster are initially accounted for using a default assumption of 32 ETH per validator. The actual effective balance of these validators - such as in the case of consolidated validators - will only be reflected once the next sweep occurs. As a result, cluster owners must account for the potential impact of delayed updates on runway and fee accrual, particularly when adding validators with higher effective balances.

## Governance Parameters

Effective Balance Accounting introduces new governance-controlled parameters that define how oracle consensus is reached for effective balance snapshots.

| Variable | Description | Update function | Initial Value |
| :---- | :---- | :---- | :---- |
| quorumBps | Quorum threshold (in BPS) required for committing an effective balance snapshot | setQuorumBps(uint16 quorum) | 7500 (75.00%) considering a ¾ threshold. |
|  | Replaces an existing Oracle with another one. | replaceOracle(uint32 oracleId, address newOracle) |  |

---

# SSV Staking

SSV Staking introduces a staking and delegation mechanism that enables SSV holders to support the operation and maintenance of the protocol. Through staking, participants lock SSV and delegate stake toward the selection of Effective Balance Oracles, which are responsible for maintaining accurate effective balance accounting within the network.

In return for participating in this process, protocol fees denominated in ETH and generated by network usage are reflected through the staking mechanism in proportion to participation. This introduces a tokenomic model in which SSV functions as an ETH accrual token, with value derived directly from protocol usage.

## Motivation

SSV Staking strengthens the role of SSV holders within the network by expanding their responsibilities beyond passive ownership. Through staking, token holders take part in selecting the oracles responsible for maintaining core protocol functions, giving them a direct role in the ongoing operation and reliability of the system.

This model places protocol maintenance in the hands of participants with long-term economic exposure to the network, while allowing responsibility to be distributed and adjusted over time through delegation.

This approach mirrors the participation model used in Ethereum staking, where ETH holders contribute to network maintenance through delegation to node operators or staking services. Similarly, SSV Staking allows token holders to participate in maintaining the protocol through delegation, without requiring direct operation of oracle infrastructure, while preserving accountability and decentralization.

By tying economic participation to long-term staking, SSV Staking also strengthens governance. Participants who benefit from sustained protocol usage and growth are more incentivized to actively engage in governance and contribute to decisions that support the protocol's long-term reliability and evolution

## Staking and cSSV

SSV holders can stake their tokens into the SSV Staking contract and receive **cSSV**, an ERC-20 token that represents their staked position at a **1:1 ratio**.

cSSV represents a claim on the underlying staked SSV, as well as a proportional share of protocol fees accrued to stakers.

As part of staking, stakers must **delegate** their staking voting power. This delegation determines the composition of the Effective Balance Oracle set, which is responsible for maintaining effective balance data on-chain.

In the temporary initial phase, staking delegation is automatically split evenly across the DAO-elected oracle set, providing a smooth starting point while establishing the foundation for stake-driven oracle selection in future phases.

## Rewards and Claiming

Protocol fees accrue continuously as validators operate on the SSV Network and generate ongoing network fees. Stakers earn a **pro-rata share of ETH-denominated fees**, based on their share of the total staked SSV.

Rewards can be claimed at any time without unstaking, and claiming does not affect the staking position.

When cSSV is transferred, rewards accrued up to that point remain claimable by the original holder, while the new holder begins accruing rewards only from the moment they receive the cSSV.

## Unstaking

Unstaking is a two-step process:

First, the staker submits a withdrawal request, which locks the specified amount of cSSV and stops reward accrual for that portion. It is proposed that the protocol will launch with a **7-day lock period**.

Once the lock period ends, the staker can finalize the unstake. The locked cSSV is burned, and the underlying SSV is returned at a 1:1 ratio relative to the original stake.

## Governance Rights

Staked SSV, represented by cSSV, **retains full governance and voting power**. Holding cSSV does not reduce a user's ability to participate in DAO governance compared to holding unstaked SSV.

This ensures that participants who stake their SSV continue to influence the protocol's direction, while aligning governance participation with sustained economic exposure to the network.

## Governance Parameters

SSV Staking introduces new governance-controlled parameters that define the lifecycle and constraints of staking and unstaking within the protocol.

| Variable | Description | Update function | Initial Value |
| :---- | :---- | :---- | :---- |
| cooldownDuration | Unstake cooldown duration (in blocks): the period users must wait between requesting an unstake and being able to withdraw their unlocked SSV. | setUnstakeCooldownDuration(uint64 blocks) | 50120 (7 days) |

# Protocol Transition and Governance Implications

The introduction of ETH-denominated payments and native effective balance accounting represents a structural upgrade to the SSV Network. Beyond the core protocol design, these changes require deliberate updates to incentives, parameters, and legacy governance decisions.

## Incentivized Mainnet Transition

With the introduction of ETH payments, network fees for ETH-denominated clusters are no longer compatible with the Incentivized Mainnet fee deduction mechanism (Incentivized Mainnet rewards are distributed in SSV, while network fees for these clusters are paid in ETH). As a result, network fees cannot be deducted from Incentivized Mainnet rewards for validators operating as part of ETH-denominated clusters.

At the same time, ETH-denominated clusters operate under the new effective balance accounting model, where network fees are calculated and collected natively by the protocol. Because these fees are already enforced on-chain, applying additional off-chain deductions via the Incentivized Mainnet script becomes obsolete for ETH-denominated clusters.

To reflect this distinction, the Incentivized Mainnet script will be updated to differentiate between legacy SSV-based clusters and ETH-denominated clusters:

* **ETH-denominated clusters -** Network fee deductions are removed.

* **SSV-based clusters -** Network fees continue to be deducted from Incentivized Mainnet rewards under the existing model.

This update ensures that Incentivized Mainnet behavior remains aligned with the accounting and fee mechanisms applicable to each cluster type, while correctly supporting ETH-denominated clusters under the upgraded protocol model.

---

## Liquidation Collateral Parameter Evaluation

The liquidation collateral and liquidation threshold parameters currently in effect were derived using a DAO-approved calculation framework, most recently formalized in [DIP-44](https://snapshot.org/#/s:mainnet.ssvnetwork.eth/proposal/0x5ab8383681f4efec61c1e89388477e18de3f1b9a34ce1fef001e55043a8f3273). With the introduction of ETH payments, the protocol introduces dedicated liquidation parameters for ETH-denominated clusters. As part of defining these new parameters, it is appropriate to revisit the existing calculation framework to ensure that its underlying assumptions remain valid under current network conditions.

### Revisiting the Calculation Framework

The existing framework relies on a **1-year historical lookback window** for gas price data. This choice was appropriate at the time of adoption, when gas prices were higher and more volatile.

However, recent Ethereum network conditions differ materially from those reflected in earlier datasets. In particular:

* Average gas prices have declined significantly

* Gas price volatility has stabilized

* Sustained Layer 2 adoption has structurally reduced congestion on Ethereum mainnet

As a result, a full 1-year lookback increasingly overweights historical periods that are no longer representative of current or expected near-term conditions.

To illustrate this shift, the following charts compare historical gas price behavior under different lookback windows:

![image|690x280](upload://8hRge5dE8zSuB6g0BBWEvKnMusw.png)

*Ethereum gas prices over the last year (reference \- [ycharts.com](https://ycharts.com/indicators/ethereum_average_gas_price))* 

![image|690x267](upload://joYrIivA0jpY5kms7LbgyHIxov9.png)

*Ethereum gas prices over the last 6 months (reference \- [ycharts.com](https://ycharts.com/indicators/ethereum_average_gas_price))* 

Under a 1-year lookback window:

* **Average gas price:** \~3.51 GWEI

* **Gas price standard deviation:** \~4.63 GWEI

Under a 6-month lookback window:

* **Average gas price:** \~1.86 GWEI

* **Gas price standard deviation:** \~1.86 GWEI

This represents a substantial reduction in both average gas costs and volatility. Continuing to rely on a 1-year window would therefore embed outdated assumptions into the liquidation model, resulting in parameters that are more conservative than current network conditions justify.

For this reason, it is proposed to update the calculation framework to use a **rolling 6-month lookback window**. By grounding liquidation cost assumptions in more recent gas price data, the framework reflects both a lower average gas cost and reduced volatility. This, in turn, lowers the estimated worst-case cost of executing a liquidation and reduces the amount of collateral required to safely incentivize liquidators, improving capital efficiency without weakening safety guarantees.

This change applies to the framework itself, and therefore affects all parameter evaluations derived from it going forward.

### Impact on Existing SSV-Based Parameters

Applying the updated 6-month lookback window to the existing framework results in revised parameter values for SSV-denominated clusters:

| Parameter | Current Value | Proposed Value | Deviance |
| :---- | :---- | :---- | :---- |
| *minimumLiquidationCollateralSSV* | 1.53 SSV | 0.883 SSV | \-42.52% (\>15%) |
| *minimumBlocksBeforeLiquidationSSV*  | 14 days | 100380(14 days) | 0% (\<15%) |

[*Calculations sheet*](https://docs.google.com/spreadsheets/d/1pa7VDZywlc5He2rS7qVbAKVv2KQrj7wZ-yvabpMRvUo/edit?usp=sharing)

These updated values are a direct consequence of revised inputs rather than a change in liquidation logic. They are presented to maintain methodological consistency with prior DAO decisions.

The DAO may choose to adopt these updated SSV-denominated values as part of this proposal or defer their application to a separate governance decision.

### ETH-Denominated Liquidation Parameters

In parallel to the existing SSV-denominated parameters, ETH-denominated clusters require a **dedicated set of liquidation parameters** derived from the same framework but adjusted to reflect their materially different risk profile.

#### Reduced Risk from Removing SSV from the Calculation Framework

Under the legacy SSV-based model, liquidation parameters were required to account for a cross-asset mismatch: liquidation execution costs are paid in ETH, while liquidation rewards and fee accrual are denominated in SSV. This required incorporating assumptions around SSV/ETH price ratios and their deviations, increasing uncertainty and necessitating more conservative parameter values.

By removing SSV from the calculation framework, ETH-denominated clusters eliminate this cross-asset exposure entirely. Network fees, collateral, and liquidation execution are all denominated in ETH, resulting in a more predictable and tightly bounded liquidation model.

#### Revised Liquidation Functions for ETH-Denominated Clusters

With SSV-denominated components removed from the calculation framework, the existing liquidation functions can be simplified and recalibrated for ETH-denominated accounting.

The calculation framework uses the following formulas for SSV-denominated clusters:

* Minimum Liquidation Collateral  

![image|690x57, 50%](upload://3dvCyE3Kh3eHUJPOWEt6TMrHSSY.png)

* Liquidation Threshold

![image|690x66, 50%](upload://ae570VVYXDfsFMPbdp5oe3InDRN.png)

New formulas for ETH-denominated clusters:

* Minimum Liquidation Collateral  

![image|690x97, 50%](upload://eBvHtGoMdNmprbjB6n7ckxMoo9q.png)

* Liquidation Threshold

![image|690x88, 50%](upload://xy3dPLIc4Rxe43ouHptc4woj9jR.png)

These ETH-denominated functions maintain the same safety objectives as the legacy framework, while allowing parameters to reflect the reduced risk profile enabled by ETH-denominated accounting.

#### Proposed Initial Parameters for ETH-Denominated Clusters

Applying the ETH-specific liquidation functions yields the following proposed **initial liquidation parameters** for ETH-denominated clusters:

| Parameter | Current Value | Proposed Value | Deviance |
| :---- | :---- | :---- | :---- |
| *minimumLiquidationCollateral* | - | 0.00094 ETH | 100% (>15%) |
| *minimumBlocksBeforeLiquidation*  | - | 50190 (7 days) | 100% (>15%)  |

[*Calculations sheet*](https://docs.google.com/spreadsheets/d/1pa7VDZywlc5He2rS7qVbAKVv2KQrj7wZ-yvabpMRvUo/edit?usp=sharing)

These values are proposed as initial settings and remain fully governance-controlled. As with all liquidation-related parameters, the DAO retains the ability to adjust them as network conditions and assumptions evolve.

---

## Network Fee Implications

### Network Fee for ETH-Denominated Clusters

As part of the transition to ETH-denominated clusters, the protocol introduces a **dedicated network fee denominated in ETH**, applied to ETH-denominated clusters.

Under the legacy SSV-based model, the network fee calculation incorporated an ETH/SSV conversion factor, reflecting the fact that protocol fees were accrued in SSV while staking rewards and execution costs were denominated in ETH. With ETH-denominated clusters, this conversion is no longer required.

For ETH-denominated clusters, the network fee is calculated natively in ETH as:

![image|690x70, 50%](upload://ri9U6MpvfFhv8iWC0aOubQIUgiM.png)

This formulation removes SSV entirely from the network fee calculation and aligns fee accrual directly with ETH-denominated validator rewards.

##### Proposed Network Fee

Applying the ETH-denominated network fee formulation yields the following **proposed initial network fee parameter** for ETH-denominated clusters:

| Parameter | Current Value | Proposed Value | Deviance |
| :---- | :---- | :---- | :---- |
| *ethNetworkFee* | – | 0.000000003550929823 ETH (0.00928 ETH \- annual) | 100% (\>15%) |

###  Implications for the Legacy SSV Network Fee

Once all clusters have migrated from SSV-based accounting to ETH-denominated clusters, the protocol will no longer rely on SSV-denominated network fees or ETH/SSV conversion logic.

The existing governance mechanism for bounding the SSV network fee via a ratio-based maximum, as defined in [DIP-49](https://snapshot.org/#/s:mainnet.ssvnetwork.eth/proposal/0x5300de7fd0df8c07b06b1e4ad71bdf036945b26787b0157d70ab80fee3ad4126), was introduced to constrain the network fee under a model where fees were denominated in SSV and implicitly exposed to ETH price dynamics.

Under an ETH-denominated fee model, this constraint becomes irrelevant. With network fees calculated and collected directly in ETH, there is no longer an SSV/ETH ratio to bound, and governance of the protocol network fee is expressed solely through the ETH-denominated network fee parameter.

---

## Future Consideration: Public-Good DVT Clusters (SSV-Based)

In future versions of the protocol, the SSV Network may explore supporting SSV-based clusters as a dedicated mode for public-good DVT use cases.

Under this model, public-good DVT clusters would operate without paying protocol-level network fees. In exchange, these clusters would not participate in incentive programs such as the Incentivized Mainnet (IM). This preserves economic neutrality while allowing certain DVT deployments to operate purely as public infrastructure.

This approach acknowledges that while SSV-based clusters are being deprecated for ongoing commercial operation, they may still serve a purpose as a constrained and clearly defined execution mode for non-commercial validator setups - such as research, experimentation, or ecosystem infrastructure - without distorting the protocol's economic model.

This concept is not part of the current release and is presented as a potential future extension to support public-good DVT use cases in a principled and economically isolated manner.
