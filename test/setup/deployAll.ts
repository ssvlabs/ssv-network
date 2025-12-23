import hre from "hardhat";

export async function getTestConnection() {
  const connection = await hre.network.connect();

  return {
    connection,
    ethers: connection.ethers,
    networkHelpers: connection.networkHelpers,
  };
}
export async function deployToken(connection: any) {
  const { ethers } = connection;
  const [deployer] = await ethers.getSigners();

  return ethers.deployContract(
    "ERC20Mock",
    ["SSV", "SSV", deployer.address, ethers.parseEther("1000000")]
  );
}

export async function deployModule(
  connection: any,
  moduleName: string
) {
  return connection.ethers.deployContract(moduleName);
}type DeployAllParams = {
  ssvTokenAddress: string;
  params: {
    minimumBlocksBeforeLiquidation: bigint;
    minimumLiquidationCollateral: bigint;
    validatorsPerOperatorLimit: bigint;
    declareOperatorFeePeriod: bigint;
    executeOperatorFeePeriod: bigint;
    operatorMaxFeeIncrease: bigint;
    defaultOracleIds: bigint[];
    quorumBps: bigint;
  };
};

export async function deployAll(
  connection: any,
  cfg: DeployAllParams
) {
  const { ethers } = connection;
  const [deployer] = await ethers.getSigners();

  const moduleNames = [
    "SSVOperators",
    "SSVClusters",
    "SSVDAO",
    "SSVViews",
    "SSVOperatorsWhitelist",
    "SSVStaking",
  ] as const;

  const modules: Record<string, any> = {};

  for (const name of moduleNames) {
    const contract = await ethers.deployContract(name);
    await contract.waitForDeployment();
    modules[name] = contract;
  }

  const networkImpl = await ethers.deployContract("SSVNetwork");

  const networkFactory = await ethers.getContractFactory("SSVNetwork");

  const initParams = [
    cfg.params.minimumBlocksBeforeLiquidation,
    cfg.params.minimumLiquidationCollateral,
    cfg.params.validatorsPerOperatorLimit,
    cfg.params.declareOperatorFeePeriod,
    cfg.params.executeOperatorFeePeriod,
    cfg.params.operatorMaxFeeIncrease,
    cfg.params.defaultOracleIds,
    cfg.params.quorumBps
  ];

  const initData = networkFactory.interface.encodeFunctionData(
    "initialize",
    [
      cfg.ssvTokenAddress,
      await modules.SSVOperators.getAddress(),
      await modules.SSVClusters.getAddress(),
      await modules.SSVDAO.getAddress(),
      await modules.SSVViews.getAddress(),
      initParams
    ]
  );

  const Proxy = await ethers.getContractFactory("ERC1967Proxy");
  const proxy = await Proxy.deploy(
    await networkImpl.getAddress(),
    initData
  );

  const network = await ethers.getContractAt(
    "SSVNetwork",
    await proxy.getAddress()
  );

  await network.updateModule(4, await modules.SSVOperatorsWhitelist.getAddress());

  const viewsImpl = await ethers.deployContract("SSVNetworkViews");

  const viewsFactory = await ethers.getContractFactory("SSVNetworkViews");
  const viewsInitData =
    viewsFactory.interface.encodeFunctionData("initialize", [
      await proxy.getAddress(),
    ]);

  const viewsProxy = await Proxy.deploy(
    await viewsImpl.getAddress(),
    viewsInitData
  );

  const views = await ethers.getContractAt(
    "SSVNetworkViews",
    await viewsProxy.getAddress()
  );

  await ethers.deployContract("CSSVToken", [await proxy.getAddress()]);

  await network.updateModule(5, await modules.SSVStaking.getAddress());

  return {
    deployer,
    network,
    networkProxy: proxy,
    networkImpl,
    views,
    viewsProxy,
    viewsImpl,
    modules,
  };
}