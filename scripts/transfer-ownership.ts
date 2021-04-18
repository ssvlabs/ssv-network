import { upgrades } from 'hardhat';

async function main() {
  const gnosisSafe = process.env.GNOSIS_SAFE_ADDRESS;
 
  console.log('Transferring ownership of ProxyAdmin...');
  // The owner of the ProxyAdmin can upgrade our contracts
  await upgrades.admin.transferProxyAdminOwnership(gnosisSafe);
  console.log(`Transferred ownership of ProxyAdmin to: ${gnosisSafe}`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
