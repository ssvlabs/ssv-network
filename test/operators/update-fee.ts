// Declare imports
import { owners, initializeContract, registerOperators, DataGenerator, CONFIG } from '../helpers/contract-helpers';
import { assertEvent } from '../helpers/utils/test';
import { trackGas, GasGroup } from '../helpers/gas-usage';

import { time } from '@nomicfoundation/hardhat-network-helpers';

import { expect } from 'chai';

// Declare globals
let ssvNetwork: any, ssvViews: any, initialFee: BigInt;

describe('Operator Fee Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    const metadata = await initializeContract();
    ssvNetwork = metadata.ssvNetwork;
    ssvViews = metadata.ssvNetworkViews;

    initialFee = CONFIG.minimalOperatorFee * 10n;
    await registerOperators(2, 1, initialFee);
  });

  it('Declare fee emits "OperatorFeeDeclared"', async () => {
    await assertEvent(
      ssvNetwork.write.declareOperatorFee([1, initialFee + initialFee / 10n], {
        account: owners[2].account,
      }),
      [
        {
          contract: ssvNetwork,
          eventName: 'OperatorFeeDeclared',
        },
      ],
    );
  });

  it('Declare fee gas limits"', async () => {
    await trackGas(
      ssvNetwork.write.declareOperatorFee([1, initialFee + initialFee / 10n], {
        account: owners[2].account,
      }),
      [GasGroup.DECLARE_OPERATOR_FEE],
    );
  });

  it('Declare fee with zero value emits "OperatorFeeDeclared"', async () => {
    await assertEvent(
      ssvNetwork.write.declareOperatorFee([1, 0], {
        account: owners[2].account,
      }),
      [
        {
          contract: ssvNetwork,
          eventName: 'OperatorFeeDeclared',
        },
      ],
    );
  });

  it('Declare a lower fee gas limits', async () => {
    await trackGas(
      ssvNetwork.write.declareOperatorFee([1, initialFee - initialFee / 10n], {
        account: owners[2].account,
      }),
      [GasGroup.DECLARE_OPERATOR_FEE],
    );
  });

  it('Declare a higher fee gas limit', async () => {
    await trackGas(
      ssvNetwork.write.declareOperatorFee([1, initialFee + initialFee / 10n], {
        account: owners[2].account,
      }),
      [GasGroup.DECLARE_OPERATOR_FEE],
    );
  });

  it('Cancel declared fee emits "OperatorFeeDeclarationCancelled"', async () => {
    await ssvNetwork.write.declareOperatorFee([1, initialFee + initialFee / 10n], {
      account: owners[2].account,
    });

    await assertEvent(
      ssvNetwork.write.cancelDeclaredOperatorFee([1], {
        account: owners[2].account,
      }),
      [
        {
          contract: ssvNetwork,
          eventName: 'OperatorFeeDeclarationCancelled',
        },
      ],
    );
  });

  it('Cancel declared fee gas limits', async () => {
    await ssvNetwork.write.declareOperatorFee([1, initialFee + initialFee / 10n], {
      account: owners[2].account,
    });
    await trackGas(
      ssvNetwork.write.cancelDeclaredOperatorFee([1], {
        account: owners[2].account,
      }),
      [GasGroup.CANCEL_OPERATOR_FEE],
    );
  });

  it('Execute declared fee emits "OperatorFeeExecuted"', async () => {
    await ssvNetwork.write.declareOperatorFee([1, initialFee + initialFee / 10n], {
      account: owners[2].account,
    });

    await time.increase(CONFIG.declareOperatorFeePeriod);

    await assertEvent(
      ssvNetwork.write.executeOperatorFee([1], {
        account: owners[2].account,
      }),
      [
        {
          contract: ssvNetwork,
          eventName: 'OperatorFeeExecuted',
        },
      ],
    );
  });

  it('Execute declared fee gas limits', async () => {
    await ssvNetwork.write.declareOperatorFee([1, initialFee + initialFee / 10n], {
      account: owners[2].account,
    });

    await time.increase(CONFIG.declareOperatorFeePeriod);
    await trackGas(
      ssvNetwork.write.executeOperatorFee([1], {
        account: owners[2].account,
      }),
      [GasGroup.EXECUTE_OPERATOR_FEE],
    );
  });

  it('Get operator fee', async () => {
    expect(await ssvViews.read.getOperatorFee([1])).to.equal(initialFee);
  });

  it('Get fee from operator that does not exist returns 0', async () => {
    expect(await ssvViews.read.getOperatorFee([12])).to.equal(0);
  });

  it('Get operator maximum fee limit', async () => {
    expect(await ssvViews.read.getMaximumOperatorFee()).to.equal(CONFIG.maximumOperatorFee);
  });

  it('Declare fee of operator I do not own reverts "CallerNotOwnerWithData"', async () => {
    await expect(
      ssvNetwork.write.declareOperatorFee([1, initialFee + initialFee / 10n], { account: owners[1].account }),
    ).to.be.rejectedWith('CallerNotOwnerWithData');
  });

  it('Declare fee with a wrong Publickey reverts "OperatorDoesNotExist"', async () => {
    await expect(
      ssvNetwork.write.declareOperatorFee([12, initialFee + initialFee / 10n], { account: owners[1].account }),
    ).to.be.rejectedWith('OperatorDoesNotExist');
  });

  it('Declare fee when previously set to zero reverts "FeeIncreaseNotAllowed"', async () => {
    await ssvNetwork.write.declareOperatorFee([1, 0], {
      account: owners[2].account,
    });
    await time.increase(CONFIG.declareOperatorFeePeriod);
    await ssvNetwork.write.executeOperatorFee([1], {
      account: owners[2].account,
    });

    await expect(
      ssvNetwork.write.declareOperatorFee([1, initialFee + initialFee / 10n], { account: owners[2].account }),
    ).to.be.rejectedWith('FeeIncreaseNotAllowed');
  });

  it('Declare same fee value as actual reverts "SameFeeChangeNotAllowed"', async () => {
    await ssvNetwork.write.declareOperatorFee([1, initialFee / 10n], {
      account: owners[2].account,
    });
    await time.increase(CONFIG.declareOperatorFeePeriod);

    await ssvNetwork.write.executeOperatorFee([1], {
      account: owners[2].account,
    });
    await expect(
      ssvNetwork.write.declareOperatorFee([1, initialFee / 10n], { account: owners[2].account }),
    ).to.be.rejectedWith('SameFeeChangeNotAllowed');
  });

  it('Declare fee after registering an operator with zero fee reverts "FeeIncreaseNotAllowed"', async () => {
    await ssvNetwork.write.registerOperator([DataGenerator.publicKey(2), 0, false], {
      account: owners[2].account,
    });

    await expect(
      ssvNetwork.write.declareOperatorFee([2, initialFee + initialFee / 10n], { account: owners[2].account }),
    ).to.be.rejectedWith('FeeIncreaseNotAllowed');
  });

  it('Declare fee above the operators max fee increase limit reverts "FeeExceedsIncreaseLimit"', async () => {
    await expect(
      ssvNetwork.write.declareOperatorFee([1, initialFee + initialFee / 5n], { account: owners[2].account }),
    ).to.be.rejectedWith('FeeExceedsIncreaseLimit');
  });

  it('Declare fee above the operators max fee limit reverts "FeeTooHigh"', async () => {
    await expect(ssvNetwork.write.declareOperatorFee([1, 2e14], { account: owners[2].account })).to.be.rejectedWith(
      'FeeTooHigh',
    );
  });

  it('Declare fee too high reverts "FeeTooHigh" -> DAO updates limit -> declare fee emits "OperatorFeeDeclared"', async () => {
    const maxOperatorFee = 8e14;
    await ssvNetwork.write.updateMaximumOperatorFee([maxOperatorFee]);

    await ssvNetwork.write.registerOperator([DataGenerator.publicKey(10), maxOperatorFee, false], {
      account: owners[3].account,
    });

    const newOperatorFee = maxOperatorFee + maxOperatorFee / 10;

    await expect(
      ssvNetwork.write.declareOperatorFee([2, newOperatorFee], {
        account: owners[3].account,
      }),
    ).to.be.rejectedWith('FeeTooHigh');

    await assertEvent(ssvNetwork.write.updateMaximumOperatorFee([newOperatorFee]), [
      {
        contract: ssvNetwork,
        eventName: 'OperatorMaximumFeeUpdated',
        argNames: ['maxFee'],
        argValuesList: [[newOperatorFee]],
      },
    ]);

    await assertEvent(ssvNetwork.write.declareOperatorFee([2, newOperatorFee], { account: owners[3].account }), [
      {
        contract: ssvNetwork,
        eventName: 'OperatorFeeDeclared',
      },
    ]);
  });

  it('Cancel declared fee without a pending request reverts "NoFeeDeclared"', async () => {
    await expect(
      ssvNetwork.write.cancelDeclaredOperatorFee([1], {
        account: owners[2].account,
      }),
    ).to.be.rejectedWith('NoFeeDeclared');
  });

  it('Cancel declared fee of an operator I do not own reverts "CallerNotOwnerWithData"', async () => {
    await ssvNetwork.write.declareOperatorFee([1, initialFee + initialFee / 10n], {
      account: owners[2].account,
    });

    await expect(ssvNetwork.write.cancelDeclaredOperatorFee([1], { account: owners[1].account })).to.be.rejectedWith(
      'CallerNotOwnerWithData',
    );
  });

  it('Execute declared fee of an operator I do not own reverts "CallerNotOwnerWithData"', async () => {
    await ssvNetwork.write.declareOperatorFee([1, initialFee + initialFee / 10n], {
      account: owners[2].account,
    });

    await expect(ssvNetwork.write.executeOperatorFee([1], { account: owners[1].account })).to.be.rejectedWith(
      'CallerNotOwnerWithData',
    );
  });

  it('Execute declared fee without a pending request reverts "NoFeeDeclared"', async () => {
    await expect(ssvNetwork.write.executeOperatorFee([1], { account: owners[2].account })).to.be.rejectedWith(
      'NoFeeDeclared',
    );
  });

  it('Execute declared fee too early reverts "ApprovalNotWithinTimeframe"', async () => {
    await ssvNetwork.write.declareOperatorFee([1, initialFee + initialFee / 10n], {
      account: owners[2].account,
    });

    await time.increase(CONFIG.declareOperatorFeePeriod - 10);
    await expect(ssvNetwork.write.executeOperatorFee([1], { account: owners[2].account })).to.be.rejectedWith(
      'ApprovalNotWithinTimeframe',
    );
  });

  it('Execute declared fee too late reverts "ApprovalNotWithinTimeframe"', async () => {
    await ssvNetwork.write.declareOperatorFee([1, initialFee + initialFee / 10n], {
      account: owners[2].account,
    });

    await time.increase(CONFIG.declareOperatorFeePeriod + CONFIG.executeOperatorFeePeriod + 1);
    await expect(ssvNetwork.write.executeOperatorFee([1], { account: owners[2].account })).to.be.rejectedWith(
      'ApprovalNotWithinTimeframe',
    );
  });

  it('Reduce fee emits "OperatorFeeExecuted"', async () => {
    await assertEvent(ssvNetwork.write.reduceOperatorFee([1, initialFee / 2n], { account: owners[2].account }), [
      {
        contract: ssvNetwork,
        eventName: 'OperatorFeeExecuted',
      },
    ]);

    expect(await ssvViews.read.getOperatorFee([1])).to.equal(initialFee / 2n);

    await assertEvent(ssvNetwork.write.reduceOperatorFee([1, 0], { account: owners[2].account }), [
      {
        contract: ssvNetwork,
        eventName: 'OperatorFeeExecuted',
      },
    ]);
    expect(await ssvViews.read.getOperatorFee([1])).to.equal(0);
  });

  it('Reduce fee emits "OperatorFeeExecuted"', async () => {
    await trackGas(ssvNetwork.write.reduceOperatorFee([1, initialFee / 2n], { account: owners[2].account }), [
      GasGroup.REDUCE_OPERATOR_FEE,
    ]);
  });

  it('Reduce fee with a fee thats too low reverts "FeeTooLow"', async () => {
    await expect(ssvNetwork.write.reduceOperatorFee([1, 10e6], { account: owners[2].account })).to.be.rejectedWith(
      'FeeTooLow',
    );
  });

  it('Reduce fee with an increased value reverts "FeeIncreaseNotAllowed"', async () => {
    await expect(
      ssvNetwork.write.reduceOperatorFee([1, initialFee * 2n], { account: owners[2].account }),
    ).to.be.rejectedWith('FeeIncreaseNotAllowed');
  });

  it('Reduce fee after declaring a fee change', async () => {
    await ssvNetwork.write.declareOperatorFee([1, initialFee + initialFee / 10n], {
      account: owners[2].account,
    });

    await assertEvent(ssvNetwork.write.reduceOperatorFee([1, initialFee / 2n], { account: owners[2].account }), [
      {
        contract: ssvNetwork,
        eventName: 'OperatorFeeExecuted',
      },
    ]);

    expect(await ssvViews.read.getOperatorFee([1])).to.equal(initialFee / 2n);
    const [isFeeDeclared] = await ssvViews.read.getOperatorDeclaredFee([1]);
    expect(isFeeDeclared).to.equal(false);
  });

  it('Reduce maximum fee limit after declaring a fee change reverts "FeeTooHigh', async () => {
    await ssvNetwork.write.declareOperatorFee([1, initialFee + initialFee / 10n], {
      account: owners[2].account,
    });
    await ssvNetwork.write.updateMaximumOperatorFee([1000]);

    await time.increase(CONFIG.declareOperatorFeePeriod);

    await expect(ssvNetwork.write.executeOperatorFee([1], { account: owners[2].account })).to.be.rejectedWith(
      'FeeTooHigh',
    );
  });

  //Dao
  it('DAO increase the fee emits "OperatorFeeIncreaseLimitUpdated"', async () => {
    await assertEvent(ssvNetwork.write.updateOperatorFeeIncreaseLimit([1000]), [
      {
        contract: ssvNetwork,
        eventName: 'OperatorFeeIncreaseLimitUpdated',
      },
    ]);
  });

  it('DAO update the maximum operator fee emits "OperatorMaximumFeeUpdated"', async () => {
    const newMaxFee = 2e10;

    await assertEvent(ssvNetwork.write.updateMaximumOperatorFee([newMaxFee]), [
      {
        contract: ssvNetwork,
        eventName: 'OperatorMaximumFeeUpdated',
        argNames: ['maxFee'],
        argValuesList: [[newMaxFee]],
      },
    ]);
  });

  it('DAO increase the fee gas limits"', async () => {
    await trackGas(ssvNetwork.write.updateOperatorFeeIncreaseLimit([1000]), [
      GasGroup.DAO_UPDATE_OPERATOR_FEE_INCREASE_LIMIT,
    ]);
  });

  it('DAO update the declare fee period emits "DeclareOperatorFeePeriodUpdated"', async () => {
    await assertEvent(ssvNetwork.write.updateDeclareOperatorFeePeriod([1200]), [
      {
        contract: ssvNetwork,
        eventName: 'DeclareOperatorFeePeriodUpdated',
      },
    ]);
  });

  it('DAO update the declare fee period gas limits"', async () => {
    await trackGas(ssvNetwork.write.updateDeclareOperatorFeePeriod([1200]), [
      GasGroup.DAO_UPDATE_DECLARE_OPERATOR_FEE_PERIOD,
    ]);
  });

  it('DAO update the execute fee period emits "ExecuteOperatorFeePeriodUpdated"', async () => {
    await assertEvent(ssvNetwork.write.updateExecuteOperatorFeePeriod([1200]), [
      {
        contract: ssvNetwork,
        eventName: 'ExecuteOperatorFeePeriodUpdated',
      },
    ]);
  });

  it('DAO update the execute fee period gas limits', async () => {
    await trackGas(ssvNetwork.write.updateExecuteOperatorFeePeriod([1200]), [
      GasGroup.DAO_UPDATE_EXECUTE_OPERATOR_FEE_PERIOD,
    ]);
  });

  it('DAO update the maximum fee for operators using SSV gas limits', async () => {
    await trackGas(ssvNetwork.write.updateMaximumOperatorFee([2e10]), [GasGroup.DAO_UPDATE_OPERATOR_MAX_FEE]);
  });

  it('DAO get fee increase limit', async () => {
    expect(await ssvViews.read.getOperatorFeeIncreaseLimit()).to.equal(CONFIG.operatorMaxFeeIncrease);
  });

  it('DAO get declared fee', async () => {
    const newFee = initialFee + initialFee / 10n;
    await ssvNetwork.write.declareOperatorFee([1, newFee], { account: owners[2].account });

    const [_, feeDeclaredInContract] = await ssvViews.read.getOperatorDeclaredFee([1]);
    expect(feeDeclaredInContract).to.equal(newFee);
  });

  it('DAO get declared and execute fee periods', async () => {
    expect(await ssvViews.read.getOperatorFeePeriods()).to.deep.equal([
      CONFIG.declareOperatorFeePeriod,
      CONFIG.executeOperatorFeePeriod,
    ]);
  });

  it('Increase fee from an address thats not the DAO reverts "caller is not the owner"', async () => {
    await expect(
      ssvNetwork.write.updateOperatorFeeIncreaseLimit([1000], { account: owners[1].account }),
    ).to.be.rejectedWith('Ownable: caller is not the owner');
  });

  it('Update the declare fee period from an address thats not the DAO reverts "caller is not the owner"', async () => {
    await expect(
      ssvNetwork.write.updateDeclareOperatorFeePeriod([1200], { account: owners[1].account }),
    ).to.be.rejectedWith('Ownable: caller is not the owner');
  });

  it('Update the execute fee period from an address thats not the DAO reverts "caller is not the owner"', async () => {
    await expect(
      ssvNetwork.write.updateExecuteOperatorFeePeriod([1200], { account: owners[1].account }),
    ).to.be.rejectedWith('Ownable: caller is not the owner');
  });

  it('DAO declared fee without a pending request reverts "NoFeeDeclared"', async () => {
    await ssvNetwork.write.declareOperatorFee([1, initialFee + initialFee / 10n], {
      account: owners[2].account,
    });

    const [isFeeDeclared] = await ssvViews.read.getOperatorDeclaredFee([2]);
    expect(isFeeDeclared).to.equal(false);
  });
});
