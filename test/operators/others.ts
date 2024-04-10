// Declare imports
import { owners, initializeContract, registerOperators, DataGenerator, CONFIG } from '../helpers/contract-helpers';
import { assertEvent } from '../helpers/utils/test';
import { trackGas, GasGroup } from '../helpers/gas-usage';

import { ethers } from 'hardhat';
import { expect } from 'chai';

// Declare globals
let ssvNetwork: any, ssvViews: any;

describe('Others Operator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    const metadata = await initializeContract();
    ssvNetwork = metadata.ssvNetwork;
    ssvViews = metadata.ssvNetworkViews;
  });

  it('Add fee recipient address emits "FeeRecipientAddressUpdated"', async () => {
    await assertEvent(
      ssvNetwork.write.setFeeRecipientAddress(
        [owners[2].account.address], {
          account: owners[1].account,
        }
      ),
      [
        {
          contract: ssvNetwork,
          eventName: 'FeeRecipientAddressUpdated',
          argNames: ['owner', 'recipientAddress'],
          argValuesList: [[owners[1].account.address, owners[2].account.address]],
        },
      ],
    );
  });

  it('Remove operator whitelisted address', async () => {
    const result = await trackGas(ssvNetwork.write.registerOperator([
      DataGenerator.publicKey(1),
      CONFIG.minimalOperatorFee]
    ));
    const { operatorId } = result.eventsByName.OperatorAdded[0].args;

    await ssvNetwork.write.setOperatorWhitelist([operatorId, owners[2].account.address]);

    await assertEvent(
      ssvNetwork.write.setOperatorWhitelist(
        [operatorId, ethers.ZeroAddress]
      ),
      [
        {
          contract: ssvNetwork,
          eventName: 'OperatorWhitelistUpdated',
          argNames: ['operatorId', 'whitelisted'],
          argValuesList: [[operatorId, ethers.ZeroAddress]],
        },
      ],
    );
  });

  it('Non-owner remove operator whitelisted address reverts "CallerNotOwner"', async () => {
    const result = await trackGas(ssvNetwork.write.registerOperator(
      [DataGenerator.publicKey(1),
      CONFIG.minimalOperatorFee],
      { account: owners[1].account }
    ));
    const { operatorId } = result.eventsByName.OperatorAdded[0].args;

    await ssvNetwork.write.setOperatorWhitelist([operatorId, owners[2].account.address],
      { account: owners[1].account });

    await expect(ssvNetwork.write.setOperatorWhitelist([operatorId, ethers.ZeroAddress]))
      .to.be.rejectedWith('CallerNotOwner');
  });

  it('Update operator whitelisted address', async () => {
    const result = await trackGas(ssvNetwork.write.registerOperator([
      DataGenerator.publicKey(1),
      CONFIG.minimalOperatorFee
    ]));
    const { operatorId } = result.eventsByName.OperatorAdded[0].args;


    await assertEvent(
      ssvNetwork.write.setOperatorWhitelist(
        [operatorId, owners[2].account.address]
      ),
      [
        {
          contract: ssvNetwork,
          eventName: 'OperatorWhitelistUpdated',
          argNames: ['operatorId', 'whitelisted'],
          argValuesList: [[operatorId, owners[2].account.address]],
        },
      ],
    );
  });

  it('Non-owner update operator whitelisted address reverts "CallerNotOwner"', async () => {
    const result = await trackGas(ssvNetwork.write.registerOperator([
      DataGenerator.publicKey(1),
      CONFIG.minimalOperatorFee
    ], { account: owners[1].account }));
    const { operatorId } = result.eventsByName.OperatorAdded[0].args;

    await expect(ssvNetwork.write.setOperatorWhitelist([operatorId, owners[2].account.address]))
      .to.be.rejectedWith('CallerNotOwner');
  });

  it('Get the maximum number of validators per operator', async () => {
    expect(await ssvViews.read.getValidatorsPerOperatorLimit()).to.equal(CONFIG.validatorsPerOperatorLimit);
  });

});