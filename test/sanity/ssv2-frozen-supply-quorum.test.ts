import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../setup/connection.js";
import { ssvDAOHarnessFixture } from "../setup/fixtures.js";
import type { NetworkHelpersType } from "../common/types.js";
import { Events } from "../common/events.js";
import { ethers } from "ethers";

const totalSupply = ethers.parseEther("1000");
const numberOfOracles = 4n;

describe("SSV-2: commitRoot freezes cSSV supply on first vote", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner: HardhatEthersSigner;
  let oracle1: HardhatEthersSigner;
  let oracle2: HardhatEthersSigner;
  let oracle3: HardhatEthersSigner;
  let oracle4: HardhatEthersSigner;

  const getCommitmentKey = (blockNum: number | bigint, merkleRoot: string) => {
    return ethers.keccak256(
      ethers.solidityPacked(["uint64", "bytes32"], [blockNum, merkleRoot])
    );
  };

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [owner, oracle1, oracle2, oracle3, oracle4] = await connection.ethers.getSigners();
  });

  const deployFixture = async () => {
    const { dao, cssv } = await ssvDAOHarnessFixture(connection);
    await dao.mockSetOracle(1, oracle1.address);
    await dao.mockSetOracle(2, oracle2.address);
    await dao.mockSetOracle(3, oracle3.address);
    await dao.mockSetOracle(4, oracle4.address);
    await dao.mockSetQuorumBps(7500);
    return { dao, cssv };
  };

  it("Freezes supply at first vote and cleans up on commit", async function () {
    const { dao, cssv } = await networkHelpers.loadFixture(deployFixture);
    await cssv.mint(owner.address, totalSupply);

    const root = ethers.keccak256(ethers.toUtf8Bytes("root"));
    const blockNum = await connection.ethers.provider.getBlockNumber();
    const commitmentKey = getCommitmentKey(blockNum, root);

    expect(await dao.getRoundFrozenSupply(commitmentKey)).to.equal(0n);

    await dao.connect(oracle1).commitRoot(root, blockNum);
    expect(await dao.getRoundFrozenSupply(commitmentKey)).to.equal(totalSupply);

    await dao.connect(oracle2).commitRoot(root, blockNum);
    await dao.connect(oracle3).commitRoot(root, blockNum);

    expect(await dao.getRoundFrozenSupply(commitmentKey)).to.equal(0n);
    expect(await dao.getEBRoot(blockNum)).to.equal(root);
  });

  it("Supply increase between votes does not block quorum (liveness attack blocked)", async function () {
    const { dao, cssv } = await networkHelpers.loadFixture(deployFixture);
    await cssv.mint(owner.address, totalSupply);

    const root = ethers.keccak256(ethers.toUtf8Bytes("root"));
    const blockNum = await connection.ethers.provider.getBlockNumber();
    const commitmentKey = getCommitmentKey(blockNum, root);

    const frozenWeight = totalSupply / numberOfOracles;
    const frozenThreshold = (totalSupply * 7500n) / 10000n;

    await dao.connect(oracle1).commitRoot(root, blockNum);
    expect(await dao.getRoundFrozenSupply(commitmentKey)).to.equal(totalSupply);

    await cssv.mint(owner.address, totalSupply);

    const tx2 = await dao.connect(oracle2).commitRoot(root, blockNum);
    await expect(tx2).to.emit(dao, Events.WEIGHTED_ROOT_PROPOSED)
      .withArgs(root, blockNum, frozenWeight * 2n, frozenThreshold, 2, oracle2.address);

    const tx3 = await dao.connect(oracle3).commitRoot(root, blockNum);
    await expect(tx3).to.emit(dao, Events.ROOT_COMMITTED).withArgs(root, blockNum);

    expect(await dao.getEBRoot(blockNum)).to.equal(root);
    expect(await dao.getRoundFrozenSupply(commitmentKey)).to.equal(0n);
  });

  it("Supply decrease between votes does not bypass quorum (safety attack blocked)", async function () {
    const { dao, cssv } = await networkHelpers.loadFixture(deployFixture);
    await cssv.mint(owner.address, totalSupply);

    const root = ethers.keccak256(ethers.toUtf8Bytes("supply-decrease"));
    const blockNum = await connection.ethers.provider.getBlockNumber();
    const commitmentKey = getCommitmentKey(blockNum, root);

    const frozenWeight = totalSupply / numberOfOracles;
    const frozenThreshold = (totalSupply * 7500n) / 10000n;

    await dao.connect(oracle1).commitRoot(root, blockNum);

    await cssv.burn(owner.address, totalSupply - 10n);

    const tx2 = await dao.connect(oracle2).commitRoot(root, blockNum);
    await expect(tx2).to.emit(dao, Events.WEIGHTED_ROOT_PROPOSED)
      .withArgs(root, blockNum, frozenWeight * 2n, frozenThreshold, 2, oracle2.address);

    expect(await dao.getEBRoot(blockNum)).to.equal(ethers.ZeroHash);
    expect(await dao.getRoundFrozenSupply(commitmentKey)).to.equal(totalSupply);
  });
});
