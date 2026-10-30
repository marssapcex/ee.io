const fs = require('fs'), path = require('path'), solc = require('solc');
const files = ['DepositProxy.sol', 'DepositProxyFactory.sol', 'Mocks.sol'];
const sources = {};
for (const f of files) sources[f] = { content: fs.readFileSync(path.join(__dirname, 'contracts', f), 'utf8') };
const input = { language: 'Solidity', sources, settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } };
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errs = (out.errors || []).filter(e => e.severity === 'error');
if (errs.length) { console.error(errs.map(e => e.formattedMessage).join('\n')); process.exit(1); }
fs.writeFileSync(path.join(__dirname, 'artifacts.json'), JSON.stringify(out.contracts, null, 1));
console.log('compiled:', Object.keys(out.contracts).join(', '));
