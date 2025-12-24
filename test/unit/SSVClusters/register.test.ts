import { expect } from "chai";
import { getTestConnection } from "../../setup/connection.js";
import { fullNetworkFixture } from "../../setup/fixtures.js";
import {
  asClusterStruct,
  mustEmitEvent,
  makePublicKey,
  registerOperators,
} from "./helpers/clusterHelpers.js";
import { EMPTY_CLUSTER, DEFAULT_SHARES } from "./types/constants.js";

describe("SSVClusters – register", function () {
  let connection: any;
  let networkHelpers: any;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
  });

  const deployNetworkWithOperators = async () => {
    const deployed = await fullNetworkFixture(connection);
    const [owner] = await connection.ethers.getSigners();
    const operatorIds = await registerOperators(deployed.network, owner, 4);

    return {
      ...deployed,
      owner,
      operatorIds,
      deposit: connection.ethers.parseEther("200"),
    };
  };

  it("registerValidator valid registration succeeds", async function () {
    const { network, views, operatorIds, owner, deposit } =
      await networkHelpers.loadFixture(deployNetworkWithOperators);

    const publicKey = makePublicKey(1);

    const tx = await network.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      0,
      { ...EMPTY_CLUSTER },
      { value: deposit }
    );

    await expect(tx).to.emit(network, "ValidatorAdded");

    const receipt = await tx.wait();
    const addedLog = mustEmitEvent(receipt, network, "ValidatorAdded");

    const clusterFromEvent = asClusterStruct((addedLog as any).args.cluster);
    expect(clusterFromEvent.validatorCount).to.equal(1n);
    expect(clusterFromEvent.balance).to.equal(deposit);

    expect(await views.getValidator(owner.address, publicKey)).to.equal(true);
  });

  const validationCases = [
    {
      name: "reverts when publicKeys list is empty",
      expectedError: "EmptyPublicKeysList",
      call: (ctx: any) =>
        ctx.network.bulkRegisterValidator(
          [],
          ctx.operatorIds,
          [],
          0,
          { ...EMPTY_CLUSTER }
        ),
    },
    {
      name: "reverts when publicKeys and shares length mismatch",
      expectedError: "PublicKeysSharesLengthMismatch",
      call: (ctx: any) =>
        ctx.network.bulkRegisterValidator(
          [makePublicKey(1)],
          ctx.operatorIds,
          [],
          0,
          { ...EMPTY_CLUSTER }
        ),
    },
    {
      name: "reverts for invalid operatorIds length",
      expectedError: "InvalidOperatorIdsLength",
      call: (ctx: any) =>
        ctx.network.registerValidator(
          makePublicKey(1),
          [1, 2, 3],
          DEFAULT_SHARES,
          0,
          { ...EMPTY_CLUSTER }
        ),
    },
    {
      name: "reverts for invalid public key length",
      expectedError: "InvalidPublicKeyLength",
      call: (ctx: any) =>
        ctx.network.registerValidator(
          "0x1234",
          ctx.operatorIds,
          DEFAULT_SHARES,
          0,
          { ...EMPTY_CLUSTER }
        ),
    },
  ];

  validationCases.forEach(({ name, expectedError, call }) => {
    it(name, async function () {
      const ctx = await networkHelpers.loadFixture(deployNetworkWithOperators);

      await expect(call(ctx)).to.be.revertedWithCustomError(
        ctx.network,
        expectedError
      );
    });
  });

  it("reverts when public key is already registered", async function () {
    const ctx = await networkHelpers.loadFixture(deployNetworkWithOperators);
    const publicKey = makePublicKey(5);

    await ctx.network.registerValidator(
      publicKey,
      ctx.operatorIds,
      DEFAULT_SHARES,
      0,
      { ...EMPTY_CLUSTER },
      { value: ctx.deposit }
    );

    await expect(
      ctx.network.registerValidator(
        publicKey,
        ctx.operatorIds,
        DEFAULT_SHARES,
        0,
        { ...EMPTY_CLUSTER }
      )
    ).to.be.revertedWithCustomError(
      ctx.network,
      "ValidatorAlreadyExistsWithData"
    );
  });

  it("registers another validator into an existing active cluster", async function () {
    const ctx = await networkHelpers.loadFixture(deployNetworkWithOperators);
    const firstPk = makePublicKey(11);

    const firstTx = await ctx.network.registerValidator(
      firstPk,
      ctx.operatorIds,
      DEFAULT_SHARES,
      0,
      { ...EMPTY_CLUSTER },
      { value: ctx.deposit }
    );
    const firstReceipt = await firstTx.wait();
    const firstLog = mustEmitEvent(firstReceipt, ctx.network, "ValidatorAdded");

    const existingCluster = asClusterStruct((firstLog as any).args.cluster);

    const secondPk = makePublicKey(12);
    const secondTx = await ctx.network.registerValidator(
      secondPk,
      ctx.operatorIds,
      DEFAULT_SHARES,
      0,
      existingCluster
    );

    await expect(secondTx).to.emit(ctx.network, "ValidatorAdded");

    const secondReceipt = await secondTx.wait();
    const secondLog = mustEmitEvent(secondReceipt, ctx.network, "ValidatorAdded");

    const clusterFromSecond = asClusterStruct((secondLog as any).args.cluster);
    expect(clusterFromSecond.validatorCount).to.equal(2n);
    expect(clusterFromSecond.balance).to.equal(ctx.deposit);
  });
});
