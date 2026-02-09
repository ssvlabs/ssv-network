build:
    npx hardhat compile --force

clean:
    npx hardhat clean

test:
    NO_GAS_ENFORCE=true npx hardhat test

coverage:
    COVERAGE=true npx hardhat test --coverage
    genhtml coverage/lcov.info -o coverage/html

sizes:
    npx hardhat compile --force
    npx tsx ./scripts/contract-sizes.ts

deploy-module module network *args:
    npx hardhat compile --force
    npx tsx scripts/deploy-module.ts --network {{network}} --module {{module}} {{ if args == "" { "" } else { "--args '[\"" + replace(args, " ", "\",\"") + "\"]'" } }}

deploy-implementation contract network:
    npx hardhat compile --force
    npx tsx scripts/deploy-implementation.ts --network {{network}} --contract {{contract}}

deploy-all network:
    npx hardhat compile --force
    npx tsx scripts/deploy-all.ts --network {{network}}

update-module module proxy network *args:
    npx hardhat compile --force
    npx tsx scripts/update-module.ts --network {{network}} --module {{module}} --proxy-address {{proxy}} {{ if args == "" { "" } else { "--args '[\"" + replace(args, " ", "\",\"") + "\"]'" } }}

upgrade-contract contract proxy network:
    npx hardhat compile --force
    npx tsx scripts/upgrade-contract.ts --network {{network}} --contract {{contract}} --proxy-address {{proxy}}

upgrade-implementation contract proxy implementation network:
    npx tsx scripts/upgrade-with-impl.ts --network {{network}} --contract {{contract}} --proxy-address {{proxy}} --impl-address {{implementation}}

attach-module module module-address proxy-address network:
    npx hardhat compile --force
    npx tsx scripts/attach-module.ts --network {{network}} --module {{module}} --module-address {{module-address}} --proxy-address {{proxy-address}}

upgrade-ssv-staking proxy network:
    npx hardhat compile --force
    npx tsx scripts/staking-upgrade.ts --network {{network}} --proxy-address {{proxy}}

verify address network:
    npx hardhat verify --network "{{network}}" "{{address}}"

abis:
  npx hardhat compile --force
  npx tsx scripts/common/export-abis.ts