// Define imports
import * as helpers from '../helpers/contract-helpers';
import { trackGas, GasGroup } from '../helpers/gas-usage';

// Define global variables
let ssvNetworkContract: any
let validators: { publicKey: string, owner: number }[] = [];

describe('Stress Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;

    // Register operators
    await helpers.registerOperators(0, 250, '10');
    await helpers.registerOperators(1, 250, '10');
    await helpers.registerOperators(2, 250, '10');
    await helpers.registerOperators(3, 250, '10');

    // Deposit into accounts
    for (let i = 0; i < 9; i++) {
      await helpers.deposit([i], ['1000000000000']);
    }

    // Clear validators array
    validators = []

    for (let i = 1000; i < 2000; i++) {
      // Define random values
      const randomOwner = Math.floor(Math.random() * 8)
      const randomOperator = (Math.floor(Math.random() * 995)) + 1

      // Define public key
      const publicKey = `0x${'1'.repeat(92)}${i}`

      // Register 1000 validators
      await trackGas(await ssvNetworkContract.connect(helpers.DB.owners[randomOwner]).registerValidator(
        publicKey,
        [randomOperator, randomOperator + 1, randomOperator + 2, randomOperator + 3],
        helpers.DataGenerator.shares(0),
        '100000'
      ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
      validators.push({ publicKey, owner: randomOwner })
    }
  });

  // NEED TO UPDATE WITH GAS TRACK ONCE UPDATE OPERATOR FEE IS ADDED
  it('Update 1000 operators', async () => {
    for (let i = 0; i < 250; i++) await ssvNetworkContract.connect(helpers.DB.owners[0]).updateOperatorFee(i + 1, 9);
    for (let i = 250; i < 500; i++) await ssvNetworkContract.connect(helpers.DB.owners[1]).updateOperatorFee(i + 1, 9);
    for (let i = 500; i < 750; i++) await ssvNetworkContract.connect(helpers.DB.owners[2]).updateOperatorFee(i + 1, 9);
    for (let i = 750; i < 1000; i++) await ssvNetworkContract.connect(helpers.DB.owners[3]).updateOperatorFee(i + 1, 9);
  });

  it('Remove 1000 operators', async () => {
    for (let i = 0; i < 250; i++) await trackGas(await ssvNetworkContract.connect(helpers.DB.owners[0]).removeOperator(i + 1), [GasGroup.REMOVE_OPERATOR]);
    for (let i = 250; i < 500; i++) await trackGas(await ssvNetworkContract.connect(helpers.DB.owners[1]).removeOperator(i + 1), [GasGroup.REMOVE_OPERATOR]);
    for (let i = 500; i < 750; i++) await trackGas(await ssvNetworkContract.connect(helpers.DB.owners[2]).removeOperator(i + 1), [GasGroup.REMOVE_OPERATOR]);
    for (let i = 750; i < 1000; i++) await trackGas(await ssvNetworkContract.connect(helpers.DB.owners[3]).removeOperator(i + 1), [GasGroup.REMOVE_OPERATOR]);
  });

  it('Transfer 1000 validators', async () => {
    for (let i = 0; i < validators.length; i++) {
      const randomOperator = (Math.floor(Math.random() * 995)) + 1
      await trackGas(await ssvNetworkContract.connect(helpers.DB.owners[validators[i].owner]).transferValidator(
        validators[i].publicKey,
        [randomOperator, randomOperator + 1, randomOperator + 2, randomOperator + 3],
        helpers.DataGenerator.shares(0),
        '100001'
      ), [GasGroup.TRANSFER_VALIDATOR_NEW_POD])
    }
  });

  it('Remove 1000 validators', async () => {
    for (let i = 0; i < validators.length; i++) {
      await trackGas(await ssvNetworkContract.connect(helpers.DB.owners[validators[i].owner]).removeValidator(validators[i].publicKey), [GasGroup.REMOVE_VALIDATOR]);
    }
  });

});
