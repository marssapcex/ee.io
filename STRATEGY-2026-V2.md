# STRATEGY 2026-V2 — Quét đúng quy trình, 3 câu hỏi bắt buộc

> Kế thừa bài học red-team của STRATEGY-2026.md (giữ nguyên làm bằng chứng).
> Quy tắc lần này: **mọi ứng viên phải trả lờị đủ (1) AI ĐÃ LÀM + họ gọi được bao nhiêu tiền? (2) AI TRẢ TIỀN HÔM NAY? (3) con số gốc từ đâu?** Ô nào trống → không được recommend.
> Ngày viết: 26/9/2026. Mọi con số trích nguồn cuối tài liệu.

---

## 1. Bảng quyết án các nhánh "công nghệ nóng 2026"

| Nhánh | (1) Ai đã làm | (2) Ai trả hôm nay | Verdict |
|---|---|---|---|
| Agent trust/escrow (x402, ERC-8004/8183) | Nava $8.3M (Polychain); GenLayer Internet Court consortium 27 firm; Kustodia; MeshLedger; RNWY; SENTINEL… | Chưa rõ — volume x402 thật ~$45.7M **all-time**, 51% endpoint chết, top-2 catalog 88% | ❌ LOẠI (đã established lượt trước) |
| Post-quantum migration | **Project Eleven: $26M** ($6M seed + $20M Series A Castle Island/Coinbase Ventures/Balaji), đã ký Solana Foundation | Protocol foundations, treasuries tổ chức — chu kỳ bán dài, brand là moat | ❌ LOẠI: có cả một quán quân được vốn hóa |
| ZK proving infra / proof markets | Succinct (~$55M), Boundless/RISC Zero, Brevis… | L2s, verifier networks | ❌ LOẠI: vùng VC đẫm máu |
| Enterprise crypto accounting global | **Cryptio, Bitwave, Bitwave, TRES (Fireblocks mua lại 1/2026), Lukka, TaxBit, SoftLedger, Cryptoworth, CoinTracker Ent.** — giá publ ic $29–$1,375/tháng | Finance teams enterprise/tradfi | ❌ LOẠI: đỏ biển có SOC2/PwC audit sẵn |
| Privacy cho tổ chức (Prividium/Aztec/FHE) | ZKsync, Aztec, Zama, Chainlink privacy, JPM Kinexys | Bank — 18 tháng/deal + license | ❌ LOẠI: không có runway bán cho bank |
| Facilitator security cho x402 | Chỉ 1 bài học thuật (X402SCOPE, 49 violations, $202K sponsor fee burn); service liên tục chưa có | Chưa verify được ai trả | ⚠️ TREO: buyer rõ (Coinbase/Daydreams/PayAI) nhưng câu (2) CHƯA có bằng chứng — không recommend khi chưa đo |
| **Cụm thuế/sổ sách crypto Việt Nam** | Xem §2 — kiểm kỹ | Xem §2 — chốt được | ✅ **ỨNG VIÊN DUY NHẤT QUA 3 CÂU** |

## 2. Nhánh thắng: thuế & sổ sách crypto Việt Nam — chứng cứ

### Luật vừa vào đờị, đã đóng đinh ngày tháng

- **Luật Công nghiệp Công nghệ số (14/6/2025), hiệu lực 1/1/2026**: crypto được công nhận là tài sản hợp pháp. (TheBlock, CoinDesk 6/2025)
- **Thông tư 32/2026/TT-BTC (hiệu lực 27/3/2026)**: cá nhân chịu **0,1% PIT trên giá chuyển nhượng TỪNG LẦN, kể cả GIAO DỊCH LỖ, không được bù lỗ**; doanh nghiệp 20% CIT trên lãi thuần tự kê khai; miễn VAT. (Kryptos guide, Solvex, VTV)
- **Thông tư 41/2026/TT-BTC**: cơ chế kê khai/khấu trừ/nộp. Sàn licensed **khấu trừ tự động** khi settle. (Solvex)
- **Luật PIT sửa đổị hiệu lực 1/7/2026**: hợp thức hóa mặt bằng pháp lý của mức 0,1%. (BITGP, MEXC)
- **Pilot 5 năm (Nghị quyết 05/2025/NQ-CP), đúng 5 license CASP**, vốn tối thiểu ~$400M, sở hữu nội địa ≥65%; thị trường regulated đầu tiên mục tiêu Q3/2026. (CryptoTimes, vietnamspot)
- Thực tế hiện tại: **đa số user vẫn dùng sàn offshore + P2P tiền mặt/USDT**, và cơ chế thu thuế với kênh offshore **"vẫn đang được pilot thử nghiệm"** — phần khai tự giác thuộc về ngườị dùng, deadline quyết toán năm **31/3** (Datawallet, vietnamspot, MEXC).
- Quy mô ngườị dùng: **17–21 triệu ngườị VN dùng/giao dịch crypto** (MEXC guide 2026).

### Ba câu hỏi, trả lờị thẳng

**(1) Ai đã làm? — đã quét.**
- Quốc tế: Koinly/CoinLedger/Kryptos/… — cost-basis engine cho chế tài capital-gains của Mỹ/EU/Úc; chế tài VN (0,1% gross, không bù lỗ) cực lệch chuẩn; **không tiếng Việt, không export format CASP nội, không map biểu mẫu HTKK/quyết tóan VN, không integrate MISA, không kênh bán nội địa.**
- Nội địa: chỉ tìm được **content/calculator** (thue.cuthongthai.vn — bộ công cụ tính thuế có "thuế crypto", là lead-gen dạng web tĩnh) và Kryptos có guide VN. **Không thấy engine reconciliation nào bằng ngườị Việt, cho luật Việt, bán tại Việt Nam.**

**(2) Ai trả tiền hôm nay? — chốt được 3 nhóm.**
- **Nhóm đau nhất: cá nhân giao dịch ngoài sàn licensed (offshore/P2P)** — vẫn là số đông trong 17–21 triệu user; phải tự tổng hợp Binance/wallets/P2P thành tờ khai 0,1% gross không bù lỗ; sai = or under-pay (rủi ro phạt/hình sự sau giai đoạn chuyển tiếp) or over-pay. Đợt kê khai THẬT đầu tiên: kỳ quyết toán **31/3/2027** — còn ~6 tháng để chiếm tâm trí.
- **Doanh nghiệp VN kinh doanh crypto** (OTC desks, market makers, studio, quỹ nội): CIT 20% trên lãi thuần, tự kê khai, cần sổ sách + chứng từ điện tử lưu trữ (Thông tư 32 yêu cầu post-audit). Willing-to-pay cao, chu kỳ bán vừa phải, ít khách nhưng MRR lớn.
- **Công ty kế toán/kiểm toán VN** làm kênh phân phố: họ có sẵn khách crypto đang phải kê khai mà không có công cụ nào bằng tiếng Việt.

**(3) Con số gốc từ đâu? — toàn bộ là văn bản luật + ấn phẩm định hướng trích ở §5;** không lấy con số quảng cáo.

### Sizing thận trọng (ghi rõ là estimate, không giả chính xác)

- Retail pro-user: giả sử 0,5–1% của 17–21M sẵn sàng trả $60–120/năm cho công cụ kê khai đúng → 85k–210k user → TAM năm **$5–25M**; mục tiêu thực tế 3–5% TAM trong 24 tháng → **$150k–$1,2M ARR**. Bootstrap được, không phải unicorn.
- B2B doanh nghiệp + kênh kế toán: vài trăm khách × $100–500/tháng → $0,5–3M ARR trần gần. Cân bằng tốt cho team 3–6 ngườị.
- Nói thẳng: **đây là business vừa-miệng-ăn có moat, không phải "đột phá công nghệ".** Đột phá của nó nằm ở TIMING (luật vừa hạ màn 2026) × moat địa phương (ngôn ngữ + biểu mẫu + CASP formats + kênh) × DNA evidence của team.

### DNA khớp chỗ nào (không bịa)

Keccak evidence receipt của ee.io → thành **"gói chứng từ post-audit"**: mỗi sự kiện giao dịch/nạp/rút kèm chứng cứ tx hash + băm chống sửa, xuất đúng định dạng lưu trữ thông tư 32/41 yêu cầu. Không tool nội địa nào có, vì không tool nào động vào tầng chain.

### Kill-criteria (tự giết nếu)

1. Nếu các CASP licensed ra Q3/2026 export sẵn tờ khai đầy đủ + miễn phí cho user offshore-repatriate → nhánh retail co bóp, giữ lại B2B + kênh kế toán.
2. Nếu pilot đổi chế tài sang capital-gains (bỏ 0,1% gross) → engine viết theo module hóa để đổi luật bằng config (bài học thiết kế bắt buộc từ đầu).
3. Nếu Koinly lokalize tiếng Việt sâu trong 12 tháng → đánh giá lại moat kênh; retail CAC sẽ tăng.

## 3. Lộ trình 90 ngày (mỗi mốc có tiêu chí đo)

**Tuần 1–2 — Validation trước khi code (bắt buộc):** đọc bản đầy đủ Thông tư 32+41; phỏng vấn 5 công ty kế toán VN đang có khách crypto + 2 OTC desk; lấy 2 sample CSV export của sàn offshore phổ biến tại VN. **Tiêu chí go/no-go: ≥2/5 công ty kế toán đồng ý trial khi có MVP.**
**Tuần 3–6 — Engine tối thiểu:** import CSV Binance(Bybit/OKX)+địa chỉ ví (EVM/BTC/Solana); rule engine 0,1%-gross-no-offset + CIT net-profit; rule ở config, không hardcode; xuất báo cáo mẫu quyết toán + "gói chứng từ" receipt-hash từng sự kiện.
**Tuần 7–10 — Kênh bán:** ký 3 công ty kế toán làm đối tác triển khai (rev-share); content tiếng Việt (bị thue.cuthongthai dẫn trước thì đánh niche "đố soát ví on-chain" mà họ không làm được); 1 webinar với OTC community.
**Tuần 11–13 — Thử thị trường thật:** 10 khách trả phí bất kỳ (= mục tiêu duy nhất của quý; không đạt → dừng, ghi bài học).
**Ngân sách:** 1–2 kỹ sự, $0 mua infra lớn (public RPC + CSV), chi phí lớn nhất là thờị gian sales kênh kế toán.

## 4. Những câu hỏi CHƯA trả lờị được ngồi một mình (ghi công khai, không giấu)

- Thông tư 41 quy định kỳ kê khai tạm tính/quyết toán chính xác cho cá nhân offshore ra sao (cần đọc bản gốc).
- 5 CASP sẽ cung cấp export dữ liệu ở định dạng nào — chưa tồn tại để kiểm (thị trường chưa mở).
- Giá W2P thật của user retail VN ($5–$15/tháng hay sẽ lượm free?) — chỉ trả lờị được bằng 10 khách trả phí tuần 11–13.
- Liệu luật có buộc kê khai **giao dịch ví-ví thuần on-chain** không? Nếu có → scope tăng mạnh, pain tăng mạnh (tốt cho product).

## 5. Nguồn (trích từng con số)

- Luật CNTT số & mốc hiệu lực: Coindesk 16/6/2025; TheBlock 16/6/2025; Panama/panews 8/2025.
- Thuế 0,1% gross, no-offset, kỳ pilot: Kryptos Vietnam guide 8/2026; Solvex consulting guide; BITGP; MEXC learn; VTV.vn 30/3/2026.
- Khấu trừ tự động sàn licensed: Solvex guide (Thông tư 41); vietnamspot 7/2026.
- 5 licenses, ~$400M vốn tối thiểu, ≥65% nội địa: vietnamspot; CryptoTimes 5/2026 (mục tiêu Q3/2026).
- 17–21M user: MEXC learn guide 2026.
- Offshore vẫn số đông & cơ chế thu offshore "đang thử nghiệm": Datawallet 6/2026.
- HTKK 5.7.2 (nền tảng kê khai): MeInvoice 8/2026.
- Project Eleven $6M+$20M: The Quantum Insider 1/2026; Coindesk.
- x402 volume/concentration: x402.fuchss.app; x402station; tháng 12/2025 $24M tích lũy (smartcontracts.tools).
- Bãi đỏ biển accounting doanh nghiệp: breezing.io 9/2026, spark.money comparison, cbinsights.
