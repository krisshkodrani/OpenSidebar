import { ToolName } from "../../types";
import type { ToolProfile } from "../tools/metadata";

import { SKILL_CATALOG } from "./skill-catalog";
import { SKILL_BODIES } from "./skill-bodies";
import type {
  SkillCapability,
  SkillDescriptor,
  SkillPack,
  SkillCatalogOptions,
  SkillToolPolicy,
  SkillToolSuppressionPolicy,
  SkillSelection,
  SkillMatcherInput,
  SkillActivationSignalStrength,
  SkillCandidateDescriptor,
  SkillMatcher,
  LoadedSkillContract,
} from "./skill-types";
export * from "./skill-types";


const MAX_ROUTED_SKILL_CANDIDATES = 32;

const BUILT_IN_SKILL_PACKS: SkillPack[] = [
  {
    id: "communication-workflows",
    name: "Communication Workflows",
    description:
      "Default communication skills for careful email and message composition workflows.",
    type: "enterprise",
    enabledByDefault: true,
    skillIds: ["email-reply-careful"],
  },
  {
    id: "procurement-workflows",
    name: "Multi-Tab Workflows",
    description:
      "Default checklist skills for source-list workflows that intentionally span multiple tabs.",
    type: "enterprise",
    enabledByDefault: true,
    skillIds: ["multi-tab-checklist-workflow"],
  },
  {
    id: "servicenow-platform",
    name: "ServiceNow Platform",
    description:
      "ServiceNow-specific platform semantics for application modules, record forms, reference fields, and Glide-backed commits.",
    type: "platform",
    enabledByDefault: true,
    skillIds: ["servicenow-module-navigation", "servicenow-record-form"],
  },
];


const comparePattern =
  /\b(compare|based on both|across both|both tabs?|two tabs?|multiple tabs?|two pages?|multiple pages?|support dashboard.*marketing dashboard|marketing dashboard.*support dashboard)\b/i;
const hoverRevealPattern =
  /\b(hover|hover over|tooltip|flyout|reveal menu|products menu|under the .* menu)\b/i;
const budgetPattern =
  /\b(turn budget|remaining turns|max turns|max_turns|turn limit|budget exhaustion|conservation mode)\b/i;
const continuationPattern =
  /\b(change|revise|rewrite|edit|one more change|previous draft|draft reply|continue previous task|make (?:it|the tone)|reply|casual)\b/i;
const continuationArtifactPattern =
  /\b(draft|reply|tone|email|message|copy|text|wording|paragraph|sentence)\b/i;
const continuationRevisionPattern =
  /\b(change|revise|rewrite|edit|one more change|previous draft|current draft|make (?:it|the tone)|keep the rest|preserve)\b/i;
const gridEditPattern = /\b(spreadsheet|grid|cell|row|column|sheet|table)\b/i;
const inlineEditPattern =
  /\b(rename|inline edit|inline rename|change .* value|update .* value|replace .* value|edit .* cell|rename .* to|filename|file name|document name|table cell|grid cell)\b/i;
const cartPattern =
  /\b(cart|checkout|coupon|promo|discount|swap|replace|remove|add to cart)\b/i;
const emailReplyPattern =
  /\b(?:reply|respond|draft|compose)\b[\s\S]{0,100}\b(?:email|e-mail|mail|inbox|subject|sender|recipient)\b|\b(?:email|e-mail|mail|inbox)\b[\s\S]{0,100}\b(?:reply|response|draft)\b|\bsend\b[\s\S]{0,80}\b(?:email|e-mail|mail)\b[\s\S]{0,80}\b(?:reply|response|to|confirm|acknowledge)\b/i;
const threadMessagePattern =
  /\b(?:reply|respond|post|send|compose)\b[\s\S]{0,120}\b(?:thread|chat|channel|conversation|team thread|team chat|message thread|direct message|dm|comment)\b|\b(?:thread|chat|channel|conversation|messaging|message thread|team thread|project-updates)\b[\s\S]{0,120}\b(?:reply|respond|post|send|compose)\b/i;
const crmTicketPattern =
  /\b(?:crm|support\s+ticket|ticket|case|incident)\b[\s\S]{0,140}\b(?:status|priority|assignee|category|tag|triage|escalat\w*|internal note|comment|customer impact|account context|next step|update)\b|\b(?:set|update|triage|escalat\w*|add)\b[\s\S]{0,140}\b(?:support\s+ticket|ticket|case|incident|internal note)\b/i;
const chartValuePattern =
  /\b(chart|dashboard|graph|plot|bar chart|line chart|pie chart|highcharts|visualization|report widget)\b/i;
const chartValueIntentPattern =
  /\b(value|number|count|total|metric|data point|series|category|legend|axis|bar|slice|point|how many|amount)\b/i;
const searchAnswerPattern =
  /\b(knowledge base|kb article|search results?|search knowledge|find (?:the )?answer|look up|answer the question|article)\b/i;
const listFilterPattern =
  /\b(filter|condition builder|filter builder|show records where|query list|apply [^.\n]{0,80}filter|add [^.\n]{0,80}condition)\b/i;
const listSortPattern =
  /\b(sort|order by|ascending|descending|sort column|sort [^.\n]{0,80}list|sort [^.\n]{0,80}table)\b/i;
const listRowActionPattern =
  /\b(delete|remove|mark [^.\n]{0,80}duplicate|selected rows?|list action|row action|actions? on selected rows?)\b/i;
const catalogOrderPattern =
  /\b(service catalog|catalog item|request item|hardware store|hardware catalog|catalog option|optional software|add to cart|order now|place order|submit order|request [^.\n]{0,80}catalog|order\s+\d+\s+"[^"]{3,120}"\s+with\s+configuration)\b/i;
const serviceNowModuleNavigationPattern =
  /\b(application navigator|module of the|module in the|navigate to (?:the )?[^.\n]{0,120}module|open (?:the )?[^.\n]{0,120}module|(?:service\s*now|servicenow)[^.\n]{0,80}\bmodule\b|\bmodule\b[^.\n]{0,80}\b(?:service\s*now|servicenow))\b/i;
const formPattern =
  /\b(form|fill|input|field|dropdown|checkbox|select|budget|category|submit)\b/i;
const fieldValueRecordFormPattern =
  /\bvalue\s+of\s+(["'])[\s\S]*?\1\s+for\s+field\s+(["'])[\s\S]*?\2/i;
const serviceNowRecordFormPattern =
  /\b(?:service[-\s]*now|servicenow|incident|change request|problem|hardware asset|asset|user record|record)\b/i;
const configuratorPattern =
  /\b(configure|configurator|pick|choose|select|enable|disable)\b[\s\S]{0,120}\b(size|option|engraving|color|variant|total price|total|price|summary)\b/i;
const profileFieldPattern =
  /\b(saved profile|profile field|profile data|identity\.(?:first_name|last_name|email)|full name|email address)\b/i;
const progressiveRepeatableFormPattern =
  /\b(?:add|create|insert)\b[\s\S]{0,120}\b(?:another|multiple|several|\d+|two|three|four|five|sections?|roles?|experiences?|education|addresses?|dependents?)\b[\s\S]{0,120}\b(?:section|role|experience|education|address|dependent|form group|field group)s?\b|\b(?:add|create|insert)\b[\s\S]{0,120}\b(?:experience|education|address|dependent|role|work history|employment history)\s+entries\b|\b(?:experience|education|address|dependent|role|employment history|work history)\s+\d+\b|\b(?:roles?|experiences?|sections?)\b[\s\S]{0,80}\b(?:in order|repeatable|repeated|add another|add item|add experience)\b/i;
const multiStepFormWizardPattern =
  /\b(?:multi[-\s]?step|wizard|step\s+\d|next\s+step|continue\s+(?:to|through)|review\s+(?:step|details|page|summary))\b[\s\S]{0,160}\b(?:form|request|application|enrollment|intake|submit|submission)\b|\b(?:form|request|application|enrollment|intake)\b[\s\S]{0,160}\b(?:multi[-\s]?step|wizard|next|continue\s+(?:to|through)|review\s+(?:step|details|page|summary))\b/i;
const conditionalFormPattern =
  /\b(?:conditional|depends on|reveals?|appears?|hidden|required if|only if)\b[\s\S]{0,120}\b(?:field|fields|section|question|checkbox|dropdown|radio|select)\b|\b(?:field|fields|section|question)\b[\s\S]{0,120}\b(?:appears?|reveals?|required if|only if)\b/i;
const consequentialActionConsentPattern =
  /\b(?:wait for|ask for|request|get)\s+(?:my\s+|user\s+)?(?:approval|confirmation|permission|go-ahead)\b|\b(?:prepare|fill|draft|stage|review)\b[\s\S]{0,100}\b(?:but\s+)?(?:do not|don't|without)\s+(?:submit|send|post|publish|buy|purchase|place|delete|confirm|approve)\b|\b(?:final approval|required approval|approval required|ask before)\b/i;
const finalConsequentialActionPattern =
  /\b(?:submit|send|post|publish|buy|purchase|place order|delete|confirm|approve|apply)\b/i;
const jobApplicationPattern =
  /\b(?:job|career|position|vacancy|resume|cv)\b[\s\S]{0,160}\b(?:apply|application|submit|form|cover letter|resume|cv)\b|\b(?:apply|application|submit)\b[\s\S]{0,160}\b(?:job|career|position|vacancy|resume|cv)\b/i;
const jobApplicationPageUrlPattern =
  /\b(?:jobs\.ashbyhq\.com|greenhouse\.io|lever\.co|workdayjobs\.com|smartrecruiters\.com|jobvite\.com|bamboohr\.com|applytojob\.com)\b/i;
const jobApplicationFieldPattern =
  /\b(?:resume|cv|cover letter|linkedin|salary expectation|work authorization|work authorisation|work permit|sponsorship|earliest start date|notice period|why do you care|why .* company)\b/i;
const ashbyJobApplicationPattern =
  /\b(?:jobs\.ashbyhq\.com|ashbyhq|ashby(?:[-\s]+hosted)?\s+(?:job\s+)?application|ashby)\b/i;
const transactionPattern =
  /\b(verify|confirm|check|delete account|dismiss popups?|inspect|status|activity feed|posted comment|ticket status)\b/i;
const navigateReturnPattern =
  /\b(go (?:to|back)|come back|return (?:to|after)|look up .* (?:then|and) return|check .* (?:then|and) (?:come|go) back|find .* details|job (?:listing|board|posting)|round.?trip)\b/i;
const listDetailReviewPattern =
  /\b(review|read|open|check)\b[\s\S]{0,120}\b(each|every|all)\b[\s\S]{0,120}\b(listing|listings|jobs|job listing|postings|items|results)\b/i;
const listReturnPattern =
  /\b(return|come back|go back|back to (?:the )?(?:list|listings)|one by one)\b/i;
const listReviewSurfacePattern =
  /\b(job board|job listings?|job postings?|jobs\b|listings?|results page|search results|candidate list)\b/i;
const listRecommendationIntentPattern =
  /\b(review|evaluate|compare|recommend|rank|shortlist|best matches?|best fit|which (?:ones|jobs|listings)|matches? (?:for|to)|fit (?:my|the|this) profile|why)\b/i;
const paginatedDataSurfacePattern =
  /\b(paginated|pagination|page\s+\d+\s+of\s+\d+|showing\s+\d+\s*(?:-|to|\u2012|\u2013|\u2014)\s*\d+\s+of\s+\d+|per\s+page|next\s+page|previous\s+page|table|directory|records?|rows?|employees?|items?|results?|data-table|feed)\b/i;
const tableAggregateIntentPattern =
  /\b(highest|max(?:imum)?|largest|most|lowest|min(?:imum)?|smallest|least)\b[\s\S]{0,120}\b(salar(?:y|ies)|pay|compensation|price|cost|amount|revenue|budget|value|total|score)\b|\b(salar(?:y|ies)|pay|compensation|price|cost|amount|revenue|budget|value|total|score)\b[\s\S]{0,120}\b(highest|max(?:imum)?|largest|most|lowest|min(?:imum)?|smallest|least)\b/i;
const paginatedRecordLookupIntentPattern =
  /\b(find|search for|look up|locate|open|review)\b[\s\S]{0,120}\b(?:#[0-9]+|[A-Z]+-\d+|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?|post\s+#?\d+|record|row|ticket|employee|item)\b|\b(?:salary|status|priority|code|amount|email|owner|count)\b[\s\S]{0,120}\b(?:for|of)\b[\s\S]{0,80}\b(?:#[0-9]+|[A-Z]+-\d+|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i;
const procurementLoopPattern =
  /\b(procurement|purchase|buy)\b[\s\S]{0,160}\b(new tab|another tab|each store|store page|store link)\b[\s\S]{0,160}\b(check (?:it|them) off|mark (?:it|them) done|come back and check|return and check|checkbox)\b/i;
const naturalProcurementChecklistPattern =
  /\b(?:buy|purchase|procure)\b[\s\S]{0,120}\b(?:first\s+\w+|first\s+\d+|\d+)\s+items?\b[\s\S]{0,120}\bprocurement\s+list\b[\s\S]{0,120}\b(?:mark|check)\s+(?:them|items?|rows?)\s+(?:complete|done|off)\b/i;
const explicitTabIntentPattern =
  /\b(?:new|separate|another|other|multiple)\s+tabs?\b|\bopen\b[\s\S]{0,60}\b(?:tabs?|new windows?)\b|\bswitch\b[\s\S]{0,40}\btabs?\b|\bacross\s+tabs?\b/i;
const sourceListLoopPattern =
  /\b(?:source\s+)?(?:list|checklist|rows?|items?|links?|listings?|articles?|dashboards?|reports?|job listings?|research links?)\b/i;
const sourceProgressPattern =
  /\b(?:return|come back|switch back|go back)\b[\s\S]{0,120}\b(?:source|list|checklist|board|page|tab)\b|\b(?:mark|check|record|note)\b[\s\S]{0,80}\b(?:done|complete|reviewed|finished|progress|each|item|row|article)\b/i;
const repeatedItemPattern =
  /\b(?:first\s+\w+|first\s+\d+|\d+|two|three|four|five|six|seven|eight|nine|ten|all|each|every)\s+(?:items?|rows?|links?|listings?|articles?|dashboards?|dashboard\s+tabs?|reports?|jobs?)\b/i;
const overlayRecoveryPattern =
  /\b(close .* (?:banner|popup|modal|overlay|dialog)|dismiss .* (?:popup|modal|overlay|banner)|cookie (?:banner|consent|popup)|newsletter (?:popup|modal)|can'?t see the page|blocking (?:modal|overlay|popup)|popups? (?:blocking|covering|obscuring)|clear (?:the )?(?:popup|modal|overlay)s?)\b/i;

function buildCorpus(parts: Array<string | undefined>): string {
  return parts
    .filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    )
    .join("\n")
    .toLowerCase();
}

function buildRoutingCorpus(input: SkillMatcherInput): string {
  return buildCorpus([
    input.query,
    input.objective,
    input.successCriteria,
    input.pageTitle,
    ...(input.pageMarkers ?? []),
    ...(input.runtimeContext ?? []),
  ]);
}

function hasJobApplicationSignal(
  input: SkillMatcherInput,
  corpus: string,
): boolean {
  return (
    jobApplicationPattern.test(corpus) ||
    jobApplicationPageUrlPattern.test(input.pageUrl ?? "") ||
    (/\bapplication\b/i.test(corpus) && jobApplicationFieldPattern.test(corpus))
  );
}

function hasAshbyJobApplicationSignal(
  input: SkillMatcherInput,
  corpus: string,
): boolean {
  const ashbyCorpus = buildCorpus([
    input.pageUrl,
    input.pageTitle,
    ...(input.pageMarkers ?? []),
    ...(input.runtimeContext ?? []),
  ]);
  return (
    /\bjobs\.ashbyhq\.com\b/i.test(input.pageUrl ?? "") ||
    (ashbyJobApplicationPattern.test(`${ashbyCorpus}\n${corpus}`) &&
      hasJobApplicationSignal(input, corpus))
  );
}

function stripBenchmarkTaskIds(text: string): string {
  return text.replace(/\bworkarena\.[a-z0-9_.-]+\b/gi, " ");
}

/**
 * Domain-INDEPENDENT ServiceNow URL-path fingerprints (Next Experience nav shell,
 * Glide list/form `.do` endpoints, sys_id / sysparm query params). These identify
 * a ServiceNow instance even when it is hosted on a custom/vanity domain (many
 * enterprises reverse-proxy or self-host, so the `.service-now.com` hostname is
 * absent). They are ServiceNow-specific enough to avoid matching generic ITSM
 * sites — e.g. `helpdesk.example.com/incidents/new` has none of them.
 */
const SERVICENOW_URL_PATH_FINGERPRINT =
  /\/now\/(?:nav|workspace|sow|cwf|wb|agent)\/|\bnav_to\.do\b|\b[a-z0-9_]+_list\.do\b|\.do\?[^#]*\bsys_id=|\bsysparm_[a-z_]+=/i;

function hasServiceNowUrlSignal(pageUrl?: string): boolean {
  if (!pageUrl) return false;
  try {
    const url = new URL(pageUrl);
    const host = url.hostname.toLowerCase();
    if (
      host.endsWith(".service-now.com") ||
      host.endsWith(".servicenow.com") ||
      host === "service-now.com" ||
      host === "servicenow.com"
    ) {
      return true;
    }
    // Custom-hosted ServiceNow: recognize the platform by its URL fingerprints.
    return SERVICENOW_URL_PATH_FINGERPRINT.test(
      `${url.pathname}${url.search}`,
    );
  } catch {
    return (
      /\b(?:service-now|servicenow)\.com\b/i.test(pageUrl) ||
      SERVICENOW_URL_PATH_FINGERPRINT.test(pageUrl)
    );
  }
}

function getServiceNowActivationReason(
  input: SkillMatcherInput,
): string | null {
  if (hasServiceNowUrlSignal(input.pageUrl)) {
    return "ServiceNow URL host is active.";
  }

  const markerCorpus = buildCorpus([
    input.pageTitle,
    ...(input.pageMarkers ?? []),
    ...(input.runtimeContext ?? []),
  ]);
  if (/\b(?:service\s*now|servicenow)\b/i.test(markerCorpus)) {
    return "ServiceNow page or runtime marker is active.";
  }

  const taskCorpus = stripBenchmarkTaskIds(
    buildCorpus([input.query, input.objective, input.successCriteria]),
  );
  if (/\b(?:service\s*now|servicenow)\b/i.test(taskCorpus)) {
    return "User explicitly named ServiceNow as the target environment.";
  }

  return null;
}

function hasCommunicationPackSignal(input: SkillMatcherInput): boolean {
  const corpus = buildRoutingCorpus(input);
  return emailReplyPattern.test(corpus) || threadMessagePattern.test(corpus);
}

function hasProcurementPackSignal(input: SkillMatcherInput): boolean {
  const corpus = buildRoutingCorpus(input);
  return (
    naturalProcurementChecklistPattern.test(corpus) ||
    procurementLoopPattern.test(corpus) ||
    (explicitTabIntentPattern.test(corpus) &&
      sourceListLoopPattern.test(corpus) &&
      repeatedItemPattern.test(corpus) &&
      sourceProgressPattern.test(corpus))
  );
}

function isPackPolicyEnabled(
  pack: SkillPack,
  options?: SkillCatalogOptions,
): boolean {
  const enabledSkillPackIds = resolveEnabledSkillPackIds(options);
  return !enabledSkillPackIds || enabledSkillPackIds.has(pack.id);
}

function getPackActivationReason(
  pack: SkillPack,
  input: SkillMatcherInput,
): { reason: string; strength: SkillActivationSignalStrength } | null {
  if (
    pack.id === "communication-workflows" &&
    hasCommunicationPackSignal(input)
  ) {
    return {
      reason: "Communication workflow signals are present.",
      strength: "weak",
    };
  }

  if (pack.id === "procurement-workflows" && hasProcurementPackSignal(input)) {
    return {
      reason:
        "Source-list or multi-tab checklist workflow signals are present.",
      strength: "weak",
    };
  }

  if (pack.id === "servicenow-platform") {
    const reason = getServiceNowActivationReason(input);
    return reason ? { reason, strength: "strong" } : null;
  }

  return null;
}

export function resolveEligibleSkillCandidates(
  input: SkillMatcherInput,
): SkillCandidateDescriptor[] {
  const candidates: SkillCandidateDescriptor[] = [];
  const seen = new Set<string>();
  const policyOptions: SkillCatalogOptions = {
    enabledSkillPackIds: input.enabledSkillPackIds,
  };

  const addSkill = (
    skill: SkillDescriptor,
    activationReason: string,
    signalStrength: SkillActivationSignalStrength,
  ) => {
    if (seen.has(skill.id)) return;
    seen.add(skill.id);
    candidates.push({
      skill: cloneSkillDescriptor(skill),
      packId: skill.packId,
      activationReason,
      signalStrength,
    });
  };

  for (const skill of SKILL_CATALOG) {
    if (!skill.packId) {
      addSkill(skill, "Core workflow skills are always eligible.", "always");
    }
  }

  for (const pack of BUILT_IN_SKILL_PACKS) {
    if (!isPackPolicyEnabled(pack, policyOptions)) continue;
    const activation = getPackActivationReason(pack, input);
    if (!activation) continue;
    for (const skillId of pack.skillIds) {
      const skill = SKILL_CATALOG.find((candidate) => candidate.id === skillId);
      if (skill) addSkill(skill, activation.reason, activation.strength);
    }
  }

  const activatedPackCandidates = candidates.filter(
    (candidate) => candidate.packId,
  );
  const coreCandidates = candidates.filter((candidate) => !candidate.packId);
  return [...activatedPackCandidates, ...coreCandidates].slice(
    0,
    MAX_ROUTED_SKILL_CANDIDATES,
  );
}

function cloneSkillPack(pack: SkillPack): SkillPack {
  return {
    ...pack,
    skillIds: [...pack.skillIds],
  };
}

function cloneSkillDescriptor(skill: SkillDescriptor): SkillDescriptor {
  return {
    ...skill,
    tags: [...skill.tags],
    triggers: [...skill.triggers],
    preferredTools: skill.preferredTools
      ? [...skill.preferredTools]
      : undefined,
    discouragedTools: skill.discouragedTools
      ? [...skill.discouragedTools]
      : undefined,
    capabilityNeeds: skill.capabilityNeeds
      ? [...skill.capabilityNeeds]
      : undefined,
    requiredEvidenceTypes: skill.requiredEvidenceTypes
      ? [...skill.requiredEvidenceTypes]
      : undefined,
    notes: skill.notes ? [...skill.notes] : undefined,
  };
}

function resolveEnabledSkillPackIds(
  options?: SkillCatalogOptions,
): Set<string> | null {
  if (!options?.enabledSkillPackIds) return null;
  return new Set(options.enabledSkillPackIds);
}

function isSkillDescriptorEnabled(
  skill: SkillDescriptor,
  options?: SkillCatalogOptions,
): boolean {
  if (
    options?.candidateSkillIds &&
    !new Set(options.candidateSkillIds).has(skill.id)
  ) {
    return false;
  }
  if (!skill.packId) return true;
  const enabledSkillPackIds = resolveEnabledSkillPackIds(options);
  if (!enabledSkillPackIds) return true;
  return enabledSkillPackIds.has(skill.packId);
}

function selectEnabledSkill(
  input: SkillCatalogOptions,
  id: string,
  reason: string,
): SkillSelection | null {
  if (!getSkillDescriptor(id, input)) return null;
  return { id, reason };
}

export function listSkillPacks(): SkillPack[] {
  return BUILT_IN_SKILL_PACKS.map(cloneSkillPack);
}

export function listDefaultEnabledSkillPackIds(): string[] {
  return BUILT_IN_SKILL_PACKS.filter((pack) => pack.enabledByDefault).map(
    (pack) => pack.id,
  );
}

export function getSkillPack(id: string): SkillPack | undefined {
  const pack = BUILT_IN_SKILL_PACKS.find((candidate) => candidate.id === id);
  return pack ? cloneSkillPack(pack) : undefined;
}

export function listSkillDescriptors(
  options?: SkillCatalogOptions,
): SkillDescriptor[] {
  return SKILL_CATALOG.filter((skill) =>
    isSkillDescriptorEnabled(skill, options),
  ).map(cloneSkillDescriptor);
}

export function getSkillDescriptor(
  id: string,
  options?: SkillCatalogOptions,
): SkillDescriptor | undefined {
  const skill = SKILL_CATALOG.find((candidate) => candidate.id === id);
  if (!skill || !isSkillDescriptorEnabled(skill, options)) return undefined;
  return cloneSkillDescriptor(skill);
}

export function getLoadedSkillContract(
  id?: string,
  options?: SkillCatalogOptions,
): LoadedSkillContract | null {
  if (!id) return null;
  const descriptor = getSkillDescriptor(id, options);
  const body = SKILL_BODIES[id];
  if (!descriptor || !body) return null;
  return {
    ...descriptor,
    ...body,
  };
}

const TOOL_NAME_VALUES = new Set<string>(Object.values(ToolName));

function normalizeSkillTools(tools?: string[]): ToolName[] {
  if (!Array.isArray(tools)) return [];
  return tools.filter(
    (tool): tool is ToolName =>
      typeof tool === "string" && TOOL_NAME_VALUES.has(tool),
  );
}

export function getSkillToolPolicy(
  id?: string,
  options?: SkillCatalogOptions,
): SkillToolPolicy | null {
  const descriptor = getSkillDescriptor(id || "", options);
  if (!descriptor) return null;
  return {
    preferredTools: normalizeSkillTools(descriptor.preferredTools),
    discouragedTools: normalizeSkillTools(descriptor.discouragedTools),
  };
}

function hasCapability(
  descriptor: SkillDescriptor,
  capability: SkillCapability,
): boolean {
  return descriptor.capabilityNeeds?.includes(capability) ?? false;
}

function hasCommunicationWriteIntent(text: string): boolean {
  return (
    /\b(reply|respond|post|send|compose|write back)\b/i.test(text) ||
    /\bdraft\b[^.\n]{0,80}\b(reply|email|e-mail|message|comment|response)\b/i.test(
      text,
    ) ||
    /\b(reply|email|e-mail|message|comment|response)\b[^.\n]{0,80}\bdraft\b/i.test(
      text,
    ) ||
    /\bwrite\b[^.\n]{0,60}\b(message|comment|reply|response)\b/i.test(text)
  );
}

function hasRecordMutationIntent(text: string): boolean {
  return (
    /\b(update|set|change|assign|reassign|escalate|save|submit|mark|close|reopen)\b[^.\n]{0,100}\b(ticket|case|record|status|priority|assignee|owner|category|tag|field|escalation)\b/i.test(
      text,
    ) ||
    /\b(add|write|post)\b[^.\n]{0,80}\b(internal note|note|comment)\b/i.test(
      text,
    )
  );
}

function hasServiceNowRecordSubmitIntent(text: string): boolean {
  if (
    /\b(?:submit the form|form submission completes|submitted record|created record|created\/updated record|confirmation|resulting item page)\b/i.test(
      text,
    )
  ) {
    return true;
  }

  if (
    /\b(?:do not submit|not submit|ready to submit|submit action has not been clicked|has not been submitted)\b/i.test(
      text,
    )
  ) {
    return false;
  }

  return /\bcreate\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:incident|change request|problem|record|user|hardware asset|asset)\b/i.test(
    text,
  );
}

export function resolveSkillToolProfile(
  id: string | null | undefined,
  objective: string,
  successCriteria: string,
  currentProfile?: ToolProfile,
  options?: SkillCatalogOptions,
): ToolProfile | undefined {
  const descriptor = getSkillDescriptor(id || "", options);
  if (!descriptor) return currentProfile;

  const text = `${objective}\n${successCriteria}`;

  if (descriptor.id === "catalog-order-workflow") {
    return "full";
  }

  if (descriptor.id === "servicenow-module-navigation") {
    return "navigate";
  }

  if (descriptor.id === "servicenow-record-form") {
    return hasServiceNowRecordSubmitIntent(text) ? "submit_form" : "form_fill";
  }

  if (
    descriptor.id === "job-application-assistant" ||
    descriptor.id === "ashby-job-application-assistant" ||
    descriptor.id === "progressive-repeatable-form" ||
    descriptor.id === "multi-step-form-wizard"
  ) {
    return "form_fill";
  }

  if (
    (hasCapability(descriptor, "compose_response") ||
      hasCapability(descriptor, "submit_response")) &&
    hasCommunicationWriteIntent(text)
  ) {
    return "submit_form";
  }

  if (
    (hasCapability(descriptor, "update_record") ||
      hasCapability(descriptor, "add_note")) &&
    hasRecordMutationIntent(text)
  ) {
    return "form_fill";
  }

  if (descriptor.id === "list-filter-workflow") {
    return "form_fill";
  }

  if (descriptor.id === "list-sort-workflow") {
    return "form_fill";
  }

  if (descriptor.id === "list-row-action-workflow") {
    return "form_fill";
  }

  if (descriptor.id === "chart-value-extraction") {
    return "read_only";
  }

  return currentProfile;
}

const SKILL_TOOL_SUPPRESSION_POLICIES: Record<
  string,
  SkillToolSuppressionPolicy
> = {
  "hover-reveal-navigation": {
    temporarilySuppressedTools: [
      ToolName.HIDE_ELEMENT,
      ToolName.INSPECT_HIDDEN,
      ToolName.XRAY_PAGE,
      ToolName.EXECUTE_JS,
      ToolName.CLICK_COORDINATES,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
    ],
  },
  "structured-form-fill": {
    temporarilySuppressedTools: [
      ToolName.PRESS_KEY,
      ToolName.XRAY_PAGE,
      ToolName.CLICK_COORDINATES,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
    ],
  },
  "progressive-repeatable-form": {
    temporarilySuppressedTools: [
      ToolName.NAVIGATE,
      ToolName.OPEN_SERVICENOW_MODULE,
      ToolName.GO_BACK,
      ToolName.CREATE_TAB,
      ToolName.LIST_TABS,
      ToolName.INSPECT_HIDDEN,
      ToolName.XRAY_PAGE,
      ToolName.PRESS_KEY,
      ToolName.CLICK_COORDINATES,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
    ],
  },
  "multi-step-form-wizard": {
    temporarilySuppressedTools: [
      ToolName.NAVIGATE,
      ToolName.OPEN_SERVICENOW_MODULE,
      ToolName.GO_BACK,
      ToolName.CREATE_TAB,
      ToolName.LIST_TABS,
      ToolName.INSPECT_HIDDEN,
      ToolName.XRAY_PAGE,
      ToolName.PRESS_KEY,
      ToolName.CLICK_COORDINATES,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
    ],
  },
  "servicenow-record-form": {
    temporarilySuppressedTools: [
      ToolName.CLICK_ELEMENT,
      ToolName.PRESS_KEY,
      ToolName.CLICK_COORDINATES,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
      ToolName.CONFIGURE_SERVICENOW_FORM,
    ],
  },
  "inline-edit-surface": {
    temporarilySuppressedTools: [ToolName.CLICK_COORDINATES],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
    ],
  },
  "modal-overlay-recovery": {
    temporarilySuppressedTools: [
      ToolName.DISMISS_OVERLAYS,
      ToolName.NAVIGATE,
      ToolName.TYPE_TEXT,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
    ],
  },
  "multi-tab-checklist-workflow": {
    temporarilySuppressedTools: [
      ToolName.NAVIGATE,
      ToolName.GO_BACK,
      ToolName.READ_ELEMENT,
      ToolName.LIST_TABS,
      ToolName.INSPECT_HIDDEN,
      ToolName.XRAY_PAGE,
      ToolName.CLICK_COORDINATES,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
    ],
  },
  "list-detail-review-loop": {
    temporarilySuppressedTools: [
      ToolName.NAVIGATE,
      ToolName.GO_BACK,
      ToolName.PRESS_KEY,
      ToolName.READ_ELEMENT,
      ToolName.FIND_ELEMENT,
      ToolName.INSPECT_HIDDEN,
      ToolName.XRAY_PAGE,
      ToolName.CLICK_COORDINATES,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
    ],
  },
  "paginated-table-scan": {
    temporarilySuppressedTools: [
      ToolName.NAVIGATE,
      ToolName.GO_BACK,
      ToolName.READ_ELEMENT,
      ToolName.FIND_ELEMENT,
      ToolName.TYPE_TEXT,
      ToolName.PRESS_KEY,
      ToolName.SELECT_OPTION,
      ToolName.SET_CHECKBOX,
      ToolName.SCROLL_PAGE,
      ToolName.INSPECT_HIDDEN,
      ToolName.XRAY_PAGE,
      ToolName.EXECUTE_JS,
      ToolName.CLICK_COORDINATES,
      ToolName.CREATE_TAB,
      ToolName.LIST_TABS,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
    ],
  },
  "paginated-record-lookup": {
    temporarilySuppressedTools: [
      ToolName.NAVIGATE,
      ToolName.GO_BACK,
      ToolName.READ_ELEMENT,
      ToolName.PRESS_KEY,
      ToolName.INSPECT_HIDDEN,
      ToolName.XRAY_PAGE,
      ToolName.EXECUTE_JS,
      ToolName.CLICK_COORDINATES,
      ToolName.CREATE_TAB,
      ToolName.LIST_TABS,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
    ],
  },
  "cross-tab-compare": {
    temporarilySuppressedTools: [
      ToolName.NAVIGATE,
      ToolName.GO_BACK,
      ToolName.CLICK_COORDINATES,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
    ],
  },
};

export function getSkillToolSuppressionPolicy(
  id?: string,
  options?: SkillCatalogOptions,
): SkillToolSuppressionPolicy | null {
  if (!id) return null;
  if (!getSkillDescriptor(id, options)) return null;
  return SKILL_TOOL_SUPPRESSION_POLICIES[id] ?? null;
}

export function summarizeSkillForVerifier(
  contract: LoadedSkillContract | null,
): string {
  if (!contract) return "";

  const lines = [
    `Selected skill: ${contract.id}`,
    `Description: ${contract.description}`,
    `Verifier mode: ${contract.verifierMode}`,
  ];

  if (contract.requiredEvidence?.length) {
    lines.push(
      "Required evidence:",
      ...contract.requiredEvidence.map((item) => `- ${item}`),
    );
  }

  if (contract.requiredEvidenceTypes?.length) {
    lines.push(
      "Required typed evidence:",
      ...contract.requiredEvidenceTypes.map((item) => `- ${item}`),
    );
  }

  if (contract.executionContract?.completionChecks?.length) {
    lines.push(
      "Completion checks:",
      ...contract.executionContract.completionChecks.map((item) => `- ${item}`),
    );
  }

  if (contract.executionContract?.failureRecovery?.length) {
    lines.push(
      "Failure recovery:",
      ...contract.executionContract.failureRecovery.map((item) => `- ${item}`),
    );
  }

  if (contract.notes?.length) {
    lines.push("Skill notes:", ...contract.notes.map((item) => `- ${item}`));
  }

  return lines.join("\n");
}

function selectPrimarySkillWithKeywordMatcher(
  input: SkillMatcherInput,
): SkillSelection | null {
  const corpus = buildCorpus([
    input.query,
    input.objective,
    input.successCriteria,
    input.pageTitle,
    input.pageUrl,
  ]);
  const stepCorpus = buildCorpus([input.objective, input.successCriteria]);
  const currentStepLooksLikeInlineEdit =
    (gridEditPattern.test(stepCorpus) || inlineEditPattern.test(stepCorpus)) &&
    /\b(change|edit|update|set|replace|rename|enter|type)\b/i.test(stepCorpus);
  const currentStepLooksLikeContinuationRevision =
    continuationPattern.test(corpus) &&
    continuationArtifactPattern.test(corpus) &&
    continuationRevisionPattern.test(corpus) &&
    !gridEditPattern.test(stepCorpus) &&
    !crmTicketPattern.test(corpus);
  const currentStepLooksLikeFormFill =
    (formPattern.test(stepCorpus) &&
      /\b(fill|form|field|dropdown|checkbox|input|email|name|phone|category|budget)\b/i.test(
        stepCorpus,
      )) ||
    /\b(?:upload|attach|import|choose|select)\b[\s\S]{0,100}\b(?:file|csv|resume|cv|attachment)\b/i.test(
      stepCorpus,
    ) ||
    /\b(?:file|csv|resume|cv|attachment)\b[\s\S]{0,100}\b(?:upload|attach|import|input|field)\b/i.test(
      stepCorpus,
    ) ||
    configuratorPattern.test(stepCorpus);
  const currentStepLooksLikeProgressiveRepeatableForm =
    progressiveRepeatableFormPattern.test(stepCorpus) ||
    (progressiveRepeatableFormPattern.test(corpus) &&
      /\b(?:fill|add|create|section|entry|row|item|role|experience|education|address|dependent|field)\b/i.test(
        stepCorpus,
      ));
  const currentStepLooksLikeMultiStepFormWizard =
    multiStepFormWizardPattern.test(stepCorpus) ||
    ((multiStepFormWizardPattern.test(corpus) ||
      conditionalFormPattern.test(corpus)) &&
      /\b(?:fill|form|field|request|application|enrollment|intake|continue|next|review|submit|confirm|checkbox|select|radio)\b/i.test(
        stepCorpus,
      ));
  const currentTaskLooksLikeJobApplication = hasJobApplicationSignal(
    input,
    corpus,
  );
  const currentTaskLooksLikeAshbyJobApplication = hasAshbyJobApplicationSignal(
    input,
    corpus,
  );
  const currentStepNeedsTransactionalCheck =
    transactionPattern.test(stepCorpus);
  const matchesMultiTabChecklistWorkflow =
    naturalProcurementChecklistPattern.test(corpus) ||
    procurementLoopPattern.test(corpus) ||
    (/\b(procurement list|store)\b/i.test(corpus) &&
      /\b(new tab|another tab)\b/i.test(corpus) &&
      /\b(buy|purchase)\b/i.test(corpus) &&
      /\b(check off|mark .* done|checkbox)\b/i.test(corpus)) ||
    (explicitTabIntentPattern.test(corpus) &&
      sourceListLoopPattern.test(corpus) &&
      repeatedItemPattern.test(corpus) &&
      sourceProgressPattern.test(corpus));

  if (
    fieldValueRecordFormPattern.test(corpus) &&
    serviceNowRecordFormPattern.test(corpus) &&
    !listFilterPattern.test(corpus) &&
    !listSortPattern.test(corpus) &&
    !catalogOrderPattern.test(corpus)
  ) {
    const selection = selectEnabledSkill(
      input,
      "servicenow-record-form",
      "Task contains explicit ServiceNow record field/value pairs and should use deterministic form configuration and submit evidence.",
    );
    if (selection) return selection;
  }

  if (currentTaskLooksLikeAshbyJobApplication) {
    const selection = selectEnabledSkill(
      input,
      "ashby-job-application-assistant",
      "Task is an Ashby job application workflow and should fill requested fields literally, verify live field state, and approval-gate Submit Application.",
    );
    if (selection) return selection;
  }

  if (currentTaskLooksLikeJobApplication) {
    const selection = selectEnabledSkill(
      input,
      "job-application-assistant",
      "Task is a job application workflow and should prepare, verify, preserve supplied answers, and approval-gate final submission.",
    );
    if (selection) return selection;
  }

  if (currentStepLooksLikeProgressiveRepeatableForm) {
    const selection = selectEnabledSkill(
      input,
      "progressive-repeatable-form",
      "Current step targets repeated/progressive form groups and should count, add, map, fill, and verify groups by index or label.",
    );
    if (selection) return selection;
  }

  if (currentStepLooksLikeMultiStepFormWizard) {
    const selection = selectEnabledSkill(
      input,
      "multi-step-form-wizard",
      "Current step targets a multi-step or conditional form and should fill visible fields, re-ground after transitions, handle revealed fields, review, and submit when requested.",
    );
    if (selection) return selection;
  }

  if (
    catalogOrderPattern.test(corpus) &&
    /\b(order|request|catalog|quantity|configure|cart|hardware|software|item)\b/i.test(
      corpus,
    )
  ) {
    const selection = selectEnabledSkill(
      input,
      "catalog-order-workflow",
      "Task requires configuring and ordering a catalog item through request or order confirmation.",
    );
    if (selection) return selection;
  }

  if (
    consequentialActionConsentPattern.test(corpus) &&
    finalConsequentialActionPattern.test(stepCorpus)
  ) {
    const selection = selectEnabledSkill(
      input,
      "consequential-action-consent",
      "Current step includes a final consequential action with approval or prepare-only policy, so final execution must be consent-gated.",
    );
    if (selection) return selection;
  }

  if (chartValuePattern.test(corpus) && chartValueIntentPattern.test(corpus)) {
    const selection = selectEnabledSkill(
      input,
      "chart-value-extraction",
      "Task asks for a concrete value from a chart or dashboard and should use structured chart evidence before answering.",
    );
    if (selection) return selection;
  }

  if (
    listRowActionPattern.test(corpus) &&
    /\b(list|table|records?|rows?|incidents?|tickets?|results?|selected)\b/i.test(
      corpus,
    )
  ) {
    const selection = selectEnabledSkill(
      input,
      "list-row-action-workflow",
      "Task requires selecting list/table rows and applying a selected-row action.",
    );
    if (selection) return selection;
  }

  if (
    listFilterPattern.test(corpus) &&
    /\b(list|table|records?|rows?|incidents?|tickets?|results?|filter)\b/i.test(
      corpus,
    )
  ) {
    const selection = selectEnabledSkill(
      input,
      "list-filter-workflow",
      "Task requires applying a list or table filter and verifying the applied filtered state.",
    );
    if (selection) return selection;
  }

  if (
    listSortPattern.test(corpus) &&
    /\b(list|table|records?|rows?|incidents?|tickets?|results?|column|order by)\b/i.test(
      corpus,
    )
  ) {
    const selection = selectEnabledSkill(
      input,
      "list-sort-workflow",
      "Task requires sorting a list or table and verifying the resulting sort state.",
    );
    if (selection) return selection;
  }

  if (matchesMultiTabChecklistWorkflow) {
    const selection = selectEnabledSkill(
      input,
      "multi-tab-checklist-workflow",
      "Task requires repeating a source-list workflow across tabs: open or reuse a target tab, complete or capture item evidence, return to the source, and record progress.",
    );
    if (selection) return selection;
  }

  if (
    searchAnswerPattern.test(corpus) &&
    /\b(answer|article|knowledge|result|search|find|look up|question)\b/i.test(
      corpus,
    )
  ) {
    const selection = selectEnabledSkill(
      input,
      "search-answer-extraction",
      "Task requires searching or reading a knowledge source and returning the requested answer, not just opening a result.",
    );
    if (selection) return selection;
  }

  if (
    serviceNowModuleNavigationPattern.test(corpus) &&
    /\b(module|application navigator)\b/i.test(corpus)
  ) {
    const selection = selectEnabledSkill(
      input,
      "servicenow-module-navigation",
      "Task requires opening a ServiceNow application module and should resolve the module target directly from ServiceNow metadata.",
    );
    if (selection) return selection;
  }

  if (
    paginatedDataSurfacePattern.test(corpus) &&
    tableAggregateIntentPattern.test(corpus)
  ) {
    const selection = selectEnabledSkill(
      input,
      "paginated-table-scan",
      "Task asks for an aggregate value from a table, directory, or paginated data surface and needs exhaustive row coverage before answering.",
    );
    if (selection) return selection;
  }

  if (
    overlayRecoveryPattern.test(stepCorpus) ||
    (overlayRecoveryPattern.test(corpus) &&
      !currentStepLooksLikeInlineEdit &&
      !currentStepLooksLikeFormFill &&
      !currentStepNeedsTransactionalCheck)
  ) {
    const selection = selectEnabledSkill(
      input,
      "modal-overlay-recovery",
      "Task requires dismissing blocking overlays before the underlying content is accessible.",
    );
    if (selection) return selection;
  }

  if (
    hoverRevealPattern.test(corpus) &&
    /\b(menu|tooltip|reveal|hover|dropdown|flyout)\b/i.test(corpus)
  ) {
    const selection = selectEnabledSkill(
      input,
      "hover-reveal-navigation",
      "Task depends on revealing a hidden menu or tooltip through hover before acting.",
    );
    if (selection) return selection;
  }

  if (currentStepLooksLikeInlineEdit) {
    const selection = selectEnabledSkill(
      input,
      "inline-edit-surface",
      "Current step edits a value directly inside an inline editor, grid cell, table row, or rename surface.",
    );
    if (selection) return selection;
  }

  if (currentStepLooksLikeContinuationRevision) {
    const selection = selectEnabledSkill(
      input,
      "continuation-edit",
      "Task requests revising prior work while preserving earlier intent.",
    );
    if (selection) return selection;
  }

  if (emailReplyPattern.test(corpus)) {
    const selection = selectEnabledSkill(
      input,
      "email-reply-careful",
      "Task requires drafting or sending an email reply with recipient, source context, language, and tone checks.",
    );
    if (selection) return selection;
  }

  if (threadMessagePattern.test(corpus)) {
    const selection = selectEnabledSkill(
      input,
      "thread-message-careful",
      "Task requires posting a grounded reply in a message or thread while preserving audience, language, and tone context.",
    );
    if (selection) return selection;
  }

  if (crmTicketPattern.test(corpus)) {
    const selection = selectEnabledSkill(
      input,
      "crm-ticket-update",
      "Task requires updating a CRM or support ticket record after reading case context and verifying field or note changes.",
    );
    if (selection) return selection;
  }

  if (
    continuationPattern.test(corpus) &&
    continuationArtifactPattern.test(corpus) &&
    !gridEditPattern.test(stepCorpus) &&
    !crmTicketPattern.test(corpus)
  ) {
    const selection = selectEnabledSkill(
      input,
      "continuation-edit",
      "Task requests revising prior work while preserving earlier intent.",
    );
    if (selection) return selection;
  }

  if (budgetPattern.test(corpus)) {
    const selection = selectEnabledSkill(
      input,
      "budget-aware-execution",
      "Task context explicitly calls for conserving remaining turns and avoiding blind retries.",
    );
    if (selection) return selection;
  }

  const explicitListDetailLoop =
    listDetailReviewPattern.test(corpus) &&
    listReturnPattern.test(corpus) &&
    /\b(detail|details|view details|open)\b/i.test(corpus);
  const naturalListDetailRecommendation =
    listReviewSurfacePattern.test(corpus) &&
    listRecommendationIntentPattern.test(corpus) &&
    /\b(review|evaluate|compare|recommend|rank|best matches?|best fit|which (?:ones|jobs|listings))\b/i.test(
      corpus,
    );
  if (explicitListDetailLoop || naturalListDetailRecommendation) {
    const selection = selectEnabledSkill(
      input,
      "list-detail-review-loop",
      explicitListDetailLoop
        ? "Task requires reviewing multiple visible list items by opening each detail view and returning to the list in sequence."
        : "Task requires reviewing visible list items and grounding a recommendation in item-level detail facts.",
    );
    if (selection) return selection;
  }

  if (
    paginatedDataSurfacePattern.test(corpus) &&
    paginatedRecordLookupIntentPattern.test(corpus)
  ) {
    const selection = selectEnabledSkill(
      input,
      "paginated-record-lookup",
      "Task asks for a specific record or item from a paginated, searchable, or list-like data surface and should verify the exact target before extracting the requested field.",
    );
    if (selection) return selection;
  }

  if (comparePattern.test(corpus)) {
    const selection = selectEnabledSkill(
      input,
      "cross-tab-compare",
      "Comparison-oriented task spans multiple tabs or pages.",
    );
    if (selection) return selection;
  }

  if (
    navigateReturnPattern.test(corpus) &&
    /\b(return|come back|go back|round.?trip|then)\b/i.test(corpus)
  ) {
    const selection = selectEnabledSkill(
      input,
      "navigate-read-return",
      "Task requires navigating to a target page, extracting information, and returning.",
    );
    if (selection) return selection;
  }

  if (configuratorPattern.test(stepCorpus)) {
    const selection = selectEnabledSkill(
      input,
      "structured-form-fill",
      "Current step configures product options and must verify the derived total or summary before completion.",
    );
    if (selection) return selection;
  }

  if (
    profileFieldPattern.test(stepCorpus) &&
    /\b(fill|checkout|form|field|name|email|submit|place order)\b/i.test(
      stepCorpus,
    )
  ) {
    const selection = selectEnabledSkill(
      input,
      "structured-form-fill",
      "Current step requires filling form fields from saved profile data before submission.",
    );
    if (selection) return selection;
  }

  if (currentStepNeedsTransactionalCheck) {
    const selection = selectEnabledSkill(
      input,
      "transactional-act-check-act",
      "Current step requires an action followed by explicit intermediate verification.",
    );
    if (selection) return selection;
  }

  if (cartPattern.test(stepCorpus) || cartPattern.test(corpus)) {
    const selection = selectEnabledSkill(
      input,
      "cart-modify-checkout",
      "Task modifies an in-progress shopping or checkout state before completion.",
    );
    if (selection) return selection;
  }

  if (currentStepLooksLikeFormFill) {
    const selection = selectEnabledSkill(
      input,
      "structured-form-fill",
      "Task requires disciplined multi-field form entry before submission.",
    );
    if (selection) return selection;
  }

  if (transactionPattern.test(corpus)) {
    const selection = selectEnabledSkill(
      input,
      "transactional-act-check-act",
      "Task requires an action followed by explicit intermediate verification.",
    );
    if (selection) return selection;
  }

  return null;
}

export class KeywordSkillMatcher implements SkillMatcher {
  match(input: SkillMatcherInput): SkillSelection | null {
    return selectPrimarySkillWithKeywordMatcher(input);
  }
}

export const keywordSkillMatcher = new KeywordSkillMatcher();

export function selectPrimarySkill(
  input: SkillMatcherInput,
): SkillSelection | null {
  if (input.candidateSkillIds) return keywordSkillMatcher.match(input);

  const candidateSkillIds = resolveEligibleSkillCandidates(input).map(
    (candidate) => candidate.skill.id,
  );
  return keywordSkillMatcher.match({ ...input, candidateSkillIds });
}
