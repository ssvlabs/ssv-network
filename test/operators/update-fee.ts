//Declare imports
import * as helpers from '../helpers/contract-helpers';
import { expect } from 'chai';
import { progressTime } from '../helpers/utils';
import { trackGas, GasGroup } from '../helpers/gas-usage';

//Declare globals
let ssvNetworkContract: any, initialFee: any;

describe('Operator Fee Tests', () => {
  beforeEach(async () => {
    ssvNetworkContract = (await helpers.initializeContract()).contract;
    initialFee = helpers.CONFIG.minimalOperatorFee * 10;
    await helpers.registerOperators(2, 1, initialFee);
  });

  it('Get operator fee', async () => {
    expect(await ssvNetworkContract.getOperatorFee(1)).to.equal(initialFee);
  });

  it('Get fee reverts "OperatorNotFound"', async () => {
    await expect(ssvNetworkContract.getOperatorFee(12
    )).to.be.revertedWith('OperatorNotFound');
  });

  //Declare
  it('Declare fee < 10% emits "OperatorFeeDeclaration"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[2]).declareOperatorFee(1, initialFee + initialFee / 10
    )).to.emit(ssvNetworkContract, 'OperatorFeeDeclaration');
  });

  it('Declare fee < 10% in contract', async () => {
    await trackGas(ssvNetworkContract.declareOperatorFee(1, initialFee - initialFee / 20), [GasGroup.REGISTER_OPERATOR]);
  });

  it('Declare fee gas limits', async () => {
    await trackGas(ssvNetworkContract.declareOperatorFee(1, initialFee + initialFee / 10), [GasGroup.REGISTER_OPERATOR]);
  });

  it('Declare fee reverts "CallerNotOwner"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).declareOperatorFee(1, initialFee + initialFee / 10
    )).to.be.revertedWith('CallerNotOwner');
  });

  //Test to be removed - Duplicate
  it('Declare fee reverts "CallerNotOwner"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).declareOperatorFee(1, initialFee + initialFee / 10
    )).to.be.revertedWith('CallerNotOwner');
  });

  it('Declare fee reverts "OperatorWithPublicKeyNotExist"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).declareOperatorFee(12, initialFee + initialFee / 10
    )).to.be.revertedWith('OperatorWithPublicKeyNotExist');
  });

  it('Declare fee reverts "FeeTooLow"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[2]).declareOperatorFee(1, helpers.CONFIG.minimalOperatorFee - 1
    )).to.be.revertedWith('FeeTooLow');
  });

  it('Declare fee > 10% reverts "FeeExceedsIncreaseLimit"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[2]).declareOperatorFee(1, initialFee + initialFee / 5
    )).to.be.revertedWith('FeeExceedsIncreaseLimit');
  });

  //Cancel declare 
  it('Cancel declared fee emits "DeclaredOperatorFeeCancelation"', async () => {
    await ssvNetworkContract.declareOperatorFee(1, initialFee + initialFee / 10);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[2]).cancelDeclaredOperatorFee(1
    )).to.emit(ssvNetworkContract, 'DeclaredOperatorFeeCancelation');
  });

  it('Cancel declared fee gas limits', async () => {
    await trackGas(ssvNetworkContract.declareOperatorFee(1, initialFee + initialFee / 10), [GasGroup.REGISTER_OPERATOR]);
    await trackGas(ssvNetworkContract.cancelDeclaredOperatorFee(1), [GasGroup.REGISTER_OPERATOR]);
  });

  it('Cancel declared fee reverts "NoPendingFeeChangeRequest"', async () => {
    await expect(ssvNetworkContract.cancelDeclaredOperatorFee(1
    )).to.be.revertedWith('NoPendingFeeChangeRequest');
  });

  it('Cancel declared fee reverts "CallerNotOwner"', async () => {
    await trackGas(ssvNetworkContract.declareOperatorFee(1, initialFee + initialFee / 10), [GasGroup.REGISTER_OPERATOR]);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).cancelDeclaredOperatorFee(1
    )).to.be.revertedWith('CallerNotOwner');
  });

  //Execute 
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

  it('Execute declared fee reverts "CallerNotOwner"', async () => {
    await trackGas(ssvNetworkContract.declareOperatorFee(1, initialFee + initialFee / 10), [GasGroup.REGISTER_OPERATOR]);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).executeOperatorFee(1
    )).to.be.revertedWith('CallerNotOwner');
  });

  it('Execute declared fee reverts "NoPendingFeeChangeRequest"', async () => {
    await expect(ssvNetworkContract.executeOperatorFee(1
    )).to.be.revertedWith('NoPendingFeeChangeRequest');
  });

  it('Execute declared fee early reverts "ApprovalNotWithinTimeframe"', async () => {
    await trackGas(ssvNetworkContract.declareOperatorFee(1, initialFee + initialFee / 10), [GasGroup.REGISTER_OPERATOR]);
    await progressTime(helpers.CONFIG.declareOperatorFeePeriod - 10);
    await expect(ssvNetworkContract.executeOperatorFee(1
    )).to.be.revertedWith('ApprovalNotWithinTimeframe');
  });

  it('Execute declared fee late reverts "ApprovalNotWithinTimeframe"', async () => {
    await trackGas(ssvNetworkContract.declareOperatorFee(1, initialFee + initialFee / 10), [GasGroup.REGISTER_OPERATOR]);
    await progressTime(helpers.CONFIG.declareOperatorFeePeriod + helpers.CONFIG.executeOperatorFeePeriod + 1);
    await expect(ssvNetworkContract.executeOperatorFee(1
    )).to.be.revertedWith('ApprovalNotWithinTimeframe');
  });

  //Dao
  it('DAO increase fee limit emits "OperatorFeeIncreaseLimitUpdate"', async () => {
    await expect(ssvNetworkContract.updateOperatorFeeIncreaseLimit(1000
    )).to.emit(ssvNetworkContract, 'OperatorFeeIncreaseLimitUpdate');
  });

  it('DAO update declare fee period emits "DeclareOperatorFeePeriodUpdate"', async () => {
    await expect(ssvNetworkContract.updateDeclareOperatorFeePeriod(1200
    )).to.emit(ssvNetworkContract, 'DeclareOperatorFeePeriodUpdate');
  });

  it('DAO update execute fee period emits "ExecuteOperatorFeePeriodUpdate"', async () => {
    await expect(ssvNetworkContract.updateExecuteOperatorFeePeriod(1200
    )).to.emit(ssvNetworkContract, 'ExecuteOperatorFeePeriodUpdate');
  });

  it('DAO increase fee limit reverts "caller is not the owner"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).updateOperatorFeeIncreaseLimit(1000
    )).to.be.revertedWith('caller is not the owner');
  });

  it('DAO update declare fee period reverts "caller is not the owner"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).updateDeclareOperatorFeePeriod(1200
    )).to.be.revertedWith('caller is not the owner');
  });

  it('DAO update execute fee period reverts "caller is not the owner"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).updateExecuteOperatorFeePeriod(1200))
      .to.be.revertedWith('caller is not the owner');
  });

  it('DAO declared fee fails reverts "NoPendingFeeChangeRequest"', async () => {
    await trackGas(ssvNetworkContract.declareOperatorFee(1, initialFee + initialFee / 10), [GasGroup.REGISTER_OPERATOR]);
    await expect(ssvNetworkContract.getOperatorDeclaredFee(2
    )).to.be.revertedWith('NoPendingFeeChangeRequest');
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
});
