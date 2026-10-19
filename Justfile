# Compile all contracts from scratch (force recompile)
build:
    npx hardhat compile --force

# Remove Hardhat build artifacts and cache
clean:
    npx hardhat clean

# Run test suite without gas enforcement (allows larger txs)
test:
    NO_GAS_ENFORCE=true npx hardhat test

# Run unit tests only (test/unit/, recursive)
test-unit:
    NO_GAS_ENFORCE=true bash scripts/ci/run-test-family.sh unit

# Run integration tests only (test/integration/, recursive)
test-integration:
    NO_GAS_ENFORCE=true bash scripts/ci/run-test-family.sh integration

# Run e2e tests only (test/e2e/, recursive)
test-e2e:
    NO_GAS_ENFORCE=true bash scripts/ci/run-test-family.sh e2e

# Run sanity tests only (test/sanity/, every .ts including effective-balance.ts)
test-sanity:
    NO_GAS_ENFORCE=true bash scripts/ci/run-test-family.sh sanity

# Fail if a test file belongs to no family (or to several)
test-families-check:
    bash scripts/ci/test-family-files.sh --check

# Full suite with in-test gas limits enforced. NO_GAS_ENFORCE must be ABSENT:
# any value, including "false" or "0", disables enforcement (test/helpers/gas-usage.ts).
test-gas-enforced:
    env -u NO_GAS_ENFORCE REPORT_GAS=true npx hardhat test mocha
    npx tsx scripts/gas-compare.ts --mode limits --expected-ops scripts/ci/gas-expected-ops.txt

# Frozen-graph equivalence: current gas report must equal the reference report exactly (operation
# set, limits, min/max/average/txCount, summary; only timestamp/commit/branch ignored).
# Example: just gas-exact reference/gas-report.json
gas-exact baseline current="gas-report.json":
    npx tsx scripts/gas-compare.ts --mode exact --expected-ops scripts/ci/gas-expected-ops.txt --baseline {{baseline}} --current {{current}}

# Run the canonical fork suite (test/test-forked) with the in-test upgrade fixture
# (requires MAINNET_RPC_URL in .env)
test-forked:
    NO_GAS_ENFORCE=true RUN_FORK=true FORK_USE_DEPLOYED_STATE=false bash scripts/ci/run-test-family.sh fork

# Run the older test/forked suite, kept as a separate regression row
test-forked-legacy:
    NO_GAS_ENFORCE=true RUN_FORK=true FORK_USE_DEPLOYED_STATE=false bash scripts/ci/run-test-family.sh fork-legacy

# Run tests with coverage report, then generate HTML report. Hardhat's --coverage writes an
# instrumented build into artifacts/, so the normal build is recompiled afterwards.
coverage:
    COVERAGE=true NO_GAS_ENFORCE=1 npx hardhat test mocha --coverage
    npx hardhat compile --force
    genhtml coverage/lcov.info -o coverage/html

# Diamond-storage struct/slot fingerprint vs the pristine reference (build-info AST, no recompile)
storage-structs out="storage-structs.txt":
    node scripts/ci/storage-structs.mjs . {{out}} --reference scripts/ci/storage-structs.reference.txt

# Check npm package contents (dry run; no publish)
pack-check:
    bash scripts/ci/check-pack.sh

# Compile contracts and display contract bytecode sizes
sizes:
    npx hardhat compile --force
    npx tsx ./scripts/contract-sizes.ts

# === Env-based Workflows ===
# All env-based recipes take `env` as the first arg.
# The network is auto-resolved from the env name (hoodi-* -> hoodi, mainnet -> mainnet, etc.).
# Pass an explicit network override as the second arg when needed (e.g. deploy to local with hoodi config).

# Fresh deployment (all contracts including proxies)
# Example: just deploy-fresh local
#          just deploy-fresh hoodi-stage           (deploys to hoodi)
#          just deploy-fresh hoodi-stage local      (deploys to local with hoodi-stage config)
deploy-fresh env="local" network="":
    npx hardhat compile --force
    npx tsx scripts/deploy-fresh.ts --env {{env}} {{ if network == "" { "" } else { "--network " + network } }}

# Deploy implementations + modules (no proxy upgrade)
# Example: just deploy hoodi-prod
#          just deploy mainnet
deploy env network="":
    npx hardhat compile --force
    npx tsx scripts/deploy.ts --env {{env}} {{ if network == "" { "" } else { "--network " + network } }}

# Upgrade on fork (pre-deployment validation)
upgrade-fork env="hoodi-stage":
    npx hardhat compile --force
    npx tsx scripts/upgrade.ts --env {{env}} --fork --network local

# Check a fork run's mocha log: nonzero passing, no failing/unexpected pending, no missing expected test
# Example: just check-fork-log fork.log
check-fork-log log expected="scripts/ci/fork-expected-tests.txt":
    npx tsx scripts/ci/check-test-log.ts --log {{log}} --expected {{expected}} --max-pending 0

# Fork tests
test-fork env="hoodi-stage":
    npx hardhat compile --force
    npx tsx scripts/run-forked-tests.ts --env {{env}} --fork-network hardhat_forked --use-deployed-state true --strict-deployed-state true --allow-deployed-fallback false --no-gas-enforce true

# End-to-end fork workflow: upgrade then run strict tests
upgrade-test-fork env="hoodi-stage":
    just upgrade-fork {{env}}
    just test-fork {{env}}

# Live upgrade (owner key required)
# Example: just upgrade hoodi-stage
#          just upgrade hoodi-prod
upgrade env network="":
    npx hardhat compile --force
    npx tsx scripts/upgrade.ts --env {{env}} {{ if network == "" { "" } else { "--network " + network } }}

# Generate SAFE multi-sig batch
generate-safe-batch env="mainnet":
    npx tsx scripts/generate-safe-batch.ts --env {{env}}

# Generate hotfix deployment attestation for a two-module mainnet hotfix
generate-hotfix-attestation env clusters validators network="":
    npx tsx scripts/generate-hotfix-attestation.ts --env {{env}} --clusters {{clusters}} --validators {{validators}} {{ if network == "" { "" } else { "--network " + network } }}

# Generate hotfix SAFE batch with exactly SSVClusters and SSVValidators updateModule calls
generate-hotfix-safe-batch env clusters validators:
    npx tsx scripts/generate-hotfix-safe-batch.ts --env {{env}} --clusters {{clusters}} --validators {{validators}}

# Generate deployment attestation (bytecode hashes + config summary for committee review)
generate-attestation env="mainnet" network="":
    npx tsx scripts/generate-deployment-attestation.ts --env {{env}} {{ if network == "" { "" } else { "--network " + network } }}

# Verify on-chain state (backward-compatible alias)
verify-upgrade env network="":
    npx hardhat compile --force
    npx tsx scripts/verify-post-upgrade-config.ts --env {{env}} {{ if network == "" { "" } else { "--network " + network } }}

# Post-upgrade smoke test on a local fork of the just-upgraded network state.
# Exercises register / deposit / stake / oracle commit / liquidate / unstake end-to-end.
# Requires the mainnet fork to be running locally (or --network <fork> override).
# Example: just smoke-test mainnet local
#          just smoke-test hoodi-stage local
smoke-test env network="":
    npx hardhat compile --force
    npx tsx scripts/smoke-test.ts --env {{env}} {{ if network == "" { "" } else { "--network " + network } }}

# === One-off Utilities ===

# Deploy a specific module contract (e.g., SSVOperators, SSVClusters)
deploy-module module network *args:
    npx hardhat compile --force
    npx tsx scripts/deploy-module.ts --network {{network}} --module {{module}} {{ if args == "" { "" } else { "--args '[\"" + replace(args, " ", "\",\"") + "\"]'" } }}

# Attach an existing deployed module to the env-configured proxy
attach-module env module module-address network="":
    npx hardhat compile --force
    npx tsx scripts/attach-module.ts --env {{env}} --module {{module}} --module-address {{module-address}} {{ if network == "" { "" } else { "--network " + network } }}

# Deploy a new module implementation and attach it to the proxy in one step
# Example: just update-module SSVValidators 0xProxyAddress hoodi
update-module module proxy network:
    npx hardhat compile --force
    npx tsx scripts/update-module.ts --module {{module}} --proxy-address {{proxy}} --network {{network}}

# Upgrade a contract via UUPS proxy pattern (optionally with pre-deployed impl)
upgrade-contract contract proxy network *impl:
    npx hardhat compile --force
    npx tsx scripts/upgrade-contract.ts --network {{network}} --contract {{contract}} --proxy-address {{proxy}} {{ if impl == "" { "" } else { "--impl-address " + impl } }}

# Verify contract source code on Etherscan/block explorer
verify address network:
    npx hardhat verify --network "{{network}}" "{{address}}"

# Export contract ABIs to JSON files for external use
abis:
    npx hardhat compile --force
    npx tsx scripts/common/export-abis.ts
