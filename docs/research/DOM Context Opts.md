Optimizing DOM Context Representation in LLM-Based Browser Automation Agents: A Comprehensive Analysis of State-of-the-Art Techniques
1. Introduction: The Context Econophysics of Autonomous Web Agents
The transition from imperative, selector-based web automation to autonomous, Large Language Model (LLM)-driven agency represents a fundamental paradigm shift in software engineering. Traditional frameworks like Selenium or Cypress required developers to hard-code explicit pathways through a Document Object Model (DOM), a method that was inherently brittle and intolerant of minor UI updates. In contrast, the emerging generation of "Generalist Web Agents"—exemplified by architectures such as AgentOccam, Stagehand, and Browser-Use—operates on a probabilistic understanding of user intent, dynamically interpreting the state of a web page to execute natural language directives.
However, this flexibility introduces a severe computational and economic bottleneck: the context window. While modern foundation models like Gemini 1.5 Pro or GPT-4o boast context windows exceeding one million tokens, the practical and economic utility of these windows for real-time web agents is constrained by latency and the "lost-in-the-middle" phenomenon. A raw, unoptimized DOM tree for a modern Single Page Application (SPA) can easily exceed 50,000 tokens. When an agent is tasked with a multi-step workflow—such as navigating an e-commerce site, filtering products, and completing a checkout—the accumulation of these verbose state representations rapidly saturates the context budget. This saturation leads to "context rot," where the agent's ability to reason about the current state degrades as the noise of previous states accumulates.1
Consequently, the primary engineering challenge in building production-grade web agents has shifted from model training to Observation Space Engineering. This discipline focuses on maximizing the Signal-to-Noise Ratio (SNR) of the data fed into the model. It treats the context window not as a bin to be filled, but as a scarce economic resource where every token must justify its existence through semantic utility. This report provides an exhaustive technical analysis of the state-of-the-art techniques for optimizing DOM context representation, synthesizing findings from recent benchmarks including WebArena, Mind2Web, and Online-Mind2Web, and analyzing the architectural patterns of leading open-source frameworks.
1.1 The Token-Utility Curve and Signal Degradation
The relationship between context length and agent performance is non-linear. Empirical studies on the "Lost in the Middle" phenomenon demonstrate that LLMs exhibit a U-shaped attention curve, effectively utilizing information at the beginning (system prompts) and end (current user query) of the input sequence, while information buried in the middle suffers from significant attention atrophy.1 In the context of browser automation, the "middle" is invariably occupied by the DOM observation.
If a raw HTML snapshot is injected into the context without pruning, critical navigational cues—such as a specific data-testid on a checkout button or a subtle error message inside a span—are liable to be overlooked. This is not a failure of the model's reasoning capability, but a failure of the retrieval mechanism within the attention layers. Research from the Mind2Web benchmark indicates that increasing the observation space beyond a certain density does not linearly improve success rates; rather, it often introduces "hallucination triggers" where the model conflates structurally similar but functionally distinct elements (e.g., confusing a "Login" button in the header with a "Sign Up" button in the footer).4
Therefore, the state-of-the-art approach has moved decisively away from raw HTML ingestion toward semantic distillation. The goal is to transform the DOM—a rendering tree designed for browser engines—into a semantic tree designed for inference engines.
2. The DOM Context Crisis: Anatomy of the Problem
To understand the necessity of optimization, one must first analyze the hostile nature of the modern DOM regarding LLM processing.
2.1 The "Div Soup" of Modern Frameworks
Modern web development practices, particularly the widespread adoption of Client-Side Rendering (CSR) frameworks like React, Vue, and Angular, have exacerbated the context problem. These frameworks often generate deeply nested structures to manage component lifecycles and styling. A simple interactive element, such as a dropdown menu, may be wrapped in a dozen layers of div and span tags used solely for Flexbox positioning or CSS Grid alignment.
For a browser engine, these wrappers are computationally cheap. For an LLM, they are semantically null but token-expensive. A standard React-based e-commerce product page can contain over 3,000 DOM nodes. Analysis of the Mind2Web dataset reveals that on average, fewer than 10% of these nodes are interactive or contain text relevant to the user's task.6 The remaining 90% constitute "structural noise."
Furthermore, automated CSS modules and utility-first frameworks (like Tailwind) often produce class names that are non-semantic strings of hashes (e.g., class="css-1q2w3e4 Button_root__2dKj"). Feeding these raw attributes to an LLM wastes tokens on high-entropy strings that convey no meaning about the element's function. In worst-case scenarios, these random strings can act as adversarial noise, distracting the model from the intelligible attributes like aria-label or placeholder.1
2.2 The Economic Physics of Context
The cost of unoptimized DOM ingestion is twofold: financial and temporal.
Financial Cost: In a multi-step trajectory (e.g., 20 steps to book a flight), passing a 20k-token DOM at each step results in 400,000 input tokens. At current enterprise API rates for high-reasoning models (e.g., GPT-4o or Claude 3.5 Sonnet), a single task execution can cost several dollars. This breaks the unit economics for many automation use cases.
Latency Cost: Time-To-First-Token (TTFT) scales with input size. Heavy contexts introduce multi-second latencies between actions. For a user waiting for an agent to complete a task, a 30-second delay per click renders the agent unusable.
This economic pressure has forced the industry to adopt "Context Engineering" as a primary discipline, leading to the development of sophisticated serialization and pruning algorithms.
3. Element Representation Optimization: From HTML to Semantics
The fundamental unit of browser automation is the web element. The manner in which this element is serialized into text determines the agent's ability to perceive and interact with it.
3.1 The Shift to Accessibility Trees (AXTree)
A dominant trend in 2024-2025 is the abandonment of raw HTML in favor of the Accessibility Tree (AXTree). The AXTree is a parallel structure generated by the browser's rendering engine to support assistive technologies (such as screen readers for the visually impaired). Unlike the DOM, which focuses on visual rendering, the AXTree focuses on semantic function.
Playwright MCP 8 has popularized this approach by exposing "structured accessibility snapshots" as the primary interface for LLMs. This representation offers several critical advantages:
Noise Reduction: The AXTree inherently filters out purely decorative elements (e.g., empty divs, decorative svg icons, layout spacers) that do not have a semantic role. This creates an immediate, lossless compression of the observation space, often reducing token count by 10-20x compared to raw HTML.10
Semantic Abstraction: Instead of representing a button as a <div class="btn-primary" onclick="...">, the AXTree represents it as an object with Role: "button", Name: "Submit", and State: "enabled". This abstraction aligns perfectly with the training objective of instruction-tuned LLMs, which reasoning is based on functional concepts rather than implementation details.
Robustness: The AXTree is more stable than the DOM. A visual redesign of a website might completely change the HTML structure (e.g., changing from float layout to flexbox), breaking XPath selectors. However, if the site maintains accessibility standards, the AXTree remains constant, ensuring the agent's prompt remains valid.11
However, AXTrees are not a panacea. They can sometimes abstract away too much information, losing the spatial relationships between elements (e.g., knowing that the "Price" label is visually adjacent to the "$50.00" text). To address this, hybrid serialization strategies are employed.
3.2 Custom DOM Serialization and Attribute Whitelisting
Frameworks that rely on DOM processing, such as AgentOccam and Browser-Use, employ rigorous Attribute Whitelisting to balance detail with brevity.
Research from AgentOccam and Mind2Web establishes a hierarchy of attribute importance.7 Effective serialization algorithms strip all attributes except those on a strict allow-list:
Identity: id, name, data-testid (crucial for testing-friendly environments).
Navigation: href, src.
Accessibility: role, aria-label, aria-description, aria-expanded, aria-selected, alt.
Input State: value, placeholder, type, checked, disabled, readonly, required.
AgentOccam introduces a sophisticated heuristic to further clean this list: the Character-to-Token Ratio Filter. The system analyzes the values of allowed attributes. If a value (e.g., an ID or Class) has a low character-to-token ratio—indicating a random string or hash like id="u_0_j_8W"—it is discarded even if the attribute is whitelisted. This prevents the LLM from hallucinating relationships based on random seed data and keeps the context "human-readable".7
3.3 Text Content Truncation and Summarization
Text nodes within elements (e.g., paragraphs of an article, legal disclaimers) are a major source of token bloat. Agents generally do not need to read the entire text of a page to navigate it; they only need enough context to identify the element's purpose.
SOTA implementations employ Smart Truncation:
Head/Tail Retention: Retaining the first 50-100 characters and the last 20 characters of a text node, inserting a [...] token in between. This captures the headline/topic (head) and any potential trailing markers (tail).
Hierarchical Summarization: Advanced systems like Lemon Agent use a multi-tier approach where a sub-agent (or a lighter model) summarizes long text blocks into a single sentence before inserting them into the navigation agent's context.12
Mind2Web Empirical Results: Experiments on the Mind2Web benchmark suggest that strict character limits on element text rarely degrade navigation performance. The navigational signal is almost always present in the first few words of an element's inner text.4
4. Structural Optimization: Pruning the Tree
Once individual elements are optimized, the next challenge is optimizing the tree structure itself. Even with clean elements, a full tree traversal can be overwhelming.
4.1 The "Pivotal Node" Theory (AgentOccam)
AgentOccam 13 introduces a theoretically grounded approach to observation space reduction known as Pivotal Node Selection. This technique posits that at any given step in a workflow, only a tiny subset of the DOM is "pivotal" to the immediate action or the long-term goal.
The AgentOccam workflow proceeds in two phases:
Prediction Phase: The agent (or a specialized classifier) analyzes the page to identify "Pivotal Nodes"—elements that are interactive (buttons, inputs) or contain key information requested by the user.
Reconstruction Phase: The agent constructs a Sparse DOM Tree. This tree contains only:
The identified Pivotal Nodes.
Their direct ancestors (up to the root), preserving the containment hierarchy (e.g., knowing a button is inside a "Modal" vs. the "Page Body").
Their immediate siblings, preserving local context (e.g., a "Price" label next to the value).
This algorithm creates a "skeleton" of the page. Vast subtrees containing irrelevant content (e.g., the footer, recommended products rail, or advertisements) are entirely pruned because they contain no pivotal nodes. This technique has been shown to reduce observation size by orders of magnitude while maintaining the structural integrity required for XPath generation.13
4.2 DOM Distillation in ScribeAgent
Similarly, ScribeAgent 15 employs a DOM Distillation process. ScribeAgent focuses on training specialized agents using production-scale workflow data. Its distillation process involves filtering out non-interactive elements unless they serve as labels for interactive ones. This creates a "functional view" of the web page, where the agent sees the page solely as a collection of affordances (actions it can take) rather than a collection of content. This approach aligns with the "Affordance-based" theory of navigation, where agents reason about "what can I do here?" rather than "what does this look like?".16
5. Viewport vs. Full-Page Strategies
A critical architectural decision in agent design is the scope of the observation: Should the agent see the entire page at once, or only what is visible in the viewport?
5.1 The Case for Viewport-Centric Observation
Frameworks like Browser-Use and Stagehand default to a Viewport-Centric strategy. The rationale is biomimetic: humans browse the web by scrolling. We do not process the footer of a page while looking at the header.
Hallucination Mitigation: Feeding the full page often leads to hallucinations where the agent attempts to interact with elements that are not currently rendered or are obscured by modals. By restricting the view to the viewport, the agent's action space is naturally constrained to "clickable" elements.
Performance: For hybrid agents that use visual inputs (screenshots), processing a standard 1280x800 viewport is significantly faster and cheaper than processing a full-page scroll capture, which can be thousands of pixels tall.
5.2 Viewport Expansion and Sliding Windows
Strict viewport cropping can lead to "tunnel vision." An agent might fail to scroll because the next relevant section (e.g., the "Next" button) is just 10 pixels off-screen.
To mitigate this, Browser-Use implements Viewport Expansion.17 This technique involves capturing the DOM for the current viewport plus a defined margin (e.g., 500 pixels above and below).
Mechanism: The agent is fed a list of elements within Viewport + Margin.
Benefit: This creates a "Sliding Window" effect. The agent has "peripheral vision," allowing it to anticipate upcoming content and make smoother scrolling decisions.
5.3 The "100vh" CSS Trap
Research by Tripp Hamilton 18 highlights a dangerous pitfall in expanding the viewport. Some naive implementations attempt to "expand" the viewport by resizing the browser window height to a large value (e.g., 15,000 pixels) to capture the full page in one shot.
The Failure Mode: Many modern sites use CSS units like vh (viewport height). A "Hero Section" styled with height: 100vh is intended to fill the screen. If the screen is resized to 15,000 pixels high, the Hero Section stretches to 15,000 pixels, pushing all other content off the canvas.
Impact: To the agent (and the screenshot tool), the page appears to be nothing but a giant version of the hero image.
Production Pattern: SOTA agents strictly avoid resizing the window height. Instead, they rely on standard scrolling (using window.scrollBy or Playwright's mouse.wheel) and capture disjoint observations, or they use the Chrome DevTools Protocol (CDP) to capture a "full page snapshot" that renders the layout correctly without altering the viewport metrics.
5.4 Handling Lazy Loading (Stagehand)
Another challenge with static snapshots is Lazy Loading. Images and components often do not hydrate until they are intersected by the viewport. A static scrape of the full page will miss these elements. Stagehand addresses this by incorporating an active "Observe" phase. Before capturing the state, the agent may execute a rapid scroll sequence or use IntersectionObserver API calls to force the browser to load lazy content within the target region.18 This ensures that the DOM snapshot accurately reflects the renderable state of the page.
6. Hybrid DOM + Vision Approaches
While text-based DOM optimization is critical, textual representations inevitably lose information about spatial layout, color, and visual hierarchy. State-of-the-art agents increasingly adopt Hybrid Multimodal approaches that fuse DOM text with visual inputs.
6.1 Set-of-Mark (SoM) Prompting
The Set-of-Mark (SoM) technique 20 has emerged as the gold standard for visual grounding in 2024-2025. It addresses the "Coordinate Regression" problem: LLMs are notoriously bad at predicting precise X,Y coordinates for clicks.
The SoM Workflow:
The agent parses the simplified DOM to identify all interactive elements in the viewport.
It overlays high-contrast Numeric Tags or Bounding Boxes onto the screenshot, positioned exactly over the identified elements.
The LLM receives this tagged image along with a simplified list mapping ID -> Element Description.
The Cognitive Shift: The task shifts from "Click the search button at 400,200" (geometry) to "Click element #42" (semantic reference). This leverages the strong OCR and object recognition capabilities of models like GPT-4o-Vision.
Benchmark Results: On VisualWebArena, SoM-based agents consistently outperform both pure-text agents (which lack spatial context) and pure-vision agents (which struggle with precise actuation), achieving higher success rates in tasks requiring visual discrimination (e.g., "Click the blue shirt, not the red one").22
6.2 The "Screenshot Fallback" Pattern (Stagehand)
Stagehand implements a tiered "Fallback" architecture to balance cost and accuracy.23
Tier 1: DOM Mode. The agent first attempts to resolve the user's intent using only the text-based DOM/AXTree. This is fast and token-cheap.
Tier 2: Vision Mode. If the DOM analysis is ambiguous, returns no results, or results in a failed action, the system escalates to Vision Mode. It captures a screenshot (potentially with SoM tags) and asks the vision model to identify the target.
Use Case: This is particularly vital for "Canvas" applications (e.g., Google Maps, Figma, complex games) where the DOM is effectively empty or obfuscated. In these scenarios, the DOM provides no signal, and vision is the only viable channel.
7. Context Budget Management: The Temporal Dimension
Optimization is not just about the current step; it is about managing the context over time. As an agent executes a long-horizon task, the history of observations accumulates, threatening to overflow the context window or degrade reasoning via the "Lost in the Middle" effect.
7.1 Progressive Compression (Lemon Agent)
Lemon Agent 12 introduces a Three-Tier Progressive Compression mechanism to manage this temporal accumulation.
Tier 1: Intra-Tool Truncation. This occurs at the point of data retrieval. If a tool (e.g., a search engine) returns verbose data, it is immediately truncated to a predefined limit (e.g., Top-5 results) before entering the context.
Tier 2: Intra-Round Adaptive Summarization. At the end of a reasoning step, the agent summarizes the current state and action into a concise natural language description. The massive DOM observation used to make that decision is then discarded from the history.
Transition: + + [Action]  State: Homepage. Action: Clicked Login.
Tier 3: Cross-Round Retroactive Compression. As the conversation history lengthens, older summaries are further compressed into high-level narrative blocks. A sequence of 5 steps detailing a filtering process might be collapsed into a single sentence: "User navigated to the laptop category and applied price filters."
7.2 State Invalidation and "Context Purging"
A critical insight from ScribeAgent and Browser-Use is the concept of State Invalidation.
The DOM observation of Step 1 is valid only at Step 1. By Step 2, the page state has likely changed. Retaining the Step 1 DOM in the context window is not just wasteful; it is harmful. It introduces "stale state" that contradicts the current reality.
Production Pattern: SOTA agents enforce a strict policy where the context history contains only the Action Trace (what was done) and Outcome Summaries. The DOM/Screenshot is strictly ephemeral; only the current step's observation is present in the context. This "Markovian" approach (State  depends on State  and Action , not directly on State ) drastically reduces token load and prevents the model from hallucinating based on outdated information.15
7.3 Dynamic Token Allocation
Research suggests that a rigid allocation ratio is necessary for stability.24 A recommended budget distribution for a standard 128k context window is:
System Prompt: 10-15% (Immutable constraints and persona).
Current Observation: 40-50% (Maximum detail for immediate reasoning).
Compressed History: 20-30% (Contextual continuity).
Scratchpad/Reasoning: 10-15% (Chain-of-Thought generation).
8. Production Implementation Patterns: Framework Analysis
The theoretical techniques described above are codified in distinct ways across the leading open-source frameworks.
8.1 Stagehand: The observe() vs act() Pattern
Stagehand (by Browserbase) distinguishes itself with a rigorous separation of Observation and Action.19
The observe() Method: Instead of a monolithic "Run" loop, Stagehand exposes an observe() primitive. This method analyzes the page and returns a list of candidate actions without executing them.
Context Builder: Stagehand uses an internal "Context Builder" that sanitizes the DOM specifically for the observe phase, stripping heavy media and stabilizing animations to ensure a clean read.
Caching Strategy: By decoupling observation, Stagehand enables Deterministic Caching. If the agent encounters a page state that fingerprints identically to a previous run, it can reuse the cached "Plan" (the mapping of intent to Playwright selector) without querying the LLM. This dramatically improves speed and reduces cost for repetitive tasks.
8.2 Browser-Use: Pythonic DOM Distillation
Browser-Use implements its optimization logic directly in Python, prioritizing Coordinate Injection.26
Spatial Awareness: The distiller calculates the center-point  of every element and injects it into the text representation. This allows even text-only models to perform a degree of spatial reasoning (e.g., distinguishing the "top" search bar from a "bottom" search bar).
Shadow DOM Support: Browser-Use explicitly handles Shadow DOM traversal. This is critical for automating enterprise applications built with Web Components, where standard scrapers often fail to see inside the shadow root boundaries.
8.3 Playwright MCP: The Standardization of Context
Playwright MCP 8 represents the move toward Agent-Tool Standardization.
The MCP Server: By wrapping Playwright in the Model Context Protocol, it abstracts the complexity of DOM serialization away from the agent's prompt engineering. The agent simply calls get_accessibility_tree, and the server handles the extraction and optimization.
Shift to Edge: This moves the optimization logic from the "Client" (the LLM system prompt) to the "Edge" (the tool execution layer). This allows for faster iteration on serialization logic without requiring model re-prompting.
9. Conclusion
The optimization of DOM context representation is no longer a matter of "prompt engineering"; it has evolved into a full-stack engineering discipline involving browser internals, computer vision, and information theory. The "Context Econophysics" of web agents dictates that success is not achieved by feeding more data to the model, but by rigorously distilling the infinite complexity of the web into a dense, semantic signal.
The state-of-the-art workflow for 2025 can be summarized as:
Ingest via Accessibility Trees or Sparse DOMs (AgentOccam) to minimize noise.
Filter using Attribute Whitelists and Pivotal Node prediction.
Ground using Set-of-Mark visual tagging to ensure precise actuation.
Manage using Progressive Compression (Lemon Agent) to maintain temporal coherence without context overflow.
As LLMs continue to evolve, the "Context Window" will remain the defining constraint. The agents that succeed will be those that treat this window not as a bucket, but as a lens—carefully focusing the model's attention on the few pixels and characters that truly matter.
Works cited
Context Engineering: 4 Ways Your Agent's Context Fails - Firecrawl, accessed February 10, 2026, https://www.firecrawl.dev/blog/context-engineering
Context Rot: Why AI Gets Worse the Longer You Chat (And How to Fix It) - Product Talk, accessed February 10, 2026, https://www.producttalk.org/context-rot/
Large Language Model Agents: A Comprehensive Survey on Architectures, Capabilities, and Applications - Preprints.org, accessed February 10, 2026, https://www.preprints.org/manuscript/202512.2119
Promoting Sustainable Web Agents: Benchmarking and Estimating Energy Consumption Through Empirical and Theoretical Analysis - arXiv, accessed February 10, 2026, https://arxiv.org/html/2511.04481v1
NeurIPS Poster Mind2Web: Towards a Generalist Agent for the Web, accessed February 10, 2026, https://neurips.cc/virtual/2023/poster/73485
MIND2WEB: Towards a Generalist Agent for the Web - NeurIPS, accessed February 10, 2026, https://proceedings.neurips.cc/paper_files/paper/2023/file/5950bf290a1570ea401bf98882128160-Paper-Datasets_and_Benchmarks.pdf
SCRIBEAGENT: TOWARDS SPECIALIZED WEB AGENTS USING PRODUCTION-SCALE WORKFLOW DATA - OpenReview, accessed February 10, 2026, https://openreview.net/pdf?id=irfQuEnOkx
Playwright MCP - Jimmy Song, accessed February 10, 2026, https://jimmysong.io/ai/playwright-mcp/
What is Playwright MCP? and how to use it in your testing workflow? - TestCollab, accessed February 10, 2026, https://testcollab.com/blog/playwright-mcp
Playwright MCP Changes the Build vs. Buy Equation for AI Testing in 2026 | Bug0, accessed February 10, 2026, https://bug0.com/blog/playwright-mcp-changes-ai-testing-2026
Do Accessible Websites Really Perform Better for AI Agents?, accessed February 10, 2026, https://www.accessibility.works/blog/do-accessible-websites-perform-better-for-ai-agents
Lemon Agent Technical Report - arXiv, accessed February 10, 2026, https://arxiv.org/html/2602.07092v1
AgentOccam: A Simple Yet Strong Baseline for LLM-Based Web Agents - arXiv, accessed February 10, 2026, https://arxiv.org/html/2410.13825v2
FOR LLM-BASED WEB AGENTS - Amazon Science, accessed February 10, 2026, https://assets.amazon.science/e8/9b/35bdbcb9448da1083ec5710b7c75/agentoccam-a-simple-yet-strong-baseline-for-llm-based-web-agents.pdf
ScribeAgent: Towards Specialized Web Agents Using Production-Scale Workflow Data, accessed February 10, 2026, https://www.researchgate.net/publication/387269911_ScribeAgent_Towards_Specialized_Web_Agents_Using_Production-Scale_Workflow_Data
(PDF) Affordance Representation and Recognition for Autonomous Agents - ResearchGate, accessed February 10, 2026, https://www.researchgate.net/publication/397006472_Affordance_Representation_and_Recognition_for_Autonomous_Agents
Default browser launch at full screen, and can't change window width/height. #1611 - GitHub, accessed February 10, 2026, https://github.com/browser-use/browser-use/issues/1611
Guide to Rendering, Indexing, and AI SEO | Hive Digital, accessed February 10, 2026, https://www.hivedigital.com/blog/rendering-indexing-ai-seo-guide/
Speed Optimization - Stagehand Docs, accessed February 10, 2026, https://docs.stagehand.dev/v3/best-practices/speed-optimization
SPA-Bench: A Comprehensive Benchmark for SmartPhone Agent Evaluation - OpenReview, accessed February 10, 2026, https://openreview.net/pdf/ccf7378d7990423773ff34746c452e85f4e7f588.pdf
ColorBrowserAgent: An Intelligent GUI Agent for Complex Long-Horizon Web Automation, accessed February 10, 2026, https://arxiv.org/html/2601.07262v1
A Survey on Web Agent Performance and Efficiency - OSF, accessed February 10, 2026, https://osf.io/vhn2c_v2/download/?format=pdf
PriceFinderAgent: An Agentic Approach to Web Scraping - Lund University Publications, accessed February 10, 2026, https://lup.lub.lu.se/student-papers/record/9204532/file/9204534.pdf
Lessons from Building VT Code: An Open-Source AI Coding Agent - Hugging Face, accessed February 10, 2026, https://huggingface.co/blog/vinhnx90/vt-code
Stagehand breakdown - Dwarves Memo, accessed February 10, 2026, https://memo.d.foundation/breakdown/stagehand
AgentOrchestra: Orchestrating Multi-Agent Intelligence with the Tool-Environment-Agent(TEA) Protocol - arXiv, accessed February 10, 2026, https://arxiv.org/html/2506.12508v5
browser-use/browser_use/agent/service.py at main - GitHub, accessed February 10, 2026, https://github.com/browser-use/browser-use/blob/main/browser_use/agent/service.py
Playwright MCP: Comprehensive Guide to AI-Powered Browser Automation in 2025, accessed February 10, 2026, https://medium.com/@bluudit/playwright-mcp-comprehensive-guide-to-ai-powered-browser-automation-in-2025-712c9fd6cffa
