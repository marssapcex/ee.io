#!/usr/bin/env node
/**
 * Compile the REAL Bancor v46 StandardPoolConverter (unmodified upstream sources,
 * Ellipsis of bancorprotocol/contracts-solidity @ 7fbf6c26, `solidity/contracts/...`)
 * with solc-js. No forge, no solc binary download, no network at compile time.
 *
 * usage: node compile.js  ->  artifacts.json
 */
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const HERE = __dirname;
const SRC = path.resolve(HERE, "src");
const OZ = path.resolve(HERE, "node_modules/@openzeppelin/contracts");

const ENTRY = [
  "converter/types/standard-pool/StandardPoolConverter.sol",
  "mocks/Mocks.sol",
];

function readSource(key) {
  const p = path.resolve(SRC, key);
  if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  throw new Error("missing " + key);
}

const sources = {};
for (const e of ENTRY) sources[e] = { content: readSource(e) };

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

function findImports(importPath) {
  // @openzeppelin/... -> node_modules
  if (importPath.startsWith("@openzeppelin/")) {
    const p = path.resolve(HERE, "node_modules", importPath);
    if (fs.existsSync(p)) return { contents: fs.readFileSync(p, "utf8") };
    return { error: "not found " + importPath };
  }
  // relative to src/
  const candidates = [path.resolve(SRC, importPath)];
  // also allow resolution relative to the importing file's dir (solc normally does this
  // itself for relative paths, so this is only a fallback)
  for (const p of candidates) {
    if (fs.existsSync(p)) return { contents: fs.readFileSync(p, "utf8") };
  }
  return { error: "not found " + importPath };
}

const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

let errors = (out.errors || []).filter((e) => e.severity === "error");
if ((out.errors || []).length) {
  for (const e of out.errors) console.error(e.severity.toUpperCase(), e.formattedMessage || e.message);
}
if (errors.length) process.exit(1);

const keep = new Set([
  "StandardPoolConverter",
  "MockERC20",
  "MockPoolToken",
  "MockRegistry",
  "MockNetworkSettings",
]);
const artifacts = {};
for (const file of Object.keys(out.contracts)) {
  for (const name of Object.keys(out.contracts[file])) {
    if (!keep.has(name)) continue;
    artifacts[name] = {
      abi: out.contracts[file][name].abi,
      bytecode: "0x" + out.contracts[file][name].evm.bytecode.object,
    };
  }
}
fs.writeFileSync(path.resolve(HERE, "artifacts.json"), JSON.stringify(artifacts, null, 1));
console.log("compiled:", Object.keys(artifacts).join(", "));
