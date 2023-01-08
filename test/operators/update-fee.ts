// Declare imports
import * as helpers from '../helpers/contract-helpers';
import { expect } from 'chai';
import { progressTime } from '../helpers/utils';
import { trackGas, GasGroup } from '../helpers/gas-usage';

// Declare globals
let ssvNetworkContract: any, initialFee: any;

describe('Operator Fee Tests', () => {
  beforeEach(async () => {
    ssvNetworkContract = (await helpers.initializeContract()).contract;
    initialFee = helpers.CONFIG.minimalOperatorFee * 10;
    await helpers.registerOperators(2, 1, initialFee);
  });

  it('Declare fee emits "OperatorFeeDeclaration"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[2]).declareOperatorFee(1, initialFee + initialFee / 10
    )).to.emit(ssvNetworkContract, 'OperatorFeeDeclaration');
  });

  it('Declare a lower fee gas limits', async () => {
    await trackGas(ssvNetworkContract.declareOperatorFee(1, initialFee + initialFee / 10), [GasGroup.REGISTER_OPERATOR]);
  });

  it('Declare a higher fee gas limit', async () => {
    await trackGas(ssvNetworkContract.declareOperatorFee(1, initialFee - initialFee / 20), [GasGroup.REGISTER_OPERATOR]);
  });

  it('Cancel declared fee emits "OperatorFeeCancelationDeclared"', async () => {
    await ssvNetworkContract.declareOperatorFee(1, initialFee + initialFee / 10);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[2]).cancelDeclaredOperatorFee(1
    )).to.emit(ssvNetworkContract, 'OperatorFeeCancelationDeclared');
  });

  it('Cancel declared fee gas limits', async () => {
    await trackGas(ssvNetworkContract.declareOperatorFee(1, initialFee + initialFee / 10), [GasGroup.REGISTER_OPERATOR]);
    await trackGas(ssvNetworkContract.cancelDeclaredOperatorFee(1), [GasGroup.REGISTER_OPERATOR]);
  });

  it('Execute declared fee emits "OperatorFeeExecution"', async () => {
    await ssvNetworkContract.declareOperatorFee(1, initialFee + initialFee / 10);
    await progressTime(helpers.CONFIG.declareOperatorFeePeriod);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[2]).executeOperatorFee(1
    )).to.emit(ssvNetworkContract, 'OperatorFeeExecution');
  });

  it('Execute declared fee gas limits', async () => {
    await trackGas(ssvNetworkContract.declareOperatorFee(1, initialFee + initialFee / 10), [GasGroup.REGISTER_OPERATOR]);
    await progressTime(helpers.CONFIG.declareOperatorFeePeriod);
    await trackGas(ssvNetworkContract.executeOperatorFee(1), [GasGroup.REGISTER_OPERATOR]);
  });

  it('Get operator fee', async () => {
    expect(await ssvNetworkContract.getOperatorFee(1)).to.equal(initialFee);
  });

  it('Get fee from operator that does not exist reverts "OperatorDoesNotExist"', async () => {
    await expect(ssvNetworkContract.getOperatorFee(12
    )).to.be.revertedWith('OperatorDoesNotExist');
  });

  it('Declare fee of operator I do not own reverts "CallerNotOwner"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).declareOperatorFee(1, initialFee + initialFee / 10
    )).to.be.revertedWith('CallerNotOwner');
  });

  it('Declare fee with a wrong Publickey reverts "OperatorDoesNotExist"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).declareOperatorFee(12, initialFee + initialFee / 10
    )).to.be.revertedWith('OperatorDoesNotExist');
  });

  it('Declare fee with too low of a fee reverts "FeeTooLow"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[2]).declareOperatorFee(1, helpers.CONFIG.minimalOperatorFee - 1
    )).to.be.revertedWith('FeeTooLow');
  });

  it('Declare fee above the operators max fee increase limit reverts "FeeExceedsIncreaseLimit"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[2]).declareOperatorFee(1, initialFee + initialFee / 5
    )).to.be.revertedWith('FeeExceedsIncreaseLimit');
  });

  it('Cancel declared fee without a pending request reverts "NoFeeDelcared"', async () => {
    await expect(ssvNetworkContract.cancelDeclaredOperatorFee(1
    )).to.be.revertedWith('NoFeeDelcared');
  });

  it('Cancel declared fee of an operator I do not own reverts "CallerNotOwner"', async () => {
    await trackGas(ssvNetworkContract.declareOperatorFee(1, initialFee + initialFee / 10), [GasGroup.REGISTER_OPERATOR]);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).cancelDeclaredOperatorFee(1
    )).to.be.revertedWith('CallerNotOwner');
  });

  it('Execute declared fee of an operator I do not own reverts "CallerNotOwner"', async () => {
    await trackGas(ssvNetworkContract.declareOperatorFee(1, initialFee + initialFee / 10), [GasGroup.REGISTER_OPERATOR]);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).executeOperatorFee(1
    )).to.be.revertedWith('CallerNotOwner');
  });

  it('Execute declared fee without a pending request reverts "NoFeeDelcared"', async () => {
    await expect(ssvNetworkContract.executeOperatorFee(1
    )).to.be.revertedWith('NoFeeDelcared');
  });

  it('Execute declared fee too early reverts "ApprovalNotWithinTimeframe"', async () => {
    await trackGas(ssvNetworkContract.declareOperatorFee(1, initialFee + initialFee / 10), [GasGroup.REGISTER_OPERATOR]);
    await progressTime(helpers.CONFIG.declareOperatorFeePeriod - 10);
    await expect(ssvNetworkContract.executeOperatorFee(1
    )).to.be.revertedWith('ApprovalNotWithinTimeframe');
  });

  it('Execute declared fee too late reverts "ApprovalNotWithinTimeframe"', async () => {
    await trackGas(ssvNetworkContract.declareOperatorFee(1, initialFee + initialFee / 10), [GasGroup.REGISTER_OPERATOR]);
    await progressTime(helpers.CONFIG.declareOperatorFeePeriod + helpers.CONFIG.executeOperatorFeePeriod + 1);
    await expect(ssvNetworkContract.executeOperatorFee(1
    )).to.be.revertedWith('ApprovalNotWithinTimeframe');
  });

  //Dao
  it('DAO increase the fee emits "OperatorFeeIncreaseLimitUpdate"', async () => {
    await expect(ssvNetworkContract.updateOperatorFeeIncreaseLimit(1000
    )).to.emit(ssvNetworkContract, 'OperatorFeeIncreaseLimitUpdate');
  });

  it('DAO update the declare fee period emits "DeclareOperatorFeePeriodUpdate"', async () => {
    await expect(ssvNetworkContract.updateDeclareOperatorFeePeriod(1200
    )).to.emit(ssvNetworkContract, 'DeclareOperatorFeePeriodUpdate');
  });

  it('DAO update the execute fee period emits "ExecuteOperatorFeePeriodUpdate"', async () => {
    await expect(ssvNetworkContract.updateExecuteOperatorFeePeriod(1200
    )).to.emit(ssvNetworkContract, 'ExecuteOperatorFeePeriodUpdate');
  });

  it('DAO get fee increase limit', async () => {
    expect(await ssvNetworkContract.getOperatorFeeIncreaseLimit()).to.equal(helpers.CONFIG.operatorMaxFeeIncrease);
  });

  it('DAO get declared fee', async () => {
    const newFee = initialFee + initialFee / 10;
    await trackGas(ssvNetworkContract.declareOperatorFee(1, newFee), [GasGroup.REGISTER_OPERATOR]);
    const [feeDeclaredInContract] = await ssvNetworkContract.getOperatorDeclaredFee(1);
    expect(feeDeclaredInContract).to.equal(newFee);
  });

  it('DAO get declared fee period', async () => {
    expect(await ssvNetworkContract.getDeclaredOperatorFeePeriod()).to.equal(helpers.CONFIG.declareOperatorFeePeriod);
  });

  it('DAO get execute fee period', async () => {
    expect(await ssvNetworkContract.getExecuteOperatorFeePeriod()).to.equal(helpers.CONFIG.executeOperatorFeePeriod);
  });

  it('Increase fee from an address thats not the DAO reverts "caller is not the owner"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).updateOperatorFeeIncreaseLimit(1000
    )).to.be.revertedWith('caller is not the owner');
  });

  it('Update the declare fee period from an address thats not the DAO reverts "caller is not the owner"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).updateDeclareOperatorFeePeriod(1200
    )).to.be.revertedWith('caller is not the owner');
  });

  it('Update the execute fee period from an address thats not the DAO reverts "caller is not the owner"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).updateExecuteOperatorFeePeriod(1200))
      .to.be.revertedWith('caller is not the owner');
  });

  it('DAO declared fee without a pending request reverts "NoFeeDelcared"', async () => {
    await trackGas(ssvNetworkContract.declareOperatorFee(1, initialFee + initialFee / 10), [GasGroup.REGISTER_OPERATOR]);
    await expect(ssvNetworkContract.getOperatorDeclaredFee(2
    )).to.be.revertedWith('NoFeeDelcared');
  });
});
