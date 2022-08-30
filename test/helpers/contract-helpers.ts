// Imports
declare const ethers: any;

import { trackGas, getGasStats } from './gas-usage';

// Generate shares
const shares = Array.from(Array(10).keys()).map(k => `0xe0096008000000b4010000040000001000000076000000dc000000420d142c307831323334353637383930fe0a00520a000031017afe66008266000032fe66009266000033fe66009266000034016621ac28d60000009c01000062020025c02c307839383736353433323130fe0a00520a000031fe560052560019b0003101dafec60082c6000032fec6007ac6004d6ca666000033ceb401fe8c017e8c014dcca6c6004d7a0035b23200fec6007ec6000034${k}${k}`);

export const initializeContract = async (numberOfOperators: number, fee: number) => {
  // Define accounts
  const [owner] = await ethers.getSigners();

  // Initialize contract
  const ssvNetwork = await ethers.getContractFactory('SSVNetwork');
  const deployedRegistryContract = await ssvNetwork.deploy();
  await deployedRegistryContract.deployed();

  // Register Operators
  for (let i = 0; i < numberOfOperators; i++) {
    const encodedABI = '0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000002644c5330744c5331435255644a54694253553045675546564354456c4449457446575330744c533074436b314a53554a4a616b464f516d64726357687261556335647a424351564646526b464254304e425554684254556c4a516b4e6e53304e42555556424e5756554e557777563068365a54647954575a506232787456484d4b64577449513245344b336474625577324f54464a5131527052454531556b4a31546b787153565132576b4530597a4d78635652495933464256486c3565566b774c7a6b3352336c4b5a32646f596e6c465232526f5a516f76616c6836615756544f584a325279744a56474631516a684d566c686b656b78475956517857455a5765466c6e4e327832546c42344f5552504c315a6f526b686b5757786e54334932643052745633466a52476f33436c68575557464f57454674526e67334e6a56514e546c584e585a7a564752585657464852577858536d3933536b5a4b646e6332556c5249536b5a315456686a537a5a5661574a3063555a4d536d4a774f57356b6455674b516a6c4c537a4e57636d59725a6d744a4f5752425a327478524446484f456c785130744b4d566c33626a557965477878625452434e69744f4f475a555a45314d53314a75635770465a6d527a563164774d46567a4d51704c54573976535863796333426f6158417a5546704e596e4a61615530774e6a4a325a556f3055336f76596a424f62576450546e685464304a4a546e4e7863473534516a68465556517853544e6a4e6b6c714e586868436d35525355524255554643436930744c5330745255354549464a545153425156554a4d53554d675330565a4c5330744c53304b00000000000000000000000000000000000000000000000000000000';
    await deployedRegistryContract.registerOperator(encodedABI, fee);
  }

  // Generate Operator IDs
  const operatorIDs = Array.from(Array(numberOfOperators).keys()).map(k => k + 1);

  // Deposit to the contract
  await deployedRegistryContract.deposit('9000000000000000000');

  return { contract: deployedRegistryContract, operatorIDs: operatorIDs, shares: shares, owner: owner };
};

export const registerValidators = async (numberOfValidators: number, amount: string, operatorAmount: number, contract: any) => {
  const validatorData: any = [];
  const validatorsToRegister = 1000 + numberOfValidators;

  // Register validators to contract
  for (let i = 1000; i < validatorsToRegister; i++) {
    const randomOperator = Math.floor(Math.random() * (operatorAmount - 4));
    const validatorPK = `0xa7ae1ea93b860ca0269ccca776b4526977395aa194e5820a00dedbf1cd63e7a898eec9a12f539f733ea4df9c651f${i}`;

    const receipt = await trackGas(contract.registerValidator(
      [randomOperator, randomOperator + 1, randomOperator + 2, randomOperator + 3],
      validatorPK,
      shares[0],
      amount,
    ), 'registerValidator', 400000);

    const registerResult = receipt.logs[0];

    // Save validator group id emits
    const interfaceRegister = new ethers.utils.Interface(['event ValidatorAdded(bytes validatorPK, bytes32 groupId, bytes shares)']);
    const outputRegister = interfaceRegister.decodeEventLog('ValidatorAdded', registerResult.data, registerResult.topics);

    // Save the validator emit
    validatorData.push({ publicKey: validatorPK, groupId: outputRegister.groupId });
  }

  return validatorData;

};
