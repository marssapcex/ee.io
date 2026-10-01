#!/usr/bin/env python3
# build.py — generates Grounded_Reputation_for_the_Agentic_Economy_v0.1.pdf
# Style model: measured, data-first research paper (ARK x Glassnode register).

import math
import os

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.graphics.shapes import Drawing, Line, Polygon, Rect, String

OUT = os.path.join(os.path.dirname(__file__), "Grounded_Reputation_for_the_Agentic_Economy_v0.1.pdf")
TITLE = "Grounded Reputation for the Agentic Economy"
SUBTITLE = "Payment-Bound Fulfilment Evidence for ERC-8004"
SHORT = "Grounded Reputation for the Agentic Economy"

# ---------------------------------------------------------------- fonts
FDIR = "/usr/share/fonts/truetype/dejavu"


def _reg(name, fname):
    try:
        pdfmetrics.registerFont(TTFont(name, os.path.join(FDIR, fname)))
        return True
    except Exception:
        return False


SERIF, SERIF_B, SERIF_I, SERIF_BI = "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"
if _reg("DVS", "DejaVuSerif.ttf"):
    SERIF = "DVS"
    SERIF_B = "DVS-B" if _reg("DVS-B", "DejaVuSerif-Bold.ttf") else SERIF
    SERIF_I = "DVS-I" if _reg("DVS-I", "DejaVuSerif-Italic.ttf") else SERIF
    SERIF_BI = "DVS-BI" if _reg("DVS-BI", "DejaVuSerif-BoldItalic.ttf") else SERIF_B
    registerFontFamily(SERIF, normal=SERIF, bold=SERIF_B, italic=SERIF_I, boldItalic=SERIF_BI)

MONO = "Courier"
if _reg("DVM", "DejaVuSansMono.ttf"):
    MONO = "DVM"
    _reg("DVM-B", "DejaVuSansMono-Bold.ttf")

SANS = "Helvetica"
if _reg("DVN", "DejaVuSans.ttf"):
    SANS = "DVN"
    _reg("DVN-B", "DejaVuSans-Bold.ttf")

# ---------------------------------------------------------------- styles


def S(name, **kw):
    base = dict(fontName=SERIF, fontSize=9.5, leading=13.2, textColor=colors.HexColor("#1a1a1a"))
    base.update(kw)
    return ParagraphStyle(name, **base)


ST = {
    "Title": S("Title", fontName=SERIF_B, fontSize=20, leading=25, alignment=TA_CENTER),
    "Subtitle": S("Subtitle", fontName=SERIF, fontSize=12.5, leading=17, alignment=TA_CENTER,
                  textColor=colors.HexColor("#444444")),
    "Meta": S("Meta", fontName=SERIF, fontSize=9, leading=13, alignment=TA_CENTER,
              textColor=colors.HexColor("#555555")),
    "AbstractHead": S("AbstractHead", fontName=SERIF_B, fontSize=9.5, leading=13,
                      alignment=TA_CENTER, spaceBefore=14),
    "Abstract": S("Abstract", fontSize=9.2, leading=12.6, alignment=TA_JUSTIFY,
                  leftIndent=14 * mm, rightIndent=14 * mm, textColor=colors.HexColor("#2a2a2a")),
    "Keywords": S("Keywords", fontName=SERIF_I, fontSize=8.8, leading=12, alignment=TA_CENTER,
                  leftIndent=14 * mm, rightIndent=14 * mm, textColor=colors.HexColor("#555555")),
    "H1": S("H1", fontName=SERIF_B, fontSize=13, leading=16, spaceBefore=15, spaceAfter=6,
            textColor=colors.HexColor("#111111")),
    "H1NoTOC": S("H1NoTOC", fontName=SERIF_B, fontSize=13, leading=16, spaceBefore=15, spaceAfter=6,
            textColor=colors.HexColor("#111111")),
    "H2": S("H2", fontName=SERIF_B, fontSize=10.5, leading=14, spaceBefore=10, spaceAfter=4,
            textColor=colors.HexColor("#222222")),
    "Body": S("Body", alignment=TA_JUSTIFY, spaceAfter=5),
    "BodyTight": S("BodyTight", alignment=TA_JUSTIFY, spaceAfter=2),
    "Bullet": S("Bullet", alignment=TA_JUSTIFY, spaceAfter=3, leftIndent=7 * mm, bulletIndent=2 * mm),
    "Caption": S("Caption", fontName=SERIF_I, fontSize=8.6, leading=11.5, alignment=TA_CENTER,
                 textColor=colors.HexColor("#444444"), spaceBefore=4, spaceAfter=8),
    "THead": S("THead", fontName=SERIF_B, fontSize=8.3, leading=10.5, alignment=TA_LEFT),
    "TCell": S("TCell", fontSize=8.3, leading=10.5, alignment=TA_LEFT),
    "TCellC": S("TCellC", fontSize=8.3, leading=10.5, alignment=TA_CENTER),
    "Ref": S("Ref", fontSize=8.4, leading=11, spaceAfter=3, leftIndent=8 * mm, firstLineIndent=-8 * mm),
    "Note": S("Note", fontName=SERIF_I, fontSize=8.6, leading=11.5, textColor=colors.HexColor("#555555")),
    "Code": ParagraphStyle("Code", fontName=MONO, fontSize=8.1, leading=10.4,
                           leftIndent=0, rightIndent=0, backColor=colors.HexColor("#f4f4f2"),
                           borderPadding=(6, 6, 6, 6), spaceBefore=4, spaceAfter=8),
    "TOC0": S("TOC0", fontName=SERIF_B, fontSize=9.8, leading=15),
    "TOC1": S("TOC1", fontSize=9.2, leading=12.5, leftIndent=6 * mm),
}


# ---------------------------------------------------------------- doc with TOC support
class WPDoc(BaseDocTemplate):
    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph):
            name = flowable.style.name
            if name == "H1":
                self.notify("TOCEntry", (0, flowable.getPlainText(), self.page))
            elif name == "H2":
                self.notify("TOCEntry", (1, flowable.getPlainText(), self.page))


def on_first(canvas, doc):
    canvas.saveState()
    canvas.setFont(SERIF, 8)
    canvas.setFillColor(colors.HexColor("#666666"))
    canvas.drawCentredString(A4[0] / 2, 12 * mm, str(doc.page))
    canvas.restoreState()


def on_later(canvas, doc):
    canvas.saveState()
    canvas.setFont(SERIF, 8)
    canvas.setFillColor(colors.HexColor("#666666"))
    y = A4[1] - 14 * mm
    canvas.drawString(22 * mm, y, SHORT)
    canvas.drawRightString(A4[0] - 22 * mm, y, "v0.1 · October 2026")
    canvas.setStrokeColor(colors.HexColor("#aaaaaa"))
    canvas.setLineWidth(0.5)
    canvas.line(22 * mm, y - 1.8 * mm, A4[0] - 22 * mm, y - 1.8 * mm)
    canvas.drawCentredString(A4[0] / 2, 12 * mm, str(doc.page))
    canvas.restoreState()


# ---------------------------------------------------------------- story helpers
story = []


def h1(txt):
    story.append(Paragraph(txt, ST["H1"]))


def h2(txt):
    story.append(Paragraph(txt, ST["H2"]))


def body(txt):
    story.append(Paragraph(txt, ST["Body"]))


def bul(txt):
    story.append(Paragraph(txt, ST["Bullet"], bulletText="\u2022"))


def note(txt):
    story.append(Paragraph(txt, ST["Note"]))


def cap(txt):
    story.append(Paragraph(txt, ST["Caption"]))


def code(txt):
    story.append(Preformatted(txt, ST["Code"]))


def gap(h=4):
    story.append(Spacer(1, h))


def table(rows, widths, header=True, align_center_cols=()):
    data = []
    for r, row in enumerate(rows):
        line = []
        for c, cell in enumerate(row):
            sty = ST["THead"] if (header and r == 0) else (ST["TCellC"] if c in align_center_cols else ST["TCell"])
            line.append(Paragraph(str(cell), sty))
        data.append(line)
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    style = [
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEABOVE", (0, 0), (-1, 0), 0.9, colors.HexColor("#333333")),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
    ]
    if header:
        style.append(("LINEBELOW", (0, 0), (-1, 0), 0.55, colors.HexColor("#333333")))
    style.append(("LINEBELOW", (0, len(rows) - 1), (-1, len(rows) - 1), 0.9, colors.HexColor("#333333")))
    t.setStyle(TableStyle(style))
    story.append(t)


def ref(idx, txt):
    story.append(Paragraph(f"[{idx}]&nbsp;&nbsp;{txt}", ST["Ref"]))


# ---------------------------------------------------------------- figure 1
def arrow(d, x1, y1, x2, y2, dashed=False):
    ln = Line(x1, y1, x2, y2, strokeColor=colors.HexColor("#333333"), strokeWidth=0.8)
    if dashed:
        ln.strokeDashArray = [2.2, 2.0]
    d.add(ln)
    ang = math.atan2(y2 - y1, x2 - x1)
    L = 5.0
    a1 = ang + math.pi * 0.82
    a2 = ang - math.pi * 0.82
    tip = [(x2, y2), (x2 + L * math.cos(a1), y2 + L * math.sin(a1)), (x2 + L * math.cos(a2), y2 + L * math.sin(a2))]
    d.add(Polygon([p for pt in tip for p in pt], fillColor=colors.HexColor("#333333"),
                  strokeColor=colors.HexColor("#333333"), strokeWidth=0.4))


def box(d, x, y, w, h, label, sub=None, fill="#ffffff", dash=False):
    r = Rect(x, y, w, h, fillColor=colors.HexColor(fill), strokeColor=colors.HexColor("#333333"), strokeWidth=0.9)
    if dash:
        r.strokeDashArray = [3, 2.4]
    d.add(r)
    d.add(String(x + w / 2, y + h - 11 if sub else y + h / 2 - 3, label, fontName=SANS, fontSize=7.6,
                 textAnchor="middle", fillColor=colors.HexColor("#111111")))
    if sub:
        d.add(String(x + w / 2, y + 5, sub, fontName=SANS, fontSize=6.6, textAnchor="middle",
                     fillColor=colors.HexColor("#555555")))


def figure1():
    W, H = 468, 238
    d = Drawing(W, H)
    box(d, 8, 186, 106, 34, "Buyer (agent)", "requests work, pays")
    box(d, 354, 186, 106, 34, "Service (agent)", "returns artifact")
    box(d, 216, 148, 108, 26, "Judge / validator", "verdict in {0..100}")
    box(d, 8, 60, 56, 44, "Payment", "provider", dash=True)
    d.add(String(36, 52, "facilitator / chain RPC", fontName=SANS, fontSize=6.0, textAnchor="middle",
                 fillColor=colors.HexColor("#555555")))
    box(d, 150, 54, 240, 58, "Fulfilment receipt", "payment + artifact hash + verdict")
    d.add(String(270, 44, "hash-chain: h_i = H(H(canon(core_i)) || h_{i-1})", fontName=SANS, fontSize=6.4,
                 textAnchor="middle", fillColor=colors.HexColor("#555555")))
    box(d, 402, 54, 58, 48, "ERC-8004", "reputation registry")
    d.add(String(396, 44, "grounded feedback", fontName=SANS, fontSize=6.0, textAnchor="middle",
                 fillColor=colors.HexColor("#333333")))
    arrow(d, 114, 208, 354, 208)
    d.add(String(234, 211.5, "x402 payment (verify, settle)", fontName=SANS, fontSize=6.8,
                 textAnchor="middle", fillColor=colors.HexColor("#333333")))
    arrow(d, 354, 195, 114, 195)
    d.add(String(234, 187.5, "delivered artifact", fontName=SANS, fontSize=6.8, textAnchor="middle",
                 fillColor=colors.HexColor("#333333")))
    arrow(d, 270, 148, 270, 114)
    arrow(d, 61, 186, 165, 114)
    arrow(d, 407, 186, 375, 114)
    arrow(d, 64, 78, 150, 78, dashed=True)
    d.add(String(107, 82, "cross-check", fontName=SANS, fontSize=6.0, textAnchor="middle",
                 fillColor=colors.HexColor("#555555")))
    arrow(d, 390, 78, 402, 78)
    return d


# ================================================================ content
story.append(NextPageTemplate("Later"))
story.append(Spacer(1, 34 * mm))
story.append(Paragraph(TITLE, ST["Title"]))
gap(5 * mm)
story.append(Paragraph(SUBTITLE, ST["Subtitle"]))
gap(8 * mm)
story.append(Paragraph("ee.io Research", ST["Meta"]))
story.append(Paragraph("Version 0.1 &nbsp;·&nbsp; October 2026 &nbsp;·&nbsp; working draft — comments solicited", ST["Meta"]))
gap(10 * mm)

story.append(Paragraph("Abstract", ST["AbstractHead"]))
story.append(Paragraph(
    "Payment rails for machine commerce now exist at production scale, and a shared identity and "
    "reputation standard for autonomous agents has been adopted faster than any comparable Ethereum "
    "standard. What remains missing is evidence that feedback means anything: the first empirical "
    "study of the deployed reputation registry, covering every event on Ethereum, BSC and Base "
    "through May 2026, finds that 59–91% of reviewers exhibit coordinated Sybil funding patterns "
    "and that most rated agents retain no valid feedback once those are removed. A rating that "
    "costs nothing conveys nothing. This paper presents a receipt protocol that binds three "
    "independent legs of a fulfilled transaction — the x402 settlement, a hash commitment to the "
    "delivered artifact, and a validator verdict — into one hash-chained record, and emits ERC-8004 "
    "feedback only when the payment leg cross-verifies. Grounding gives feedback a production cost "
    "instead of a signing cost; canonical encoding and hash chaining give every third party a "
    "complete, localized audit; median and trimmed-mean aggregation restores robustness that a "
    "plain mean provably lacks. A reference implementation ships with this paper: four modules, "
    "fifteen property tests, and a specification sufficient for independent re-verification.",
    ST["Abstract"]))
story.append(Paragraph(
    "agent commerce · ERC-8004 · x402 · reputation systems · verifiable credentials · keccak hash chains",
    ST["Keywords"]))
story.append(PageBreak())

# -------- TOC
toc = TableOfContents()
toc.levelStyles = [ST["TOC0"], ST["TOC1"]]
toc.dotsMinLevel = 0
story.append(Paragraph("Contents", ST["H1NoTOC"]))
story.append(toc)
story.append(PageBreak())

# -------- 1
h1("1&nbsp;&nbsp;Introduction")
body(
    "The web's payment verb arrived three decades after its other verbs. HTTP reserved status code "
    "402 for payment in 1997; the x402 protocol turned it into a working request for settlement in "
    "2025 [3]. Within a year, x402 processed roughly 169 million payments across about 590,000 "
    "buyers and 100,000 sellers, and both Cloudflare and AWS embedded x402 at their edge networks "
    "within two weeks of each other in mid-2026 [4]. Stripe began accepting x402-based USDC "
    "payments on Base through its Payment Intents API in February 2026 [5]. In April 2026 the "
    "protocol moved to a foundation under the Linux Foundation whose founding members include AWS, "
    "Cloudflare, Anthropic, and Circle [4].")
body(
    "Identity and reputation plumbing followed at comparable speed. ERC-8004, proposed in August "
    "2025 by authors from MetaMask, the Ethereum Foundation, Google, and Coinbase, defines three "
    "per-chain singleton registries — identity, reputation, and validation [1]. Its mainnet "
    "contracts went live on 29 January 2026 [7], and within roughly eleven weeks community trackers "
    "counted about 200,000 agent registrations across more than twenty chains — an adoption pace "
    "faster than ERC-721's [8]. The standard's own materials describe feedback as permanent and "
    "queryable, and defer aggregation quality to off-chain systems: reputation aggregation 'will "
    "happen off-chain', unfiltered summaries are 'subject to Sybil/spam attacks', and 'many "
    "players' are expected to build the scoring layer [1].")
body(
    "What neither standard settles is whether a recorded rating means anything. Payments prove that "
    "value moved; registries record what somebody said. Neither reflects whether work was "
    "delivered, or whether the person saying it ever transacted. This paper addresses exactly that "
    "junction: it specifies a minimal evidence object — a fulfilment receipt — that grounds every "
    "unit of agent reputation in a settled payment, a delivered artifact, and a graded verdict, "
    "and shows that this construction repairs the failure modes measured in deployment. The claims "
    "made are deliberately narrow: the protocol cannot make agents honest; it can make dishonesty "
    "expensive, detectable, and priced out of the signalling channel.")

# -------- 2
h1("2&nbsp;&nbsp;What deployment data shows")
body(
    "The empirical basis for this paper is a 2026 study that crawled every Identity and Reputation "
    "Registry event on Ethereum, BSC, and Base from deployment through 13 May 2026, dereferenced "
    "the linked off-chain registration and feedback files, measured gas costs, and cross-analysed "
    "x402 settlement activity [2]. Its findings quantify what 'unverified feedback' means in "
    "practice:")
bul("Only 3–15% of registered identities expose a valid registration file with a live service "
    "endpoint. Registration, in other words, is mostly placeholder occupation, not service "
    "supply [2].")
bul("Between 59% and 91% of reviewing addresses exhibit coordinated funding patterns "
    "characteristic of Sybil clusters; after removing feedback from those clusters, most rated "
    "agents retain no valid feedback whatsoever [2].")
bul("The registry's aggregation surface fails four necessary conditions for a usable trust "
    "signal: values are not commensurable across producers; a mean aggregator breaks under "
    "outliers; records are not grounded in verifiable interactions; and manipulation is cheap "
    "— the marginal cost of one more five-star report is the gas for one transaction [2].")
gap(2)
table(
    [
        ["Condition", "Measured failure [2]", "Requirement it implies"],
        ["C1 Commensurability", "Producers use incompatible value ranges; averages over them are arithmetic noise.",
         "A single fixed score domain for fulfilment feedback."],
        ["C2 Outlier robustness", "Mean aggregation has breakdown point zero; one fabricated extreme moves the mean.",
         "Robust statistics (median, trimmed mean) as the default consumption path."],
        ["C3 Grounding", "Feedback rarely references a verifiable interaction; self-rating is routine.",
         "Feedback must bind to a settled payment and a delivered artifact by construction."],
        ["C4 Manipulation cost", "Forging a rating costs only a transaction fee.",
         "Each signalling unit must carry a real production cost."],
    ],
    [27 * mm, 78 * mm, 61 * mm])
cap("Table 1. The four conditions, what the field measurement found, and the design requirement each forces.")
body(
    "Two further observations frame the design space. First, the honest volume base is still "
    "modest relative to the rail's capacity: independent measurement puts cumulative x402 value "
    "at roughly $46.5M across its first ten months, with much of 2025 flow linked to memecoin "
    "churn rather than service commerce [5]; the stablecoin substrate beneath it moved about $46T "
    "gross, $9T adjusted, in the same period [6]. The discrepancy is the opportunity: the "
    "infrastructure for machine payment is deployed, but the trust layer that would route buyers "
    "to competent sellers does not yet function. Second, the ecosystem has already begun to "
    "compensate in fragments — agent scanners, off-chain scoreboards, a finalized vetting "
    "standard producing private risk scores [9] — which confirms demand for trustworthy signals "
    "while underscoring that no public, payment-grounded evidence object currently feeds the "
    "canonical registry.")

# -------- 3
h1("3&nbsp;&nbsp;Requirements and threat model")
h2("3.1&nbsp;&nbsp;Security properties")
bul("<b>P1 Grounding.</b> No feedback may be emitted for a receipt whose payment leg does not "
    "cross-verify against an independent provider (a facilitator's verify interface or chain "
    "state). This is enforced in code at the emission boundary, not by convention.")
bul("<b>P2 Append-only auditability.</b> Receipts form a per-agent hash chain. Any insertion, "
    "deletion, edit, or re-ordering is detectable and localisable to the first inconsistent "
    "index by any party holding the chain and the canonical-encoding rule.")
bul("<b>P3 Commensurability.</b> Fulfilment verdicts occupy a fixed integer domain (0–100) with a "
    "fixed semantic tag, so a client can aggregate across producers without a schema negotiation.")
bul("<b>P4 Aggregation robustness.</b> The default aggregation path has a positive breakdown point "
    "(median: 0.5; 10%-trimmed mean: 0.1), in contrast to the mean's breakdown point of zero.")
bul("<b>P5 Cost asymmetry.</b> One unit of reputation must cost its producer at least one settled "
    "payment, while verifying the chain costs the observer only hashing and at most one lookup per "
    "receipt of interest.")
bul("<b>P6 Neutrality.</b> The construction introduces no token, no custodian, and no new registry; "
    "it writes into the extension surfaces of existing standards [1, 8 with respect to ERC-8183, 3 "
    "with respect to x402 ] and remains ledger-agnostic wherever a settled payment can be read.")
h2("3.2&nbsp;&nbsp;Adversary classes")
bul("<b>A1 Rating farmer.</b> Operates clusters of buyer identities to multiply its own feedback — "
    "the population the measurement [2] found dominant. Defence: grounding (P1) and cost asymmetry "
    "(P5); each cluster identity must settle real payments from traceable funding, which is the "
    "same funding-graph signature the study used to detect clusters.")
bul("<b>A2 Selective historian.</b> A seller that curates which receipts enter its chain, hiding "
    "failures. Defence: chains anchored by external counters (feedback events on the registry; "
    "payment transactions on settlement chains) make silent gaps observable to an auditor that "
    "reconciles counts.")
bul("<b>A3 Provider compromise.</b> A facilitator or RPC endpoint that lies about a payment. "
    "Defence: providers are evidence sources, not oracles — their claims are checked field-by-field "
    "against the receipt, and disagreements surface as named mismatches rather than silent "
    "overrides; multiple independent providers can be required for high-value receipts.")
bul("<b>A4 Platform capture.</b> The standard's own operators shipping an equivalent feature. "
    "Defence: none, by design. The working track of the standard already contemplates standardized "
    "payment-proof schemas inside feedback attestations [16]; an implementation compatible with "
    "that schema ratifies the direction instead of competing with it.")

# -------- 4
h1("4&nbsp;&nbsp;Construction")
h2("4.1&nbsp;&nbsp;Receipt schema")
body(
    "A fulfilment receipt binds three legs. The payment leg carries the x402 settlement reference "
    "(scheme, chain, transaction hash, parties, asset, amount, facilitator). The delivery leg "
    "carries a commitment to the returned artifact (keccak-256 of its bytes, a retrieval URI, the "
    "validation method, and a timestamp). The verdict leg carries an integer score in 0–100 and "
    "the identity of the validator that issued it. Let H denote keccak-256 and canon(·) the "
    "canonical encoding of Section 4.2. For agent A:")
code("coreHash_i  = H( canon( core_i ) )                  # canonicalisation\n"
     "h_0          = 0^256                                  # genesis\n"
     "h_i          = H( coreHash_i  ||  h_{i-1} )           # chain link\n"
     "receipt_i    = ( core_i , h_{i-1} , h_i )")
gap(2)
table(
    [
        ["Field", "Type", "Meaning"],
        ["agentId / taskId", "string", "Registry-qualified agent handle, and the buyer's correlation id."],
        ["payment.scheme, chainId, txHash", "enum, uint, bytes32", "The x402 settlement leg (exact or upto)."],
        ["payment.from / to / asset / amount", "address, address, asset, uint", "Who paid whom, what, and how much."],
        ["payment.facilitator", "string", "Which facilitator's verify/settle path the payment used."],
        ["payment.verified", "bool", "True only after cross-check (Section 4.3). Gates feedback emission."],
        ["delivery.artifactHash / artifactURI", "bytes32, uri", "Commitment to, and pointer to, what was returned."],
        ["delivery.method", "enum", "hash-commit, reexec, tee, zkml — the validation tier (Section 5)."],
        ["verdict.score / validator", "uint 0–100, address", "The graded fulfilment score and its issuer."],
        ["prevHash, receiptHash", "bytes32", "Chain linkage as defined above."],
    ],
    [46 * mm, 40 * mm, 80 * mm])
cap("Table 2. Receipt fields. Types follow the reference implementation in Section 7.")
h2("4.2&nbsp;&nbsp;Canonical encoding and the hash chain")
body(
    "Evidence must remain re-verifiable indefinitely, without trusting the issuer's stack. The "
    "canonical form is JSON with keys sorted at every depth, insignificant whitespace removed, "
    "and undefined members dropped — several lines of specification, implementable in any "
    "language with a JSON library. Because canon(·) is independent of key order, a receipt "
    "served by any provider can be re-hashed and compared; portability of the hash is the "
    "portability of the evidence. Chain verification walks the receipts, recomputes each link, "
    "and returns the first index at which the linkage or the content hash breaks:")
code("verifyChain(records):\n"
     "    expect = 0^256\n"
     "    for i in 0..len(records)-1:\n"
     "        if records[i].prevHash != expect:        return FAIL(link, i)\n"
     "        if H(H(canon(records[i].core)) || records[i].prevHash)\n"
     "                               != records[i].receiptHash:  return FAIL(hash, i)\n"
     "        expect = records[i].receiptHash\n"
     "    return OK(len(records))")
body(
    "The construction inherits the tamper-localisation property of any hash chain: editing receipt "
    "j invalidates every link from j onward, and an auditor halts at the first broken index, "
    "naming the exact receipt that fails consistency.")
h2("4.3&nbsp;&nbsp;Payment grounding")
body(
    "A payment leg is a claim, not a fact. The protocol defines a provider interface — one method, "
    "fetchPayment(chainId, txHash) — with two natural implementations: the facilitator's verify "
    "path (already required of every x402 payment [3]) and a direct settlement-chain lookup "
    "checking that the transaction is final and moves the claimed amount of the claimed asset "
    "between the claimed parties. Each field of the leg is compared independently; any divergence "
    "is reported as a named mismatch rather than silently reconciled. The receipt's verified bit "
    "is therefore not an assertion of quality: it is a claim that its payment leg survived "
    "field-level cross-examination. The forgery cost bound is immediate — fabricating a verified "
    "leg requires settling a real payment of the claimed amount, which costs the full amount plus "
    "settlement fees, versus approximately zero for fabricating an unverified leg.")
h2("4.4&nbsp;&nbsp;Grounded feedback emission")
body(
    "ERC-8004's giveFeedback accepts a value, tags, an endpoint, and a content-hashed off-chain "
    "file [1]; the off-chain feedback schema reserves a proofOfPayment object carrying from, to, "
    "chainId, and txHash [1]. The protocol emits feedback only through a function with the "
    "following guard: if receipt.payment.verified is false, refuse. The emitted record fixes "
    "value = verdict.score with zero decimals, tag1 = 'fulfilled', and feedbackHash = receiptHash; "
    "the off-chain file at feedbackURI is the receipt JSON itself. Two consequences follow. "
    "Grounding (C3) ceases to be a convention — a buyer who never transacted cannot emit, because "
    "receipt construction cannot pass Section 4.3 — and manipulation (C4) acquires a price equal "
    "to Section 6's cost curve. The v2 working track of the standard contemplates standardized "
    "x402 payment-proof schemas inside feedback attestations [16]; the payload above is a strict "
    "instance, making the implementation forward-compatible by construction.")
h2("4.5&nbsp;&nbsp;Robust aggregation")
body(
    "Condition C2 is repaired at consumption time. For a set of fulfilment scores the protocol "
    "consumers compute, by default, the median and the 10%-trimmed mean; the plain mean is carried "
    "only as a diagnostic. The arithmetic argument is classical: the median has breakdown point "
    "0.5 — an adversary must control half of the observations to move it arbitrarily — the "
    "10%-trimmed mean has breakdown point 0.1, and the mean has breakdown point zero. A one-line "
    "demonstration suffices: ten honest scores of 100 plus one fabricated score of 0 yield mean "
    "90.9, median 100, trimmed mean 100. The same study that measured C2's failure recommended "
    "robust aggregation among its redesign directions [2].")

story.append(Spacer(1, 2))
story.append(figure1())
cap("Figure 1. A fulfilled transaction becomes one receipt binding payment, artifact, and verdict; "
    "the chain feeds grounded feedback into the registry, and providers cross-check the payment leg.")

# -------- 5
h1("5&nbsp;&nbsp;Validation tiers, and their honest limits")
table(
    [
        ["Tier", "What the verdict proves", "Marginal cost per job", "Status in this construction"],
        ["hash-commit", "A specific artifact (bytes) was delivered, and bound to a settled payment.",
         "one hash", "implemented; the default"],
        ["reexec", "A bonded validator re-ran the work and agrees (or not) with the result.",
         "re-run cost + validator bond", "typed; network economics open (Section 9)"],
        ["tee", "Code ran unmodified inside an attested enclave.", "attestation overhead",
         "typed; hardware trust assumption is explicit"],
        ["zkml", "A succinct proof that the inference followed from the claimed model.",
         "proof generation", "typed; flagged not-yet-practical"],
    ],
    [24 * mm, 74 * mm, 34 * mm, 34 * mm])
cap("Table 3. Validation tiers. Tier choice follows the standard's own rule: security proportional to value at risk [1].")
body(
    "Two limits are stated rather than smoothed over. First, zero-knowledge machine learning is "
    "not ready for arbitrary per-call verdicts: the current state of the art proves a full "
    "124M-parameter model end-to-end, production-grade systems proving large contemporary models "
    "do not exist, and recent surveys note that no fully verifiable end-to-end inference pipeline "
    "has been demonstrated [13]. The protocol therefore treats zkML as a future tier and routes "
    "high-stakes work through bonded re-execution and TEEs meanwhile. Second, hash-commit proves "
    "delivery, not correctness; correctness at machine speed is the validator network's role, "
    "whose incentive design the base standard explicitly leaves to higher layers [1] — see "
    "Section 9.")

# -------- 6
h1("6&nbsp;&nbsp;Sybil economics")
body(
    "Grounding converts reputation production from a signing problem into a budgeting problem. "
    "Let a producer want n additional five-star records. Pre-grounding, the cost is n gas "
    "transactions — measured in [2] to be negligible on the deployment chains. With this "
    "protocol, each record requires a settled payment from a funded address: cost at least n "
    "times (fee + spread + time-locked capital), plus, because the funding of buyer identities "
    "is observable on the settlement chain, exposure to the funding-graph clustering that the "
    "field measurement used to unmask exactly this population [2]. Verification, by contrast, "
    "stays cheap: hashing a chain of n receipts is O(n) hashing, and field-level payment checks "
    "are needed only for receipts whose content one actually relies on.")
body(
    "Two design consequences are stated for implementers. First, the economic defence degrades "
    "gracefully only if aggregation discounts ungrounded feedback to zero rather than to a "
    "fraction; a Sybil's ungrounded records must count for literally nothing, otherwise a large "
    "enough cluster re-enters through the discount. Second, circular payments (a cluster moving "
    "the same funds around a ring to mint grounding) still cost the full settling and financing "
    "overhead per rotation and produce a recognisable ring signature in the funding graph; the "
    "detector does not need to eliminate the strategy, only to keep its cost above the value of "
    "the reputation it mints — which is bounded, since a fraudulent rating's worth is capped by "
    "the margin of the fraud it enables.")

# -------- 7
h1("7&nbsp;&nbsp;Reference implementation")
body(
    "This paper ships with a working implementation in TypeScript (the evidence module of the "
    "ee.io repository), organised as four files: types.ts (schema of Table 2), keccakChain.ts "
    "(canonical encoding and chain construction, dependency-free), verify.ts (provider "
    "interface, payment and delivery cross-checks, chain audit with first-fault localisation), "
    "and erc8004.ts (emission with the Section 4.4 guard, robust aggregation of Section 4.5). "
    "Fifteen property tests exercise the documented failure modes — tampered verdicts, spliced "
    "chains, payment-legged mismatches (amount, settlement status, missing transactions), "
    "emission attempts without verified payment, out-of-domain scores, and the aggregation "
    "demonstration of Section 4.5. A runnable demo walks one buyer through three fulfilled tasks "
    "and prints the grounded feedback payload. Independent re-verification of any receipt "
    "requires only Section 4.2's canonical-encoding rule and Section 4.3's provider semantics; "
    "no trust in this repository's continued operation is needed.")
body(
    "Current limits are explicit: payment providers in the implementation are test doubles (the "
    "interface is the stable part; production providers are thin adapters over facilitator "
    "endpoints and chain RPC); receipts are self-chained but not yet anchored to periodic Merkle "
    "roots on a public chain; and the validator network for reexec-tier verdicts does not exist "
    "yet — its incentive design is the subject of Section 9.")

# -------- 8
h1("8&nbsp;&nbsp;Related work and positioning")
body(
    "<b>Payment rails.</b> x402 supplies the settlement leg this protocol binds to [3]; Unicity "
    "pushes settlement-side throughput and privacy further with a ledgerless, recipient-validated "
    "asset model aimed at the same agentic-economy scale [11]. Both are orthogonal layers: the "
    "receipt protocol assumes only that a settled payment is publicly readable somewhere.")
body(
    "<b>Identity and registries.</b> ERC-8004 is the substrate the evidence feeds [1, 7]; the "
    "empirical measurement of its deployed reputation surface [2] is the problem statement. "
    "ERC-8126, finalized in June 2026, standardizes pre-trade vetting — multi-layer checks whose "
    "output is a private risk score for the operator, optionally pushed into the validation "
    "registry [9]. Vetting answers 'should I engage this agent'; fulfilment receipts answer 'did "
    "the completed transaction deliver'. The two compose: a vetting score and a grounded "
    "fulfilment record are independent signals, and nothing in either standard conflicts.")
body(
    "<b>Assured job settlement.</b> The Moonbeam protocol (v1.0, September 2026) is the closest "
    "relative. It attaches assurance to ERC-8183 job lifecycles: the seller locks a deposit "
    "larger than the price, the buyer pays a record-derived premium, a judge recomputes verdicts "
    "from sealed evidence, arbitrators adjudicate on the same evidence, and coverage pools stand "
    "behind deposits [10]. It is deliberately restricted to jobs large enough to insure, and its "
    "worked example prices a batch of calls because per-call jobs fall below the verification "
    "cost floor [10]. Two distinctions matter here. Moonbeam treats registry feedback as an "
    "untrusted assertion; this protocol makes the assertion itself expensive and verifiable, so "
    "the registry surface the measurement found unusable [2] becomes usable — the two layers are "
    "complementary, and Moonbeam verdicts are natural verdict-leg issuers for fulfilment receipts. "
    "Second, escrow-deposit assurance requires ERC-8183-conforming job ledgers [10], while most "
    "x402 traffic today is per-call metering on general ledgers [3, 5]; receipts bind anywhere a "
    "settlement is readable, requiring no job-state machine, deposit, or pool.")
body(
    "<b>Vertical verification chains.</b> FLOP (Flop Labs) proposes a dedicated chain where agents "
    "pay miners for inference and validators settle proofs of completed computation, under its own "
    "token economics [12]. It verifies compute inside its own marketplace; receipts verify "
    "fulfilment of arbitrary HTTP services on the rails that already carry their payments.")
body(
    "<b>Web-data provenance.</b> DECO established that TLS-session data can be proven to third "
    "parties without server cooperation [14]; practical zkTLS notarization gives the delivery leg "
    "a stronger option than bare hashing when the artifact's provenance inside a web session "
    "matters. The protocol's delivery leg takes a method field precisely to admit this upgrade "
    "without schema change.")
gap(2)
table(
    [
        ["System", "Layer", "Secures", "Attacker's cost object", "New token", "Relation to this work"],
        ["x402 [3]", "payment", "value moved", "the payment itself", "no", "the payment leg"],
        ["ERC-8004 [1]", "identity, reputation", "records claims", "~ 0 (measured [2])", "no", "the substrate fed by receipts"],
        ["ERC-8126 [9]", "pre-trade vetting", "operator's risk view", "provider checks", "no", "complementary signal"],
        ["Moonbeam [10]", "job settlement", "escrowed jobs (D > P)", "deposit + bond", "yes (pools)", "complementary assurance; verdict issuer"],
        ["FLOP [12]", "compute market", "inference completion", "validator stake", "yes", "vertical; not a neutral layer"],
        ["Unicity [11]", "settlement", "double-spend privacy", "consensus stake", "yes", "orthogonal rail"],
        ["this work", "fulfilment evidence", "the rating itself", "settled payments", "no", "—"],
    ],
    [22 * mm, 30 * mm, 32 * mm, 34 * mm, 16 * mm, 30 * mm], align_center_cols=(4,))
cap("Table 4. Positioning. The only systems fixing the reputation surface directly are the fragments measured in [2]; "
    "no public payment-grounded evidence object currently feeds the canonical registry.")

# -------- 9
h1("9&nbsp;&nbsp;Open problems")
bul("<b>Validator economics.</b> Bonded re-execution — the tier that proves correctness, not just "
    "delivery — needs an incentive and slashing design; the base standard explicitly scopes this "
    "out [1]. A viable design must price verification below job value for the insurable slice "
    "(cf. Moonbeam's cost analysis [10]) while keeping collusive validator blocs more expensive "
    "than the fraud they could approve.")
bul("<b>Ring forensics at scale.</b> Funding-graph clustering unmasked the current Sybil "
    "population [2]; production-grade detection needs maintained heuristics and an ecosystem "
    "of independent indexers, not one scorekeeper. The receipt format deliberately carries "
    "sufficient fields for third-party detectors.")
bul("<b>Anchoring cadence.</b> Hash chains are self-consistent but unbounded; publishing "
    "periodic Merkle roots of receipt sets to a settlement chain converts A2's selective-history "
    "attack from 'detectable by audit' to 'detectable by anyone'. Cadence and cost trade-offs are "
    "open.")
bul("<b>Dual-rail payments.</b> Card-network-style mandates (AP2) and x402 settlements co-exist; "
    "whether one evidence schema can span both without a lowest-common-denominator collapse is an "
    "open schema-design question.")
bul("<b>Registry interplay.</b> The validation registry's mainnet deployment was pending at the "
    "time of the field measurement [2, 7]; once live, verdict legs can reference requestHashes "
    "directly, and emission policy should track the registry's final interface.")

# -------- 10
h1("10&nbsp;&nbsp;Conclusion")
body(
    "The agentic economy's plumbing was built in the right order: first payments, then identity. "
    "The measurement record shows the consequence of leaving the third piece — evidence — unbuilt: "
    "a reputation surface dominated by coordinated forgery at negligible cost [2]. A receipt that "
    "binds settlement, delivery, and verdict, and that refuses to speak on behalf of transactions "
    "that never happened, converts agent reputation from a free assertion into a priced signal. "
    "Nothing here requires inventing new rails, new registries, or new tokens; it requires wiring "
    "evidence into the extension surfaces the standing standards already provide [1, 3, 10]. "
    "If the diagnosis in [2] is right — and its measurement methods are public — then the repair "
    "is of the kind this paper describes: enforceable provenance for every claim of fulfilment, "
    "and arithmetic that forgery cannot move.")

# -------- references
story.append(PageBreak())
h1("References")
for i, r in enumerate([
    "De Rossi, M., Crapis, D., Ellis, J., Reppel, E. ERC-8004: Trustless Agents (Draft, Standards Track), "
    "created 13 Aug 2025. https://eips.ethereum.org/EIPS/eip-8004",
    "'Can Trustless Agents Be Trusted? An Empirical Study of the ERC-8004 Decentralized AI Agent "
    "Ecosystem', arXiv:2606.26028, 2026 (public review at pith.science/paper/2606.26028).",
    "Coinbase Developer Platform / x402 Foundation. x402: A payments protocol for the internet "
    "(specification, SDKs, facilitator interface), 2025-2026. https://github.com/x402-foundation/x402",
    "InfoQ. 'Cloudflare and AWS Embed x402 Agent Payments at the Edge', 6 Jul 2026. "
    "https://www.infoq.com/news/2026/07/cloudflare-aws-x402-micropayment/",
    "Khala Research. 'x402: Unlocking the Internet's Missing Payment Layer', March 2026 "
    "(cumulative volume, facilitator shares, memecoin wash estimate).",
    "a16z crypto. State of Crypto 2025, October 2025 (stablecoin volumes, throughput, "
    "infrastructure-to-application shift).",
    "8004.org. 'Welcome to ERC-8004 and the open agentic economy', January 2026 (testnet metrics, "
    "audit status, validation-registry rollout). https://www.8004.org/blog/welcome-to-8004",
    "Decipher Club. 'So, what exactly are Trustless Agents up to?', 17 Jun 2026 (registration pace, "
    "activity-measurement gap). https://www.decipherclub.com/so-what-exactly-are-trustless-agents-up-to/",
    "Cronian, L., Johnson, C. ERC-8126: AI Agent Verification (Final, June 2026). "
    "https://eips.ethereum.org/EIPS/eip-8126",
    "Moonbeam Foundation. Moonbeam Protocol: A Commerce Layer for Software Agents, v1.0, "
    "September 2026. https://www.moonbeam.network/moonbeam-protocol-whitepaper-v1.0.pdf",
    "The Unicity Developers. Unicity: Settlement Infrastructure for the Agentic Economy, 2026. "
    "https://github.com/unicitynetwork/whitepaper",
    "Flop Labs / A. Hayes. FLOP: Proof-of-Useful-Inference network (whitepaper), 7 Sept 2026 "
    "(protocol parameters via public reporting).",
    "Zylos.ai research. 'Zero-Knowledge Proofs for AI Agent Verification and Privacy', 18 Mar 2026 "
    "(state of zkML, DeepProve-1, absence of fully verifiable pipelines).",
    "Zhang, F., Maram, S.K.D., Malvai, H., Goldfeder, S., Juels, A. 'DECO: Liberating Web Data "
    "Using Decentralized Oracles for TLS', CCS 2020. arXiv:1909.00938.",
    "'The Agent Economy: A Blockchain-Based Foundation for Autonomous AI Agents', arXiv:2602.14219, "
    "Feb 2026 (the 'oracle problem 2.0' framing).",
    "eco.com. 'What is ERC-8004? The Ethereum Standard Enabling Trustless AI Agents', Sept 2026 "
    "(v2 working track: standardised x402 payment-proof schemas inside feedback attestations).",
    "Bitcoin.com News. 'What Is ERC-8004? Ethereum's New Agent Standard Powers Thousands of "
    "Onchain AI Identities', 14 Feb 2026 (8004scan registration counts).",
    "Everstake research. 'ERC-8004 Explained: Building a Unified Framework for Data Verification', "
    "10 Jul 2026 (validator-sector interest in agent validation).",
], start=1):
    ref(i, r)


# ---------------------------------------------------------------- build
def build():
    doc = WPDoc(OUT, pagesize=A4, leftMargin=22 * mm, rightMargin=22 * mm,
                topMargin=22 * mm, bottomMargin=20 * mm,
                title=TITLE, author="ee.io Research", subject=SUBTITLE)
    fr_first = Frame(22 * mm, 20 * mm, A4[0] - 44 * mm, A4[1] - 40 * mm, id="f1")
    fr_later = Frame(22 * mm, 20 * mm, A4[0] - 44 * mm, A4[1] - 42 * mm, id="f2")
    doc.addPageTemplates([
        PageTemplate(id="First", frames=[fr_first], onPage=on_first),
        PageTemplate(id="Later", frames=[fr_later], onPage=on_later),
    ])
    doc.multiBuild([f for f in story])
    print("wrote", OUT)
    from pypdf import PdfReader
    print("pages:", len(PdfReader(OUT).pages))


if __name__ == "__main__":
    build()
