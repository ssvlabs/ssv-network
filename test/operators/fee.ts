import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';
import { progressTime } from '../helpers/utils';

let ssvNetworkContract: any;

describe('Operator Fee Tests', () => {
  beforeEach(async () => {
    ssvNetworkContract = (await helpers.initializeContract()).contract;
    await helpers.registerOperators(2, 1, helpers.CONFIG.minimalOperatorFee);
  });

  it('Declare fee success emits OperatorFeeDeclaration event', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[2]).declareOperatorFee(1, helpers.CONFIG.minimalOperatorFee +  helpers.CONFIG.minimalOperatorFee / 10))
      .to.emit(ssvNetworkContract, 'OperatorFeeDeclaration');
  });

  it('Declare fee success as contract owner', async () => {
    await ssvNetworkContract.declareOperatorFee(1, helpers.CONFIG.minimalOperatorFee +  helpers.CONFIG.minimalOperatorFee / 10);
  });

  it('Declare fee fails no owner', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).declareOperatorFee(1, helpers.CONFIG.minimalOperatorFee +  helpers.CONFIG.minimalOperatorFee / 10 ))
      .to.be.revertedWith('CallerNotOwner');
  });

  it('Declare fee fails fee too low', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[2]).declareOperatorFee(1, helpers.CONFIG.minimalOperatorFee - 1))
      .to.be.revertedWith('FeeTooLow');
  });

  it('Declare fee fails fee exceeds increase limit', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[2]).declareOperatorFee(1, helpers.CONFIG.minimalOperatorFee +  helpers.CONFIG.minimalOperatorFee / 5))
      .to.be.revertedWith('FeeExceedsIncreaseLimit');
  });

  it('Cancel declared fee success emits DeclaredOperatorFeeCancelation event', async () => {
    await ssvNetworkContract.declareOperatorFee(1, helpers.CONFIG.minimalOperatorFee + helpers.CONFIG.minimalOperatorFee / 10);

    await expect(ssvNetworkContract.connect(helpers.DB.owners[2]).cancelDeclaredOperatorFee(1))
      .to.emit(ssvNetworkContract, 'DeclaredOperatorFeeCancelation');
  });

  it('Cancel declared fee success as contract owner', async () => {
    await ssvNetworkContract.declareOperatorFee(1, helpers.CONFIG.minimalOperatorFee + helpers.CONFIG.minimalOperatorFee / 10);

    await ssvNetworkContract.cancelDeclaredOperatorFee(1);
  });

  it('Cancel declared fee fails no pending request', async () => {
    await expect(ssvNetworkContract.cancelDeclaredOperatorFee(1))
      .to.be.revertedWith('NoPendingFeeChangeRequest');
  });

  it('Cancel declared fee fails no owner', async () => {
    await ssvNetworkContract.declareOperatorFee(1, helpers.CONFIG.minimalOperatorFee + helpers.CONFIG.minimalOperatorFee / 10);

    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).cancelDeclaredOperatorFee(1))
      .to.be.revertedWith('CallerNotOwner');
  });

  it('Execute declared fee success emits OperatorFeeExecution event', async () => {
    await ssvNetworkContract.declareOperatorFee(1, helpers.CONFIG.minimalOperatorFee + helpers.CONFIG.minimalOperatorFee / 10);
    await progressTime(helpers.CONFIG.declareOperatorFeePeriod);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[2]).executeOperatorFee(1))
      .to.emit(ssvNetworkContract, 'OperatorFeeExecution');
  });

  it('Execute declared fee success as contract owner', async () => {
    await ssvNetworkContract.declareOperatorFee(1, helpers.CONFIG.minimalOperatorFee + helpers.CONFIG.minimalOperatorFee / 10);
    await progressTime(helpers.CONFIG.declareOperatorFeePeriod);
    await ssvNetworkContract.executeOperatorFee(1);
  });

  it('Execute declared fee fee fails no owner', async () => {
    await ssvNetworkContract.declareOperatorFee(1, helpers.CONFIG.minimalOperatorFee + helpers.CONFIG.minimalOperatorFee / 10);

    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).executeOperatorFee(1))
      .to.be.revertedWith('CallerNotOwner');
  });

  it('Execute declared fee fails no pending request', async () => {
    await expect(ssvNetworkContract.executeOperatorFee(1))
      .to.be.revertedWith('NoPendingFeeChangeRequest');
  });

  it('Execute declared fee fails not within timeframe', async () => {
    await ssvNetworkContract.declareOperatorFee(1, helpers.CONFIG.minimalOperatorFee + helpers.CONFIG.minimalOperatorFee / 10);

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

  it('DAO: get execute fee period equal init value', async () => {
    expect(await ssvNetworkContract.getExecuteOperatorFeePeriod()).to.equal(helpers.CONFIG.executeOperatorFeePeriod);
  });

  it('DAO: get declared fee period equal init value', async () => {
    expect(await ssvNetworkContract.getDeclaredOperatorFeePeriod()).to.equal(helpers.CONFIG.declareOperatorFeePeriod);
  });
});
