import hre from 'hardhat';

import { assertEvent } from '../helpers/utils/test';
const { expect } = require('chai');

describe('BasicWhitelisting', () => {
  let basicWhitelisting: any, owners: any;

  beforeEach(async () => {
    owners = await hre.viem.getWalletClients();

    basicWhitelisting = await hre.viem.deployContract('BasicWhitelisting');
  });

  describe('Deployment', async () => {
    it('Should set the right owner', async () => {
      expect(await basicWhitelisting.read.owner()).to.deep.equal(owners[0].account.address);
    });
  });

  describe('Whitelisting', async () => {
    it('Should whitelist an address', async () => {
      const addr1 = owners[2].account.address;

      await basicWhitelisting.write.addWhitelistedAddress([addr1]);
      expect(await basicWhitelisting.read.isWhitelisted([addr1, 0])).to.be.true;
    });

    it('Should remove an address from whitelist', async () => {
      const addr1 = owners[2].account.address;

      await basicWhitelisting.write.addWhitelistedAddress([addr1]);
      await basicWhitelisting.write.removeWhitelistedAddress([addr1]);
      expect(await basicWhitelisting.read.isWhitelisted([addr1, 0])).to.be.false;
    });

    it('Should emit AddressWhitelisted event', async () => {
      const addr1 = owners[2].account.address;

      await assertEvent(basicWhitelisting.write.addWhitelistedAddress([addr1]), [
        {
          contract: basicWhitelisting,
          eventName: 'AddressWhitelisted',
          argNames: ['account'],
          argValuesList: [[addr1]],
        },
      ]);
    });

    it('Should emit AddressRemovedFromWhitelist event', async () => {
      const addr1 = owners[2].account.address;

      await basicWhitelisting.write.addWhitelistedAddress([addr1]);

      await assertEvent(basicWhitelisting.write.removeWhitelistedAddress([addr1]), [
        {
          contract: basicWhitelisting,
          eventName: 'AddressRemovedFromWhitelist',
          argNames: ['account'],
          argValuesList: [[addr1]],
        },
      ]);
    });

    it('Should only allow the owner to whitelist addresses', async () => {
      const addr1 = owners[2].account.address;

      await expect(
        basicWhitelisting.write.addWhitelistedAddress([addr1], {
          account: owners[1].account,
        }),
      ).to.be.rejectedWith('Ownable: caller is not the owner');
    });

    it('Should only allow the owner to remove addresses from whitelist', async () => {
      const addr1 = owners[2].account.address;

      await basicWhitelisting.write.addWhitelistedAddress([addr1]);
      await expect(
        basicWhitelisting.write.removeWhitelistedAddress([addr1], {
          account: owners[1].account,
        }),
      ).to.be.rejectedWith('Ownable: caller is not the owner');
    });
  });
});
