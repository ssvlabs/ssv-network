# Compile all contracts from scratch (force recompile)
build:
    npx hardhat compile --force

# Remove Hardhat build artifacts and cache
clean:
    npx hardhat clean

# Run test suite without gas enforcement (allows larger txs)
test:
    NO_GAS_ENFORCE=true npx hardhat test

# Run unit tests only (test/unit/)
test-unit:
    NO_GAS_ENFORCE=true npx hardhat test $(find test/unit -name "*.test.ts" | xargs)

# Run integration tests only (test/integration/)
test-integration:
    NO_GAS_ENFORCE=true npx hardhat test $(find test/integration -maxdepth 1 -name "*.test.ts" | xargs)

# Run fork tests against mainnet state (requires MAINNET_RPC_URL in .env)
test-forked:
    NO_GAS_ENFORCE=true RUN_FORK=true npx hardhat test $(find test/forked -name "*.test.ts" | xargs)

# Run tests with coverage report, then generate HTML report
coverage:
    COVERAGE=true npx hardhat test --coverage
    genhtml coverage/lcov.info -o coverage/html

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

# Simulate a queued SAFE transaction on a local fork, verify the post-state, then run fork tests
simulate-safe-upgrade env tx_file network="local":
    npx hardhat compile --force
    npx tsx scripts/simulate-safe-upgrade.ts --env {{env}} --tx-file {{tx_file}} --network {{network}}

# Generate deployment attestation (bytecode hashes + config summary for committee review)
generate-attestation env="mainnet" network="":
    npx tsx scripts/generate-deployment-attestation.ts --env {{env}} {{ if network == "" { "" } else { "--network " + network } }}

# Verify on-chain state (backward-compatible alias)
verify-upgrade env network="":
    npx hardhat compile --force
    npx tsx scripts/verify-post-upgrade-config.ts --env {{env}} {{ if network == "" { "" } else { "--network " + network } }}

# === One-off Utilities ===

# Deploy a specific module contract (e.g., SSVOperators, SSVClusters)
deploy-module module network *args:
    npx hardhat compile --force
    npx tsx scripts/deploy-module.ts --network {{network}} --module {{module}} {{ if args == "" { "" } else { "--args '[\"" + replace(args, " ", "\",\"") + "\"]'" } }}

# Attach an existing deployed module to the proxy
attach-module module module-address proxy-address network:
    npx hardhat compile --force
    npx tsx scripts/attach-module.ts --network {{network}} --module {{module}} --module-address {{module-address}} --proxy-address {{proxy-address}}

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
