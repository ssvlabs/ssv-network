// usage: node scripts/ci/storage-structs.mjs <projectDir> <out.txt> [--reference <reference.txt>]
//
// Structural fingerprint of the diamond-storage layout (CP1R-6), from the existing 0.8.24 Hardhat
// build-info AST: no recompilation, no Hardhat config or artifact change. Complements the
// auxiliary solc storageLayout (scripts/ci/storage-layout.mjs), which reports 0 slots for these
// assembly-positioned structs and so cannot see a same-size field reorder.
//
// Emits, for every source under contracts/libraries/storage/:
//   - each struct in declaration order with its ordered members (index, name, full type);
//   - every struct/enum/user-defined value type those members reach, transitively, with ordered
//     members / enum values / underlying type (so nested struct and enum reorders are visible);
//   - every constant with its exact source text, type and, when it is a keccak256 slot
//     expression, the derived slot value;
//   - every library's load(), with the struct it returns and the constant its `.slot` is set to
//     (CP1R6-F1). Each library must have exactly one load() of the exact shape
//     `uint256 v = <constant of this library>; assembly { r.slot := v }`; any other operand
//     (arithmetic, literal, call, foreign or unknown declaration), extra statement or assembly
//     elsewhere in these sources is an error, not a fingerprint line.
// With --reference, fails (exit 1) unless the output equals the reference byte for byte. Scope:
// declared structure, slot constants and load() slot binding only; it is not a complete EVM
// storage proof (non-storage-library state and slot use outside load() are outside it).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const argv = process.argv.slice(2);
const usage = () => {
  console.error("usage: node scripts/ci/storage-structs.mjs <projectDir> <out.txt> [--reference <reference.txt>]");
  process.exit(2);
};
const positional = [];
let reference;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--reference") {
    if (reference !== undefined || !argv[i + 1] || argv[i + 1].startsWith("--")) usage();
    reference = argv[++i];
  } else if (argv[i].startsWith("--")) usage();
  else positional.push(argv[i]);
}
if (positional.length !== 2) usage();
const [dirArg, out] = positional;
const dir = path.resolve(dirArg);
const require = createRequire(path.join(dir, "package.json"));
const { keccak256, toUtf8Bytes, AbiCoder, toBeHex } = require("ethers");

// Use the build-info the current storage-library artifacts point at (an incremental compile can
// leave stale build-info files beside it); all of them must agree.
const storageArtifacts = path.join(dir, "artifacts/contracts/libraries/storage");
const ids = new Set(
  fs.readdirSync(storageArtifacts).flatMap((d) =>
    fs.readdirSync(path.join(storageArtifacts, d)).filter((f) => f.endsWith(".json")).map((f) =>
      JSON.parse(fs.readFileSync(path.join(storageArtifacts, d, f), "utf8")).buildInfoId))
);
if (ids.size !== 1) throw new Error(`storage-library artifacts reference ${ids.size} build-infos (expected 1; run hardhat compile --force)`);
const [buildInfoId] = ids;
const bi = path.join(dir, "artifacts/build-info");
const inputFile = `${buildInfoId}.json`;
const buildInput = JSON.parse(fs.readFileSync(path.join(bi, inputFile), "utf8"));
if (!buildInput.solcLongVersion?.startsWith("0.8.24")) throw new Error(`storage build-info ${inputFile} is not solc 0.8.24`);
const output = JSON.parse(fs.readFileSync(path.join(bi, `${buildInfoId}.output.json`), "utf8")).output;

const byId = new Map();
const index = (n) => {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) return n.forEach(index);
  if (typeof n.id === "number" && n.nodeType) byId.set(n.id, n);
  for (const k in n) index(n[k]);
};
for (const s of Object.values(output.sources)) index(s.ast);
const sourceNameByIndex = new Map(Object.entries(output.sources).map(([name, s]) => [s.id, name]));
const text = (node) => {
  const [start, length, file] = node.src.split(":").map(Number);
  const content = buildInput.input.sources[sourceNameByIndex.get(file)].content;
  return Buffer.from(content, "utf8").subarray(start, start + length).toString("utf8").replace(/\s+/g, " ");
};

// Full type text of a TypeName node, naming user-defined types by canonical name.
const reached = new Map();
const typeText = (t) => {
  switch (t.nodeType) {
    case "ElementaryTypeName":
      return t.typeDescriptions?.typeString ?? t.name;
    case "Mapping":
      return `mapping(${typeText(t.keyType)} => ${typeText(t.valueType)})`;
    case "ArrayTypeName":
      return `${typeText(t.baseType)}[${t.length ? t.typeDescriptions.typeString.match(/\[(\d+)\][^[]*$/)?.[1] ?? text(t.length) : ""}]`;
    case "UserDefinedTypeName": {
      const decl = byId.get(t.referencedDeclaration);
      if (!decl) throw new Error(`unresolved type ${t.typeDescriptions?.typeString}`);
      const kind = { StructDefinition: "struct", EnumDefinition: "enum", UserDefinedValueTypeDefinition: "udvt", ContractDefinition: decl.contractKind }[decl.nodeType];
      if (decl.nodeType !== "ContractDefinition") reached.set(decl.canonicalName, decl);
      return `${kind} ${decl.canonicalName ?? decl.name}`;
    }
    default:
      throw new Error(`unsupported type node ${t.nodeType}`);
  }
};
const describe = (decl) => {
  if (decl.nodeType === "StructDefinition") {
    return [`struct ${decl.canonicalName} members=${decl.members.length}`, ...decl.members.map((m, i) => `  ${i} ${m.name} : ${typeText(m.typeName)}`)];
  }
  if (decl.nodeType === "EnumDefinition") {
    return [`enum ${decl.canonicalName} values=${decl.members.length}`, ...decl.members.map((m, i) => `  ${i} ${m.name}`)];
  }
  return [`udvt ${decl.canonicalName} = ${typeText(decl.underlyingType)}`];
};

// Minimal evaluator for slot expressions such as uint256(keccak256("x")) - 1.
const evaluate = (e) => {
  if (e.nodeType === "Literal") {
    if (e.kind === "number") return { int: BigInt(e.value.replace(/_/g, "")) };
    if (e.kind === "string") return { str: e.value };
    return undefined;
  }
  if (e.nodeType === "BinaryOperation") {
    const l = evaluate(e.leftExpression);
    const r = evaluate(e.rightExpression);
    if (l?.int === undefined || r?.int === undefined) return undefined;
    if (e.operator === "-") return { int: l.int - r.int };
    if (e.operator === "+") return { int: l.int + r.int };
    return undefined;
  }
  if (e.nodeType === "FunctionCall") {
    if (e.kind === "typeConversion" && e.arguments.length === 1) {
      const v = evaluate(e.arguments[0]);
      return v?.int !== undefined ? v : undefined;
    }
    const callee = e.expression;
    if (callee.nodeType === "Identifier" && callee.name === "keccak256" && e.arguments.length === 1) {
      const a = e.arguments[0];
      if (a.nodeType === "Literal" && a.kind === "string") return { int: BigInt(keccak256(toUtf8Bytes(a.value))) };
      if (a.nodeType === "FunctionCall" && a.expression.nodeType === "MemberAccess" && a.expression.memberName === "encode" &&
          a.expression.expression.name === "abi" && a.arguments.length === 1 && a.arguments[0].kind === "string") {
        return { int: BigInt(keccak256(AbiCoder.defaultAbiCoder().encode(["string"], [a.arguments[0].value]))) };
      }
    }
  }
  return undefined;
};

// load(): the only sanctioned storage-pointer assembly. Its `.slot` operand must resolve, without
// modification, to a slot constant declared in the same library; anything else fails closed.
const loadAssembly = new Set();
const checkLoad = (fn, lib) => {
  const fail = (why) => {
    throw new Error(`${lib?.name ?? "<file level>"}.${fn.name}(): ${why} (expected: uint256 v = <slot constant>; assembly { r.slot := v })`);
  };
  if (lib?.contractKind !== "library") fail("load() outside a library");
  if (fn.kind !== "function" || fn.parameters.parameters.length !== 0 || fn.modifiers.length !== 0) fail("unexpected signature");
  const rets = fn.returnParameters.parameters;
  if (rets.length !== 1 || rets[0].storageLocation !== "storage" || rets[0].typeName.nodeType !== "UserDefinedTypeName") fail("must return exactly one storage pointer");
  const struct = byId.get(rets[0].typeName.referencedDeclaration);
  if (struct?.nodeType !== "StructDefinition") fail("return type is not a struct");
  const stmts = fn.body?.statements ?? [];
  if (stmts.length !== 2 || stmts[0].nodeType !== "VariableDeclarationStatement" || stmts[1].nodeType !== "InlineAssembly") fail("unexpected body");
  const [local] = stmts[0].declarations;
  if (stmts[0].declarations.length !== 1 || !local || local.typeDescriptions.typeString !== "uint256") fail("unexpected slot local");
  const init = stmts[0].initialValue;
  if (init?.nodeType !== "Identifier") fail(`slot operand is ${init ? `a ${init.nodeType} (${text(init)})` : "missing"}, not a constant`);
  const constant = byId.get(init.referencedDeclaration);
  if (constant?.nodeType !== "VariableDeclaration" || !constant.constant || constant.scope !== lib.id) fail(`slot operand ${init.name} is not a constant declared in ${lib.name}`);
  const slot = evaluate(constant.value);
  if (slot?.int === undefined) fail(`slot constant ${constant.name} has no derivable value`);
  const asm = stmts[1];
  const yul = asm.AST.statements;
  if (yul.length !== 1 || yul[0].nodeType !== "YulAssignment" || yul[0].variableNames.length !== 1 || yul[0].value.nodeType !== "YulIdentifier") {
    fail("assembly must be exactly `r.slot := v`");
  }
  const refs = new Map(asm.externalReferences.map((r) => [r.src, r]));
  const target = refs.get(yul[0].variableNames[0].src);
  const value = refs.get(yul[0].value.src);
  if (asm.externalReferences.length !== 2 || target?.declaration !== rets[0].id || !target.isSlot || target.suffix !== "slot" ||
      value?.declaration !== local.id || value.isSlot || value.isOffset || value.suffix !== undefined) {
    fail("assembly operands do not resolve to the returned pointer's .slot and the slot local");
  }
  loadAssembly.add(asm.id);
  return `load ${lib.name}.${fn.name} -> struct ${struct.canonicalName} storage .slot := ${lib.name}.${constant.name} => ${toBeHex(BigInt.asUintN(256, slot.int), 32)}`;
};

// The build-info id hashes every source, so it is reported on stdout but kept out of the compared
// body: an unrelated contract edit must not, by itself, fail this gate.
const lines = [`# storage-structs v2 solc=${buildInput.solcLongVersion}`];
let structs = 0;
let constants = 0;
let loads = 0;
const sources = Object.keys(output.sources).filter((s) => /(^|\/)contracts\/libraries\/storage\/[^/]+\.sol$/.test(s)).sort();
if (sources.length === 0) throw new Error("no contracts/libraries/storage sources in build-info");
for (const src of sources) {
  lines.push(`source ${src.replace(/^project\//, "")}`);
  const visit = (node, scope, lib) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((n) => visit(n, scope, lib));
    if (node.nodeType === "FunctionDefinition") {
      if (node.name === "load") {
        loads++;
        lines.push(`  ${checkLoad(node, lib)}`);
      }
      return;
    }
    if (node.nodeType === "StructDefinition") {
      structs++;
      lines.push(...describe(node).map((l) => `  ${l}`));
      return;
    }
    if (node.nodeType === "VariableDeclaration" && node.constant) {
      constants++;
      const slot = evaluate(node.value);
      lines.push(`  const ${scope}${node.name} : ${node.typeDescriptions.typeString} = ${text(node.value)}` +
        (slot?.int !== undefined ? ` => ${toBeHex(BigInt.asUintN(256, slot.int), 32)}` : ""));
      return;
    }
    const isContract = node.nodeType === "ContractDefinition";
    for (const k of ["nodes", "members"]) if (node[k]) visit(node[k], isContract ? `${node.name}.` : scope, isContract ? node : lib);
  };
  const ast = output.sources[src].ast;
  visit(ast.nodes, "");
  for (const lib of ast.nodes.filter((n) => n.nodeType === "ContractDefinition")) {
    const n = lib.nodes.filter((f) => f.nodeType === "FunctionDefinition" && f.name === "load").length;
    if (n !== 1) throw new Error(`${lib.name} in ${src} has ${n} load() functions (expected 1)`);
  }
  const strayAssembly = [];
  const findAssembly = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(findAssembly);
    if (n.nodeType === "InlineAssembly" && !loadAssembly.has(n.id)) strayAssembly.push(text(n));
    for (const k in n) if (k !== "AST") findAssembly(n[k]);
  };
  findAssembly(ast);
  if (strayAssembly.length) throw new Error(`assembly outside a checked load() in ${src}: ${strayAssembly.join(" | ")}`);
}
// Transitive closure of reached user-defined types (outside or inside the storage sources).
const done = new Set();
const closure = [];
while ([...reached.keys()].some((k) => !done.has(k))) {
  for (const [name, decl] of [...reached.entries()].sort()) {
    if (done.has(name)) continue;
    done.add(name);
    closure.push([name, describe(decl)]);
  }
}
lines.push("reached types");
for (const [, desc] of closure.sort((a, b) => a[0].localeCompare(b[0]))) lines.push(...desc.map((l) => `  ${l}`));
const counts = `sources=${sources.length} structs=${structs} constants=${constants} loads=${loads} reached_types=${closure.length}`;
lines.push(`# ${counts}`);
const body = lines.join("\n") + "\n";
fs.writeFileSync(out, body);
const digest = crypto.createHash("sha256").update(body).digest("hex");
console.log(`wrote ${out} build-info=${inputFile} ${counts} sha256=${digest}`);
if (structs === 0 || constants === 0 || loads === 0) process.exit(1);
if (reference !== undefined) {
  const want = fs.readFileSync(reference, "utf8");
  if (want !== body) {
    const a = want.split("\n");
    const b = body.split("\n");
    const first = a.findIndex((l, i) => l !== b[i]);
    console.error(`STORAGE STRUCTS DIFFER from ${reference} (first difference at line ${first + 1}):`);
    console.error(`  reference: ${a[first]}`);
    console.error(`  current:   ${b[first]}`);
    process.exit(1);
  }
  console.log(`STORAGE STRUCTS MATCH ${reference}`);
}
