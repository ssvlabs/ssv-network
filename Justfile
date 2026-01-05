build:
    npx hardhat compile --force

clean:
    npx hardhat clean

sizes:
    npx hardhat compile --force
    npx tsx ./scripts/contract-sizes.ts

deploy-module module network:
    npx hardhat compile --force
    npx tsx scripts/deploy-module.ts --network {{network}} --module {{module}}

deploy-implementation contract network:
    npx hardhat compile --force
    npx tsx scripts/deploy-implementation.ts --network {{network}} --contract {{contract}}

deploy-all network:
    npx hardhat compile --force
    npx tsx scripts/deploy-all.ts --network {{network}}

update-module module proxy network:
    npx hardhat compile --force
    npx tsx scripts/update-module.ts --network {{network}} --module {{module}} --proxy-address {{proxy}}

upgrade-contract contract proxy network:
    npx hardhat compile --force
    npx tsx scripts/upgrade-contract.ts --network {{network}} --contract {{contract}} --proxy-address {{proxy}}

upgrade-implementation contract proxy implementation network:
    npx tsx scripts/upgrade-with-impl.ts --network {{network}} --contract {{contract}} --proxy-address {{proxy}} --impl-address {{implementation}}

verify address network:
    npx hardhat verify --network "{{network}}" "{{address}}"

abis:
  npx hardhat compile --force
  npx tsx scripts/common/export-abis.ts