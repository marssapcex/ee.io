# STRATEGY 2026 — Từ sàn swap parasite tới nền kinh tế agent

> Tài liệu suy luận chiến lược, viết sau khi đọc toàn cảnh công nghệ 2026
> (ZK proving, x402/AP2, ERC-8004, FHE, PQ). Mục tiêu: tìm vấn đề THẬT còn
> thiếu, đề xuất mô hình kinh doanh KHẢ THI cho team nhỏ có sẵn động cơ
> non-custodial + evidence của ee.io — và loại thẳng các ý tưởng rác.

---

## 1. Bản đồ công nghệ 2026: cái gì là THẬT, cái gì là narrative

Sau khi đối chiếu nguồn độc lập (không lấy press release làm chân lý):

| Công nghệ | Trạng thái thật 9/2026 | Verdict |
|---|---|---|
| Real-time ZK proving / L1-zkEVM | SP1/Pico/Airbender chứng minh block <12s trên GPU commodity; ~10% validator thử nghiệm | THẬT, nhưng là cuộc chơi của EF/consensus team — không có khe cho startup nhỏ |
| FHE (Zama fhEVM) | Mainnet được, throughput còn nghèo nàn | THẬT về kỹ thuật, CHƯA có problem-solution fit cho SMB; bán cho bank = chu kỳ 18 tháng |
| Post-quantum | Roadmap ưu tiên cao, chưa ai phải migrate gấp | THẬT dài hạn; business = consulting, không phải product |
| Account abstraction native (EIP-8141…) | Đang tới, nhưng Pimlico/Alchemy/ZeroDev chiếm hết đất infra | THẬT + ĐỎ biển |
| Decentralized AI compute (Akash, 0G, io.net, EigenAI…) | Chạy production, nhưng verified inference vẫn chủ yếu TEE-attestation, zkML còn đắt | THẬT một nửa — phần "verifiable" là lỗ hổng |
| **x402 (agent payments)** | **THẬT và đo được**: 165M tx, ~69k agents, $50M tích lũy (avg $0.31/call), 85% trên Base; Linux Foundation governance; AWS CloudFront/WAF toggle-on; Stripe Bridge; Apify 20k+ tools; Coinbase Agent.market | THẬT — nhưng xem kỹ tiết ở §2 |
| **ERC-8004 (trust layer cho agents)** | Đã deploy Identity+Reputation trên Ethereum/Base/BSC; **Validation registry vừa deploy, còn trống** | THẬT và **BỊ ĐO LÀ HỎNG** — đây là phát hiện vàng |

### Bài toán đo thực nghiệm đầu tiên (arXiv 2606.26028, 7/2026)

Paper đầu tiên crawl toàn bộ sự kiện ERC-8004 trên 3 chain đến 13/5/2026. Kết quả tàn nhẫn:

- Chỉ **3–15%** identity đăng ký có registration file hợp lệ + endpoint sống. Còn lại là placeholder.
- Reputation Registry **không dùng được làm tín hiệu trust**: giá trị feedback không tương thích (C1), feedback **hiếm khi neo vào tương tác kinh tế có thể kiểm chứng**.
- **73.5% / 59.2% / 90.6%** reviewer trên Ethereum/BSC/Base thể hiện hành vi Sybil phối hợp. Sau khi loại Sybil: 15.8% / 77.9% / 86.8% agent **không còn feedback hợp lệ nào**.
- Validation Registry: mới deploy, chưa có thị trường validator — địa phận chưa có ai cắm cờ.

Ngay trên forum Ethereum Magicians, thread chính thức của ERC-8004 cũng nói trắng: *"payment proofs should be referenceable in Reputation … the hook"* — tức là tác giả chuẩn thừa nhận reputation cần **neo vào payment proofs**, mà chưa ai làm.

### Kết luận lớp 1 — Rails đã xong, và rails sẽ commodity hóa

A2A → Linux Foundation. x402 → Linux Foundation. ERC-8004 → chuẩn Ethereum mở. Ai xây *đường ray* xong phải tặng cho foundation, vì đó là điều kiện để được thông xe. **Tiền không nằm ở rail; tiền nằm ở lớp "ai được tin, dịch vụ nào đã thực sự được giao, tranh chấp xử lý thế nào"** — lớp evidence. Visa không giàu vì vận chuyển được tiền; Visa giàu vì sở hữu lớp tin cậy + arbitration phía trên rail.

### Kết luận lớp 2 — Khách hàng mới là máy

x402 avg $0.31/call, 165M tx trong vài tháng: đây không phải ngườidùng crypto đang mua sắm — đây là **khách hàng máy**. Bot đọc API trust dưới dạng JSON trong 50ms, không cần sales call, không cần UI đẹp. Một doanh nghiệp bán "dữ liệu tin cậy cho máy" có CAC ~ $0 nếu định dạng đúng chuẩn (Bazaar/Agent.market index được ngay). Đây là lý do lớp evidence cho agent economy có kinh tế học riêng mà lớp tương đương cho con ngườikhông có.

---

## 2. Ba concept kinh doanh (xếp hạng theo khả thi × hợp DNA × moat)

### 🥇 CONCEPT 1 — **"PayProof": lớp bằng chứng kinh tế cho agent commerce** (chọn)

**Tuyên bố một dòng:** *Reputation cho agent chỉ có nghĩa khi nó neo vào tiền thật đã settle và dịch vụ thật đã giao. Ta xây chính cái neo đó.*

Ba sản phẩm xếp theo thứ tự ra đờ{i}:

**(a) Grounded Reputation Oracle — sản phẩm nêm, không cần adoption 2 phía.**
- Agent của ta index toàn bộ settlement x402 trên Base (public data, 165M tx vẫn tăng), trích cặp (buyer-agent, seller-service, amount, timestamp, endpoint).
- Chi phối feedback vào ERC-8004 Reputation Registry **có điều kiện**: một feedback "uptime/nhận hàng" chỉ được ghi kèm payment-proof reference (tx hash) — chém đứt gốc Sybil (muốn fake 1000 feedback phải settle 1000 giao dịch thật).
- Expose cái "verified-feedback index" đó dạng API công khai + leaderboard — chính Agent.market / Bazaar / Apify / MCP marketplaces là khách. Họ CẦN tín hiệu lọc spam agents; paper trên đã chứng minh dữ liệu thô không lọc được.
- Doanh thu: free tier public (chiếm địa vị), paid tier cho marketplace/SDK ($X/tháng theo query volume), sau này bps trên verified-flow.

**(b) Evidence-anchored escrow cho vé lớn (≥$50–$100/call).**
- Vé $0.31 thì không ai tranh chấp — nuốt lỗ rẻ hơn. Nhưng agent mua compute giờ-chạy-GPU, data-fees theo tháng, phân tích chuyên sâu… ticket tăng → cần recourse.
- Escrow non-custodial: buyer agent khóa USDC vào contract (binding: hash(spec) + hash(payment) + validation-window + validator address). Release khi: (i) seller gửi response + hash khớp spec, (ii) qua optimistic window không dispute, hoặc (iii) validator (re-execution/TEE) phán xử.
- **Đây là tái sử dụng trực tiếp động cơ của ee.io**: CREATE2 escrow của deposit proxy + keccak evidence receipt + lock-or-refund machinery = 70% code đã viết và test rồi. Khách hàng đổi từ ngườisang máy, cơ chế giữ nguyên.
- Doanh thu: premium bps trên giá trị escrow (mô hình bảo hiểm/escrow fee, không phát token).

**(c) Validation backend đầu tiên trên 8004 Validation Registry.**
- Registry được thiết kế "unopinionated": ai cũng đăng ký làm validator, ghi verdict on-chain. Thị trường validator hiện TRỐNG.
- Ngách validation khả thi ngay hôm nay: **re-execution cho data APIs** (gọi lại đối chiếu — data endpoint deterministic) và **spot-check sampling cho scraping/automation** (Apify actors là deterministic-ish). Inference xác minh sâu (zkML/TEE) để dành — vẫn là hook, không phải day-1 product.
- Doanh thu: validator fee/verdict + reputational lock-in (địa phận "validator được registry của ta công nhận" sớm = moat bằng track record bất biến).

**Vì sao đúng DNA team này:** toàn bộ triết lý của ee.io là "đừng tin best-case; chứng minh failure-behavior bằng evidence". Lớp trust cho agent economy là đúng chữ đó, thị trường ngườikhác.

**Kill-criteria (nói thẳng, để tự giết nếu rác):**
- Nếu 12 tháng nữa x402 vẫn dậm ở $0.31/call và không ra nhánh big-ticket → (b) chết, nhưng (a) vẫn sống được như data-business (bán index).
- Nếu Coinbase tự build grounded reputation trong Agent.market → lạc quan thì bị mua lại, bi quan thì bị nghiền; moat là neutrality (Coinbase không thể công bằng với đối thủ của mình — giống lý do DEX aggregator sống cạnh sàn).
- Nếu ERC-8004 chết vì lý do chính trị foundation → pivot sản phẩm (a) thành standalone trust API không registry — dữ liệu index vẫn có giá trị.

### 🥈 CONCEPT 2 — **Verified-compute router ("giá/token ĐÃ XÁC MINH")**

So sánh decentralized GPU networks (Akash, io.net, 0G, Render, Bittensor subnets) + EigenAI theo **$/token theo trust tier**: self-reported → TEE-attested → re-executed-sample → zk-proofed. Agent buyer route qua ta, ta ký evidence receipt từng job.
- Đúng quote-engine DNA (parasite trên các venue compute — y hệt parasite trên venue swap).
- Rủi ro: API của GPU network bẩn hơn DEX venue rất nhiều (không chuẩn, SLA mờ), và distribution phải đấu với chính các network — làm SAU concept 1, kỳ vọng (a) cho ta reputational wedge để các compute network phải xin vào index (họ khao khát demand).

### 🥉 CONCEPT 3 — **Agent Goods Insurance (x402 big-ticket merchant stack)**

Bảo hiểm/escrow-as-a-service nhúng vào merchant API (du lịch, compute contract, data subscription) — seller nhận tiền chắc chắn, buyer agent có recourse không cần chargeback. Về bản chất là productize (1b) cho enterprise sellers. Đặt thứ 3 vì chu kỳ bán enterprise dài; nó là giai đoạn 2 của concept 1 chứ không phải con đường riêng.

### 🚫 Các ý tưởng bị loại thẳng (và lý do)

- **FHE confidential DeFi cho SMB**: khách duy nhất trả tiền là bank/licensed entity → cần license + chu kỳ bán 18 tháng → không có runway. Rác với team này, không phải rác nói chung.
- **PQ migration tooling**: problem thật, tiền thật — nhưng đó là consulting 2027+, không productize được bây giờ. Bookmark, chưa làm.
- **Agent app store / agent marketplace mới**: Coinbase Agent.market + AWS + Apify đã chiếm. Đi vào bị distribution nghiền.
- **Phát token "agent reputation"**: bullshit theo đúng tiêu chí bác chủ đặt ra. Moat ở đây là dữ liệu + track record on-chain, không phải token.
- **MEV/searcher infrastructure**: đã phân tích kỳ trước — margin single-digit, cuộc đua co-location. Cái duy nhất đáng giữ từ mạch đó là tư duy "watch→verify→act", vốn đã chuyển hóa vào concept 1(c).
- **"Sàn swap nhưng cho agents"**: đây là cái bẫy dễ nhất cho chính mình — đó là làm lại ee.io với customer máy. CoW/UniswapX solver network sẽ nuốt ngay khi ticket đáng làm. Không động vào.

---

## 3. Lộ trình 90 ngày cho Concept 1

**Tuần 1–3 — Indexer + trust schema.** Index x402 settlement trên Base (public RPC + facilitator events). Schema: (buyer, seller-endpoint, amount, ts, request-hash?, response-hash?, outcome). Ship public dashboard "agent economy có bao nhiêu tiền thật chảy" — bản thân nó là content-marketing miễn phí.

**Tuần 3–6 — Grounded attestor.** Viết contract wrapper quanh ERC-8004 Reputation (Base): feedback chỉ được ghi khi kèm payment-proof reference (tx hash đã settle). Batch-post feedback có kiểm chứng cho top-1k endpoints theo volume. Publish "verified-feedback API" (định dạng agent-readable JSON ngay từ đầu — khách là máy).

**Tuần 6–10 — Marketplace wedge.** Pitch 2–3 bên: Apify (họ vừa nạp 20k actors vào x402 — cần lọc rác), x402 Bazaar community, một MCP directory. KPI: ≥1 marketplace nhúng index vào search ranking.

**Tuần 10–13 — Escrow MVP.** Port deposit-proxy CREATE2 + evidence receipt + optimistic-window release (validator = ta, re-execution cho data-call domains). Pilot với 3 seller endpoints big-ticket ($50–$500/call — compute hoặc data premium). KPI: ≥10 escrowed jobs settle sạch hoặc 1 dispute được arbitration công khai minh bạch.

**Ngân sách cần:** 1 node/archive Base, server index, hợp đồng attestor+escrow (audit nhỏ: 2 contract tối giản), và 1 kỹ sư full-time 90 ngày. Không cần vốn float, không cần license.

**Số liệu kinh tế thật:** x402 ~$50M tích lũy / vài tháng → GMV tháng vận hành cỡ vài chục triệu USD và dốc. Grounded-attestation độc quyền-index được 100% dòng chảy đó ngay khi ship. Kịch bản thận trọng: 1% dòng big-ticket đi qua escrow ở 50bps → break-even team nhỏ; kịch bản tốt: trở thành *trust index mặc định* của bất kỳ ai build agent marketplace — lúc đó định giá nằm ở data-monopoly, không phải txn-fee.

---

## 4. Câu chốt

Sàn swap dạy ta một thứ giá nhất: **ngườichơi không có inventory thắng bằng cách chứng minh hành vi của ngườicó inventory.** Nền kinh tế agent vừa mở cổng lặp lại đúng bài đó, ở quy mô lớn hơn và với kẻ địch thú vị hơn: không phải sàn tập trung nữa, mà là *sự thiếu tin cậy giữa hai cỗ máy lạ trên internet mở*. Ai xây được cái neo "tiền đã qua cầu, dịch vụ đã qua tay, phán quyết đã ký bằng keccak" — ngườđó sở hữu lớp Visa của thế hệ khách hàng tiếp theo, tầng mà lần này khách hàng là máy.

Nguồn chính: arXiv 2606.26028 (empirical study ERC-8004), ethereum-magicians thread ERC-8004, 8004.org, coinbase.com/blog (x402×AWS), eco.com explainer, cryptonews Agent.market, Massive x402, BlockThreat weekly.

---

# ⚠️ PHỤ LỤC RED-TEAM (9/2026) — bản plan phía trên bị bắt bài, và phải ghi lại

Chủ nhà hỏi đúng: "vài phút ra business plan thì có nghĩ thật không?" Câu trả lờithành thật là: suy luận có thật, nhưng **hai cột trụ chịu lực của plan đã sập sau một lượt đối thủ-quét 15 phút** — và bản gốc ở trên được giữ nguyên làm bằng chứng, không được tẩy.

## Khẳng định gốc 1: "chưa ai xây lớp trust/escrow cho agent commerce" → **SAI, đỏ biển**

Một vòng search đối thủ cho ra cả đám, nhiều bên có vốn hẳn hoi:

- **Nava** — $8.3M seed (Polychain + Archetype), L3 escrow+verification trên Arbitrum (4/2026).
- **GenLayer "Internet Court"** — consortium 27 công ty (OKX, MetaMask, Matter Labs) làm dispute resolution cho agents (7/2026).
- **ERC-8183/APEX** — chuẩn escrow có evaluator + UMA optimistic oracle; ReputationGateHook đã LIVE trên Base mainnet; BNB Agent SDK gói sẵn từ 5/2026.
- **Kustodia** — production MCP escrow cho x402 (Arbitrum + Injective, 6/2026).
- **MeshLedger** — escrow + AI judge, phí 2%, deploy sẵn trên Base.
- Hàng CHỤC reputation/trust oracles đã sống: **RNWY** (150k agents indexed, 12 chain, "Sybil X-Ray"), **SENTINEL** (reference implementation của chính x402 trust-provider extension #2299, contract live trên Base), TrustAgent (đã product hóa sybil-filter — tự báo "92.6% feedback trên Base là coordinated"), 8k4, Assay, Verity, Agent Arena, DJD Agent Score (298 tests), agent-trust-oracle… Kể cả một luận văn cử nhân Hà Nội index 243k agents qua 5 chain.

Cả sản phẩm (a) grounded reputation LẪN (b) escrow đều đã có ngườicầm cờ. Câu "địa phận trống" trong bản gốc là phát biểu của ngườichưa nhìn quanh.

## Khẳng định gốc 2: "x402 volume thật, khách hàng máy thật" → **bị thương nặng**

Dữ liệu đo độc lập (không phải báo Coinbase):

- x402.fuchss.app probe 72.395 endpoints: **51% chết/unreachable**; chỉ 67.8% ví pay-to từng được trả tiền một lần; $45.7M all-time nhưng top earner (bitrefill, $532K) chiếm **50.7%** volume resolve được; hạng 3 là $119K từ đúng 67 settlements / 6 ví (test/whale).
- x402station probe 86.599 endpoints: **top-2 providers chiếm 88% catalog**, top-10 chiếm 91.85%; chỉ 8.56% "live".
- tháng 12/2025: $24M tích lũy. Con số "$600M/năm" chỉ sống trong analyst note. Nhịp thật ~ vài triệu USD/tháng, phần lớn metering dust.
- Paper bảo mật (Pith, 8/2026): **14/15 facilitator vi phạm rule an toàn** (free-shopping, asset theft), 49 violations, 1.99% settlement thất bại trên Base, $202K phí sponsor bị đốt — notional đủ nhỏ để chưa ai mất ngủ, đủ lớn để chứng minh infra còn non.

## Verdict tái thẩm

Agent-commerce trust/escrow: **thị trường thật ≠ thị trường đủ lớn cho kẻ tới muộn không vốn**. Cầu chưa đáng kể ($ hàng tháng bằng một quán cà phê khá), cung ùn tắc players được seed $8M+. Cả 3 sản phẩm gốc (a/b/c) đều lao vào đúng đám đó → **KHÔNG làm theo bản gốc nữa.**

Điều duy nhất sống sót qua red-team là dữ liệu, không phải cơ chế:
- Facilitators bị đo là **bất an** (49 violation, 31 exploitable instances, $202K burn) mà CHƯA CÓ dịch vụ security liên tục nào — chỉ có 1 bài học thuật chụp 1 lần (X402SCOPE). Ngách hẹp, B2B, buyer rõ (Coinbase/Daydreams/PayAI facilitators), ROI story rõ (đốt phí sponsor $202K lận).
- Hoặc thậm chí hơn kém quyến rũ: ý tưởng "reputation oracle #74" cần bị loại bỏ hoàn toàn.

## Bài học quy trình (cái này không bị red-team)

1. **"Hợp logic" là điều kiện cần tối thiểu, không phải đủ.** Plan càng trơn tru càng nghi.
2. Ba câu hỏi phải trả lờị TRƯỚC khi viết plan: ai đã làm? ai trả tiền hôm nay? con số gốc từ đâu? Mình chỉ trả lờị được câu 3 vừa đủ.
3. Tài sản chuyển được thật sự của team: *adversarial verification trước khi build* — vừa tự áp lên chính mình lần đầu, và đúng là đau.

Mô hình kinh doanh cuối cùng chưa chốt ở đây. Đang có hai hướng sống sót: (i) security/forensics-as-a-service cho facilitators x402 (narrow, có measured burn làm ROI), (ii) quay lại vùng swap nhưng chọn battle khác trong cùng DNA adversarial. Quyết định cần thêm dữ liệu demand phía (i) — chưa đủ, và lần này sẽ nói "chưa đủ" thay vì viết plan cho có.
