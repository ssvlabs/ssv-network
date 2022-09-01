declare const ethers: any;

import * as helpers from '../helpers/contract-helpers';
import * as utils from '../helpers/utils';
import { trackGas, GasGroup } from '../helpers/gas-usage';

import { expect } from 'chai';

const numberOfOperators = 6;
const operatorFee = 1;

let registryContract: any, operatorIDs: any, shares: any, owner: any;

describe('Balance Tests', () => {
  // beforeEach(async () => {
  //   const contractData = await helpers.initializeContract(numberOfOperators, operatorFee);
  //   registryContract = contractData.contract;
  //   operatorIDs = contractData.operatorIDs;
  //   shares = contractData.shares;
  //   owner = contractData.owner;
  // });

  // it('Check balances', async () => {
  //   const validatorPK = `0x98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098100`

  //   expect(await registryContract.operatorEarningsOf(1)).to.equal('0');

  //   // Register a validator
  //   const validator1 = await trackGas(registryContract.registerValidator(
  //       `${validatorPK}0`,
  //       [1, 2, 3, 4],
  //       shares[0],
  //       "10000"
  //   ), [ GasGroup.registerValidator ]);

  //   const outputRegister = validator1.eventsByName.ValidatorAdded[0];

  //   // Progress 50 blocks and check operator balances and group balance
  //   await utils.progressBlocks(50)
  //   expect(await registryContract.operatorEarningsOf(1)).to.equal('50')
  //   expect(await registryContract.operatorEarningsOf(2)).to.equal('50')
  //   expect(await registryContract.operatorEarningsOf(3)).to.equal('50')
  //   expect(await registryContract.operatorEarningsOf(4)).to.equal('50')
    // expect(await registryContract.groupBalanceOf(owner.address, outputRegister.groupId)).to.equal(10000 - 150)

    // // Update one of the operator fees
    // await registryContract.updateOperatorFee(1, 10)

    // // Progress 50 blocks and check operator balances and group balance
    // await utils.progressBlocks(50)
    // expect(await registryContract.operatorEarningsOf(1)).to.equal('551')
    // expect(await registryContract.operatorEarningsOf(2)).to.equal('101')
    // expect(await registryContract.operatorEarningsOf(3)).to.equal('101')
    // expect(await registryContract.operatorEarningsOf(4)).to.equal('101')
    // expect(await registryContract.groupBalanceOf(owner.address, outputRegister.groupId)).to.equal(10000 - 904)

    // // Update 3 operator fees
    // await registryContract.updateOperatorFee(2, 20)
    // await registryContract.updateOperatorFee(3, 20)
    // await registryContract.updateOperatorFee(4, 20)

    // // Progress 50 blocks and check operator balances and group balance
    // await utils.progressBlocks(50)
    // expect(await registryContract.operatorEarningsOf(1)).to.equal('1081')
    // expect(await registryContract.operatorEarningsOf(2)).to.equal('1142')
    // expect(await registryContract.operatorEarningsOf(3)).to.equal('1123')
    // expect(await registryContract.operatorEarningsOf(4)).to.equal('1104')
    // expect(await registryContract.groupBalanceOf(owner.address, outputRegister.groupId)).to.equal(10000 - 4500)

    // // Add another validator
    // await registryContract.registerValidator(
    //     [1, 2, 3, 5],
    //     `${validatorPK}1`,
    //     shares[1],
    //     "10000"
    // )

    // // Progress 50 blocks and check operator balances and group balance
    // await utils.progressBlocks(50)
    // expect(await registryContract.operatorEarningsOf(1)).to.equal('2091')
    // expect(await registryContract.operatorEarningsOf(2)).to.equal('3162')
    // expect(await registryContract.operatorEarningsOf(3)).to.equal('3143')
    // expect(await registryContract.operatorEarningsOf(4)).to.equal('2124')
    // expect(await registryContract.operatorEarningsOf(5)).to.equal('5000')
    // expect(await registryContract.groupBalanceOf(owner.address, outputRegister.groupId)).to.equal(10000 - 4500)

    // // Remove an operator
    // await registryContract.removeOperator(1)

    // // Progress 50 blocks and check operator balances and group balance
    // await utils.progressBlocks(50)
    // expect(await registryContract.operatorEarningsOf(1)).to.equal('2091')
    // expect(await registryContract.operatorEarningsOf(2)).to.equal('3162')
    // expect(await registryContract.operatorEarningsOf(3)).to.equal('3143')
    // expect(await registryContract.operatorEarningsOf(4)).to.equal('2124')
    // expect(await registryContract.operatorEarningsOf(5)).to.equal('5000')
    // expect(await registryContract.groupBalanceOf(owner.address, outputRegister.groupId)).to.equal(10000 - 4500)

    // // Update a validator
    // await registryContract.updateValidator(
    //     [1, 2, 3, 5],
    //     `${validatorPK}0`,
    //     shares[1],
    //     "10"
    // )

    // // Progress 50 blocks and check operator balances and group balance
    // await utils.progressBlocks(50)
    // expect(await registryContract.operatorEarningsOf(1)).to.equal('2091')
    // expect(await registryContract.operatorEarningsOf(2)).to.equal('3162')
    // expect(await registryContract.operatorEarningsOf(3)).to.equal('3143')
    // expect(await registryContract.operatorEarningsOf(4)).to.equal('2124')
    // expect(await registryContract.operatorEarningsOf(5)).to.equal('5000')
    // expect(await registryContract.groupBalanceOf(owner.address, outputRegister.groupId)).to.equal(10000 - 4500)

    // // Remove a validator
    // await registryContract.removeValidator(`${validatorPK}0`, outputRegister.groupId)

    // // Progress 50 blocks and check operator balances and group balance
    // await utils.progressBlocks(50)
    // expect(await registryContract.operatorEarningsOf(1)).to.equal('2091')
    // expect(await registryContract.operatorEarningsOf(2)).to.equal('3162')
    // expect(await registryContract.operatorEarningsOf(3)).to.equal('3143')
    // expect(await registryContract.operatorEarningsOf(4)).to.equal('2124')
    // expect(await registryContract.operatorEarningsOf(5)).to.equal('5000')
    // expect(await registryContract.groupBalanceOf(owner.address, outputRegister.groupId)).to.equal(10000 - 4500)
  // });

});
