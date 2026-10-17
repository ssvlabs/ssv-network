// usage: node scripts/ci/storage-layout.mjs <projectDir> <solcBinaryFor0.8.24> <out.tsv>
//
// Auxiliary storage-layout fingerprint (CP1-F5) without touching Hardhat config or artifacts.
// Takes the frozen solc standard-json input of the 0.8.24 build-info, keeps every compiler setting,
// and adds storageLayout plus evm.deployedBytecode.object to outputSelection in this auxiliary
// request only. Fails unless the auxiliary runtime bytecode of every contract equals the normal
// artifact, proving the extra output selection did not change compilation.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const [dirArg, solc, out] = process.argv.slice(2);
if (!dirArg || !solc || !out) {
  console.error("usage: node scripts/ci/storage-layout.mjs <projectDir> <solc-0.8.24> <out.tsv>");
  process.exit(2);
}
const dir = path.resolve(dirArg);
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const bi = path.join(dir, "artifacts/build-info");
const inputs = fs.readdirSync(bi).filter((f) => f.endsWith(".json") && !f.endsWith(".output.json"));
const lines = ["# source\tcontract\tstorage_layout_sha256\tslots\truntime_matches_artifact"];
let mismatches = 0;
let contracts = 0;
let compared = 0;

for (const f of inputs.sort()) {
  const buildInfo = JSON.parse(fs.readFileSync(path.join(bi, f), "utf8"));
  if (!buildInfo.solcLongVersion.startsWith("0.8.24")) continue;
  const version = execFileSync(solc, ["--version"], { encoding: "utf8" });
  if (!version.includes(buildInfo.solcLongVersion)) {
    throw new Error(`solc binary is not ${buildInfo.solcLongVersion}: ${version}`);
  }
  const input = structuredClone(buildInfo.input);
  const selected = input.settings.outputSelection["*"]["*"];
  input.settings.outputSelection["*"]["*"] = [
    ...new Set([...selected, "storageLayout", "evm.deployedBytecode.object"]),
  ];
  lines.push(`# build-info ${f} solc=${buildInfo.solcLongVersion} settings_sha256(excluding outputSelection)=${sha(
    JSON.stringify({ ...buildInfo.input.settings, outputSelection: undefined })
  )} aux_settings_sha256(excluding outputSelection)=${sha(JSON.stringify({ ...input.settings, outputSelection: undefined }))}`);

  const output = JSON.parse(
    execFileSync(solc, ["--standard-json"], { input: JSON.stringify(input), maxBuffer: 1 << 30, encoding: "utf8" })
  );
  const errors = (output.errors ?? []).filter((e) => e.severity === "error");
  if (errors.length > 0) throw new Error(`solc errors: ${errors.map((e) => e.formattedMessage).join("\n")}`);

  for (const source of Object.keys(output.contracts ?? {}).sort()) {
    for (const name of Object.keys(output.contracts[source]).sort()) {
      const c = output.contracts[source][name];
      const layout = JSON.stringify(c.storageLayout ?? null);
      // Hardhat 3 source names carry a "project/" prefix that artifact paths omit.
      const artifactPath = path.join(dir, "artifacts", source.replace(/^project\//, ""), `${name}.json`);
      let match = "no-artifact";
      if (fs.existsSync(artifactPath)) {
        const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
        const ok = `0x${c.evm.deployedBytecode.object}` === artifact.deployedBytecode;
        match = ok ? "yes" : "NO";
        compared++;
        if (!ok) mismatches++;
      }
      contracts++;
      lines.push([source, name, sha(layout), c.storageLayout?.storage?.length ?? 0, match].join("\t"));
    }
  }
}

lines.push(`# contracts=${contracts} compared_with_artifacts=${compared} runtime_mismatches=${mismatches}`);
fs.writeFileSync(out, lines.join("\n") + "\n");
console.log(`wrote ${out} contracts=${contracts} compared=${compared} runtime_mismatches=${mismatches}`);
if (contracts === 0 || compared === 0 || mismatches > 0) process.exit(1);
