#!/usr/bin/env node
/**
 * Compile the REAL 0xSplits splits-v2 sources with solc-js (no network, no forge binary).
 *
 * - reads straight out of a clone of 0xSplits/splits-contracts-monorepo (env SPLITS_ROOT)
 * - implements the repo's remappings.txt by hand and rewrites every import to a canonical
 *   key, so solc never has to guess (solc-js import callbacks lose the importer path)
 * - writes artifacts.json = { ContractName: {abi, bytecode} } for the contracts we deploy
 *
 * usage: SPLITS_ROOT=/tmp/splits/packages/splits-v2 node compile.js
 */
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const HERE = __dirname;
const SPLITS_ROOT = process.env.SPLITS_ROOT || "/tmp/splits/packages/splits-v2";
const NODE_MODULES = path.resolve(HERE, "../../node_modules");

// remappings.txt of packages/splits-v2: prefix -> base directory
const REMAP = [
  ["src/", () => path.resolve(SPLITS_ROOT, "src")],
  ["test/", () => path.resolve(HERE, "test")],
  ["@openzeppelin/contracts/", () => path.resolve(NODE_MODULES, "@openzeppelin/contracts")],
  ["solady/", () => path.resolve(NODE_MODULES, "solady/src")],
];

const ENTRY = [
  "src/SplitsWarehouse.sol",
  "src/splitters/push/PushSplitFactory.sol",
  "src/splitters/pull/PullSplitFactory.sol",
  // harness-only helpers, live next to this file, not in the repo under audit
  "test/harness/MockERC20.sol",
];

const AS_ENTRY = {
  SplitsWarehouse: "SplitsWarehouse",
  PushSplitFactory: "PushSplitFactory",
  PullSplitFactory: "PullSplitFactory",
  PushSplit: "PushSplit",
  PullSplit: "PullSplit",
  MockERC20: "MockERC20",
  RejectingRecipient: "RejectingRecipient",
  ReenteringRecipient: "ReenteringRecipient",
};

/** canonical key -> absolute path on disk */
const keyToAbs = new Map();

function realPathForImport(importerKey, importStr) {
  let abs;
  if (importStr.startsWith(".")) {
    abs = path.resolve(path.dirname(keyToAbs.get(importerKey)), importStr);
  } else {
    const hit = REMAP.find(([prefix]) => importStr.startsWith(prefix));
    if (!hit) throw new Error(`cannot resolve import "${importStr}" from ${importerKey}`);
    abs = path.resolve(hit[1](), importStr.slice(hit[0].length));
  }
  return { key: abs, abs };
}

const HERE_ROOT = path.resolve(HERE, ".."); // local_chain/

function gather(entryKey) {
  const sources = {};
  const stack = [entryKey];
  const seen = new Set();

  // resolve the entry itself
  let entryAbs;
  if (entryKey.startsWith("src/")) entryAbs = path.resolve(SPLITS_ROOT, entryKey);
  else entryAbs = path.resolve(HERE, entryKey);
  const entryCanon = entryAbs;
  keyToAbs.set(entryCanon, entryAbs);
  stack.length = 0;
  stack.push(entryCanon);

  while (stack.length) {
    const key = stack.pop();
    if (seen.has(key)) continue;
    seen.add(key);

    const abs = keyToAbs.get(key);
    if (!abs) throw new Error(`no abs path for ${key}`);
    let src = fs.readFileSync(abs, "utf8");

    // rewrite every import to its canonical key so solc resolves deterministically
    src = src.replace(/import\s+([^;]*?)\s+from\s+["']([^"']+)["']\s*;/g, (m, what, spec) => {
      const { key: ck, abs: ca } = realPathForImport(key, spec);
      if (!keyToAbs.has(ck)) keyToAbs.set(ck, ca);
      stack.push(ck);
      return `import ${what} from "${ck}";`;
    });
    src = src.replace(/import\s+["']([^"']+)["']\s*;/g, (m, spec) => {
      const { key: ck, abs: ca } = realPathForImport(key, spec);
      if (!keyToAbs.has(ck)) keyToAbs.set(ck, ca);
      stack.push(ck);
      return `import "${ck}";`;
    });

    sources[key] = { content: src };
  }
  return sources;
}

function main() {
  const sources = {};
  for (const e of ENTRY) Object.assign(sources, gather(e));

  const input = {
    language: "Solidity",
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
    },
  };

  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errs = (out.errors || []).filter((e) => e.severity === "error");
  for (const e of out.errors || []) console.error(e.formattedMessage.trim());
  if (errs.length) process.exit(1);

  const artifacts = {};
  for (const [file, contracts] of Object.entries(out.contracts)) {
    for (const [name, c] of Object.entries(contracts)) {
      artifacts[name] = {
        abi: c.abi,
        bytecode: "0x" + c.evm.bytecode.object,
        file,
      };
    }
  }

  const wanted = {};
  for (const n of Object.values(AS_ENTRY)) {
    if (!artifacts[n]) {
      console.error(`missing artifact ${n}`);
      process.exit(1);
    }
    wanted[n] = artifacts[n];
  }

  const outFile = path.resolve(HERE, "artifacts.json");
  fs.writeFileSync(outFile, JSON.stringify(wanted, null, 1));
  console.log(
    `compiled ${Object.keys(artifacts).length} contracts, wrote ${Object.keys(wanted).length} artifacts -> ${outFile}`
  );
  for (const [n, a] of Object.entries(wanted)) {
    console.log(`  ${n.padEnd(20)} ${a.file.padEnd(70)} ${a.bytecode.length / 2 - 1} bytes`);
  }
}

main();
