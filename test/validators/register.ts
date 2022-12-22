// Declare imports
import * as helpers from '../helpers/contract-helpers';
import { expect } from 'chai';
import web3 from 'web3';
const Web3 = new web3();

import { trackGas, GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any, minDepositAmount: any;

const keys = {
  shared: [
    '0x90a8603a70b0ac53150114034feaad761ac645e9cb4905bb7f42b1c0e9ad69a7487228db49397a20ce2e2b285ad6d451',
    '0x805b0b2ab75322315200f7134cbc033bc0f2e148db92099aac613cedc74ae12f698abbee2e2dde7d84eb7244c639e62c',
    '0x99259d83c32130392d369ccb27d24e0ae6be3bfc74f6c697aa32134928e07db229178b02a18a61a8ab263260c3587669',
    '0xb3aa0ae55d4d4ba3647b449410a16cbc61e14f7ab2f7278ae78cb5b09ecf0a9110d47cb5d26b61a47430c546043bbafb'
  ],
  encrypted: [
    '0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000015874726d59785a5237657a763757375a6b583435394f312f6b684e384a4f4d69486d4c6a336b51625562705a67496d48693151653768786736527136414a7750774378434450507769354a73424a2f7a4342757653636f3350557158593764516f5631634d6f55343679716c767a50702b754c78657964706d704b624b78707435303047676b357a78534f4d7a48322b564b77353948634e52677a4a53457a796b7958465674454f6c77474b6f316e73774f6750325a32704c704f377a3630655150686f7342517278644a3449434e42473576626d38326358337138356e52346461734c5354637069727330757446696b5a43797a556d4c4c54394e6f74304e2f33734c523572487936477a78396772686c71446b44576d7a7a337a553935626e6c455a5a596261594a38575162774e3555616c68306a7a346f52765a6752314c4f58532b4d5a427773323450524f324c6f394c6956513d3d0000000000000000',
    '0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000001584374556359695133695833572f35504e4677535347767639484333516c414a6e386e5644475334414d4367776c6133386c7230456e4644465a5945764d41336465504849685443346d4955592f7671626c4b686f6f56417655413962726d4c2f435858477370576d6535795153584b5172686a7775396a514a6e44784a2f5a616878566f7359474c6f356559722b6d382b302f7a6a3454484b5a7444666f3773314676722b6751317459674d716354484b35366454474a36744e65657846395746344f6e33675a72537841665232536b6d2b4c6d373947333836476f6f7155516a7756585949382f614f3643715a7a376264666a50774435544c3848496543362b45444c57545063464d747430417638512b2f4277755570627266342b53616275556f434c395038554c6b5a66476a58774566734e3173736f6e4b70786c4a675471482b3971736668775753587957635135536563513d3d0000000000000000',
    '0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000001585463474c7944534863494e4b674c577838564a462b774d55306f493874672b5a4b704b744466366267464b744e304b455444695a374b785752367076546e74365462706d376d663350386a6e655773707665757758374734564962554a313373394d5a3149684a7047587056542b522b525268534a3634705139314a716671594e59462f30484b7862724f6d75557770724a6f5642306776717a646d4a585a634f7743454467376341474959446c373370624a48616966546f4e75566344427841335a2f5a333773734a3963715439316645523651764e6538614c3445695a7346517551596f4d537444352f50747a63434b79506a654f352b4c564a327755675174616c5974634b6d377a586c6a6e38526132344c71554d37514b36435348327066527a6e424970764d4a68462f5079654839342f7a76414852516f6e444b616f7749364a51675976415279636634752f652f2f52513d3d0000000000000000',
    '0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000158746e694f4a72655078702b646e6a304b482b41544c46623575634f683354394274374e362f3271652b2b4d717876362f6b466b757a624a4d507739614b6f6950554d3051312b6a57414c374a387578627a366e3330412f6478412f75766d48534443714c4b705a68444a564d4c4e654657554d6b676d44646d2b784d4c6c3175626c705a4c334c37442f53354935684e414c7364304d4c456447434d4b574d42374a455a357a67546f58456d51712b4e31316337457a65445861424a7063526c487a736864717251544e796976524944396d4b63384f315950364f307439314c674b472f535856656f3236677a4730416e6545466b76626c59597743734a5143544a48506c5074544f765677326c6c31474a6c6541586e77576a323476332f35526b324e68576a6669394745617730314f36543133677435654d7761524533422f476c7275782b7957786e4d6f76374d5a70687644773d3d0000000000000000'
  ].map(b64 => Web3.eth.abi.decodeParameter('string',b64))
};

describe('Register Validator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;

    // Register operators
    await helpers.registerOperators(0, 14, helpers.CONFIG.minimalOperatorFee);

    minDepositAmount = (helpers.CONFIG.minimalBlocksBeforeLiquidation + 2) * helpers.CONFIG.minimalOperatorFee * 13;

    // cold register
    await helpers.DB.ssvToken.connect(helpers.DB.owners[6]).approve(helpers.DB.ssvNetwork.contract.address, '1000000000000000');
    await ssvNetworkContract.connect(helpers.DB.owners[6]).registerValidator(
      '0x221111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111119',
      [1,2,3,4],
      helpers.DataGenerator.shares(0),
      '1000000000000000',
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    );
  });

  it('4 operators: Register 1 new validator gas usage', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      helpers.DataGenerator.cluster.new(),
      Web3.utils.hexToBytes(Web3.utils.asciiToHex(JSON.stringify(keys))), // helpers.DataGenerator.shares(0),
      minDepositAmount,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
  });

  it('4 operators: Register 2 validators in same pod gas usage', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    const { eventsByName } = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      [1,2,3,4],
      Web3.utils.hexToBytes(Web3.utils.asciiToHex(JSON.stringify(keys))), // helpers.DataGenerator.shares(0),
      minDepositAmount,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);

    const args = eventsByName.PodMetadataUpdated[0].args;

    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(2),
      [1,2,3,4],
      Web3.utils.hexToBytes(Web3.utils.asciiToHex(JSON.stringify(keys))), // helpers.DataGenerator.shares(0),
      minDepositAmount,
      args.pod
    ), [GasGroup.REGISTER_VALIDATOR_EXISTING_POD]);
  });

  it('4 operators: Register 2 validators in same pod and 1 validator in new pod gas usage', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    const { eventsByName } = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      [1,2,3,4],
      Web3.utils.hexToBytes(Web3.utils.asciiToHex(JSON.stringify(keys))), // helpers.DataGenerator.shares(0),
      minDepositAmount,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);

    const args = eventsByName.PodMetadataUpdated[0].args;

    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(2),
      [1,2,3,4],
      Web3.utils.hexToBytes(Web3.utils.asciiToHex(JSON.stringify(keys))), // helpers.DataGenerator.shares(0),
      minDepositAmount,
      args.pod
    ), [GasGroup.REGISTER_VALIDATOR_EXISTING_POD]);

    await helpers.DB.ssvToken.connect(helpers.DB.owners[2]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[2]).registerValidator(
      helpers.DataGenerator.publicKey(4),
      [2,3,4,5],
      Web3.utils.hexToBytes(Web3.utils.asciiToHex(JSON.stringify(keys))), // helpers.DataGenerator.shares(0),
      minDepositAmount,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
  });

  it('4 operators: Register 2 validators in same pod with one time deposit gas usage', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, `${minDepositAmount*2}`);
    const { eventsByName } = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      [1,2,3,4],
      Web3.utils.hexToBytes(Web3.utils.asciiToHex(JSON.stringify(keys))), // helpers.DataGenerator.shares(0),
      `${minDepositAmount*2}`,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);

    const args = eventsByName.PodMetadataUpdated[0].args;
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(2),
      [1,2,3,4],
      Web3.utils.hexToBytes(Web3.utils.asciiToHex(JSON.stringify(keys))), // helpers.DataGenerator.shares(0),
      0,
      args.pod
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE_WITHOUT_DEPOSIT]);
  });

  /*

  // 7 operators

  it('7 operators: Register 1 new validator gas usage', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      helpers.DataGenerator.cluster.new(7),
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE_7]);
  });

  it('7 operators: Register 2 validators in same pod gas usage', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    const { eventsByName } = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      [1,2,3,4,5,6,7],
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE_7]);

    const args = eventsByName.PodMetadataUpdated[0].args;

    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(2),
      [1,2,3,4,5,6,7],
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      args.pod
    ), [GasGroup.REGISTER_VALIDATOR_EXISTING_POD_7]);
  });

  it('7 operators: Register 2 validators in same pod and 1 validator in new pod gas usage', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    const { eventsByName } = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      [1,2,3,4,5,6,7],
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE_7]);

    const args = eventsByName.PodMetadataUpdated[0].args;

    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(2),
      [1,2,3,4,5,6,7],
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      args.pod
    ), [GasGroup.REGISTER_VALIDATOR_EXISTING_POD_7]);

    await helpers.DB.ssvToken.connect(helpers.DB.owners[2]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[2]).registerValidator(
      helpers.DataGenerator.publicKey(4),
      [2,3,4,5,6,7,8],
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE_7]);
  });

  it('7 operators: Register 2 validators in same pod with one time deposit gas usage', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, `${minDepositAmount*2}`);
    const { eventsByName } = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      [1,2,3,4,5,6,7],
      helpers.DataGenerator.shares(0),
      `${minDepositAmount*2}`,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE_7]);

    const args = eventsByName.PodMetadataUpdated[0].args;
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(2),
      [1,2,3,4,5,6,7],
      helpers.DataGenerator.shares(0),
      0,
      args.pod
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE_WITHOUT_DEPOSIT_7]);
  });

  // 13 operators

  it('13 operators: Register 1 new validator gas usage', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      helpers.DataGenerator.cluster.new(13),
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE_13]);
  });

  it('13 operators: Register 2 validators in same pod gas usage', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    const { eventsByName } = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      [1,2,3,4,5,6,7,8,9,10,11,12,13],
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE_13]);

    const args = eventsByName.PodMetadataUpdated[0].args;

    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(2),
      [1,2,3,4,5,6,7,8,9,10,11,12,13],
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      args.pod
    ), [GasGroup.REGISTER_VALIDATOR_EXISTING_POD_13]);
  });

  it('13 operators: Register 2 validators in same pod and 1 validator in new pod gas usage', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    const { eventsByName } = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      [1,2,3,4,5,6,7,8,9,10,11,12,13],
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE_13]);

    const args = eventsByName.PodMetadataUpdated[0].args;

    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(2),
      [1,2,3,4,5,6,7,8,9,10,11,12,13],
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      args.pod
    ), [GasGroup.REGISTER_VALIDATOR_EXISTING_POD_13]);

    await helpers.DB.ssvToken.connect(helpers.DB.owners[2]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[2]).registerValidator(
      helpers.DataGenerator.publicKey(4),
      [2,3,4,5,6,7,8,9,10,11,12,13,14],
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE_13]);
  });

  it('13 operators: Register 2 validators in same pod with one time deposit gas usage', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, `${minDepositAmount*2}`);
    const { eventsByName } = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      [1,2,3,4,5,6,7,8,9,10,11,12,13],
      helpers.DataGenerator.shares(0),
      `${minDepositAmount*2}`,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE_13]);

    const args = eventsByName.PodMetadataUpdated[0].args;
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(2),
      [1,2,3,4,5,6,7,8,9,10,11,12,13],
      helpers.DataGenerator.shares(0),
      0,
      args.pod
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE_WITHOUT_DEPOSIT_13]);
  });

  it('Register validator returns an error - PodDataIsBroken', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, `${minDepositAmount*2}`);
    await ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(2),
      [1, 2, 3, 4],
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    );

    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(3),
      [1, 2, 3, 4],
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      {
        validatorCount: 2,
        networkFee: 10,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    )).to.be.revertedWith('PodDataIsBroken');
  });

  it('Register validator returns an error - OperatorDoesNotExist', async () => {
    await expect(ssvNetworkContract.registerValidator(
      helpers.DataGenerator.publicKey(2),
      [1, 2, 3, 25],
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    )).to.be.revertedWith('OperatorDoesNotExist');
  });

  it('Register validator with removed operator returns an error - OperatorDoesNotExist', async () => {
    await ssvNetworkContract.removeOperator(1);
    await expect(ssvNetworkContract.registerValidator(
      helpers.DataGenerator.publicKey(2),
      [1, 2, 3, 4],
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    )).to.be.revertedWith('OperatorDoesNotExist');
  });

  it('Register validator emits ValidatorAdded event', async () => {
    await helpers.DB.ssvToken.approve(ssvNetworkContract.address, minDepositAmount);
    await expect(ssvNetworkContract.registerValidator(
      helpers.DataGenerator.publicKey(1),
      [1, 2, 3, 4],
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    )).to.emit(ssvNetworkContract, 'ValidatorAdded');
  });

  it('Register pod returns an error - The operators list should be in ascending order', async () => {
    await expect(helpers.registerValidators(2, 1, minDepositAmount, [3, 2, 1, 4])).to.be.revertedWith('OperatorsListDoesNotSorted');
  });

  it('Invalid operator amount reverts "OperatorIdsStructureInvalid"', async () => {
    // 2 Operators
    await expect(helpers.registerValidators(2, 1, minDepositAmount, [1, 2])).to.be.revertedWith('OperatorIdsStructureInvalid');

    // 6 Operators
    await expect(helpers.registerValidators(2, 1, minDepositAmount,  [1, 2, 3, 4, 5, 6])).to.be.revertedWith('OperatorIdsStructureInvalid');

    // 14 Operators
    await expect(helpers.registerValidators(2, 1, minDepositAmount,  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])).to.be.revertedWith('OperatorIdsStructureInvalid');
  });

  it('Register validator with an invalild public key reverts "InvalidPublicKeyLength"', async () => {
    await expect(ssvNetworkContract.registerValidator(
      helpers.DataGenerator.shares(0),
      [1, 2, 3, 4],
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    )).to.be.revertedWith('InvalidPublicKeyLength');
  });

  it('Register validator returns an error - NotEnoughBalance', async () => {
    await helpers.DB.ssvToken.approve(ssvNetworkContract.address, helpers.CONFIG.minimalOperatorFee);
    await expect(ssvNetworkContract.registerValidator(
      helpers.DataGenerator.publicKey(1),
      [1, 2, 3, 4],
      helpers.DataGenerator.shares(0),
      helpers.CONFIG.minimalOperatorFee,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    )).to.be.revertedWith('NotEnoughBalance');
  });

  it('Register validator returns an error - ValidatorAlreadyExists', async () => {
    await helpers.DB.ssvToken.approve(ssvNetworkContract.address, helpers.CONFIG.minimalOperatorFee);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[6]).registerValidator(
      '0x221111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111119',
      [1,2,3,4],
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    )).to.be.revertedWith('ValidatorAlreadyExists');
  });
  */
});
