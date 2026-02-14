# OpenSidebar Business Plan

## Executive Summary

**OpenSidebar** is an AI-powered Chrome extension that provides autonomous browser automation. The business model consists of two versions:

| Version         | Target                | Price     | Revenue Model             |
| --------------- | --------------------- | --------- | ------------------------- |
| **Open Source** | Developers, hobbyists | Free      | BYOK + local storage      |
| **Paid**        | Non-technical users   | $12.99/mo | Full-service subscription |

**Strategy:** Launch open source first to build community → Add managed service as revenue stream.

---

## Product Overview

OpenSidebar is a Chrome Extension (Manifest V3) that provides an AI agent capable of autonomous web browsing. The agent can see web pages via DOM snapshots, click elements, type text, navigate, scroll, and perform 30+ browser automation tasks.

### Core Features

- **Agentic Web Browsing** — AI agent interacts with web pages autonomously
- **Real-time Streaming** — LLM responses stream live to the side panel
- **Memory System** — "Second Brain" stores memories with hybrid search (semantic + keyword)
- **Vision Model** — Analyzes screenshots when text-based tools fail
- **Workspace Management** — Auto-manages Chrome Tab Groups
- **Session Metrics** — Tracks token usage and costs per session

### Current Architecture

```
Chrome Extension (MV3)
├── Side Panel (React + Zustand)
├── Service Worker (Agent Loop)
├── Content Script (DOM Actions)
└── Offscreen Document (Memory: SQLite + Transformers.js)
```

---

## Market Analysis

### Market Context

The AI browser agent space grew from a handful of research projects to a crowded market in 12 months. The global AI browser market was valued at $2.1B in 2024 and is projected to grow at 27.7% CAGR through 2032. Browser agents are now a flagship product category for the biggest AI companies in the world.

This means OpenSidebar cannot compete on general brand awareness or funding. It must compete on **architecture** (in-browser vs. cloud VM), **speed** (multi-provider failover), and **privacy** (local-first data).

### Target Market

1. **Technical Users (Open Source)**
   - Developers who want to customize their AI browsing experience
   - Privacy enthusiasts who prefer local storage and BYOK
   - Hobbyists and researchers experimenting with AI agents
   - Users frustrated by Operator's $200/mo price or Cowork's limited availability

2. **Power Users (Paid)**
   - Professionals who want zero-setup AI browsing on their own logged-in sessions
   - Small business owners automating repetitive web workflows (CRM, invoicing, research)
   - Users who need cross-device memory sync and priority support

### Competitive Landscape

#### Tier 1: Big Tech (unlimited resources, massive distribution)

| Competitor | Price | Approach | Strengths | Weaknesses |
|---|---|---|---|---|
| **OpenAI Operator** | $200/mo (Pro) | Cloud-hosted browser VM | Brand trust, best distribution, strong reasoning | Expensive, can't access user's logged-in sessions, cloud-only |
| **Anthropic Cowork** | $20/mo (Pro) | Desktop agent + Chrome extension | Best reasoning model (Claude), Cowork on Win+Mac | Requires desktop app, not a pure browser extension, limited browser control |
| **Google Gemini + Project Mariner** | Free (bundled) | Native Chrome integration | Owns Chrome, can integrate at browser level | Not yet fully shipped, Google kills products |

**Implication:** These set the ceiling for user expectations but all use cloud-side or desktop-side execution. None run *inside* the user's browser with full session context.

#### Tier 2: VC-Funded Startups (well-resourced, specific niches)

| Competitor | Funding | Approach | Strengths | Weaknesses |
|---|---|---|---|---|
| **MultiOn** | VC-funded | API-based autonomous agent | Enterprise focus, transactional tasks | API-only, no end-user product, cloud execution |
| **Browserbase / Stagehand** | VC-funded | Cloud browser infra + open-source SDK | Developer tooling, headless browsers | Infrastructure layer, not end-user facing |
| **Dia Browser** | Acquired ($610M by Atlassian) | AI-native browser | Full browser replacement, enterprise backing | Replaces Chrome entirely, enterprise-only trajectory |

**Implication:** These target enterprises and developers building agents, not end users who want a Chrome extension. Different market segment, but validates the space.

#### Tier 3: Open Source (direct competitors, same positioning)

| Competitor | GitHub Stars | Approach | Strengths | Weaknesses |
|---|---|---|---|---|
| **Browser-Use** | 60K+ | Python library for browser automation | Massive community, strong benchmarks (beats Operator on WebVoyager) | Requires Python, headless browser, not a Chrome extension |
| **Nanobrowser** | Growing | Chrome extension, multi-agent, BYOK | Nearly identical concept to OpenSidebar | No memory system, no multi-provider failover, no eval pipeline, less mature |
| **Steel Browser** | Active | Open-source browser API sandbox | Batteries-included infra | Infrastructure layer, not end-user product |
| **A5 Browser-Use** | Active | Chrome extension wrapping Browser-Use | Bridges Python ecosystem to Chrome | Thin wrapper, limited native tooling |

**Implication:** Nanobrowser is the closest direct competitor. Browser-Use has the largest community but is a Python library, not a Chrome extension. OpenSidebar's engineering depth (31 tools, memory, vision, eval pipeline, multi-provider failover) is a genuine moat over these.

### Why OpenSidebar Wins: Architectural Advantages

Most competitors use one of two approaches, both with fundamental limitations:

| Approach | Used by | Limitation |
|---|---|---|
| **Cloud VM** (remote browser) | Operator, MultiOn, Browserbase | Cannot access user's logged-in sessions, cookies, or extensions. Every task starts from scratch. |
| **Desktop agent** (screenshot + click) | Cowork, Computer Use | Pixel-based — slow, fragile, resolution-dependent. Cannot read DOM structure. |

**OpenSidebar uses a third approach: in-browser DOM agent.** It runs as a Chrome extension *inside* the user's actual browser. This means:

1. **Full session context** — The agent operates on the user's logged-in pages (Gmail, CRM, banking, internal tools). No re-authentication needed.
2. **DOM-level precision** — Reads structured HTML elements, not screenshots. Faster, cheaper, more reliable than pixel-based agents.
3. **Zero infrastructure** — No cloud VM, no Python, no Docker. Install the extension and go.
4. **Works with existing extensions** — Password managers, ad blockers, corporate VPNs all work normally.
5. **Speed** — Multi-provider failover (Cerebras 3000 TPS → Groq → OpenRouter) delivers sub-second responses vs. Operator's multi-second cloud VM round trips.

---

## Strategy to Win

### The Core Bet

OpenSidebar bets that the winning browser agent will be **inside the browser, not outside it**. Cloud VMs can't access your logged-in sessions. Desktop screenshot agents are slow and fragile. The Chrome extension model is the right architecture — the market just hasn't fully recognized it yet.

### Three-Phase Strategy

#### Phase A: Win the Open Source Comparison (Months 1-3)

**Goal:** Become the obvious choice when someone searches "open source browser agent Chrome extension."

The direct competitor is Nanobrowser. To win this comparison:

| Dimension | Nanobrowser | OpenSidebar | Action needed |
|---|---|---|---|
| Memory system | None | Hybrid search (semantic + keyword) | Already ahead — promote it |
| Provider failover | Single provider | Cerebras → Groq → OpenRouter | Already ahead — promote it |
| Tool count | ~15 | 31 | Already ahead — promote it |
| Eval pipeline | None | Trace-based evals | Already ahead — promote it |
| Documentation | Basic | Needs work | Write great docs + video demos |
| Community | Small | None yet | Launch Discord, respond fast to issues |

**Key insight:** Don't compete with Browser-Use (Python, 60K stars). Compete with Nanobrowser and position as "Browser-Use but native to Chrome, no Python required."

Content strategy:
- "OpenSidebar vs Nanobrowser" comparison page
- "Why in-browser agents beat cloud VMs" blog post
- Video: "Automate your logged-in Gmail/CRM in 60 seconds" (something Operator literally cannot do)
- Benchmark against Operator on speed and cost per task

#### Phase B: Find the Wedge Use Case (Months 3-6)

**Goal:** Identify 1-2 specific workflows where OpenSidebar is 10x better than alternatives, and double down.

General-purpose "do anything on the web" agents are a commodity. The winners will own specific workflows. Candidates:

| Wedge candidate | Why OpenSidebar wins | Target user |
|---|---|---|
| **CRM data entry** | Runs on user's logged-in Salesforce/HubSpot. No API integration needed. | SDRs, sales ops |
| **Research + memory** | Agent browses, collects facts, stores in local memory, recalls later. No other extension has hybrid search memory. | Analysts, journalists, academics |
| **Internal tool automation** | Works behind corporate VPNs and SSO — cloud agents can't reach these. | Enterprise employees |
| **Form filling across sites** | Agent remembers context from site A and applies it on site B. | Insurance agents, recruiters, accountants |

**How to find the wedge:** After open source launch, monitor which use cases users actually succeed at (via traces + evals). Double down on the top 2-3 with dedicated prompt engineering, custom tools, and marketing.

#### Phase C: Monetize the Wedge (Months 6-12)

**Goal:** Convert wedge use case users into paid subscribers with features they can't get for free.

**The upgrade trigger must be a capability, not just convenience.** "No API key setup" alone won't convert developers. Paid-only features should include:

| Paid feature | Why it drives conversion | Effort |
|---|---|---|
| **Scheduled automations** | "Check this page every morning and email me changes." Requires a backend. | High |
| **Cross-device memory sync** | Research on laptop, recall on desktop. Requires cloud storage. | Medium |
| **Higher turn limits** | Free: 15 turns/task. Paid: 50+. Power users hit the wall fast. | Low |
| **Team workspaces** | Shared memory + shared automations for small teams. | High |
| **Priority model routing** | Paid users get faster models, free users get queued during peak. | Low |

### Positioning Statement

> **For professionals who automate web workflows**, OpenSidebar is the **open-source Chrome extension** that gives you an AI agent running **inside your actual browser** — with access to your logged-in sessions, local memory, and zero cloud dependencies. Unlike Operator ($200/mo, cloud VM) or Cowork (desktop app), OpenSidebar works where you already work: your Chrome tabs.

### What Not to Do

1. **Don't try to out-feature the Big 3.** They have unlimited engineering. Compete on architecture (in-browser), not feature count.
2. **Don't build enterprise sales early.** Solo founder can't do enterprise sales cycles. Focus on self-serve individuals and small teams.
3. **Don't spread across verticals.** Find one wedge use case and dominate it before expanding.
4. **Don't compete with Browser-Use.** Different audiences (Python developers vs. Chrome users). Reference it positively ("inspired by") rather than positioning against it.

---

## Technical Specification

### Current Implementation

#### Models Used

| Model Tier | Provider | Model ID | Speed | Use Case |
|---|---|---|---|---|
| **Fast (primary)** | Cerebras | `gpt-oss-120b` | ~3000 TPS | Default — fastest provider |
| **Fast (fallback 1)** | Groq | `openai/gpt-oss-120b` | ~250K TPM | Automatic failover on 429 |
| **Fast (fallback 2)** | OpenRouter | `openai/gpt-oss-120b` | Variable | Always-available fallback |
| **Smart** | OpenRouter | `minimax/minimax-m2.5` | Moderate | Complex reasoning (escalation) |
| **Vision** | OpenRouter | `qwen/qwen3-vl-235b-a22b-instruct` | Moderate | Screenshot analysis (GUI grounding, OCR) |
| **Audio** | Groq | `whisper-large-v3-turbo` | Very High | Speech-to-text & Video transcription |

Priority-based failover: Cerebras → Groq → OpenRouter. Automatic 60s cooldown on 429 rate limits with zero-delay fallback to next provider.

#### User Settings

```typescript
interface UserSettings {
  openRouterApiKey: string; // User provides
  groqApiKey: string; // User provides (optional)
  useGroqFast: boolean; // Toggle Groq vs OpenRouter
  maxTurns: number; // Default: 30
  contextWindowSize: number; // Default: 128000 tokens
  memoryEnabled: boolean; // Default: true
  workspaceEnabled: boolean; // Default: true
  theme: "light" | "dark" | "system";
  showElementTags: boolean; // Debug overlay
  visionModel: string; // Default: qwen/qwen3-vl-235b-a22b-instruct
  confirmPlan: boolean; // Require user confirmation
  showSessionMetrics: boolean; // Show token/cost metrics
}
```

#### Memory System (Local)

| Component      | Technology                                |
| -------------- | ----------------------------------------- |
| Vector Store   | Transformers.js (Xenova/all-MiniLM-L6-v2) |
| Keyword Search | SQLite FTS5 (in-browser)                  |
| Fusion         | Reciprocal Rank Fusion (RRF)              |
| Storage        | IndexedDB via offscreen document          |

---

## Business Model

### Version Comparison

| Feature            | Open Source               | Paid          |
| ------------------ | ------------------------- | ------------- |
| **Price**          | Free                      | $12.99/month  |
| **API Keys**       | User provides (BYOK)      | Included      |
| **Memory Storage** | Local (browser)           | Cloud-hosted  |
| **Vision Model**   | User configures           | Included      |
| **Hosting**        | Self-host (`bun run dev`) | Your VPS      |
| **Setup**          | User configures keys      | Just login    |
| **Support**        | GitHub issues             | Email support |
| **Source Code**    | Full access               | N/A           |

### Pricing Strategy

#### Open Source (Free)

- Free forever
- User provides their own OpenRouter API key
- Local memory storage in browser
- Community support via GitHub

#### Paid Subscription ($12.99/month)

- All API keys included
- Cloud-hosted memory (syncs across devices)
- Priority support
- No setup required

---

## Cost Analysis

### Per-User Costs (Paid Version)

#### API Usage Assumptions

- 10 sessions/day × 30 days = 300 sessions/month
- 5% escalation rate to smart model
- 20% screenshot usage

#### OpenRouter Costs

| Model                      | Price (Input) | Price (Output) | Est. Tokens/Month | Cost/Month |
| -------------------------- | ------------- | -------------- | ----------------- | ---------- |
| GPT-OSS-120B (OpenRouter)  | $0.15/1M      | $0.60/1M       | 1.5M              | $0.45      |
| MiniMax M2.5               | $0.40/1M      | $4.00/1M       | 0.1M              | $0.32      |
| Vision (Qwen3 VL 235B)     | $0.14/1M      | $0.14/1M       | 0.6M              | $0.08      |
| **Total LLM**              |               |                |                   | **~$0.85** |

#### Infrastructure Costs

| Component                     | Cost/Month |
| ----------------------------- | ---------- |
| Cloud Memory (vector DB)      | $1-2       |
| VPS amortization (1/50 users) | $1-2       |
| Stripe fees (2.9% + $0.30)    | $0.68      |
| **Total**                     | **~$4-6**  |

### Margin Analysis

| Item             | Amount             |
| ---------------- | ------------------ |
| Revenue          | $12.99             |
| Costs            | ~$5                |
| **Gross Margin** | **~$8/user (60%)** |

### Projections

| Users | Monthly Revenue | Monthly Profit |
| ----- | --------------- | -------------- |
| 25    | $325            | $125           |
| 50    | $650            | $350           |
| 100   | $1,299          | $800           |
| 200   | $2,598          | $1,700         |

---

## Infrastructure

### Phase 1: MVP ($50-75/month)

| Service        | Spec                                 | Cost     |
| -------------- | ------------------------------------ | -------- |
| **VPS**        | DigitalOcean Droplet (2CPU, 4GB RAM) | $24/mo   |
| **PostgreSQL** | On same VPS                          | included |
| **Redis**      | Same VPS or managed                  | $0-10/mo |
| **Domain/SSL** | Cloudflare (free) + Let's Encrypt    | $0       |
| **Backup**     | Nightly snapshots                    | $5/mo    |

### Phase 2: Scale (200+ users)

| Service                | Spec                | Cost   |
| ---------------------- | ------------------- | ------ |
| **VPS**                | 4CPU, 8GB RAM       | $48/mo |
| **Managed PostgreSQL** | Neon or Supabase    | $25/mo |
| **Redis**              | Upstash             | $10/mo |
| **Object Storage**     | R2 or S3 (memories) | $5/mo  |

---

## Technical Roadmap

### Phase 1: Open Source Launch (Month 1)

- [ ] Add MIT license to repository
- [ ] Write comprehensive README with setup instructions
- [ ] Clean up codebase and remove debug code
- [ ] Publish to Chrome Web Store
- [ ] Create GitHub repository
- [ ] **Promotion:**
  - Twitter/X announcement
  - Hacker News post
  - Reddit (r/ChromeExtensions, r/artificial)
  - Product Hunt launch

### Phase 2: Community Building (Months 2-3)

- [ ] Gather user feedback
- [ ] Fix bugs and improve UX
- [ ] Build Discord community
- [ ] Add documentation website
- [ ] Create video tutorials
- [ ] Add more tools based on feedback

### Phase 3: Paid Version Development (Month 4)

**Backend API Server:**

```
server/
├── src/
│   ├── index.ts           # Express/Fastify entry
│   ├── auth.ts            # JWT authentication
│   ├── llm-proxy.ts       # Proxy OpenRouter with rate limiting
│   ├── memory.ts          # Cloud vector store
│   ├── stripe.ts          # Subscription billing
│   └── db/
│       └── schema.ts      # Prisma/Drizzle schema
├── prisma/
│   └── schema.prisma      # User + usage models
└── package.json
```

**Database Schema:**

```prisma
model User {
  id              String    @id @default(cuid())
  email           String    @unique
  passwordHash    String
  stripeCustomerId String?
  subscription    String    @default("free")
  usageThisMonth  Int       @default(0)
  monthlyLimit    Int       @default(300)
  lastReset       DateTime  @default(now())
  memories        Memory[]
  createdAt       DateTime  @default(now())
}

model Memory {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  content   String
  category  String
  sourceUrl String?
  embedding Float[]
  createdAt DateTime @default(now())
}

model UsageLog {
  id        String   @id @default(cuid())
  userId    String
  model     String
  tokens    Int
  cost      Float
  createdAt DateTime @default(now())
}
```

**Extension Changes:**

| Component     | Changes                   |
| ------------- | ------------------------- |
| Settings      | Add login/subscription UI |
| LLM Client    | Add server proxy mode     |
| Memory Bridge | Add cloud sync option     |
| Auth          | JWT token management      |

### Phase 4: Launch Paid Version (Month 5)

- [ ] Deploy backend to production VPS
- [ ] Set up Stripe subscriptions
- [ ] Launch paid version to existing users
- [ ] Marketing for paid version
- [ ] Monitor usage and adjust limits

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Google ships native browser agent in Chrome** | Medium | Critical | Focus on power-user features Google won't build (memory, multi-provider, BYOK). Worst case: pivot to Firefox/Edge. |
| **LLM API costs exceed revenue (heavy users)** | High | High | Token-based usage tiers, hard caps, auto-fallback to BYOK mode when limit exceeded. |
| **Nanobrowser or similar OSS catches up** | Medium | High | Move fast on wedge use cases. Engineering depth (evals, traces, memory) is hard to replicate quickly. |
| **Too few paid conversions (free is too good)** | High | High | Gate specific capabilities (scheduled tasks, higher turn limits, team features), not just convenience. |
| **Chrome Web Store rejection** | Low | High | Follow MV3 policies strictly. No eval() in content scripts. Declare permissions minimally. |
| **API provider price changes** | Low | High | Multi-provider architecture already built. Can swap models without user-facing changes. |
| **Solo founder burnout** | High | High | Automate support with docs/Discord bots. Limit scope. Don't chase enterprise early. |

### Mitigation Strategies

1. **Cost Control:**
   - Token-based limits (not session-based — a "session" is ambiguous)
   - Free tier: 15 turns/task. Paid tiers: 50+ turns/task.
   - Auto-fallback to BYOK mode when paid quota exhausted (graceful degradation)
   - Monitor per-user costs weekly; flag outliers

2. **Competition:**
   - Win the "Chrome extension browser agent" niche, not the general "AI agent" market
   - Produce comparison content (vs. Nanobrowser, vs. Operator) for SEO
   - Ship faster than competitors on wedge use cases identified from user traces
   - Maintain engineering moat: eval pipeline, trace recording, multi-provider failover

3. **Platform Risk (Google):**
   - If Google ships a native agent, OpenSidebar still wins on: BYOK (cost control), local memory (privacy), open source (customization), multi-provider (speed)
   - Worst case: port to Firefox/Edge (MV3 is cross-browser)

---

## Key Performance Indicators

### Metrics to Track

| Metric                    | Target (3 months) | Target (6 months) |
| ------------------------- | ----------------- | ----------------- |
| GitHub Stars              | 100               | 500               |
| Chrome Web Store Users    | 250               | 1,000             |
| Discord Members           | 50                | 200               |
| GitHub Issues/Week        | 10                | 5                 |
| **Paid Subscribers**      | **25**            | **50**            |
| Monthly Recurring Revenue | $325              | $650              |

### Conversion Funnel

```
Discovers OpenSidebar (GitHub, HN, Product Hunt, search)
    ↓ (15%) — installs from Chrome Web Store
Active user (uses it at least 3x/week)
    ↓ (30%) — hits a limitation (turn limit, no sync, wants scheduling)
Creates account / starts free trial
    ↓ (20%) — experiences paid-only value
Converts to paid subscriber
```

**End-to-end conversion: ~1% of discovery → paid.** This means reaching 200 paid users requires ~20,000 people to discover OpenSidebar. Achievable with a successful HN/Product Hunt launch + ongoing SEO content.

**Churn assumption:** 8-10% monthly for paid users. Financial projections should account for this.

---

## Competitive Advantages

### Architectural Moat (vs. all competitors)

1. **In-browser execution** — Runs inside the user's actual Chrome session. Full access to logged-in state, cookies, extensions, and corporate VPNs. Cloud VM agents (Operator, MultiOn) cannot do this.
2. **DOM-level precision** — Reads structured HTML, not pixels. Faster, cheaper, and more reliable than screenshot-based agents (Cowork, Computer Use).
3. **Multi-provider speed** — Cerebras (3000 TPS) → Groq → OpenRouter failover. Sub-second responses vs. multi-second cloud VM round trips.
4. **Local-first memory** — Hybrid search (semantic + keyword) with zero cloud dependency. No other Chrome extension agent has this.

### Open Source (vs. Nanobrowser, A5, etc.)

1. **Engineering depth** — 31 tools, eval pipeline, trace recording, multi-provider failover, vision bridge. Most OSS competitors have 10-15 tools and no eval system.
2. **Privacy** — All data stays in the browser. No telemetry, no cloud calls beyond the LLM API.
3. **Full source code** — MIT license, fork-friendly, extensible tool system.
4. **Community-driven roadmap** — Public development, responsive to feedback.

### Paid Version (vs. Operator, Cowork)

1. **10-20x cheaper** — $12.99/mo vs. Operator's $200/mo (ChatGPT Pro) or Cowork's $20/mo.
2. **Works on logged-in sessions** — Operator runs in a sandboxed VM. OpenSidebar runs on your actual Gmail, CRM, banking pages.
3. **Zero setup** — Install, login, go. No API keys, no Python, no Docker.
4. **Cross-device memory sync** — Research on one machine, recall on another.
5. **Scheduled automations** (planned) — "Check this page daily and notify me" — requires a backend, justifies the subscription.

---

## Team & Operations

### Founder Responsibilities

| Task          | Time |
| ------------- | ---- |
| Development   | 50%  |
| Support       | 20%  |
| Marketing     | 20%  |
| Admin/Billing | 10%  |

### Scalability Plan

| Users   | Staff              | Infrastructure   |
| ------- | ------------------ | ---------------- |
| 0-50    | Founder            | Single VPS       |
| 50-200  | Founder            | Upgraded VPS     |
| 200-500 | +Part-time support | Dedicated server |
| 500+    | +Developer         | Multi-server     |

---

## Financial Projections

### Year 1 Projection

| Month | Users (OS) | Paid Users | Revenue | Costs | Profit |
| ----- | ---------- | ---------- | ------- | ----- | ------ |
| 1     | 50         | 0          | $0      | $50   | -$50   |
| 2     | 150        | 0          | $0      | $50   | -$50   |
| 3     | 300        | 5          | $65     | $60   | $5     |
| 4     | 500        | 10         | $130    | $75   | $55    |
| 5     | 750        | 20         | $260    | $100  | $160   |
| 6     | 1,000      | 35         | $455    | $125  | $330   |
| 7     | 1,200      | 50         | $650    | $150  | $500   |
| 8     | 1,400      | 70         | $910    | $175  | $735   |
| 9     | 1,600      | 100        | $1,299  | $200  | $1,099 |
| 10    | 1,800      | 130        | $1,689  | $225  | $1,464 |
| 11    | 2,000      | 160        | $2,078  | $250  | $1,828 |
| 12    | 2,200      | 200        | $2,598  | $300  | $2,298 |

### Break-even Point

- **Month 3** — First profit
- **Break-even users** — ~20-25 paid users

---

## Long-Term Vision

At 1,000+ active users, new opportunities open up:

1. **API access** — Let developers build on OpenSidebar's tool execution engine (headless mode, no UI). Competing with Browserbase but running in real browsers, not cloud VMs.
2. **Marketplace** — User-created automation templates ("one-click CRM sync", "daily competitor price check"). Revenue share model.
3. **Enterprise tier** — Team workspaces, shared memory, admin controls, SSO. $49/seat/mo.
4. **Acquisition target** — Atlassian paid $610M for Dia. A browser agent extension with proven user base and open-source community has strategic value to browser companies (Brave, Vivaldi) or AI companies needing browser distribution.

---

## Conclusion

OpenSidebar has a clear path to profitability:

1. **Open source builds credibility** — Proves the product works
2. **Community provides feedback** — Improves the product
3. **Paid version monetizes** — Converts users to subscribers
4. **Low infrastructure costs** — Start small, scale as needed

The business model is sustainable with as few as 25-50 paid users covering infrastructure costs, with significant upside at scale.

---

## Appendix: File Structure

```
opensidebar/
├── src/
│   ├── background/           # Service worker
│   │   ├── agent/           # Agent loop
│   │   ├── llm/             # LLM client
│   │   ├── tools/           # Tool registry
│   │   └── memory/          # Memory bridge
│   ├── content/              # Content script
│   ├── sidepanel/           # React UI
│   ├── offscreen/           # Memory worker
│   └── types/               # TypeScript types
├── server/                   # Backend (Phase 3)
├── docs/                     # Documentation
└── tests/                   # Test suite
```

---

## Appendix: API Reference

### LLM Providers & Models

| Provider | Model | Context | Input | Output |
|---|---|---|---|---|
| Cerebras | gpt-oss-120b | 128K | Free (rate-limited) | Free (rate-limited) |
| Groq | openai/gpt-oss-120b | 128K | Free (rate-limited) | Free (rate-limited) |
| OpenRouter | openai/gpt-oss-120b | 128K | $0.15/1M | $0.60/1M |
| OpenRouter | minimax/minimax-m2.5 | 1M | $0.40/1M | $4.00/1M |
| OpenRouter | qwen/qwen3-vl-235b-a22b-instruct | 128K | $0.14/1M | $0.14/1M |
| Groq | whisper-large-v3-turbo | N/A | $0.003/min | N/A |

### Chrome Extension APIs Used

- `chrome.tabs` — Tab management
- `chrome.webNavigation` — Navigation tracking
- `chrome.tabGroups` — Workspace management
- `chrome.storage` — Data persistence
- `chrome.runtime` — Message passing
- `chrome.scripting` — JavaScript execution
