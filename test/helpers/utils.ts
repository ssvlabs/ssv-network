declare var network: any;
//@ts-ignore
export const strToHex = str => `0x${Buffer.from(str, 'utf8').toString('hex')}`;
//@ts-ignore
export const asciiToHex = str =>  {
  var arr1 = [];
  for (var n = 0, l = str.length; n < l; n ++)  {
    var hex = Number(str.charCodeAt(n)).toString(16);
    arr1.push(hex);
  }
  return arr1.join('');
}
//@ts-ignore
export const progress = async function(time, blocks, func = null) {
  let snapshot;

  if (func) {
    snapshot = await network.provider.send("evm_snapshot");
  }

  if (time) {
    await network.provider.send("evm_increaseTime", [time]);
    if (!blocks) {
      await network.provider.send("evm_mine", []);
    }
  }

  for (let index = 0; index < blocks; ++index) {
    await network.provider.send("evm_mine", []);
  }

  if (func) {
    //@ts-ignore
    await func();
    await network.provider.send("evm_revert", [snapshot]);
  }
}
//@ts-ignore
export const progressTime = async function(time, func = null) {
  return progress(time, 1, func);
}
//@ts-ignore
export const progressBlocks = async function(blocks, func = null) {
  return progress(0, blocks, func);
}
//@ts-ignore
export const snapshot = async function(func) {
  return progress(0, 0, func);
}

export const mineOneBlock = async () => network.provider.send("evm_mine", []);

export const mineChunk = async (amount: number) =>
  Promise.all(
    Array.from({ length: amount }, () => mineOneBlock())
  ) as unknown as Promise<void>;

export const mine = async (amount: number) => {
  if (amount < 0) throw new Error('mine cannot be called with a negative value');
  const MAX_PARALLEL_CALLS = 1000;
  // Do it on parallel but do not overflow connections
  for (let i = 0; i < Math.floor(amount / MAX_PARALLEL_CALLS); i++) {
    await mineChunk(MAX_PARALLEL_CALLS);
  }
  return mineChunk(amount % MAX_PARALLEL_CALLS);
};