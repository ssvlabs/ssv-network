export function makePublicKey(seed: number): string {
    return `0x${seed.toString(16).padStart(96, "0")}`;
}

export function makePublicKeys(count: number, start = 1): string[] {
    return Array.from({ length: count }, (_, i) => makePublicKey(start + i));
}

export function makeOperatorKey(seed: number): string {
    return `0x${(seed + 1000).toString(16).padStart(96, "0")}`;
}

export function makeArrayOfKeysAndShares(initialSeed: number, amount: number): {
    keys: string[];
    shares: string[];
} {
    const keys: string[] = [];
    const shares: string[] = [];

    for (let i = initialSeed; i < amount; i++) {
        keys.push(`0x${i.toString(16).padStart(96, "0")}`);
        shares.push("0x1234");
    }

    return { keys, shares };
}
