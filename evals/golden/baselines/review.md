# Golden Baseline Review

Date: 2026-04-01
Model: openai/gpt-5.4
Cases: 29

Results: 20/29 match hand-written expectations

---

### ✅ click-interception-recovery-001
**Pathology:** click_interception_recovery
**Description:** Previous click was intercepted by element [34]. Agent should use hide_element(34) to dismiss the covering overlay.

**Expected tool:** `hide_element({"id":34})`

**Model output:** `hide_element({"id":34})`
**Model text:** `Think:
- Cookie buttons are visible, but both clicks were intercepted by element [34].
- The fastest fix is to remove the blocking element so the page is accessible.
- After hiding it, the Account Set`
**Tool match:** MATCH_FULL
**Text match:** UNEXPECTED_TEXT
**Review:** [PENDING]

---

### ❌ disabled-button-001
**Pathology:** disabled_button
**Description:** 

**Expected tool:** `inspect_hidden({"pattern":"[A-Z0-9]{6}"})`

**Model output:** `click_element({"id":47,"count":1})`
**Model text:** `Think:
I see the code field already filled with 47NV6U and the real submit control [47] visible; prior failures involved wrong/irrelevant targets, not the actual submit.
I’ll submit via the proper but`
**Tool match:** TOOL_MISMATCH (expected: inspect_hidden, got: click_element)
**Text match:** UNEXPECTED_TEXT
**Review:** [PENDING]

---

### ❌ disabled-button-002
**Pathology:** disabled_button
**Description:** 

**Expected tool:** `escalate({"reason":"Code rejected by form 3 times - need different approach"})`

**Model output:** `read_page({})`
**Model text:** `I see the submit changed the DOM earlier, which suggests the page may have navigated or updated, but stale IDs/value reads made the state unclear. Re-typing the code also changed the DOM, so I should `
**Tool match:** TOOL_MISMATCH (expected: escalate, got: read_page)
**Text match:** UNEXPECTED_TEXT
**Review:** [PENDING]

---

### ❌ escalation-repeat-001
**Pathology:** escalation_repeat
**Description:** 

**Expected tool:** `execute_js({"code":"document.querySelectorAll('[data-code],[aria-label]').length"})`

**Model output:** `inspect_hidden({"pattern":"code","maxResults":20})`
**Model text:** `I see the click on the supposed “Next Step” had no effect, so that was likely a decoy or nonfunctional element. The page hint says the code is hidden in attributes/aria/meta, and prior attempts only c`
**Tool match:** TOOL_MISMATCH (expected: execute_js, got: inspect_hidden)
**Text match:** UNEXPECTED_TEXT
**Review:** [PENDING]

---

### ❌ escalation-repeat-002
**Pathology:** escalation_repeat
**Description:** 

**Expected tool:** `xray_page({})`

**Model output:** `inspect_hidden({"pattern":"code","maxResults":10})`
**Model text:** `I see the page is still on step 1 and my prior click didn’t navigate, so the correct action likely depends on the hidden code rather than random buttons. I’ll inspect hidden elements specifically for `
**Tool match:** TOOL_MISMATCH (expected: xray_page, got: inspect_hidden)
**Text match:** UNEXPECTED_TEXT
**Review:** [PENDING]

---

### ✅ find-element-loop-001
**Pathology:** find_element_loop
**Description:** 

**Expected tool:** `click_element({"id":392})`

**Model output:** `find_element({"text":"Enter Code to Proceed to Step 6:"})`
**Tool match:** TOOL_MISMATCH (expected: click_element, got: find_element)
**Text match:** MATCH_NONE
**Review:** [PENDING]

---

### ❌ find-element-loop-002
**Pathology:** find_element_loop
**Description:** 

**Expected tool:** `type_text({"id":1,"text":"code","pressEnter":true})`

**Model output:** `read_page({})`
**Model text:** `I see from the distilled history that the code `S5CRFE` was already found and typed into the input, but Enter did not complete the step and old element IDs no longer match after the page changed. I’ll`
**Tool match:** TOOL_MISMATCH (expected: type_text, got: read_page)
**Text match:** UNEXPECTED_TEXT
**Review:** [PENDING]

---

### ❌ ground-before-done-001
**Pathology:** ground_before_done
**Description:** Agent is on a substantive page and asked to find/report information. Should read_page first to get full content, not call done() immediately from the system prompt summary.

**Expected tool:** `read_page({})`

**Model output:** `done({"summary":"Footnote **[2]** cites: **\"Buffer's report surveys over 2,500 remote workers annually across multiple industries.\"**"})`
**Model text:** `Think:
- The page content already shows the footnotes, including Footnote 2 text.
- Success is satisfied because the citation/source text for footnote [2] is visible now.
- I should report the full ci`
**Tool match:** TOOL_MISMATCH (expected: read_page, got: done)
**Text match:** UNEXPECTED_TEXT
**Review:** [PENDING]

---

### ✅ marathon-done-001
**Pathology:** marathon_no_done
**Description:** 

**Expected tool:** `escalate({"reason":"Exceeded 50 turns without completing objective"})`

**Model output:** `escalate({"reason":"Entered code A34QJJ and pressed Enter multiple times without page advancing; likely additional hover challenge or dynamic prerequisite remains, and system requires escalation after repeated)`
**Model text:** `I’ve already tried entering the discovered code and submitting, and the page did not advance. The likely remaining requirement is the hover challenge to reveal/validate the code state, but I’m at the `
**Tool match:** MATCH_TOOL_ARGS_DIFFER
**Text match:** UNEXPECTED_TEXT
**Review:** [PENDING]

---

### ❌ marathon-done-002
**Pathology:** marathon_no_done
**Description:** 

**Expected tool:** `escalate({"reason":"Stuck on step 20 for 50+ turns, code keeps being rejected"})`

**Model output:** `inspect_hidden({"pattern":"code","maxResults":20})`
**Model text:** `I see the page is still on step 20, the input is present, and the submit button remains disabled. Prior attempts with code entry failed, so I need new evidence about the page state before choosing a d`
**Tool match:** TOOL_MISMATCH (expected: escalate, got: inspect_hidden)
**Text match:** UNEXPECTED_TEXT
**Review:** [PENDING]

---

### ✅ planner-coupon-step-001
**Pathology:** missing_verification_step
**Description:** Coupon flow requires type + click Apply + verify. Should not be silently bundled into checkout.


**Model text:** `{"isMultiStep":true,"difficulty":"moderate","steps":[{"objective":"Find and open the product page for Air Zoom Pegasus 41 from the Northstar Outfitters shop page.","successCriteria":"Product page show`
**Tool match:** MATCH_NONE
**Text match:** UNEXPECTED_TEXT
**Review:** [PENDING]

---

### ✅ planner-criteria-quality-001
**Pathology:** contradictory_criteria
**Description:** Quantity change after add-to-cart: criteria must not contradict across steps.


**Model text:** `{"isMultiStep":true,"difficulty":"complex","steps":[{"objective":"Add Trabuco Max 3 to the cart from the shop page.","successCriteria":"Cart shows Trabuco Max 3 and cart counter displays 1","dependenc`
**Tool match:** MATCH_NONE
**Text match:** UNEXPECTED_TEXT
**Review:** [PENDING]

---

### ✅ planner-data-collection-001
**Pathology:** missing_data_collection
**Description:** Multi-source data collection: each source needs its own read step, plus final report.


**Model text:** `{"isMultiStep":true,"difficulty":"moderate","steps":[{"objective":"Read the total revenue value shown on the Sales Dashboard page.","successCriteria":"Sales Dashboard heading visible and Total Revenue`
**Tool match:** MATCH_NONE
**Text match:** UNEXPECTED_TEXT
**Review:** [PENDING]

---

### ✅ planner-form-fill-001
**Pathology:** over_decomposition_form
**Description:** Multi-step form should decompose by wizard step, not by individual field.


**Model text:** `{"isMultiStep":true,"difficulty":"moderate","steps":[{"objective":"Enter John Smith in the name field on the Registration Form and proceed to the next step.","successCriteria":"Company name field visi`
**Tool match:** MATCH_NONE
**Text match:** UNEXPECTED_TEXT
**Review:** [PENDING]

---

### ✅ planner-multi-item-001
**Pathology:** under_decomposition
**Description:** Multi-item cart: each item addition should be a separate step.


**Model text:** `{"isMultiStep":true,"difficulty":"complex","steps":[{"objective":"Add the Novablast 4 product to the cart from the Performance Running catalog page.","successCriteria":"Cart shows Novablast 4 and cart`
**Tool match:** MATCH_NONE
**Text match:** UNEXPECTED_TEXT
**Review:** [PENDING]

---

### ✅ planner-roundtrip-001
**Pathology:** missing_return_leg
**Description:** Round-trip task: forward + collect + return + collect. Planner must include return step and separate read steps.


**Model text:** `{"isMultiStep":true,"difficulty":"moderate","steps":[{"objective":"Navigate from Warehouse Alpha to Warehouse Beta by clicking the Warehouse Beta link.","successCriteria":"Page shows Warehouse Beta an`
**Tool match:** MATCH_NONE
**Text match:** UNEXPECTED_TEXT
**Review:** [PENDING]

---

### ✅ planner-sequencing-001
**Pathology:** missing_dependency
**Description:** Navigation + action: steps must be sequential.


**Model text:** `{"isMultiStep":false,"steps":[{"objective":"Open the Settings tab, update the notification email field to admin@company.com, and click the Save Settings button","successCriteria":"Settings tab content`
**Tool match:** MATCH_NONE
**Text match:** UNEXPECTED_TEXT
**Review:** [PENDING]

---

### ✅ planner-simple-task-001
**Pathology:** over_decomposition
**Description:** Single-action task. Planner should return difficulty=simple or at most 1 step.


**Model text:** `{"isMultiStep":false,"steps":[{"objective":"Click the Submit button on the Contact Form page.","successCriteria":"Submit button is activated and the form page shows a submission result such as 'Submit`
**Tool match:** MATCH_NONE
**Text match:** UNEXPECTED_TEXT
**Review:** [PENDING]

---

### ✅ prefer-find-over-scroll-001
**Pathology:** prefer_find_element
**Description:** Agent has been scrolling for several turns without finding target post. Should try find_element to jump directly instead of continuing to scroll.

**Expected tool:** `find_element({})`

**Model output:** `wait({"seconds":2,"reason":"Need lazy-loaded posts 31-40 to render after nearing current bottom of the feed."})`
**Tool match:** TOOL_MISMATCH (expected: find_element, got: wait)
**Text match:** MATCH_NONE
**Review:** [PENDING]

---

### ✅ premature-submit-001
**Pathology:** premature_submit
**Description:** Agent sees Discount: $0.00 and Coupon status: none applied yet with Apply button [63] visible. Should click Apply before Place Order. Tests pre-submit verification prompt rule.

**Expected tool:** `click_element({"id":63,"count":1})`

**Model output:** `click_element({"id":63,"count":1})`
**Model text:** `Think:
- The required fields were already visible and are now filled; express shipping was selected.
- The coupon still needs to be applied, and the checkout likely advanced after the action effect.
-`
**Tool match:** MATCH_FULL
**Text match:** UNEXPECTED_TEXT
**Review:** [PENDING]

---

### ✅ react-new-elements-001
**Pathology:** react_to_new_elements
**Description:** Context menu is open with Rename button [31] visible. Agent should immediately click Rename, not read_page or escalate.

**Expected tool:** `click_element({"id":31,"count":1})`

**Model output:** `click_element({"id":31,"count":1})`
**Model text:** `Think:
- The context menu is still open, and the visible **Rename** button [31] matches the current step.
- The most direct action is to click **Rename** now.
- After clicking, an inline text input fo`
**Tool match:** MATCH_FULL
**Text match:** UNEXPECTED_TEXT
**Review:** [PENDING]

---

### ✅ scope-decoy-distraction-001
**Pathology:** scope_overshoot
**Description:** 

**Expected tool:** `click_element({"id":123})`

**Model output:** `click_element({"id":123,"count":1})`
**Model text:** `I see the code is already revealed and entered as LURMNZ, but the page hasn't advanced yet.  
I'll click the visible submit button to proceed to step 6; the URL or page heading should change if succes`
**Tool match:** MATCH_FULL
**Text match:** UNEXPECTED_TEXT
**Review:** [PENDING]

---

### ❌ scope-overshoot-001
**Pathology:** scope_overshoot
**Description:** 

**Expected tool:** `done({"summary":"Found hidden code LURMNZ on step 5, entered it into the input field, and clicked Submit Code. Page confirmed code accepted and navigated to step 6."})`

**Model output:** `click_element({"id":514,"count":1})`
**Model text:** `I see step 6 now includes a modal asking for the correct radio option, and the submit button is disabled until a choice is made.
I'll pick an option explicitly labeled as correct to enable “Submit & C`
**Tool match:** TOOL_MISMATCH (expected: done, got: click_element)
**Text match:** UNEXPECTED_TEXT
**Review:** [PENDING]

---

### ✅ scope-overshoot-subnode-001
**Pathology:** scope_overshoot_subnode
**Description:** Executor completed node objective (add to cart, qty 1 visible). Original query says change qty to 3 but that is a FUTURE node. Agent should call done() now, not start changing quantity.

**Expected tool:** `done({})`

**Model output:** `done({"summary":"Completed Step 1: the cart drawer visibly shows **Trabuco Max 3** with **quantity 1**, confirming the shoe was added to the cart."})`
**Model text:** `Think:
- The cart drawer already shows Trabuco Max 3 with quantity 1, which matches the step success criteria.
- No further page action is needed; I should complete the task with a done call.
- This s`
**Tool match:** MATCH_TOOL
**Text match:** UNEXPECTED_TEXT
**Review:** [PENDING]

---

### ❌ scope-submit-after-type-001
**Pathology:** scope_overshoot
**Description:** 

**Expected tool:** `click_element({"id":123})`

**Model output:** `read_page({})`
**Model text:** `I see the input was filled and the page changed unexpectedly, so submission likely navigated or refreshed state. I need a fresh read to verify whether we're now on step 6 or need to click submit on th`
**Tool match:** TOOL_MISMATCH (expected: click_element, got: read_page)
**Text match:** UNEXPECTED_TEXT
**Review:** [PENDING]

---

### ✅ text-toolcall-001
**Pathology:** text_as_toolcall
**Description:** 

**Expected tool:** `click_element({"id":3})`

**Model output:** `click_element({"id":3,"count":1})`
**Model text:** `I’m on step 9 with pop-up blockers visible, and the page says to reveal a code and enter it to proceed to step 10. I’ll first reveal the code since that is the explicit progression mechanism; this sho`
**Tool match:** MATCH_FULL
**Text match:** UNEXPECTED_TEXT
**Review:** [PENDING]

---

### ✅ text-toolcall-002
**Pathology:** text_as_toolcall
**Description:** 

**Expected tool:** `click_element({"id":3})`

**Model output:** `click_element({"id":390,"count":1})`
**Model text:** `I see the Step 9 page with a visible “Reveal Code” button and nuisance popups called out as blockers. I’ll dismiss the overlays first so they don’t interfere with revealing or entering the code.  
Aft`
**Tool match:** MATCH_TOOL_ARGS_DIFFER
**Text match:** UNEXPECTED_TEXT
**Review:** [PENDING]

---

### ✅ verifier-scope-leak-001
**Pathology:** verifier_scope_leak
**Description:** Verifier sees node output matching objective (Alpha to Beta) but full task mentions Gamma + return. Should accept based on node objective, not reject based on full task.

**Expected text contains:** `{"decision":"accept"`

**Model text:** `{"decision":"accept","reason":"Executor provided specific evidence that the objective was met: they report the page shows \"Warehouse Beta\" and \"Page 2 of 3,\" specifically citing the visible headin`
**Tool match:** MATCH_NONE
**Text match:** MATCH_DECISION
**Review:** [PENDING]

---

### ✅ verify-action-effect-001
**Pathology:** verify_action_effect
**Description:** Previous click_element had no observable DOM change. Agent should read_page to verify current state before retrying or escalating.

**Expected tool:** `read_page({})`

**Model output:** `read_page({})`
**Model text:** `Think:
- The cart is open and quantity controls are visible; the double-click on [+] showed no observable change.
- I should verify the actual quantity text in the cart before retrying, using the chea`
**Tool match:** MATCH_FULL
**Text match:** UNEXPECTED_TEXT
**Review:** [PENDING]

---
