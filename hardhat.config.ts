import { task } from 'hardhat/config';
import '@nomiclabs/hardhat-waffle';
import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-etherscan';
import '@openzeppelin/hardhat-upgrades';

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task('accounts', 'Prints the list of accounts', async (args, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    compilers: [
      { version: '0.6.8' },
      { version: '0.7.3' }
    ],
  },
  networks: {
    goerli: {
      url: `http://eth1.stage.bloxinfra.com`, // ${process.env.ALCHEMYAPI_KEY}`,
      accounts: ['0x326f3f71738964d5bb06cc9711afb19898cce869afe2a561f3a258e1bb0b51bf'], //[`0x${process.env.OWNER_PRIVATE_KEY}`]
    }
  },
  etherscan: {
    // Your API key for Etherscan
    // Obtain one at https://etherscan.io/
    apiKey: 'ANXN5ZHTDYJFDS6DW57YEEMV5BP99HQHB6'
  }
};
