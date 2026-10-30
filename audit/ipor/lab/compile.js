// Compiles the exact sources of IPOR-Labs/ipor-protocol (clone at ../repo) with solc 0.8.26.
// Imports are resolved up-front (no solc callback), so every source is keyed by its import path.
// Usage: node compile.js <file...>   (repo-relative, or mocks/...)
const fs = require('fs');
const path = require('path');
const solc = require('solc');

const ROOT = path.resolve(__dirname, '..', 'repo');
const OUT = path.join(__dirname, 'artifacts.json');

function resolveOnDisk(p) {
    const candidates = [
        path.join(ROOT, p),
        path.join(ROOT, 'node_modules', p),
        path.join(__dirname, 'node_modules', p),
        path.join(ROOT, 'lib', p),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    }
    return null;
}

function resolveRelative(fromKey, imp) {
    const dir = path.posix.dirname(fromKey);
    return path.posix.normalize(path.posix.join(dir, imp));
}

const sources = {};
const queue = [];

function add(key, diskPath) {
    if (sources[key]) return;
    const content = fs.readFileSync(diskPath, 'utf8');
    sources[key] = { content };
    queue.push(key);
}

for (const f of process.argv.slice(2)) {
    const disk = f.startsWith('mocks/') ? path.join(__dirname, f) : path.join(ROOT, f);
    add(f, disk);
}

while (queue.length) {
    const key = queue.shift();
    const content = sources[key].content;
    const re = /^\s*import\s+(?:[^"';]*from\s+)?["']([^"']+)["']/gm;
    let m;
    while ((m = re.exec(content))) {
        const imp = m[1];
        const isRelative = imp.startsWith('./') || imp.startsWith('../');
        const candidate = isRelative ? resolveRelative(key, imp) : imp;
        if (sources[candidate]) continue;
        const disk = resolveOnDisk(candidate) || resolveOnDisk(imp);
        if (!disk) throw new Error('cannot resolve import ' + imp + ' (from ' + key + ')');
        add(candidate, disk);
    }
}

const input = {
    language: 'Solidity',
    sources,
    settings: {
        optimizer: { enabled: true, runs: 200 },
        evmVersion: 'shanghai',
        outputSelection: {
            '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.bytecode.linkReferences'] },
        },
    },
};

const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errs = (out.errors || []).filter((e) => e.severity === 'error');
if (errs.length) {
    for (const e of errs) console.error(e.formattedMessage);
    process.exit(1);
}

const artifacts = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
let n = 0;
for (const file of Object.keys(out.contracts || {})) {
    for (const name of Object.keys(out.contracts[file])) {
        const c = out.contracts[file][name];
        if (!c.evm.bytecode.object) continue;
        artifacts[file + ':' + name] = {
            abi: c.abi,
            bytecode: '0x' + c.evm.bytecode.object,
            size: c.evm.deployedBytecode.object.length / 2,
            links: c.evm.bytecode.linkReferences,
        };
        n++;
    }
}
fs.writeFileSync(OUT, JSON.stringify(artifacts));
const big = Object.entries(artifacts)
    .filter(([, v]) => v.size > 24576)
    .map(([k, v]) => k + ' ' + v.size);
console.log('added', n, 'contracts; total', Object.keys(artifacts).length);
if (big.length) console.log('OVER 24576 bytes:', big.join(', '));
