// Imports
declare const ethers: any;
declare const upgrades: any;

import { trackGas, GasGroup } from './gas-usage';

export let DB: any;
export let CONFIG: any;

const SHARES = [
  // 4 shares
  "0x0202686448614337673633566a4a42734966346b525457427872744336684162355454796c5776677a5763505a75785656495458492b4a436a7261562f325677302f7043413252454168317579414464774b7a726478426c3246626f6f72575a6b5262757647425936726442444271343045586b32765677397765346c74486639491f7ba8b4ed90bf0b7724497d2033ed0bac529078800c9dec63a1126fcfe900c14f8916fade6a9fd63f5e34976c3aa668def077777e497863caca80dc0b05c057924fc33c3609f66f55dce30881eff32eb1077a30fbe45f1e2cc2b9e3168914488d8647236273f2e497713c1c808fae3e81b39f8485010582b8aba5cf674a958e424b4449587a5076526a667667334749777463437358776d32367448677a65483172382f6c6b37557472392b6c5661564f36635657766c7555336777544336434b367a556d4b31714c434a6f70622f64355074573644625444373971477275517638357232675a764d394872652b4e39315a546a6c424b6f503469664863336351377970494d382b766b48716f56536250356c544570336b564b436477624a61684c67727335484b636d76306d357952526a44656949722f524f73305852325033513d3d65b86cca9c853357b4757a82d0bb2e05c498cbc1cb4ec5b7928893ae885f3d3a1198ad41d0f724d8ba4306051b7bcfa57a18a3f984ebd08952eb6ee613f5a00643f82c358ec75e86bdfcc43372c37498ebb615be52ba7ad1a94c775da8a741aaea4dc26ee46c15c0d820637b32b93ba65919bb3f516c0fed35d21846de53c2352cc5741254aec7404fc6c51f6a5c2af5824f0cb1d4e2881e88265512bcde43fe774498e21deada68cd63deba459a3ba127ccccea461049be0d19f2ecb1c7843537acf9703492be41968f36e4f6b909aaa439598afa74a75826c92622476c591e1056ae2aaeee9bcaefa2439e817e1c40bfb68f750b9e3e8053866f65d703a78b7e555afb239cd84973461814cc99ae430374692201e0d7c938613892827a34da4d3f3c289ad86be836b03083e0a0e8837872cc6a1add6f08c0d1781fe8ab006989c233abde3b0ee9e61220bb512ccf13e49aaa07a2cf96c46376bf1c679f321e683e3ccbafa9cf434b8ab4f7bb039ca3686b15719c3821604fc63edab9851567f7f0060a18168f15d28dc397d4470d0ba5da0a330185ac50ef59ea92e86cef8760edaac6ab45ad977570e29388e8cd1c8bfb70e51b698624a02947303241cc4b88486301a3859714af6a2e1d3d3fb77faa18bad79c86d21e811129aeb22fd1213e61b3dcb78e95424ce3a28d1c0aec92ccbb57d1f099d42ee3a5c00e43c9cbeb6d09a704338420da34217ef29a496a577a9ad3410ef21988a30c5331ce2c1d9921a4a41d3250bb263f05d53b7198253452c77b1385306318ed7cc8cf0d49b6c666ec3c98bcf6b23c1bf6c648",
  // 7 shares
  "0x03827043413252454168317579414464774b7a726478426c3246626f6f72575a6b5262757647425936726442444271343045586b32765677397765346c74486639491f7ba8b4ed90bf0b7724497d2033ed0bac529078800c9dec63a1126fcfe900c14f8916fade6a9fd63f5e34976c3aa668def077777e497863caca80dc0b05c057924fc33c3609f66f55dce30881eff32eb1077a30fbe45f1e2cc2b9e3168914488d8647236273f2e497713c1c808fae3e81b39f8485010582b8aba5cf674a958ed35a4fbb614945ddfd46878e46f07d9e702ff97ab399a6e60dd303a66fb106d264b0d5d3b7306f5efd07565ba58ad09e8094c736a6f13c27e821b3c340807bfc09153d27d021444f469203a94fe0a0f90feda4d9ed4842f3f6d1bca663b2d675d83bb23b63ac5135a443f905108118ba8cdbdb9f6f52b44e2aa9fb4825df14fa4e1d8dde2e168c0798dacf077c12d99439e34d1ffd91e59513e263b5d0cb863035cf507af0b3899f8bf3b4a53ab85a34f0a8713db242ed7948f00d64a0bb2dc530e731505dd1f36b50bd9cbf7b3052045f6308873ac459eebd3dee7299aaf5be0ea67e5d24b51d79d7f5c92bf68f2fc3e586da271b26b4f6697a8b6cfd14ae85893692a19e50d006f8fe28d78b779c5096a64b2b2572953ed5db83005c54260d8b2e43005d242d7bb4a9f385d5298247104496d88efd9693d56db70cf0f83f6a92bf0db11513a245b56b2e5c81806baf96168e045ea62041b3547c2ce6dcba374829765425401124d99881317c9a56710189f2f9a62d398fc29056157f9fee0d3e3939ec3406842643d85d68e9c6a68e5d3281113d1283778389c564b669594e694018a9bf48d13b7d840ca7cf21d13fcefeafbce7e79702db4731f5f6cd8f1d5c3cff83f73ea14399c7ededf380605be9d30ce2a383fa80c37c5558c760eddc836d462dcf70597581a00b40b472e5a1f12c2b64af326ec60bfc1b8c121754ff53509d93a0a870b8a2fada856b232a1cd4191f4010d4207af9ea823602a25f5e615bc711fd089183cce917e4f236bb4005b55074a8311a8d3e6547259451d73790b2476e2792f64a267652adfbf0b0a73af101b070582e2a111512364c8d1a139411c338b401210841917a8c96648ca8b2006a64c15fc40498c880959c44a71e79a62a437f3461747bdafe323ed35be64fea9dbe358e8b82780fda2004eb78ff208ae7fc7952ce89c6e1ba7a01ca553ed73d27b49e014a296e01ec48d1e7c22a44c9650a1f425a5799dbaf6a41131488cd84cbeec6508cc7a38b3cfdf03f5848478f404f9fcabd188e14780021391cfc7811653d017655b7f8e4910c55ea2db01d1d43d9af2cf005d7346573e4bc0af64d595d4a5eb5ca177abf35e9487195161a6c4795c09e522c9d375535df5492a61c45a7132023771cf73b1f4ed159989ffd08a79258ab3b5013a8e55dd1f43a029f3790109f8966c40720cded64946b620fd07eae230cfc1637dee2827c1dff93c3e7a2d3f3797dd4c7500f0c24c5989ed92d8fb3abc4b80f3bda5cb5e8d952ed729d6676e7dcf34dd1b1e71d407744b44d40fb53e1264e85ed3cc97c0db208ef1958024fd475b809ffd576fd8075467e437c8abc9b18e6427a2bf60ec1af40ee1cb9d89ed08dd11eb2302a2b8a97288e516b238bd461a99573964886f1782899ff4ca67773394a8282d826aae73a38e8daeb3c472e7c8552e12c0b88bc7517c8eaefe5c8a6c5cdf0b8991db58d8226e37dba214579c3f2b1368654a59590ccc9270513918472e1e15cfc3277edb7d1d78e4ea9ced3658c07b606fe3e361d015f3b6646bd8400ad121cb4c1456ce04bd8d84fdb9e3b2173cebd715adeeea12dcf6de13ba90d4846778a6ecd305e54389718a6fea37b6796cb565f8c391a20a65a9d50646037a6f4d1fde7999262c9e66198946ad39018834f5bc8dd7b6ac25852a79541df7ce5abcba153757f9f2d90f40030b553a6853100ffe04f51bef48e1c3cc469018b0f30c3cb82b83ce6d681f8e7cadd745c680c924e56ddb2cc254246177fc7759c59719e118e89a69efeaead1b58518986a9a13700306e093605d22c1dd0926a093390a125be865b79c7584b9f334d5863a30f2afef18e3d6dfcb78823effcd4b06daefa4aa2761d0c64bf2af7767327edf5f77d245fd09ec31747cf8ec6018c0815fec76a82f472cc8f1675ce99b1052c976aa904d55c194691b301851f1f0c26fb5b41531a253bef46e6b75268a46466657f6c933833b986fef7e0a5d832a8eddec85465021498a55f08108c3dc10ab5419e1a0b7f6381b08ec8ab10069491a4107d79736c93efe555d9ea29f000c5663d1ebe1c1621e93266b36aae4051de46361f15d5a64a07f3c4be5d3257c3090a5d5259f066c6b70f310258f6ee119bf2f1b4eb5242832c0012c32a88477b736cc1818950a91829fb2036805330f981534936bc22611303653fb025653caff1a4be19fc366a2cdceb957aba863a0f3a6683a93289e6aeb0c82dd363b39aee4fd61287bf14301073296a6e83d7aed14093be4772eeaecbd6",
  // 13 shares
  "0x06827043413252454168317579414464774b7a726478426c3246626f6f72575a6b5262757647425936726442444271343045586b32765677397765346c74486639491f7ba8b4ed90bf0b7724497d2033ed0bac529078800c9dec63a1126fcfe900c14f8916fade6a9fd63f5e34976c3aa668def077777e497863caca80dc0b05c057924fc33c3609f66f55dce30881eff32eb1077a30fbe45f1e2cc2b9e3168914488d8647236273f2e497713c1c808fae3e81b39f8485010582b8aba5cf674a958ed35a4fbb614945ddfd46878e46f07d9e702ff97ab399a6e60dd303a66fb106d264b0d5d3b7306f5efd07565ba58ad09e8094c736a6f13c27e821b3c340807bfc09153d27d021444f469203a94fe0a0f90feda4d9ed4842f3f6d1bca663b2d675d83bb23b63ac5135a443f905108118ba8cdbdb9f6f52b44e2aa9fb4825df14fa4e1d8dde2e168c0798dacf077c12d99439e34d1ffd91e59513e263b5d0cb863035cf507af0b3899f8bf3b4a53ab85a34f0a8713db242ed7948f00d64a0bb2dc530e731505dd1f36b50bd9cbf7b3052045f6308873ac459eebd3dee7299aaf5be0ea67e5d24b51d79d7f5c92bf68f2fc3e586da271b26b4f6697a8b6cfd14ae859e57d65800c810586001058a1a2ec0b52f8732a19c32ec534b868d78dc347cdfb135a9e03c3fdbcd563d6eac0169d970f3e0899b6975152c4ed393e2256b2075e02ce2edda555ef314af4541f2a262ead2c28c41e86978422815ffc001a387c8d5b83a909cc198851473b0785983875a8480337382b460469576e2606829a9fd3ceeabc18e24087d91a864de3b4b4e2bd72c950c740228f38c8197bbaebb76206876fcd7cb01ca90cbb81fcdac80c07ce05dc2902427ba5782afb75e5dd96e483484a122edada709f9d09b269930058e3c1dc708f7222790c99394dd398b5f793306f503b1a1b3ace28eb1cd412b402639a8beccffc4029b9d7a33ed79598fd5738cd53e9905df756ed82b0fdb5d5d9ef7757faac258b0933850a4c297478e363db465171d149ca3e1216b1f38e83c53994ae26a4648e1823435db65dcb2ce8b2b0660b6016a0af950e47cf3ed17112db4fe9ece1ae1dfd8b246aed9b22d3676bf5ca043a0b6f835e98c48cb876281fb8670d5058ea460ab3b16c06a99a97e0f893692a19e50d006f8fe28d78b779c5096a64b2b2572953ed5db83005c54260d8b2e43005d242d7bb4a9f385d5298247104496d88efd9693d56db70cf0f83f6a92bf0db11513a245b56b2e5c81806baf96168e045ea62041b3547c2ce6dcba374829765425401124d99881317c9a56710189f2f9a62d398fc29056157f9fee0d3e3939ec3406842643d85d68e9c6a68e5d3281113d1283778389c564b669594e694018a9bf48d13b7d840ca7cf21d13fcefeafbce7e79702db4731f5f6cd8f1d5c3cff83f73ea14399c7ededf380605be9d30ce2a383fa80c37c5558c760eddc836d462dcf70597581a00b40b472e5a1f12c2b64af326ec60bfc1b8c121754ff53509d93a0a870b8a2fada856b232a1cd4191f4010d4207af9ea823602a25f5e615bc711fd089183cce917e4f236bb4005b55074a8311a8d3e6547259451d73790b2476e2792f64a267652adfbf0b0a73af101b070582e2a111512364c8d1a139411c338b401210841917a8c96648ca8b2006a64c15fc40498c880959c44a71e79a62a437f3461747bdafe323ed35be64fea9dbe358e8b82780fda2004eb78ff208ae7fc7952ce89c6e1ba7a01ca553ed73d27b49e014a296e01ec48d1e7c22a44c9650a1f425a5799dbaf6a41131488cd84cbeec6508cc7a38b3cfdf03f5848478f404f9fcabd188e14780021391cfc7811653d017655b7f8e4910c55ea2db01d1d43d9af2cf005d7346573e4bc0af64d595d4a5eb5ca177abf35e9487195161a6c4795c09e522c9d375535df5492a61c45a7132023771cf73b1f4ed159989ffd08a79258ab3b5013a8e55dd1f43a029f3790109f8966c40720cded64946b620fd07eae230cfc1637dee2827c1dff93c3e7a2d3f3797dd4c7500f0c24c5989ed92d8fb3abc4b80f3bda5cb5e8d952ed729d6676e7dcf34dd1b1e71d407744b44d40fb53e1264e85ed3cc97c0db208ef1958024fd475b809ffd576fd8075467e437c8abc9b18e6427a2bf60ec1af40ee1cb9d89ed08dd11eb2302a2b8a97288e516b238bd461a99573964886f1782899ff4ca67773394a8282d826aae73a38e8daeb3c472e7c8552e12c0b88bc7517c8eaefe5c8a6c5cdf0b8991db58d8226e37dba214579c3f2b1368654a59590ccc9270513918472e1e15cfc3277edb7d1d78e4ea9ced3658c07b606fe3e361d015f3b6646bd8400ad121cb4c1456ce04bd8d84fdb9e3b2173cebd715adeeea12dcf6de13ba90d4846778a6ecd305e54389718a6fea37b6796cb565f8c391a20a65a9d50646037a6f4d1fde7999262c9e66198946ad39018834f5bc8dd7b6ac25852a79541df7ce5abcba153757f9f2d90f40030b553a6853100ffe04f51bef48e1c3cc469018b0f30c3cb82b83ce6d681f8e7cadd745c680c924e56ddb2cc254246177fc7759c59719e118e89a69efeaead1b58518986a9a13700306e093605d22c1dd0926a093390a125be865b79c7584b9f334d5863a30f2afef18e3d6dfcb78823effcd4b06daefa4aa2761d0c64bf2af7767327edf5f77d245fd09ec31747cf8ec6018c0815fec76a82f472cc8f1675ce99b1052c976aa904d55c194691b301851f1f0c26fb5b41531a253bef46e6b75268a46466657f6c933833b986fef7e0a5d832a8eddec85465021498a55f08108c3dc10ab5419e1a0b7f6381b08ec8ab10069491a4107d79736c93efe555d9ea29f000c5663d1ebe1c1621e93266b36aae4051de46361f15d5a64a07f3c4be5d3257c3090a5d5259f066c6b70f310258f6ee119bf2f1b4eb5242832c0012c32a88477b736cc1818950a91829fb2036805330f981534936bc22611303653fb025653caff1a4be19fc366a2cdceb957aba863a0f3a6683a93289e6aeb0c82dd363b39aee4fd61287bf14301073296a6e83d7aed14093be4772eeaecbd60e0712a1d7162fe5b21f644c5ad3bfb52e0f743fa629ae593edb1e0251ce50fb2ec5a5ec41b31a7a88d5bb486923ebb7a33976f9729f37dbc4ac4edf5f1087af28e4eead3979fb2dcee95760b0b5fa74c963f3fe10f71d5fc54fe12c04a714883e401156fc7f5aa1d33e2a8257f26f39e6919d95da284aaf8d2edef2fa111d0d1db4b90d4f67cb23df5aab9707779b19188e8be257ed346daa3ddadcc1a361766a7cf824ddff7445886e95194650b37c7797786f280ec36b29471d1fdf29e8835e58bcd178971bd6b57ac6496e98374346480a9ce314c349f2f7bebdc7d9de8a2aeb2700c17242bbdbd7abd282cbb7bd83f23f6f10c49662aee094e8034fc4c50836810cea1eb9e01b1bc97303cc6c0c72fa3edd76a69213e777bf7b53e947fe98857440282341fd6f7a88b1876fd8b9e9fc8e9629e78a749a8381239eae43cf73837c77b44166254b8c0a64624631f18456896416365c3feb3a730eae48ea19edd6d6f5b5c5a5eccc60c5a312aca091f21993080b3fa3920365f144f5f2f8062951317d9a82bc0d35ef252bd016dc86c879f549b4e09df13d526021aa8f8fbacd229df936a4572dc27fac19e8ca450a92d85e2762e1fdcc464defa46bce846a8cba3472f0eb6a0b7057b306fe6baeafe015b61ece41f7b0b0b323cd8e39ca6b4b76802bda179c17d48c6f34c5bda4fa3f081686333cbddaaceec16611d74062b918fe38ca7a8333a48f1a7ac25bbb3e66d3bd44172166455d3777374abfa270a6f4bd5930803593a82f8b97d57538937384748d45c1f9423ddf9763fba14d479ea233d239529a5720a68f14c9a259e118659e9f78ae2ed940cdbc967c911603c20edeecf5f2db830db749da00e09087b582fb450a654a139decf84471e545e989341d083f5ec92163494791047c29cb18e737c5ed2b843cda1128c1b288265bbc0aa27586bd71cdf7c8e3a82c310a1c30fe859fb3ddbe58ec1d58833614849490e91a65fa0db12f62a7fed05e4e99ba56a450a2f8526f3ae579ac986c66d2a8224fb9be9688874342ed2cecbe884e199a9b9d3beaa547819494074a9638508892f7841f5a20bacbc7d1b2e194f6988f7044fa9f0eaea06bac418e2bb4983fbe626c2143535440b750cc29217b8c97480946e089eb57e0f1ab303515e41d6198875cbdad341d939d4677aba12f2478b64a43003ba0f044f3ea5a386e98bbd939b1056d4ea861f5d6960fc74e000a6e438c05efbd1d2033a6754f810c5f852241676d300aadb5f110b84263904cc538c1fcd7a7174bcbbc807d9c760aa19246fee171deeecfb281ee8890b09cb8b8e8411f7fb67f1dfa28fb2a682811434465ad9689d75533d6763d5d4b5ba5f30978eb61a53541a7c5ed9e6289bdcc38ad157a6498f9f092acbd6d38ea0603c9c74c694317716470e3554fff9c50b6d787cb93f3b9b58d88f4739a8927a185e46d03f212a113769f666a48a4d01e843c804dfb0930a8438dc6914d84316119cc434a0502f60bbbb41f0e51ce42d216fc0f26d8dfc75017fca283ae06df7a1d9745bc75b7184932a18223e1b725ece0ce95af007b3b00135b1f6c0a5c2effa3762d4e263f57d40e247c29949a8fae0663f187cd24d77ee281823dbc2ea6cb40cddca42e31efae45bf860c95"
];

export const DataGenerator = {
  publicKey: (index: number) => `0x${index.toString(16).padStart(96, '1')}`,
  shares: (index: number) => {
    switch (index) {
      case 7:
        return SHARES[1];
      case 13:
        return SHARES[2];
      default:
        return SHARES[0];
  }
  },
  cluster: {
    new: (size = 4) => {
      const usedOperatorIds: any = {};
      for (const clusterId in DB.clusters) {
        for (const operatorId of DB.clusters[clusterId].operatorIds) {
          usedOperatorIds[operatorId] = true;
        }
      }

      const result = [];
      for (const operator of DB.operators) {
        if (operator && !usedOperatorIds[operator.id]) {
          result.push(operator.id);
          usedOperatorIds[operator.id] = true;

          if (result.length == size) {
            break;
          }
        }
      }
      if (result.length < size) {
        throw new Error('No new clusters. Try to register more operators.');
      }
      return result;
    },
    byId: (id: any) => DB.clusters[id].operatorIds
  }
};

export const initializeContract = async () => {
  CONFIG = {
    operatorMaxFeeIncrease: 1000,
    declareOperatorFeePeriod: 3600, // HOUR
    executeOperatorFeePeriod: 86400, // DAY
    minimalOperatorFee: 100000000,
    minimalBlocksBeforeLiquidation: 6570,
  };

  DB = {
    owners: [],
    validators: [],
    operators: [],
    clusters: [],
    ssvNetwork: {},
    ssvToken: {},
  };

  // Define accounts
  DB.owners = await ethers.getSigners();

  // Initialize contract
  const ssvNetwork = await ethers.getContractFactory('SSVNetwork');
  const ssvToken = await ethers.getContractFactory('SSVTokenMock');

  DB.ssvToken = await ssvToken.deploy();
  await DB.ssvToken.deployed();

  DB.ssvNetwork.contract = await upgrades.deployProxy(ssvNetwork, [
    DB.ssvToken.address,
    CONFIG.operatorMaxFeeIncrease,
    CONFIG.declareOperatorFeePeriod,
    CONFIG.executeOperatorFeePeriod,
    CONFIG.minimalBlocksBeforeLiquidation
  ]);

  await DB.ssvNetwork.contract.deployed();

  DB.ssvNetwork.owner = DB.owners[0];

  await DB.ssvToken.mint(DB.owners[1].address, '1000000000000000');
  await DB.ssvToken.mint(DB.owners[2].address, '1000000000000000');
  await DB.ssvToken.mint(DB.owners[3].address, '1000000000000000');
  await DB.ssvToken.mint(DB.owners[4].address, '1000000000000000');
  await DB.ssvToken.mint(DB.owners[5].address, '1000000000000000');
  await DB.ssvToken.mint(DB.owners[6].address, '1000000000000000');

  return { contract: DB.ssvNetwork.contract, owner: DB.ssvNetwork.owner, ssvToken: DB.ssvToken };
};

export const registerOperators = async (ownerId: number, numberOfOperators: number, fee: string, gasGroups: GasGroup[] = [GasGroup.REGISTER_OPERATOR]) => {
  for (let i = 0; i < numberOfOperators; ++i) {
    const { eventsByName } = await trackGas(
      DB.ssvNetwork.contract.connect(DB.owners[ownerId]).registerOperator(DataGenerator.publicKey(i), fee),
      gasGroups
    );
    const event = eventsByName.OperatorAdded[0];
    DB.operators[event.args.id] = {
      id: event.args.id, ownerId: ownerId, publicKey: DataGenerator.publicKey(i)
    };
  }
};

export const deposit = async (ownerId: number, clusterId: string, amount: string) => {
  await DB.ssvToken.connect(DB.owners[ownerId]).approve(DB.ssvNetwork.contract.address, amount);
  await DB.ssvNetwork.contract.connect(DB.owners[ownerId])['deposit(bytes32,uint256)'](clusterId, amount);
};

export const registerValidators = async (ownerId: number, numberOfValidators: number, amount: string, operatorIds: number[], gasGroups?: GasGroup[]) => {
  const validators: any = [];
  let args: any;
  // Register validators to contract
  for (let i = 0; i < numberOfValidators; i++) {
    const publicKey = DataGenerator.publicKey(DB.validators.length);
    const shares = DataGenerator.shares(DB.validators.length);

    await DB.ssvToken.connect(DB.owners[ownerId]).approve(DB.ssvNetwork.contract.address, amount);
    const result = await trackGas(DB.ssvNetwork.contract.connect(DB.owners[ownerId]).registerValidator(
      publicKey,
      operatorIds,
      shares,
      amount,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    ), gasGroups);
    args = result.eventsByName.ValidatorAdded[0].args;

    DB.validators.push({ publicKey, operatorIds, shares });
    validators.push({ publicKey, shares });
  }

  return { validators, args };
};

export const getPod = (payload: any) => ethers.utils.AbiCoder.prototype.encode(
  ['tuple(uint32 validatorCount, uint64 networkFee, uint64 networkFeeIndex, uint64 index, uint64 balance, bool disabled) pod'],
  [payload]
);

/*
export const transferValidator = async (ownerId: number, publicKey: string, operatorIds: number[], amount: string, gasGroups?: GasGroup[]) => {
  // let podId: any;
  const shares = DataGenerator.shares(DB.validators.length);

  // Transfer validator
  await trackGas(DB.ssvNetwork.contract.connect(DB.owners[ownerId]).transferValidator(
    publicKey,
    (await registerPodAndDeposit(ownerId, operatorIds, amount)).clusterId,
    shares,
  ), gasGroups);

  // FOR ADAM TO UPDATE
  // podId = eventsByName.ValidatorTransferred[0].args.podId;
  // DB.clusters[podId] = ({ id: podId, operatorIds });
  // DB.validators[publicKey].podId = podId;
  // DB.validators[publicKey].shares = shares;

  // return { podId };
};


export const bulkTransferValidator = async (ownerId: number, publicKey: string[], fromCluster: string, toCluster: string, amount: string, gasGroups?: GasGroup[]) => {
  const shares = Array(publicKey.length).fill(DataGenerator.shares(0));

  await registerPodAndDeposit(ownerId, DataGenerator.cluster.byId(toCluster), amount);

  // Bulk transfer validators
  await trackGas(DB.ssvNetwork.contract.connect(DB.owners[ownerId]).bulkTransferValidators(
    publicKey,
    fromCluster,
    toCluster,
    shares,
  ), gasGroups);

  // FOR ADAM TO UPDATE
  // podId = eventsByName.ValidatorTransferred[0].args.podId;
  // DB.clusters[podId] = ({ id: podId, operatorIds });
  // DB.validators[publicKey].podId = podId;
  // DB.validators[publicKey].shares = shares;

  // return { podId };
};

export const liquidate = async (executorOwnerId: number, liquidatedOwnerId: number, operatorIds: number[], gasGroups?: GasGroup[]) => {
  const { eventsByName } = await trackGas(DB.ssvNetwork.contract.connect(DB.owners[executorOwnerId]).liquidate(
    DB.owners[liquidatedOwnerId].address,
    await DB.ssvNetwork.contract.getPod(operatorIds),
  ), gasGroups);

  const clusterId = eventsByName.AccountLiquidated[0].args.clusterId;
  return { clusterId };
};
*/
