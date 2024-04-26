// Declare imports
import {
  owners,
  initializeContract,
  DataGenerator,
  CONFIG,
} from '../helpers/contract-helpers';
import { assertEvent } from '../helpers/utils/test';
import { trackGas, GasGroup } from '../helpers/gas-usage';

import { ethers } from 'hardhat';
import { expect } from 'chai';

// Declare globals
let ssvNetwork: any, ssvViews: any;

describe('Register Operator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    const metadata = await initializeContract();
    ssvNetwork = metadata.ssvNetwork;
    ssvViews = metadata.ssvNetworkViews;
  });

  it('Register operator emits "OperatorAdded"', async () => {
    const publicKey = DataGenerator.publicKey(0);

    await assertEvent(
      ssvNetwork.write.registerOperator([publicKey, CONFIG.minimalOperatorFee], {
        account: owners[1].account,
      }),
      [
        {
          contract: ssvNetwork,
          eventName: 'OperatorAdded',
          argNames: ['operatorId', 'owner', 'publicKey', 'fee'],
          argValuesList: [[1, owners[1].account.address, publicKey, CONFIG.minimalOperatorFee]],
        },
      ],
    );
  });

  it('Register operator gas limits', async () => {
    await trackGas(
      ssvNetwork.write.registerOperator([DataGenerator.publicKey(0), CONFIG.minimalOperatorFee], {
        account: owners[1].account,
      }),
      [GasGroup.REGISTER_OPERATOR],
    );
  });

  it('Get operator by id', async () => {
    await ssvNetwork.write.registerOperator([DataGenerator.publicKey(0), CONFIG.minimalOperatorFee], {
      account: owners[1].account,
    });

    expect(await ssvViews.read.getOperatorById([1])).to.deep.equal([
      owners[1].account.address, // owner
      CONFIG.minimalOperatorFee, // fee
      0, // validatorCount
      ethers.ZeroAddress, // whitelisted
      false, // isPrivate
      true, // active
    ]);
  });

  it('Get non-existent operator by id', async () => {
    await ssvNetwork.write.registerOperator([DataGenerator.publicKey(0), CONFIG.minimalOperatorFee], {
      account: owners[1].account,
    });

    expect(await ssvViews.read.getOperatorById([5])).to.deep.equal([
      ethers.ZeroAddress, // owner
      0, // fee
      0, // validatorCount
      ethers.ZeroAddress, // whitelisted
      false, // isPrivate
      false, // active
    ]);
  });

  it('Get operator removed by id', async () => {
    await ssvNetwork.write.registerOperator([DataGenerator.publicKey(0), CONFIG.minimalOperatorFee], {
      account: owners[1].account,
    });    
    await ssvNetwork.write.removeOperator([1], {
      account: owners[1].account,
    });

    expect(await ssvViews.read.getOperatorById([1])).to.deep.equal([
      owners[1].account.address, // owner
      0, // fee
      0, // validatorCount
      ethers.ZeroAddress, // whitelisted
      false, // isPrivate
      false, // active
    ]);
  });

  it('Register an operator with a fee thats too low reverts "FeeTooLow"', async () => {
    await expect(ssvNetwork.write.registerOperator([DataGenerator.publicKey(0), '10'])).to.be.rejectedWith(
      'FeeTooLow',
    );
  });

  it('Register an operator with a fee thats too high reverts "FeeTooHigh"', async () => {
    await expect(ssvNetwork.write.registerOperator([DataGenerator.publicKey(0), 2e14])).to.be.rejectedWith(
      'FeeTooHigh',
    );
  });

  it('Register same operator twice reverts "OperatorAlreadyExists"', async () => {
    const publicKey = DataGenerator.publicKey(1);
    await ssvNetwork.write.registerOperator([publicKey, CONFIG.minimalOperatorFee], {
      account: owners[1].account,
    }); 

    await expect(
      ssvNetwork.write.registerOperator([publicKey, CONFIG.minimalOperatorFee], {
        account: owners[1].account,
      })
    ).to.be.rejectedWith('OperatorAlreadyExists');
  });
});
