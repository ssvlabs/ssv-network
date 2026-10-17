// usage: node scripts/ci/build-fingerprint.mjs <projectDir> <out.tsv>
// Build fingerprint: build-info hashes/settings, per-artifact creation/runtime keccak with and
// without CBOR metadata, runtime size and ABI sha256. Adopted from the CP1 pristine executor script.
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import { createRequire } from "node:module";
const [dirArg, out] = process.argv.slice(2); const dir = path.resolve(dirArg);
const req = createRequire(path.join(dir, "package.json"));
const { keccak256 } = req("ethers");
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const strip = (hex) => { // remove CBOR metadata: last 2 bytes = length
  if (!hex || hex === "0x") return hex; const h = hex.replace(/^0x/, ""); const len = parseInt(h.slice(-4), 16) * 2 + 4;
  return len < h.length ? "0x" + h.slice(0, h.length - len) : hex; };
const kh = (hex) => (!hex || hex === "0x") ? "empty" : keccak256(hex);
const bi = path.join(dir, "artifacts/build-info"); const lines = [];
lines.push("# build-info files (sha256)");
for (const f of fs.readdirSync(bi).sort()) {
  const p = path.join(bi, f); lines.push(`${sha(fs.readFileSync(p))}  build-info/${f}`);
  if (!f.endsWith(".output.json")) { const d = JSON.parse(fs.readFileSync(p)); const s = d.input.settings;
    lines.push(`#   solc=${d.solcLongVersion} sources=${Object.keys(d.input.sources).length} evm=${s.evmVersion} viaIR=${!!s.viaIR} optimizer=${JSON.stringify(s.optimizer ?? null)} outputSelection=${JSON.stringify(s.outputSelection["*"]["*"])} storageLayout=${s.outputSelection["*"]["*"].includes("storageLayout")}`);
    let srcH = crypto.createHash("sha256"); for (const k of Object.keys(d.input.sources).sort()) srcH.update(k + "\0" + (d.input.sources[k].content ?? "") + "\0");
    lines.push(`#   input-sources-sha256=${srcH.digest("hex")}`); }
}
lines.push("# contract\tcreation_keccak\tcreation_nometa_keccak\truntime_keccak\truntime_nometa_keccak\truntime_bytes\tabi_sha256");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === "build-info" ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
const arts = walk(path.join(dir, "artifacts")).filter((f) => f.endsWith(".json") && !f.endsWith(".dbg.json")).sort();
let n = 0;
for (const f of arts) { const a = JSON.parse(fs.readFileSync(f)); if (!a.contractName) continue; n++;
  const rel = path.relative(path.join(dir, "artifacts"), f);
  lines.push([rel, kh(a.bytecode), kh(strip(a.bytecode)), kh(a.deployedBytecode), kh(strip(a.deployedBytecode)), ((a.deployedBytecode || "0x").length - 2) / 2, sha(JSON.stringify(a.abi))].join("\t")); }
lines.push(`# artifacts=${n}`);
fs.writeFileSync(out, lines.join("\n") + "\n"); console.log(`wrote ${out} artifacts=${n}`);
