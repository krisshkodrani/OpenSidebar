# Perception Eval Report

Generated: 2026-02-26T12:19:17.072Z

## Summary

| Metric | Value |
|--------|-------|
| Total results | 40 |
| Pass rate | 75.0% (30/40) |
| Failed | 10 |
| Errors | 0 |
| Avg section completeness | 0.575 |
| Avg signal accuracy | 0.800 |
| Avg blocker detection | 0.587 |
| Avg actionability | 1.000 |
| Avg hallucination | 0.935 |
| Avg composite | 0.769 |

## Provider Comparison

| Provider | Pass Rate | Avg Accuracy | Avg Groundedness | Avg Composite | Avg Latency |
|----------|-----------|-------------|------------------|---------------|-------------|
| groq | 95.0% (19/20) | 5.1 | 4.5 | 0.916 | 902ms |
| openrouter | 55.0% (11/20) | 4.3 | 3.9 | 0.623 | 4767ms |

## Per-Dimension Breakdown

| Dimension | Pass Rate | Avg Composite |
|-----------|-----------|---------------|
| untagged | 75% (30/40) | 0.769 |

## Failed Cases (10 total)

### perception-3f9dd628-t1 [openrouter]

- **Dimension**: untagged
- **Status**: fail
- **Scores**: sec=0.00 sig=1.00 blk=0.25 act=1.00 hal=0.60 comp=0.57
  - **Judge**: acc=3 blk=1 gnd=2 sig=6 conc=5
  - **Reasoning**: The perception output completely missed all four NUISANCE blockers ([184], [185], [186], [187]) that were expected, leaving BLOCKERS as 'None'. The HAZARDS section references tag IDs [186] and [185] which don't exist in the element list (only [187] exists among those). The output references phantom IDs and misclassifies content. The OBJECTIVE_CHECK reasoning is acceptable since no input field is visible, but the overall output fails on blocker detection and groundedness.
  - **Prompt fix**: Add explicit instruction: 'Scan for div elements with role=div containing vague CTAs (e.g., Try This!, Click Here!, Nope!) and classify them as NUISANCE blockers with dismiss targets referencing their exact tag IDs from the element list. Never reference tag IDs not present in the element list.'

<details>
<summary>Reference output</summary>

```
1. LAYOUT: Long scrolling page with sections. Multiple navigation buttons.

2. STATE: Active tab appears to be the main content page. No open menus or focused inputs visible.

3. CONTENT: None.

4. VISUAL-ONLY: None.

5. BLOCKERS: 
   NUISANCE [184] "Try This!" → click [184]
   NUISANCE [185] "Try T
```
</details>

<details>
<summary>Actual output</summary>

```
1. **LAYOUT:** Single-column layout with multiple sections and buttons for navigation.

2. **STATE:** Multiple buttons are active; no open menus or focused inputs; no loading indicators present.

3. **BLOCKERS:** None.

4. **VISUAL-ONLY:** "Content Block 4 Loaded!" appears in a banner style.

5. **H
```
</details>

### perception-3f9dd628-t12 [openrouter]

- **Dimension**: untagged
- **Status**: fail
- **Scores**: sec=0.00 sig=1.00 blk=0.00 act=1.00 hal=1.00 comp=0.60
  - **Judge**: acc=5 blk=1 gnd=2 sig=6 conc=6
  - **Reasoning**: The perception output missed the required NUISANCE blockers [149:div] and [204:div] entirely, classifying them as HAZARDS instead and referencing tag IDs [72] and [183] which don't match the expected blocker IDs. The HAZARDS section references [72] which exists but [183] is used incorrectly. The OBJECTIVE_CHECK is reasonable given no input field is visible, but the blocker detection failure is the primary issue. Tag IDs referenced in HAZARDS ([72] exists, [183] exists) are grounded but the blocker section references phantom IDs [149] and [204] by omission rather than commission.
  - **Prompt fix**: Instruct the perception module to explicitly scan for div elements with vague or misleading CTAs (e.g., 'Try This!', 'Click Here!', 'Nope!') and classify them as NUISANCE blockers with their actual tag IDs from the element list, not just mention them in HAZARDS. Also clarify that BLOCKERS section must use the format 'NUISANCE [tagID:tagName] text → dismiss target' and must not be left empty when such elements exist.

<details>
<summary>Reference output</summary>

```
1. LAYOUT: Long scrolling page with multiple sections. Buttons scattered throughout.

2. STATE: No active menus, no loading indicators.

3. CONTENT: None.

4. VISUAL-ONLY: None.

5. BLOCKERS: 
   NUISANCE [149:div] "Try This!" → click [72:div]
   NUISANCE [204:div] "Click Here!" 

6. SPATIAL: Button
```
</details>

<details>
<summary>Actual output</summary>

```
1. **LAYOUT:** Vertical scrolling page with multiple sections and navigation buttons.

2. **STATE:** Multiple buttons are active; no open menus or focused inputs; no loading indicators present.

3. **BLOCKERS:** None.

4. **VISUAL-ONLY:** None.

5. **HAZARDS:** [72] "Click Here!" → vague CTA; [183] 
```
</details>

### perception-3f9dd628-t26 [groq]

- **Dimension**: untagged
- **Status**: fail
- **Scores**: sec=1.00 sig=1.00 blk=0.40 act=1.00 hal=0.00 comp=0.68
  - **Judge**: acc=2 blk=2 gnd=1 sig=5 conc=4
  - **Reasoning**: Nearly all referenced tag IDs ([222], [226], [245], [671], [70], [34], [41]) do not exist in the provided element list, making the output almost entirely ungrounded. The blocker section references phantom IDs and misclassifies [34] as NUISANCE when it should be RELEVANT. The input field is described as unfilled but element [207] shows 'D26GC3' already entered, and button [219] shows '✓ Submitted', suggesting the task may already be done — making NOT_DONE potentially incorrect. The output is moderately verbose with full sentences rather than fragments.
  - **Prompt fix**: Add explicit instruction: 'Only reference tag IDs that appear in the provided element list. Before outputting any [N] reference, verify it exists in the element list. For STATE, check input field values and button labels (e.g., checkmarks) to determine if actions are already completed.'

<details>
<summary>Reference output</summary>

```
1. LAYOUT: Multi-step process page with popups. Centered content area with buttons and inputs.

2. STATE: Active tab, multiple popups open. No focused inputs.

3. CONTENT: None.

4. VISUAL-ONLY: None.

5. BLOCKERS:
   NUISANCE [70:btn] "Dismiss" → click [70:btn]
   NUISANCE [28:btn] "Dismiss" → clic
```
</details>

<details>
<summary>Actual output</summary>

```
1. LAYOUT: The page appears to be a multi-step process or quiz with various interactive elements.

2. STATE: 
- Active controls: input field [222] with a 6-character code, 
- Open menus/popups: 
  - Alert! popup with a fake close button,
  - Cookie Consent popup,
  - Click here for amazing deals! po
```
</details>

### perception-3f9dd628-t26 [openrouter]

- **Dimension**: untagged
- **Status**: fail
- **Scores**: sec=0.00 sig=1.00 blk=0.50 act=1.00 hal=0.20 comp=0.54
  - **Judge**: acc=2 blk=1 gnd=1 sig=5 conc=4
  - **Reasoning**: The actual output references phantom tag IDs [34], [244], [86], [246] that do not exist in the provided element list, making it almost entirely ungrounded. Blocker classifications are wrong: [34] is mistyped as 'Cookie consent banner' with a non-existent dismiss target [244], and [86] is misclassified as RELEVANT when it should be NUISANCE. The OBJECTIVE_CHECK of NOT_DONE is plausible given the input shows 'D26GC3' already filled and a '✓ Submitted' button exists, suggesting the task may already be done, making the signal questionable. The output is moderately verbose with full sentences and fabricated descriptions.
  - **Prompt fix**: Add explicit instruction: 'Only reference tag IDs that appear in the provided element list. Do not invent or hallucinate tag IDs. For each blocker, verify the dismiss target ID exists in the element list before citing it. Check for pre-filled inputs and submitted states to assess completion before marking NOT_DONE.'

<details>
<summary>Reference output</summary>

```
1. LAYOUT: Multi-step process page with popups. Centered content area with buttons and inputs.

2. STATE: Active tab, multiple popups open. No focused inputs.

3. CONTENT: None.

4. VISUAL-ONLY: None.

5. BLOCKERS:
   NUISANCE [70:btn] "Dismiss" → click [70:btn]
   NUISANCE [28:btn] "Dismiss" → clic
```
</details>

<details>
<summary>Actual output</summary>

```
1. **LAYOUT:** Interactive web page with multiple buttons and input fields arranged in a grid-like structure.

2. **STATE:** Active input field for code entry; multiple buttons visible; no loading indicators present.

3. **BLOCKERS:**  
   NUISANCE [34] "Cookie consent banner" → click [244]  
   REL
```
</details>

### perception-3f9dd628-t29 [openrouter]

- **Dimension**: untagged
- **Status**: fail
- **Scores**: sec=0.00 sig=1.00 blk=0.13 act=1.00 hal=1.00 comp=0.63
  - **Judge**: acc=2 blk=1 gnd=2 sig=1 conc=4
  - **Reasoning**: The perception output claims DONE with code submitted and accepted, but the expected state is NOT_DONE (code still needs to be entered). Blockers section says 'None' but three nuisance blockers ([34], [35], [267]) and a PREREQ should be identified. Tag IDs [188] and [91] referenced in HAZARDS are either non-existent or misidentified (91 is 'Move On' button, not 'Click Here!'). The STATE claim about 'JANUTZ' being entered and code accepted appears fabricated/hallucinated.
  - **Prompt fix**: Add explicit instruction: 'Do not infer or hallucinate page state beyond what element metadata provides. If element text/role does not confirm completion, mark OBJECTIVE_CHECK as NOT_DONE. Always list div/button elements with roles like Moving!/Link! as NUISANCE blockers. Only reference tag IDs that exist in the provided element list.'

<details>
<summary>Reference output</summary>

```
1. LAYOUT: Central modal window with form. 
2. STATE: Active tab, no open menus, focused input [1], no loading indicators.
3. CONTENT: None.
4. VISUAL-ONLY: None.
5. BLOCKERS: 
   NUISANCE [34] "Moving!" → click [34]
   NUISANCE [35] "Link!" → click [35]
   NUISANCE [267] "Link!" → click [267]
   PR
```
</details>

<details>
<summary>Actual output</summary>

```
1. **LAYOUT:** Interactive challenge page with a form for code entry and multiple navigation buttons.

2. **STATE:** Input field is focused with the code "JANUTZ" entered; the "Submit Code" button is active.

3. **BLOCKERS:** None.

4. **VISUAL-ONLY:** "JANUTZ" is displayed in the input field; "Code
```
</details>

### perception-3f9dd628-t31 [openrouter]

- **Dimension**: untagged
- **Status**: fail
- **Scores**: sec=0.00 sig=1.00 blk=0.33 act=1.00 hal=1.00 comp=0.67
  - **Judge**: acc=3 blk=2 gnd=3 sig=6 conc=5
  - **Reasoning**: The perception output fabricates blocker descriptions (e.g., 'Cookie Consent' for [318], 'Subscribe to our newsletter' for [331]) that don't match element text in the ground truth. It misses the RELEVANT blocker [278:btn] entirely and incorrectly classifies [318]/[319] as cookie consent when those are 'Accept'/'Decline' buttons with unknown context. VISUAL-ONLY section invents content ('You have won a prize!', 'Code accepted!') not grounded in any element. The dismiss targets reference [319] and [29] and [335] which exist but are not correctly matched to their respective blockers per the reference. The OBJECTIVE_CHECK is reasonable but the STATE section incorrectly claims the input is 'focused' when reference shows no focused inputs.
  - **Prompt fix**: Instruct the perception module to derive blocker descriptions strictly from element text/role in the element list, not from inferred or hallucinated content. Add explicit instruction: 'Do not invent text for VISUAL-ONLY or blocker descriptions; only use text present in element metadata.' Also require that RELEVANT blockers (consent dialogs requiring a decision) be distinguished from NUISANCE blockers, and that dismiss targets be validated against actual close/dismiss buttons associated with each popup.

<details>
<summary>Reference output</summary>

```
1. LAYOUT: Multi-step process page with popups. 
2. STATE: Active popups: Cookie Consent, Limited time offer!, Subscribe to our newsletter!. No focused inputs.
3. CONTENT: None.
4. VISUAL-ONLY: None.
5. BLOCKERS: 
   NUISANCE [323:div] "Limited time offer! This is a popup message. The close button i
```
</details>

<details>
<summary>Actual output</summary>

```
1. **LAYOUT:** The page is a multi-step interactive form with various buttons and input fields arranged in a grid-like structure.

2. **STATE:** Active input field for "Enter 6-character code" is focused; multiple buttons are visible but not pressed; no loading indicators present.

3. **BLOCKERS:**

```
</details>

### perception-becb7565-t1 [openrouter]

- **Dimension**: untagged
- **Status**: fail
- **Scores**: sec=0.00 sig=0.00 blk=0.50 act=1.00 hal=1.00 comp=0.45
  - **Judge**: acc=5 blk=2 gnd=6 sig=8 conc=7
  - **Reasoning**: The most critical failure is in blockerQuality: the perception output lists 'None' for blockers, completely missing the PREREQ blocker for entering the 6-character code via input [1] — this is the core gating element on the page. The HAZARDS section references [20] and [21] which do exist in the element list, so groundedness is acceptable, but the reference output cites [31] and [32] which don't exist in the provided element list either. The OBJECTIVE_CHECK correctly returns NOT_DONE with reasonable evidence. The output is reasonably terse but misses the CONTENT/SPATIAL sections and the critical blocker classification.
  - **Prompt fix**: Add explicit instruction: 'If a code/password input field is present and the objective requires proceeding to a next step, classify it as a PREREQ blocker with dismiss target pointing to the input element tag ID. Never return empty BLOCKERS when a gating input field exists on the page.'

<details>
<summary>Reference output</summary>

```
1. LAYOUT: The page appears to be a long scrolling page with multiple sections of filler content and various buttons. The main structure consists of a prominent input field and submit button for entering a 6-character code.

2. STATE: The active tab is visible, with no open menus or focused inputs b
```
</details>

<details>
<summary>Actual output</summary>

```
1. **LAYOUT:** Single-column layout with sections of filler content and interactive elements prominently displayed.
2. **STATE:** Active input field for code entry; "Submit Code" button is available; no menus or loading indicators visible.
3. **BLOCKERS:** 
   - None.
4. **VISUAL-ONLY:** "Enter Code
```
</details>

### perception-becb7565-t20 [openrouter]

- **Dimension**: untagged
- **Status**: fail
- **Scores**: sec=0.00 sig=0.00 blk=0.50 act=1.00 hal=1.00 comp=0.45
  - **Judge**: acc=4 blk=2 gnd=3 sig=7 conc=6
  - **Reasoning**: The critical failure is in blockerQuality: the actual output lists 'None' for BLOCKERS when there is clearly a PREREQ blocker ('complete challenge to reveal code') that should be identified. The VISUAL-ONLY section mentions 'Code hidden - complete challenge to reveal' which is actually the blocker content, but it was misclassified. Groundedness is poor because the HAZARDS section references '[tagId]' as placeholder text rather than actual tag IDs, and the element list is empty so no IDs can be verified. The completion signal is correct (NOT_DONE) but the evidence is somewhat vague.
  - **Prompt fix**: Add explicit instruction: 'If page content indicates a prerequisite action must be completed before the objective can proceed (e.g., complete a challenge to reveal a code), classify this as a PREREQ blocker in the BLOCKERS section, not as VISUAL-ONLY content. HAZARDS must reference actual numeric tag IDs from the element list, not placeholder text like [tagId].'

<details>
<summary>Reference output</summary>

```
1. LAYOUT: The page is a challenge step with a prominent section for a "Hidden DOM Challenge" and a scrolling section with filler content. The layout suggests a multi-step process with interactive elements.

2. STATE: The active tab appears to be the main challenge page, with no open menus or focuse
```
</details>

<details>
<summary>Actual output</summary>

```
1. **LAYOUT:** Single-column layout with sections prompting user interaction to find navigation.
2. **STATE:** No active controls, open menus, or focused inputs; no loading indicators present.
3. **BLOCKERS:** None.
4. **VISUAL-ONLY:** "Code hidden - complete challenge to reveal" in the input area; 
```
</details>

### perception-becb7565-t29 [openrouter]

- **Dimension**: untagged
- **Status**: fail
- **Scores**: sec=0.00 sig=0.00 blk=0.50 act=1.00 hal=1.00 comp=0.45
  - **Judge**: acc=4 blk=3 gnd=2 sig=7 conc=5
  - **Reasoning**: The NUISANCE blocker references a '[modal]' and '[dismissTagId]' that don't exist in the element list - phantom IDs. The NUISANCE blocker is also incorrectly classified; expected output shows no NUISANCE blockers. HAZARDS reference elements by text labels rather than valid tag IDs from the element list. STATE mentions 'loading indicators present' which contradicts the reference output. The OBJECTIVE_CHECK signal is correct (NOT_DONE) but the evidence sentence is generic rather than factual.
  - **Prompt fix**: Require all blocker dismiss targets and hazard references to use numeric tag IDs from the element list (e.g., [41], [49]). Add explicit instruction: 'If no valid tag ID exists for a blocker dismiss target, omit the blocker rather than fabricating a placeholder.' Also instruct: 'Do not infer UI state (loading indicators, modals) that is not represented in the element list.'

<details>
<summary>Reference output</summary>

```
1. LAYOUT: Linear scrolling page with sections and buttons. Multiple navigation buttons present.

2. STATE: Active tab appears to be the main content page; no open menus or focused inputs visible; no loading indicators.

3. CONTENT: No key text visible only in images.

4. VISUAL-ONLY: No text in ima
```
</details>

<details>
<summary>Actual output</summary>

```
1. **LAYOUT:** Single-column layout with sections of filler content and interactive buttons scattered throughout.
2. **STATE:** Multiple buttons are active; no menus or focused inputs; loading indicators present for content blocks.
3. **BLOCKERS:** 
   - NUISANCE [modal] "Wrong Button! Try Again!" →
```
</details>

### perception-becb7565-t44 [openrouter]

- **Dimension**: untagged
- **Status**: fail
- **Scores**: sec=0.00 sig=0.00 blk=0.50 act=1.00 hal=1.00 comp=0.45
  - **Judge**: acc=6 blk=4 gnd=4 sig=8 conc=7
  - **Reasoning**: The output misclassifies [40] as a NUISANCE blocker with a dismiss target, but [40] is a paragraph element describing the hidden DOM challenge — it's not a dismissible overlay and should not be listed as a blocker with a click action. The PREREQ is correctly identified. VISUAL-ONLY mentions overlays and notifications not grounded in the element list. Tag [41] is described as 'Proceed' in HAZARDS but its actual text is 'Proceed Forward', and [82] text is correct. The completion signal NOT_DONE is correct and matches expected.
  - **Prompt fix**: Clarify that BLOCKERS with dismiss targets must reference dismissible UI elements (modals, overlays, banners) — not static paragraph/div elements describing page content. Static informational elements should only appear as PREREQ blockers without click targets.

<details>
<summary>Reference output</summary>

```
1. LAYOUT: The page appears to be a scrolling challenge with multiple sections of filler content and various buttons. The visible structure suggests a vertical layout with a prominent call-to-action (CTA) buttons scattered throughout.

2. STATE: The active tab seems to be the main content area, with
```
</details>

<details>
<summary>Actual output</summary>

```
1. **LAYOUT:** Single-column layout with sections of filler content and interactive buttons scattered throughout.
2. **STATE:** Multiple buttons visible; no menus or focused inputs; loading indicators present for content blocks.
3. **BLOCKERS:**  
   NUISANCE [40] "Hidden DOM Challenge: The code is 
```
</details>

## Perception Prompt Recommendations

1. **[LOW]** (untagged, 1x) Instruct the perception module to only reference tag IDs that appear in the provided element list, and to cross-check blocker dismiss targets against existing IDs before outputting. Add explicit instruction: 'Never reference a tag ID not present in the element list.'
2. **[LOW]** (untagged, 1x) Add explicit instruction: 'Scan for div elements with role=div containing vague CTAs (e.g., Try This!, Click Here!, Nope!) and classify them as NUISANCE blockers with dismiss targets referencing their exact tag IDs from the element list. Never reference tag IDs not present in the element list.'
3. **[LOW]** (untagged, 1x) Instruct the perception module to only reference tag IDs that appear in the provided element list for both blocker sources and dismiss targets; if a dismiss target cannot be identified from the element list, omit it rather than fabricating a nearby ID.
4. **[LOW]** (untagged, 1x) Instruct the perception module to explicitly scan for div elements with vague or misleading CTAs (e.g., 'Try This!', 'Click Here!', 'Nope!') and classify them as NUISANCE blockers with their actual tag IDs from the element list, not just mention them in HAZARDS. Also clarify that BLOCKERS section must use the format 'NUISANCE [tagID:tagName] text → dismiss target' and must not be left empty when such elements exist.
5. **[LOW]** (untagged, 1x) Add explicit instruction: 'If the task requires entering a code/text but no input field is visible in the element list, classify this as a PREREQ blocker with description of what must be done. Never list BLOCKERS as None when the objective cannot be completed with visible elements alone.'
6. **[LOW]** (untagged, 1x) Add explicit instruction: 'If the task requires entering data into a form field, classify the missing input action as a PREREQ blocker even if the field appears visible. Always verify referenced tag IDs exist in the element list before including them in output.'
7. **[LOW]** (untagged, 1x) Instruct the perception module to always check for PREREQ blockers when a form/input field is present and unfilled — if an input field shows placeholder text (not a value), classify it as a PREREQ blocker with the label describing what must be entered. Also instruct it not to infer submission state from button labels alone; only report submission if URL changed or a success message element is present.
8. **[LOW]** (untagged, 1x) Instruct the perception module to never infer completion from hallucinated confirmation messages; require that DONE signals be grounded in element list state changes (e.g., input field value, URL change, or explicit success element). Also require that PREREQ blockers be identified when a gating input field exists without a confirmed value.
9. **[LOW]** (untagged, 1x) Add explicit instruction: 'Only reference tag IDs that appear in the provided element list. Before outputting any [N] reference, verify it exists in the element list. For STATE, check input field values and button labels (e.g., checkmarks) to determine if actions are already completed.'
10. **[LOW]** (untagged, 1x) Add explicit instruction: 'Only reference tag IDs that appear in the provided element list. Do not invent or hallucinate tag IDs. For each blocker, verify the dismiss target ID exists in the element list before citing it. Check for pre-filled inputs and submitted states to assess completion before marking NOT_DONE.'
11. **[LOW]** (untagged, 1x) Add explicit guidance: 'If the task requires filling an input field before submission, classify that unfilled input as a PREREQ blocker, not a NUISANCE. NUISANCE blockers are overlays/popups unrelated to the task objective. PREREQ blockers are conditions that must be satisfied before the primary action can occur.'
12. **[LOW]** (untagged, 1x) Require that all element descriptions in BLOCKERS and HAZARDS must exactly match the text/role from the element list. Add explicit instruction: 'Never infer or paraphrase element text — copy verbatim from the element list.' Also clarify that a code-entry input field blocking task completion should be classified as PREREQ, not RELEVANT.
13. **[LOW]** (untagged, 1x) Add explicit instruction: 'Do not infer or fabricate field values or button states — only report what is present in the element list metadata. If element text/role does not indicate a filled state, report as empty/default.' Also add: 'BLOCKERS must enumerate all div elements with role=div that appear decorative or animated (e.g. Moving!, Link!) as NUISANCE with their tag IDs, and list any form prerequisites as PREREQ.'
14. **[LOW]** (untagged, 1x) Add explicit instruction: 'Do not infer or hallucinate page state beyond what element metadata provides. If element text/role does not confirm completion, mark OBJECTIVE_CHECK as NOT_DONE. Always list div/button elements with roles like Moving!/Link! as NUISANCE blockers. Only reference tag IDs that exist in the provided element list.'
15. **[LOW]** (untagged, 1x) Instruct the perception module to match blocker dismiss targets to the correct element IDs by cross-referencing button text/role against the element list before assigning. Specifically: for cookie consent dialogs, look for Accept/Decline buttons ([318], [319]) or the button whose context matches the consent flow, not arbitrary div IDs. Also enforce sentence-fragment style in OBJECTIVE_CHECK to reduce verbosity.
16. **[LOW]** (untagged, 1x) Instruct the perception module to derive blocker descriptions strictly from element text/role in the element list, not from inferred or hallucinated content. Add explicit instruction: 'Do not invent text for VISUAL-ONLY or blocker descriptions; only use text present in element metadata.' Also require that RELEVANT blockers (consent dialogs requiring a decision) be distinguished from NUISANCE blockers, and that dismiss targets be validated against actual close/dismiss buttons associated with each popup.
17. **[LOW]** (untagged, 1x) Instruct the perception prompt to: (1) use only the element's text/label as the blocker description, not fabricated surrounding context; (2) explicitly check for PREREQ blockers when page content mentions hidden/locked information (e.g., [364] 'Hidden DOM Challenge'); (3) keep blocker entries to one line: TYPE [id] 'label' → action; (4) do not invent dismiss targets — only reference tag IDs present in the element list.
18. **[LOW]** (untagged, 1x) Add explicit instruction: 'When classifying blockers, verify each dismiss target tag ID exists in the element list and has role=button. Distinguish NUISANCE (can be dismissed without consequence) from RELEVANT (requires meaningful user decision like Accept/Decline). Always check for PREREQ blockers where content must be unlocked before the objective can proceed.'
19. **[LOW]** (untagged, 1x) Add explicit guidance: 'Cookie consent dialogs with Accept/Decline options are RELEVANT blockers (user must choose), not NUISANCE. Close/X buttons on overlapping panels are NUISANCE. Reference tag IDs exactly as integers without type suffixes. HAZARDS should list genuinely dangerous or deceptive elements, not the same items already listed as BLOCKERS.'
20. **[LOW]** (untagged, 1x) Add explicit guidance: 'For cookie consent dialogs with Accept/Decline options, classify as RELEVANT (not NUISANCE) since the choice may affect page behavior. Do not describe element content beyond what is in the element list text. Never claim UI elements (like input fields) are visible unless they appear in the element list. List ALL close/dismiss buttons found in the element list as separate NUISANCE entries.'
21. **[LOW]** (untagged, 1x) Require the OBJECTIVE_CHECK evidence sentence to be factually precise and non-contradictory: if the puzzle code is not yet known, state that; if it is known but not submitted, state only that. Also instruct the STATE section to note when there are many duplicate/similar buttons that may indicate decoys, as this is hazard-relevant context.
22. **[LOW]** (untagged, 1x) Require the perception output to reference specific tag IDs [N] when describing interactive elements, and enforce sentence fragments over full sentences. Also clarify that VISUAL-ONLY should only note text embedded in non-DOM elements (images, canvas, SVG), not general page text.
23. **[LOW]** (untagged, 1x) Add explicit guidance: 'Only classify elements as BLOCKERS if they are modal overlays, cookie banners, or popups that prevent interaction with the main content. Error messages or status text embedded in the page flow are NOT blockers. A dismissTagId must reference a valid tag ID from the element list; if no valid dismiss target exists, do not create a blocker entry.'
24. **[LOW]** (untagged, 1x) Add guidance that input fields pre-populated with puzzle answers should not be classified as RELEVANT blockers — they are normal interactive elements. Also instruct the model to reconcile VISUAL-ONLY observations (e.g., 'puzzle solved, code revealed') with OBJECTIVE_CHECK status, so that if the puzzle is visually solved but submission hasn't occurred, the signal reflects 'puzzle solved, submission pending' rather than a flat NOT_DONE.
25. **[LOW]** (untagged, 1x) In HAZARDS, restrict entries to genuinely dangerous or misleading elements (e.g., decoy buttons that navigate away); do not list all similar-labeled buttons as hazards. In VISUAL-ONLY, explicitly instruct the model to capture any revealed codes, answers, or puzzle solutions visible in the screenshot, as these are critical for task completion.
26. **[LOW]** (untagged, 1x) Clarify blocker classification rules: PREREQ should be used when the user cannot proceed at all without completing an action (e.g., solving a puzzle and entering a code gate). RELEVANT should be reserved for optional but important interactive elements. Also instruct the model not to make visual claims about styling (colors, contrast) that cannot be derived from element metadata.
27. **[LOW]** (untagged, 1x) Instruct the perception module to not infer filled input values from visual-only claims unless the element list shows a value attribute; also require that BLOCKER entries include a dismiss target tag ID when one exists, and avoid contradictory OBJECTIVE_CHECK reasoning (don't claim puzzle is solved while also saying NOT_DONE due to unsolved state).
28. **[LOW]** (untagged, 1x) Add explicit instruction: 'If the page requires solving a puzzle or entering a code before navigation is possible, classify this as a PREREQ blocker with a description of what must be done. Always reference relevant tag IDs (e.g., input fields, submit buttons) when describing blockers and state.'
29. **[LOW]** (untagged, 1x) When the page requires completing a multi-step action (solve puzzle → enter code → submit), classify the incomplete chain as a PREREQ blocker even if partial progress is visible. Do not mark BLOCKERS as None when the user cannot proceed without completing a required action sequence.
30. **[LOW]** (untagged, 1x) When a blocker prevents forward progress and requires completing a prerequisite action (like solving a puzzle or entering a code), classify it as PREREQ rather than RELEVANT. RELEVANT is for optional or contextual elements; PREREQ is for mandatory gates that block task completion.
31. **[LOW]** (untagged, 1x) Clarify that PREREQ blockers should not be duplicated under RELEVANT - if an element is PREREQ, list it only once under PREREQ with the tag ID and dismiss/resolution action. Also instruct the model to avoid listing the same blocker in multiple categories.
32. **[LOW]** (untagged, 1x) Add explicit instruction: 'If a code/password input field is present and the objective requires proceeding to a next step, classify it as a PREREQ blocker with dismiss target pointing to the input element tag ID. Never return empty BLOCKERS when a gating input field exists on the page.'
33. **[LOW]** (untagged, 1x) Require that all blocker and hazard references use numeric tag IDs from the element list (e.g., [51]) rather than button text strings. When element list is empty, note that no tag IDs are available and avoid fabricating references. Also clarify that buttons which are part of a challenge mechanism should be classified as HAZARD rather than NUISANCE.
34. **[LOW]** (untagged, 1x) Add explicit instruction: 'If page content indicates a prerequisite action must be completed before the objective can proceed (e.g., complete a challenge to reveal a code), classify this as a PREREQ blocker in the BLOCKERS section, not as VISUAL-ONLY content. HAZARDS must reference actual numeric tag IDs from the element list, not placeholder text like [tagId].'
35. **[LOW]** (untagged, 1x) Instruct the perception module to derive PREREQ blocker descriptions directly from page content elements (e.g., text in [47]/[48]) rather than rephrasing the objective. Also clarify that HAZARDS should only flag genuinely dangerous/irreversible actions, not merely suspicious-looking buttons that are part of normal page interaction challenges.
36. **[LOW]** (untagged, 1x) Require all blocker dismiss targets and hazard references to use numeric tag IDs from the element list (e.g., [41], [49]). Add explicit instruction: 'If no valid tag ID exists for a blocker dismiss target, omit the blocker rather than fabricating a placeholder.' Also instruct: 'Do not infer UI state (loading indicators, modals) that is not represented in the element list.'
37. **[LOW]** (untagged, 1x) In the HAZARDS section, instruct the model to verify element tagName before labeling as 'suspicious button' — only flag button-role elements as suspicious buttons. Also instruct to omit NUISANCE/RELEVANT lines entirely when there are no blockers of those types, rather than writing '[None]'.
38. **[LOW]** (untagged, 1x) Add explicit guidance: 'Classify a blocker as PREREQ when the user must complete an action/challenge before the objective can proceed at all. Use RELEVANT only for optional or secondary blockers. In HAZARDS, only list elements that pose a specific risk of derailing the task — do not enumerate all ambiguous buttons generically.'
39. **[LOW]** (untagged, 1x) For PREREQ blockers, instruct the model to describe the specific challenge or gate preventing progress (e.g., 'must complete hidden DOM challenge to reveal code') rather than restating the objective. Also instruct that HAZARDS should only reference tag IDs that are buttons/interactive elements, not generic divs.
40. **[LOW]** (untagged, 1x) Clarify that BLOCKERS with dismiss targets must reference dismissible UI elements (modals, overlays, banners) — not static paragraph/div elements describing page content. Static informational elements should only appear as PREREQ blockers without click targets.
