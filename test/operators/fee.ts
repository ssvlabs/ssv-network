import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';
import { progressTime } from '../helpers/utils';
import { trackGas, GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any, initialFee: any;

describe('Operator Fee Tests', () => {
  beforeEach(async () => {
    ssvNetworkContract = (await helpers.initializeContract()).contract;
    initialFee = helpers.CONFIG.minimalOperatorFee * 10;
    await helpers.registerOperators(2, 1, initialFee);
  });

  it('Declare fee success emits OperatorFeeDeclaration event', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[2]).declareOperatorFee(1, initialFee +  initialFee / 10))
      .to.emit(ssvNetworkContract, 'OperatorFeeDeclaration');
  });

  it('Declare fee success as contract owner', async () => {
    await trackGas(ssvNetworkContract.declareOperatorFee(1, initialFee +  initialFee / 10), [GasGroup.REGISTER_OPERATOR]);
  });

  it('Declare fee < than initial more than 10% success', async () => {
    await trackGas(ssvNetworkContract.declareOperatorFee(1, initialFee - initialFee / 20), [GasGroup.REGISTER_OPERATOR]);
  });

  it('Declare fee fails no owner', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).declareOperatorFee(1, initialFee +  initialFee / 10 ))
      .to.be.revertedWith('CallerNotOwner');
  });

  it('Declare fee fails fee too low', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[2]).declareOperatorFee(1, helpers.CONFIG.minimalOperatorFee - 1))
      .to.be.revertedWith('FeeTooLow');
  });

  it('Declare fee fails fee exceeds increase limit', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[2]).declareOperatorFee(1, initialFee +  initialFee / 5))
      .to.be.revertedWith('FeeExceedsIncreaseLimit');
  });

  it('Cancel declared fee success emits DeclaredOperatorFeeCancelation event', async () => {
    await ssvNetworkContract.declareOperatorFee(1, initialFee + initialFee / 10);

    await expect(ssvNetworkContract.connect(helpers.DB.owners[2]).cancelDeclaredOperatorFee(1))
      .to.emit(ssvNetworkContract, 'DeclaredOperatorFeeCancelation');
  });

  it('Cancel declared fee success as contract owner', async () => {
    await trackGas(ssvNetworkContract.declareOperatorFee(1, initialFee +  initialFee / 10), [GasGroup.REGISTER_OPERATOR]);
    await trackGas(ssvNetworkContract.cancelDeclaredOperatorFee(1), [GasGroup.REGISTER_OPERATOR]);
  });

  it('Cancel declared fee fails no pending request', async () => {
    await expect(ssvNetworkContract.cancelDeclaredOperatorFee(1))
      .to.be.revertedWith('NoPendingFeeChangeRequest');
  });

  it('Cancel declared fee fails no owner', async () => {
    await trackGas(ssvNetworkContract.declareOperatorFee(1, initialFee +  initialFee / 10), [GasGroup.REGISTER_OPERATOR]);

    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).cancelDeclaredOperatorFee(1))
      .to.be.revertedWith('CallerNotOwner');
  });

  it('Execute declared fee success emits OperatorFeeExecution event', async () => {
    await ssvNetworkContract.declareOperatorFee(1, initialFee + initialFee / 10);
    await progressTime(helpers.CONFIG.declareOperatorFeePeriod);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[2]).executeOperatorFee(1))
      .to.emit(ssvNetworkContract, 'OperatorFeeExecution');
  });

  it('Execute declared fee success as contract owner', async () => {
    await trackGas(ssvNetworkContract.declareOperatorFee(1, initialFee +  initialFee / 10), [GasGroup.REGISTER_OPERATOR]);
    await progressTime(helpers.CONFIG.declareOperatorFeePeriod);
    await trackGas(ssvNetworkContract.executeOperatorFee(1), [GasGroup.REGISTER_OPERATOR]);
  });

  it('Execute declared fee fee fails no owner', async () => {
    await trackGas(ssvNetworkContract.declareOperatorFee(1, initialFee +  initialFee / 10), [GasGroup.REGISTER_OPERATOR]);

    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).executeOperatorFee(1))
      .to.be.revertedWith('CallerNotOwner');
  });

  it('Execute declared fee fails no pending request', async () => {
    await expect(ssvNetworkContract.executeOperatorFee(1))
      .to.be.revertedWith('NoPendingFeeChangeRequest');
  });

  it('Execute declared fee fails too earlier', async () => {
    await trackGas(ssvNetworkContract.declareOperatorFee(1, initialFee +  initialFee / 10), [GasGroup.REGISTER_OPERATOR]);
    await progressTime(helpers.CONFIG.declareOperatorFeePeriod - 10);
    await expect(ssvNetworkContract.executeOperatorFee(1))
      .to.be.revertedWith('ApprovalNotWithinTimeframe');
  });

  it('Execute declared fee fails too late', async () => {
    await trackGas(ssvNetworkContract.declareOperatorFee(1, initialFee +  initialFee / 10), [GasGroup.REGISTER_OPERATOR]);
    await progressTime(helpers.CONFIG.declareOperatorFeePeriod + helpers.CONFIG.executeOperatorFeePeriod + 1);
    await expect(ssvNetworkContract.executeOperatorFee(1))
      .to.be.revertedWith('ApprovalNotWithinTimeframe');
  });

  it('DAO: update fee increase limit success emits OperatorFeeIncreaseLimitUpdate event', async () => {
    await expect(ssvNetworkContract.updateOperatorFeeIncreaseLimit(1000))
      .to.emit(ssvNetworkContract, 'OperatorFeeIncreaseLimitUpdate');
  });

  it('DAO: update fee increase limit fails no owner', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).updateOperatorFeeIncreaseLimit(1000))
      .to.be.revertedWith('caller is not the owner');
  });

  it('DAO: update declare fee period success emits DeclareOperatorFeePeriodUpdate event', async () => {
    await expect(ssvNetworkContract.updateDeclareOperatorFeePeriod(1200))
      .to.emit(ssvNetworkContract, 'DeclareOperatorFeePeriodUpdate');
  });

  it('DAO: update declare fee period fails no owner', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).updateDeclareOperatorFeePeriod(1200))
      .to.be.revertedWith('caller is not the owner');
  });

  it('DAO: update execute fee period success emits ExecuteOperatorFeePeriodUpdate event', async () => {
    await expect(ssvNetworkContract.updateExecuteOperatorFeePeriod(1200))
      .to.emit(ssvNetworkContract, 'ExecuteOperatorFeePeriodUpdate');
  });

  it('DAO: update execute fee period fails no owner', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).updateExecuteOperatorFeePeriod(1200))
      .to.be.revertedWith('caller is not the owner');
  });

  it('DAO: get fee increase limit equal init value', async () => {
    expect(await ssvNetworkContract.getOperatorFeeIncreaseLimit()).to.equal(helpers.CONFIG.operatorMaxFeeIncrease);
  });

  it('DAO: get declared fee', async () => {
    const newFee = initialFee +  initialFee / 10;
    await trackGas(ssvNetworkContract.declareOperatorFee(1, newFee), [GasGroup.REGISTER_OPERATOR]);
    const [ feeDeclaredInContract ] = await ssvNetworkContract.getOperatorDeclaredFee(1);
    expect(feeDeclaredInContract).to.equal(newFee);
  });

  it('DAO: get declared fee fails no pending request', async () => {
    await trackGas(ssvNetworkContract.declareOperatorFee(1, initialFee +  initialFee / 10), [GasGroup.REGISTER_OPERATOR]);
    await expect(ssvNetworkContract.getOperatorDeclaredFee(2))
      .to.be.revertedWith('NoPendingFeeChangeRequest');
  });

  it('DAO: get execute fee period equal init value', async () => {
    expect(await ssvNetworkContract.getExecuteOperatorFeePeriod()).to.equal(helpers.CONFIG.executeOperatorFeePeriod);
  });

  it('DAO: get declared fee period equal init value', async () => {
    expect(await ssvNetworkContract.getDeclaredOperatorFeePeriod()).to.equal(helpers.CONFIG.declareOperatorFeePeriod);
  });

  it('Get fee', async () => {
    expect(await ssvNetworkContract.getOperatorFee(1)).to.equal(initialFee);
  });

});
