#!/usr/bin/env node
/**
 * Mix a TTS voiceover onto an already-rendered publish video.
 * The narration specs below are timed to the exact segment structure of each
 * cut (see build-promo-cut.mjs / build-demo-montage.mjs), so every line has a
 * hard start offset and a max window it must fit.
 *
 *   node scripts/add-voiceover.mjs --video customer|developer|linkedin|promo|pitch|store|vendor|jobs
 *     [--provider gemini|elevenlabs]    default: gemini
 *     [--voice <voice id/name>]         default: Sulafat (Gemini) / Matilda (EL)
 *     [--accent <voice direction>]       default: contemporary neutral British English
 *     [--music <file>]                  optional bed, ducked under narration
 *
 * Keys: GEMINI_API_KEY or ELEVENLABS_API_KEY / ELEVENLAB_API_KEY, from the env
 * or the repo .env. The gemini provider (gemini-3.1-flash-tts-preview) is
 * steered per line: a director-style prompt plus optional per-line `gnote`
 * delivery notes and `gtext` inline audio tags; it writes the canonical
 * output names. The elevenlabs alternate gets an "-elevenlabs" suffix so both
 * providers' cuts can sit side by side for comparison.
 * Generated lines are cached in .artifacts/vo/ by content hash — tweaking one
 * line only re-bills that line. Video frames are never re-encoded (-c:v copy).
 */

import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PUBLISH = path.join(ROOT, ".artifacts", "publish");
const VO_CACHE = path.join(ROOT, ".artifacts", "vo");

const argVal = (n, d) => {
  const i = process.argv.indexOf(n);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const WHICH = argVal("--video", "promo");
const PROVIDER = argVal("--provider", "gemini");
if (!["elevenlabs", "gemini"].includes(PROVIDER)) {
  console.error(`Unknown --provider "${PROVIDER}" (use: elevenlabs|gemini)`);
  process.exit(1);
}
// EL default "Matilda" — warm narrative female (bake-off winner).
// Gemini default "Sulafat" — the catalog's warm female, closest to that brief.
const VOICE = argVal("--voice", PROVIDER === "gemini" ? "Sulafat" : "XrExE9yKIg1WjnnlVkGX");
const ACCENT = argVal("--accent", "a contemporary neutral British English accent");
const MUSIC = argVal("--music", "");
const GEMINI_MODEL = "gemini-3.1-flash-tts-preview";

// ---- narration specs --------------------------------------------------------
// at: line start (s) · maxSec: hard window the audio must fit (atempo ≤1.1 helps)
const SPECS = {
  "linkedin-multi": {
    in: "opensidebar-linkedin-launch-56s-bed.mp4",
    out: "opensidebar-linkedin-launch-56s.mp4",
    lines: [
      { at: 0.6, maxSec: 6.2, text: "OpenSidebar is an open-source browser agent for Chrome. Bring your own API key." },
      { at: 7.6, maxSec: 7.0, text: "It reads live dashboard metrics and carries them into a useful email draft." },
      { at: 15.0, maxSec: 7.4, text: "It can then revise the message while leaving the final send under human control." },
      { at: 23.3, maxSec: 7.6, text: "The same agent completes a multi-step vendor access request, including conditional fields." },
      { at: 31.5, maxSec: 8.5, text: "It reviews the completed request, confirms the declaration, and submits with visible evidence." },
      { at: 41.1, maxSec: 8.3, text: "Because OpenSidebar is open source, it can be extended for enterprise SaaS. This ServiceNow extension shows how." },
      { at: 50.2, maxSec: 5.5, text: "OpenSidebar. Three workflows. One open-source agent." },
    ],
  },
  vendor: {
    in: "opensidebar-linkedin-vendor-workflow-47s-bed.mp4",
    out: "opensidebar-linkedin-vendor-workflow-47s.mp4",
    direction:
      `Voice direction: a warm, technically confident female narrator speaking with ${ACCENT}. ` +
      "This is a concise open-source product demo for a professional audience. Sound observant, capable, and calm. " +
      "Use crisp consonants and natural pacing; never sound salesy.",
    lines: [
      {
        at: 0.6, maxSec: 7.0,
        text: "Here is OpenSidebar completing a real vendor access request, from first field to final submission.",
        gnote: "Open cleanly and confidently. Make the full workflow scope clear without rushing.",
      },
      {
        at: 8.0, maxSec: 7.3,
        text: "It fills the requester details, then moves into the conditional request step.",
        gnote: "Matter-of-fact momentum, with light emphasis on conditional request.",
      },
      {
        at: 15.8, maxSec: 8.0,
        text: "The agent selects the request type and department, adds the vendor information, and handles the required checks.",
        gnote: "Precise and controlled. Keep the list flowing naturally.",
      },
      {
        at: 24.2, maxSec: 7.5,
        text: "Before submitting, it reviews the completed request and confirms the security declaration.",
        gnote: "Reassuring and evidence-focused. Land security declaration clearly.",
      },
      {
        at: 32.2, maxSec: 7.6,
        text: "The request is submitted, and the confirmation page provides the evidence.",
        gnote: "Brighten slightly on submitted, then settle on evidence.",
      },
      {
        at: 40.2, maxSec: 6.5,
        text: "OpenSidebar. Visible actions, reviewed state, verified result.",
        gnote: "Warm, definitive sign-off with a measured three-part rhythm.",
      },
    ],
  },
  linkedin: {
    in: "opensidebar-linkedin-work-38s-bed.mp4",
    out: "opensidebar-linkedin-work-38s.mp4",
    direction:
      `Voice direction: a warm, confident female narrator speaking with ${ACCENT}. ` +
      "This is a concise product film for a professional audience. Sound natural, capable, and calm. " +
      "Use crisp consonants and a relaxed pace; never sound salesy.",
    lines: [
      {
        at: 0.6, maxSec: 5.8,
        text: "OpenSidebar is an AI agent that works alongside you in the browser.",
        gnote: "Open cleanly and confidently. Let OpenSidebar land clearly; do not rush the first word.",
      },
      {
        at: 6.5, maxSec: 7.0,
        text: "It can take information from one page and turn it into a clear draft on another.",
        gnote: "Matter-of-fact and effortless, with light emphasis on one page and another.",
      },
      {
        at: 14.2, maxSec: 7.6,
        text: "Leave it watching, and it tells you when something important changes.",
        gnote: "Start gently, then brighten slightly on important changes.",
      },
      {
        at: 22.9, maxSec: 8.0,
        text: "For more involved work, it follows the workflow while showing you exactly what it is doing.",
        gnote: "Grounded and reassuring. Keep the delivery plain and unhurried.",
      },
      {
        at: 31.7, maxSec: 5.7,
        text: "OpenSidebar. Open source, powered by your key.",
        gnote: "Warm, definitive sign-off. Give each benefit a little space.",
      },
    ],
  },
  promo: {
    in: "opensidebar-promo-60s.mp4",
    out: "opensidebar-promo-60s-voiced.mp4",
    lines: [
      {
        at: 0.6, maxSec: 12.0,
        text: "This is OpenSidebar — an AI agent in your browser. Give it a task, and it does the clicking: cart, coupon, checkout. Done.",
        gnote: "Open bright and welcoming; build momentum through the three-item list; land the final word as a satisfied, punchy button.",
        gtext: "This is OpenSidebar — an AI agent in your browser. Give it a task, and it does the clicking: cart, coupon, checkout. [satisfied] Done.",
      },
      {
        at: 13.6, maxSec: 13.0,
        text: "It reads data on one page and writes it into another — here, turning dashboard numbers into an email reply.",
        gnote: "Matter-of-fact, effortless competence — like showing a friend a neat trick, with light emphasis on 'reads' and 'writes'.",
      },
      {
        at: 27.4, maxSec: 8.5,
        text: "And it can simply watch. The moment this product is back in stock — it speaks up.",
        gnote: "Start hushed and intriguing, almost confiding; then brighten with delight on the payoff after the dash.",
        gtext: "[intrigued] And it can simply watch. The moment this product is back in stock — [bright] it speaks up.",
      },
      {
        at: 36.5, maxSec: 14.0,
        text: "It's not just the open web. The same agent drives enterprise apps like ServiceNow, end to end.",
        gnote: "Grounded and authoritative — the serious enterprise beat; steady pace, firm landing on 'end to end'.",
      },
      {
        at: 51.5, maxSec: 6.3,
        text: "OpenSidebar. Free, open source, bring your own key.",
        gnote: "The sign-off: slow slightly, warm and definitive, with a small pause between each of the three phrases.",
        gtext: "OpenSidebar. [warmly] Free, open source, bring your own key.",
      },
    ],
  },
  customer: {
    in: "opensidebar-promo-60s.mp4",
    out: "opensidebar-customer-60s-british-female.mp4",
    direction:
      `Voice direction: a warm, confident female narrator speaking with ${ACCENT}. ` +
      "This is a customer film for a useful browser product. Sound natural, clear, and reassuring, never salesy or announcer-like. " +
      "Use crisp consonants, a relaxed pace, and a slight audible smile.",
    lines: [
      {
        at: 0.6, maxSec: 12.0,
        text: "Meet OpenSidebar, an AI agent in your browser. Give it a task and it handles the clicks: cart, coupon, checkout. Done.",
        gnote: "Open brightly and naturally. Build momentum through the three-item list, then land 'Done' with quiet satisfaction.",
        gtext: "Meet OpenSidebar, an AI agent in your browser. Give it a task and it handles the clicks: cart, coupon, checkout. [satisfied] Done.",
      },
      {
        at: 13.6, maxSec: 13.0,
        text: "It can read information on one page and use it on another, like turning dashboard numbers into an email reply.",
        gnote: "Matter-of-fact and effortless, with light emphasis on 'one page' and 'another'.",
      },
      {
        at: 27.4, maxSec: 8.5,
        text: "Or leave it watching. When this product comes back in stock, it tells you.",
        gnote: "Start gently, then brighten on the result.",
      },
      {
        at: 36.5, maxSec: 14.0,
        text: "The same side-panel agent can work through complex business apps, step by step, while you see what it is doing.",
        gnote: "Grounded and reassuring. Keep the phrasing plain and unhurried.",
      },
      {
        at: 51.5, maxSec: 6.3,
        text: "OpenSidebar. Free, open source, and powered by your own key.",
        gnote: "Warm, definitive sign-off. Give each benefit a little space.",
      },
    ],
  },
  developer: {
    in: "opensidebar-flagship-v3.mp4",
    out: "opensidebar-developer-tour-british-female.mp4",
    direction:
      `Voice direction: a technically precise female narrator speaking with ${ACCENT}. ` +
      "This is a developer film for an open-source browser-agent workbench. Sound authoritative, curious, and approachable. " +
      "Keep numbers deliberate and architecture statements crisp; avoid hype.",
    lines: [
      {
        at: 0.5, maxSec: 5.0,
        text: "OpenSidebar turns scattered browser evidence into a safe decision.",
        gnote: "Open with calm conviction and give the first word a clean entrance.",
      },
      {
        at: 5.8, maxSec: 16.2,
        text: "Here, an invoice asks for twenty-eight thousand eight hundred dollars. The agent checks the contract, usage, and policy: a missing fifteen percent discount, and only seventy-three active seats.",
        gnote: "Investigative and precise. Keep every number clear.",
      },
      {
        at: 22.8, maxSec: 12.2,
        text: "The draft is ready, but nothing is sent. Corrected renewal: fourteen thousand eight hundred ninety-two. Savings: thirteen thousand nine hundred eight.",
        gnote: "Make the safety boundary explicit, then slow slightly for both totals.",
      },
      {
        at: 35.2, maxSec: 16.1,
        text: "Then a match-day alert moves kickoff to twelve thirty. The current train arrives too late. OpenSidebar checks the rule, compares the replacements, and identifies the safe option.",
        gnote: "Give the disruption some urgency, then settle into controlled technical clarity.",
      },
      {
        at: 52.3, maxSec: 6.7,
        text: "One hour forty-eight of buffer, two hundred sixteen euros, and nothing purchased.",
        gnote: "Deliver the three facts as compact evidence.",
      },
      {
        at: 59.3, maxSec: 6.2,
        text: "Consequential actions wait for human approval.",
        gnote: "Slow, calm, and trustworthy.",
      },
      {
        at: 66.2, maxSec: 4.0,
        text: "One model plans and coordinates.",
        gnote: "Clear role-card delivery with emphasis on 'plans'.",
      },
      {
        at: 70.7, maxSec: 4.0,
        text: "Another acts and verifies.",
        gnote: "Slightly more kinetic, but still precise.",
      },
      {
        at: 75.2, maxSec: 4.0,
        text: "A judge checks the evidence.",
        gnote: "Firm and trustworthy.",
      },
      {
        at: 79.8, maxSec: 6.7,
        text: "The trace keeps each task's cost beside its actions and evidence.",
        gnote: "Transparent and matter-of-fact.",
      },
      {
        at: 87.4, maxSec: 6.5,
        text: "Run it, inspect it, and help build what comes next.",
        gnote: "A direct and inviting developer call to action.",
      },
    ],
  },
  pitch: {
    in: "opensidebar-pitch-demo-collage.mp4",
    out: "opensidebar-pitch-demo-collage-voiced.mp4",
    // Structure (extended tour, --scene-sec 15): intro 3.0 · section 2.6 ·
    // [card 3.0 + scene 15.0]×5 · section 2.6 · [card 3.0 + scene 15.0]×4 ·
    // section 2.6 · [card 3.0 + scene 18.0] · [card 3.0 + scene 15.0] · outro 3.0
    // = 214.8s. Scene starts: 8.6/26.6/44.6/62.6/80.6 · 101.2/119.2/137.2/155.2 ·
    // 175.8(18s)/196.8.
    lines: [
      { at: 0.5, maxSec: 7.9, text: "This is OpenSidebar — an open-source AI agent doing real work in your browser. Part one: the open web." },
      { at: 8.9, maxSec: 17.4, text: "Give it a task in plain English. A planner breaks it into steps, an executor drives the page, and a verifier checks the result. Watch it find the product, apply the coupon, pick express shipping, and place the order." },
      { at: 26.9, maxSec: 17.4, text: "It carries context across pages — no copy-paste, no tab juggling. Here it reads the key numbers from a dashboard, then opens the mail client and drafts a reply that reports them." },
      { at: 44.9, maxSec: 17.4, text: "Long, conditional forms are where automation usually breaks. OpenSidebar works the wizard step by step, keeps track of what it has already filled, and reviews everything before submitting." },
      { at: 62.9, maxSec: 17.4, text: "It can complete a real job application — filling the candidate's details field by field. And for consequential actions like the final submit, it pauses and leaves the last word to you." },
      { at: 80.9, maxSec: 17.4, text: "Need something buried in a paginated directory? It searches, pages through the results, and reports back exactly the fields you asked for." },
      { at: 95.9, maxSec: 20.0, text: "Part two: you stay in control. There's no subscription and no middleman — you bring your own API key and pick your provider and models: Fireworks, Moonshot, OpenRouter, or Xiaomi, with a separate choice for every seat." },
      { at: 119.5, maxSec: 17.4, text: "Watch Mode turns the agent into a quiet observer: give it a standing instruction and leave the tab open. The moment the page changes, it speaks up — here, the instant this product is back in stock." },
      { at: 137.5, maxSec: 17.4, text: "Everything is observable. The built-in observability workspace records every run — each decision the model made, what it saw on screen, and the exact cost. This entire task ran for about six cents." },
      { at: 155.5, maxSec: 17.4, text: "Zoom out, and the same workspace shows the whole fleet: success rates, failure clusters, and spend across hundreds of runs — stored locally; nothing leaves your machine." },
      { at: 170.5, maxSec: 22.0, text: "Part three: it's built to be extended. ServiceNow support ships as an adapter in the open-source repo — watch it navigate the service catalog, configure a laptop with the requested software, and submit the order end to end." },
      { at: 197.1, maxSec: 17.4, text: "The same adapter searches the knowledge base, filters lists, and sorts natively. And the pattern is yours to copy — a custom adapter and skills can teach the agent your own enterprise apps." },
      // Starts on the finale's fade-out so the sign-off lands on the outro card.
      { at: 211.9, maxSec: 3.5, text: "OpenSidebar. Open source — make it yours." },
    ],
  },
};

// Store-accurate tour (--show store): the pitch minus the two observability
// scenes (the trace viewer is dev-only and does not ship in the store package).
// Same line texts as the pitch (cache hits) at recomputed offsets.
// Structure: intro 3 · sec 2.6 · 5×(3+15) · sec 2.6 · 2×(3+15) · sec 2.6 ·
// (3+18) · (3+15) · outro 3 = 178.8s. Scene starts: 8.6/26.6/44.6/62.6/80.6 ·
// 101.2/119.2 · 139.8(18s)/160.8.
SPECS.store = {
  in: "opensidebar-store-tour.mp4",
  out: "opensidebar-store-tour-voiced.mp4",
  lines: [
    { ...SPECS.pitch.lines[0] },                                // intro @0.5
    { ...SPECS.pitch.lines[1] },                                // shop @8.9
    { ...SPECS.pitch.lines[2] },                                // compose @26.9
    { ...SPECS.pitch.lines[3] },                                // wizard @44.9
    { ...SPECS.pitch.lines[4] },                                // ashby @62.9
    { ...SPECS.pitch.lines[5] },                                // extract @80.9
    { ...SPECS.pitch.lines[6] },                                // part two + settings @95.9
    { ...SPECS.pitch.lines[7] },                                // watch @119.5
    { ...SPECS.pitch.lines[10], at: 134.8 },                    // part three + SN order
    { ...SPECS.pitch.lines[11], at: 161.1 },                    // SN KB / adapter pattern
    { at: 175.9, maxSec: 3.5, text: "OpenSidebar. Free — bring your own key." },
  ],
};

// The job-pipeline voiced story (--show jobs): one filmed run cut into four
// beats. Structure: intro 3.0 · [card 3.0 + scene 14] · [card 3.0 + scene 12] ·
// [card 3.0 + scene 16] · [card 3.0 + scene 12] · outro 3.0 = 72.0s.
// Scene starts: 6.0 / 23.0 / 38.0 / 57.0 · outro 69.0.
SPECS.jobs = {
  in: "opensidebar-jobpipeline-demo.mp4",
  out: "opensidebar-jobpipeline-demo-voiced.mp4",
  lines: [
    { at: 0.5, maxSec: 5.0, text: "One prompt. Two job applications, ready to send. This is OpenSidebar." },
    { at: 6.3, maxSec: 13.4, text: "The candidate wants senior frontend work — React and TypeScript, fully remote, one twenty to one sixty. The agent reads all ten listings and screens them against that profile, like a recruiter would." },
    { at: 23.3, maxSec: 11.4, text: "It picks the two best matches and opens each application in its own tab — no copy-paste, no tab juggling." },
    { at: 38.3, maxSec: 15.4, text: "Then it fills every field on both forms — contact details, salary, start date — and writes a short 'why this company' answer grounded in each posting. The one thing it leaves untouched: the CV upload." },
    { at: 57.3, maxSec: 11.4, text: "And here's the point — it stops before send. You review, attach your CV, and click submit yourself." },
    { at: 69.2, maxSec: 2.6, text: "OpenSidebar. The click stays yours." },
  ],
};

const spec = SPECS[WHICH];
if (!spec) {
  console.error(`Unknown --video "${WHICH}" (use: ${Object.keys(SPECS).join("|")})`);
  process.exit(1);
}

// ---- key loading (env, then repo .env; never logged) ------------------------
function loadKey() {
  const names = PROVIDER === "gemini"
    ? ["GEMINI_API_KEY"]
    : ["ELEVENLABS_API_KEY", "ELEVENLAB_API_KEY"];
  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }
  const envPath = path.join(ROOT, ".env");
  if (fs.existsSync(envPath)) {
    const pat = PROVIDER === "gemini" ? /^GEMINI_API_KEY=(.+)$/ : /^ELEVENLABS?_API_KEY=(.+)$/;
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(pat);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return null;
}

function sh(bin, a) {
  return execFileSync(bin, a, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}
const dur = (f) =>
  parseFloat(sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]));

// Length of the leading silence in seconds (0 if the file opens on sound).
// inputArgs lets raw-PCM callers pass their format flags before -i.
function leadingSilence(inputArgs, noiseDb, minDur) {
  const r = spawnSync(
    "ffmpeg",
    ["-hide_banner", ...inputArgs, "-af", `silencedetect=noise=${noiseDb}dB:d=${minDur}`, "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const err = r.stderr || "";
  const start = err.match(/silence_start:\s*(-?[\d.]+)/);
  if (!start || parseFloat(start[1]) > 0.05) return 0; // first silence isn't at the head
  const end = err.match(/silence_end:\s*([\d.]+)/);
  return end ? parseFloat(end[1]) : 0;
}

// ---- TTS with cache ---------------------------------------------------------
async function tts(key, text) {
  fs.mkdirSync(VO_CACHE, { recursive: true });
  // v5: measured-onset trim replaces fixed trim + silenceremove (bump on pipeline change)
  const hash = crypto.createHash("sha1").update(`v5|${VOICE}|${text}`).digest("hex").slice(0, 16);
  const cached = path.join(VO_CACHE, `${hash}.mp3`);
  if (fs.existsSync(cached) && fs.statSync(cached).size > 0) return { file: cached, cached: true };

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        // Leading break: ElevenLabs cold-starts clip the first phoneme's attack
        // when speech begins at sample zero; the break makes it render fully.
        // The rendered break (breath artifacts included) is trimmed back off
        // below by measuring where speech actually starts.
        text: `<break time="0.5s" /> ${text}`,
        model_id: "eleven_multilingual_v2",
        // Livelier delivery than the flat defaults: lower stability + some style.
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.75,
          style: 0.35,
          use_speaker_boost: true,
        },
      }),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs ${res.status}: ${detail.slice(0, 300)}`);
  }
  const rawFile = cached.replace(/\.mp3$/, "-raw.mp3");
  fs.writeFileSync(rawFile, Buffer.from(await res.arrayBuffer()));
  // Onset normalization, measured instead of assumed. The old recipe (fixed
  // 0.35s trim + silenceremove at -45dB) clipped first phonemes whenever EL
  // rendered the break short or the word opened with a quiet attack. Now:
  //   1. measure where speech actually starts (-30dB keeps the break's
  //      breath/murmur artifact classified as silence);
  //   2. trim 150ms BEFORE that point so the full quiet attack survives;
  //   3. fade the first 80ms of the retained lead (kills breath residue,
  //      never touches speech), then re-pad a fixed 60ms.
  const onset = leadingSilence(["-i", rawFile], -30, 0.05);
  const trim = Math.max(0, onset - 0.15);
  sh("ffmpeg", [
    "-y", "-i", rawFile,
    "-af",
    `atrim=start=${trim.toFixed(3)},asetpts=PTS-STARTPTS,` +
      "afade=t=in:d=0.08,adelay=60|60",
    cached,
  ]);
  fs.unlinkSync(rawFile);
  return { file: cached, cached: false };
}

// ---- Gemini TTS (gemini-3.1-flash-tts-preview) ------------------------------
// Steering happens in the prompt: a global director brief, an optional per-line
// delivery note (`gnote`), and inline audio tags in `gtext` ([intrigued], …).
// The transcript is quoted and fenced with "read only" so the direction itself
// is never spoken.
const GEMINI_DIRECTION = spec.direction ||
  "Voice direction: a warm, confident female narrator for a polished product film. " +
  `Speak with ${ACCENT}. Modern tech-keynote energy — intimate ` +
  "and self-assured, never salesy or announcer-like. Crisp consonants, relaxed " +
  "unhurried pace, a slight audible smile. Take a short, purposeful beat at " +
  "every em dash.";

async function ttsGemini(key, line, take) {
  fs.mkdirSync(VO_CACHE, { recursive: true });
  const text = line.gtext || line.text;
  const note = line.gnote ? ` This line: ${line.gnote}` : "";
  // g2: measured-onset trim replaces silenceremove (bump on prompt/pipeline change)
  const hash = crypto
    .createHash("sha1")
    .update(`g2|${VOICE}|${GEMINI_DIRECTION}|${note}|${text}|t${take}`)
    .digest("hex")
    .slice(0, 16);
  const cached = path.join(VO_CACHE, `${hash}.mp3`);
  if (fs.existsSync(cached) && fs.statSync(cached).size > 0) return { file: cached, cached: true };

  const prompt =
    `${GEMINI_DIRECTION}${note}\n\n` +
    `Read only the narration between the quotes, exactly as written:\n"${text}"`;
  // The preview model occasionally answers with text instead of audio — retry.
  let b64 = null;
  for (let attempt = 0; attempt < 3 && !b64; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
          },
        }),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Gemini ${res.status}: ${detail.slice(0, 300)}`);
    }
    const body = await res.json();
    const part = (body.candidates?.[0]?.content?.parts || []).find((p) =>
      p.inlineData?.mimeType?.startsWith("audio/"),
    );
    if (part) b64 = part.inlineData.data;
  }
  if (!b64) throw new Error(`Gemini returned no audio after 3 attempts for: "${text.slice(0, 60)}…"`);

  // Raw PCM (L16 24kHz mono) → mp3, with the same measured-onset normalization
  // contract as the EL path (trim to 150ms before detected speech, 80ms fade
  // over the retained lead, fixed 60ms re-pad).
  const rawFile = cached.replace(/\.mp3$/, "-raw.pcm");
  fs.writeFileSync(rawFile, Buffer.from(b64, "base64"));
  const pcmArgs = ["-f", "s16le", "-ar", "24000", "-ac", "1", "-i", rawFile];
  const onset = leadingSilence(pcmArgs, -30, 0.05);
  const trim = Math.max(0, onset - 0.15);
  sh("ffmpeg", [
    "-y", ...pcmArgs,
    "-af",
    `atrim=start=${trim.toFixed(3)},asetpts=PTS-STARTPTS,` +
      "afade=t=in:d=0.08,adelay=60|60",
    "-ar", "44100", "-b:a", "128k",
    cached,
  ]);
  fs.unlinkSync(rawFile);
  return { file: cached, cached: false };
}

// ---- main -------------------------------------------------------------------
const key = loadKey();
if (!key) {
  console.error(
    PROVIDER === "gemini"
      ? "No GEMINI_API_KEY in the environment or .env"
      : "No ELEVENLABS_API_KEY / ELEVENLAB_API_KEY in the environment or .env",
  );
  process.exit(1);
}

// --bakeoff: render the promo's first line in candidate voices so the owner can
// pick by ear (samples in .artifacts/publish/voice-samples/, then re-run with
// --voice <winner id>).
if (process.argv.includes("--bakeoff")) {
  if (PROVIDER !== "elevenlabs") {
    console.error("--bakeoff renders ElevenLabs candidates — run with --provider elevenlabs");
    process.exit(1);
  }
  const candidates = [
    { name: "rachel-retuned", id: "21m00Tcm4TlvDq8ikWAM" },
    { name: "matilda", id: "XrExE9yKIg1WjnnlVkGX" },
    { name: "jessica", id: "cgSgspJ2msm6clMCkdW9" },
  ];
  const sampleDir = path.join(PUBLISH, "voice-samples");
  fs.mkdirSync(sampleDir, { recursive: true });
  const sampleText = SPECS.promo.lines[0].text;
  for (const c of candidates) {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${c.id}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `<break time="0.5s" /> ${sampleText}`,
          model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.4, similarity_boost: 0.75, style: 0.35, use_speaker_boost: true },
        }),
      },
    );
    if (!res.ok) throw new Error(`ElevenLabs ${res.status} for ${c.name}`);
    fs.writeFileSync(path.join(sampleDir, `${c.name}.mp3`), Buffer.from(await res.arrayBuffer()));
    console.log(`  sample: voice-samples/${c.name}.mp3 (${c.id})`);
  }
  console.log(`\nListen in ${sampleDir}, then re-run with --voice <id> for the winner.`);
  process.exit(0);
}
const inFile = path.join(PUBLISH, spec.in);
if (!fs.existsSync(inFile)) {
  console.error(`Missing ${inFile} — build it first.`);
  process.exit(1);
}
const videoDur = dur(inFile);

console.log(`Voicing ${spec.in} (${videoDur.toFixed(1)}s) with ${PROVIDER} voice ${VOICE}…`);
let chars = 0;
const prepared = [];
for (const [i, line] of spec.lines.entries()) {
  chars += line.text.length;
  let file, cached;
  if (PROVIDER === "gemini") {
    // Take-to-take variance is the preview model's weak spot; if a take runs
    // past its window, re-roll (cached per take index, so takes are stable)
    // and keep the shortest before falling back to the atempo squeeze.
    let best = null;
    for (let take = 0; take < 3; take++) {
      const t = await ttsGemini(key, line, take);
      const td = dur(t.file);
      if (!best || td < best.d) best = { ...t, d: td };
      if (td <= line.maxSec) break;
      console.log(`  line ${i + 1} take ${take + 1}: ${td.toFixed(1)}s > ${line.maxSec}s, re-rolling…`);
    }
    ({ file, cached } = best);
  } else {
    ({ file, cached } = await tts(key, line.text));
  }
  let d = dur(file);
  let use = file;
  let tempo = 1;
  if (d > line.maxSec) {
    tempo = Math.min(1.1, d / line.maxSec);
    const squeezed = file.replace(/\.mp3$/, `-t${tempo.toFixed(3)}.mp3`);
    sh("ffmpeg", ["-y", "-i", file, "-af", `atempo=${tempo.toFixed(4)}`, squeezed]);
    use = squeezed;
    d = dur(use);
    if (d > line.maxSec + 0.15) {
      console.error(
        `Line ${i + 1} is ${d.toFixed(1)}s even at ${tempo.toFixed(2)}x — max ${line.maxSec}s. Shorten: "${line.text.slice(0, 60)}…"`,
      );
      process.exit(1);
    }
  }
  prepared.push({ ...line, file: use, dur: d });
  // Self-check: every processed line must open on silence (the 60ms pad plus
  // whatever quiet lead survived). Sound at sample zero means a clipped onset.
  const lead = leadingSilence(["-i", use], -40, 0.03);
  console.log(
    `  line ${i + 1} @${line.at}s: ${d.toFixed(1)}s / ${line.maxSec}s · lead ${Math.round(lead * 1000)}ms${tempo > 1 ? ` (atempo ${tempo.toFixed(2)})` : ""}${cached ? " [cached]" : ""}`,
  );
  if (lead < 0.02) {
    console.warn(
      `  WARNING line ${i + 1} starts on sound — first word may be clipped: "${line.text.slice(0, 50)}…"`,
    );
  }
}
console.log(`  total ${chars} characters sent to TTS`);

// Build the mix: each line gets 120ms of pre-roll after its scheduled offset,
// then all lines are mixed. TTS files can begin on a non-zero sample; the
// pre-roll prevents players and AAC priming from making the first consonant
// sound clipped while preserving the intended visual beat.
const inputs = ["-i", inFile];
const parts = [];
const VOICE_PREROLL_MS = 120;
prepared.forEach((l, i) => {
  inputs.push("-i", l.file);
  const delayMs = Math.round(l.at * 1000) + VOICE_PREROLL_MS;
  parts.push(
    `[${i + 1}:a]adelay=${delayMs}|${delayMs},apad[v${i}]`,
  );
});
// Mix all lines, then master the VO bus: gentle compression for presence, then
// loudness normalization to the -16 LUFS streaming standard. This is what makes
// raw TTS sit like produced narration instead of a thin voice memo.
const MASTER =
  "acompressor=threshold=-21dB:ratio=3:attack=10:release=180:makeup=3dB," +
  "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000";
const voMix = `${parts.join(";")};${prepared.map((_, i) => `[v${i}]`).join("")}amix=inputs=${prepared.length}:normalize=0,atrim=0:${videoDur.toFixed(2)},${MASTER}[vo]`;

let filter, mapAudio;
const hasSourceAudio =
  sh("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", inFile]) !== "";
if (MUSIC || hasSourceAudio) {
  // Duck the bed under narration (VO drives the sidechain), then sum.
  const bedIdx = prepared.length + 1;
  if (MUSIC) inputs.push("-i", MUSIC);
  const bedSrc = MUSIC ? `[${bedIdx}:a]` : `[0:a]`;
  filter =
    `${voMix};` +
    `${bedSrc}atrim=0:${videoDur.toFixed(2)},volume=0.9[bed];` +
    `[vo]asplit=2[voMain][voSc];` +
    `[bed][voSc]sidechaincompress=threshold=0.03:ratio=12:attack=40:release=400[ducked];` +
    `[voMain][ducked]amix=inputs=2:normalize=0[aout]`;
  mapAudio = "[aout]";
} else {
  filter = voMix;
  mapAudio = "[vo]";
}

const outName =
  PROVIDER === "elevenlabs" ? spec.out.replace(/\.mp4$/, "-elevenlabs.mp4") : spec.out;
const outFile = path.join(PUBLISH, outName);
sh("ffmpeg", [
  "-y", ...inputs,
  "-filter_complex", filter,
  "-map", "0:v", "-map", mapAudio,
  "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
  "-t", videoDur.toFixed(2),
  outFile,
]);

const outDur = dur(outFile);
console.log(`\nDone: ${outFile}`);
console.log(`Duration: ${outDur.toFixed(1)}s (video ${videoDur.toFixed(1)}s)`);
