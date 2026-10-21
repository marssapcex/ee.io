# rsk-reorg-replacement

Hai node rskj regtest thật. Một câu hỏi: giao dịch đã lên block, bị reorg đá ra,
rồi một giao dịch cùng nonce cướp nonce của nó — nó có quay lại không?

Trên rskj: **không**.

```
python3 regtest_reorg_replacement.py --rskj-jar "$HOME/rskj.jar"
```

Cần JRE 17+ và fat jar:

```
curl -L -o ~/rskj.jar https://github.com/rsksmart/rskj/releases/download/VETIVER-9.0.4/rskj-core-9.0.4-VETIVER-all.jar
```

Không cần docker, web3, tài khoản unlock. Giao dịch được ký trong `ethsign.py`
(keccak256 + secp256k1 + RLP, chỉ stdlib) rồi đẩy bằng `eth_sendRawTransaction`.

## Nó đo gì

```
P1  pool rules: đã mine thì không thay được; trong pool cần +40%.
P2  đào --prefix block, cho node2 sync đúng tip, tách, chia nhánh, nối lại, reorg.
P3  thay giao dịch bị retract bằng +15% rồi +100%, quét mọi block còn sống.
P4  control: bị orphan cùng block, không bị thay -> được đào lại bình thường.
```

P4 là chỗ chốt: reorg một mình **cứu** giao dịch. Giết nó là cái replacement,
và cái đó chỉ làm được **sau** khi reorg.

## Log

```
rskj VETIVER-731b9d8 · regtest
gas 1000 wei (node quotes 1) · prefix 12 · node1 4444/50501 · node2 4445/50502
account 0xcd2a3d..d826  bal 0
P1  pool rules
  ✓ P1a mined     blk 1  status 1  bal 1
  ✓ P1b remine    nonce 0  2000 wei  →  transaction nonce too low
  ✓ P1c +15%      1150/1000  →  gas price not enough to bump transaction
  ✓ P1d +100%     2000/1000  →  accepted  old hash gone
  ✓ P1e which     blk 2  original receipt None
P2  reorg
     prefix  h 14   tip 0xec9e5986   bal 1   nonce 3
  ✓ P2a sync      node2 h 14  tip 0xec9e5986
  ✓ P2b split     h 14/14  peers 0/0
  ✓ P2c mine      blk 15  0xec9e5986  txs 3
  ✓ P2d diff      A h 15 td 16   |   B h 17 td 18
  ✓ P2e join      peers 1/1
  ✓ P2f switch    blk 15  0xec9e5986 → 0xdbb931f1   blk 1..14 intact
  ✓ P2g tips      h 17/17  0xe96218b5  td 18
  ✓ P2h rollback  nonce 3  bal 1  pool 2
P3  replace
  ✓ P3a +15%      1150/1000  →  gas price not enough to bump transaction
  ✓ P3b +100%     2000/1000  →  accepted  victim null
  ✓ P3c scan      blk 15..20  none   new blk 18
P4  control
  ✓ P4  mined     blk 18  bal 3  (same as P2c)

  17/17   41.2 s
```

Số trong đó là placeholder, chỉ đúng cấu trúc; log của lần chạy thật sẽ thay vào
đây. Mọi giá trị đều đọc từ node: `blk`, `td`, `status`, `bal`, `nonce`, `pool`,
hash block, nguyên văn lỗi RPC.

## Đọc ở đâu trong rskj

| đo | nguồn |
| --- | --- |
| `transaction.gasPriceBump = 40` | `reference.conf:306` |
| thay cùng nonce cần `new >= old * 140 / 100` | `TransactionPoolImpl:305-311` |
| reorg trả tx về pool | `TransactionPoolImpl:315-334`, `:357-363` |
| đã mine thì không thay được | `TxValidatorNonceRangeValidator:50` |

## Files

- `regtest_reorg_replacement.py` — PoC
- `ethsign.py` — ký giao dịch; chạy trực tiếp để self-test
- `result.json` — ghi cạnh log sau mỗi lần chạy

## Phụ

`--prefix N` đổi độ dài lịch sử trước fork (mặc định 12), `--keep` giữ datadir
và log của hai node, `--probe` chỉ khởi động một node rồi báo máy này chạy được
không, `--skip-policy` bỏ P1. Regtest quote `eth_gasPrice = 1 wei`, mà 15% của
1 wei không phải số nguyên, nên mọi giao dịch dùng 1000 wei: +15% = 1150,
+100% = 2000.
