# Prompt Writing Tips

How to write effective prompts for the OpenSidebar browser agent.

## How the Agent Reads Your Prompt

The agent treats your input as a **task to accomplish on the current page**. It will:

1. **Decompose** multi-step tasks into a plan (via the guardian model)
2. **Execute** each step by reading the page, finding elements, and interacting with them
3. **Track progress** using `update_plan()` to report what step it's on
4. **Signal completion** by calling `done()` with a summary

If your prompt looks like a **question** ("What color is the submit button?"), the agent will try to answer it by reading the page and calling `done({"summary": "..."})`.

If your prompt looks like an **action** ("Click the submit button"), the agent will execute it immediately.

## Tips for Multi-Step Tasks

**Use explicit step structure** when ordering matters:

```
1. Fill in the email field with "user@example.com"
2. Fill in the password field with "hunter2"
3. Click the Submit button
4. Verify the URL changed to /dashboard
```

**Set success criteria** so the agent knows when it's done:

```
Sign up for an account using the form. The task is done when you see a "Welcome" message on the dashboard page.
```

**Mention verification steps** to prevent false-positive completion:

```
Add the item to cart. Verify the cart count increased before continuing.
```

**Hint at specific tools** for non-obvious interactions:

```
The code might be hidden in the DOM — use execute_js to inspect elements if you can't find it visually.
```

## Tips for Forms & Data Entry

**Batch related fields together:**

```
Fill the shipping form:
- Name: Jane Smith
- Address: 123 Main St
- City: Portland
- State: OR
- Zip: 97201
Then click "Place Order".
```

**Mention form validation expectations:**

```
Fill in the credit card form. Note: the card number field requires spaces between groups (e.g. "4111 1111 1111 1111").
```

## Tips for Research & Extraction

**Ask for `done()` with a summary** when you want data back:

```
Read the product page and tell me the price, rating, and number of reviews. Return the answer via done().
```

**Use `memory_add` for persistence** across sessions:

```
Read this API documentation page. Save the key endpoints and auth method to memory for future reference.
```

## What NOT to Do

**Don't micromanage tool calls.** Let the agent choose its tools:

```
Bad:  "Call read_page, then find_element for the login button, then click_element on it"
Good: "Log in using the credentials on the page"
```

**Don't repeat system prompt instructions.** The agent already knows how to use its tools:

```
Bad:  "Use the click_element tool to click things and type_text to type and scroll_page to scroll..."
Good: "Fill out the registration form and submit it"
```

**Don't be vague when specificity matters:**

```
Bad:  "Do the thing on the page"
Good: "Click the 'Start Free Trial' button in the pricing section"
```

**Don't ask the agent to stop and report mid-task** unless necessary — it disrupts the plan flow. Instead, use hints during the run.

## Example Prompts

### E-commerce checkout
```
Add the first product to cart, go to checkout, fill in the shipping form with:
Name: John Doe, Address: 456 Oak Ave, City: Seattle, State: WA, Zip: 98101
Select standard shipping and complete the purchase. Done when you see an order confirmation number.
```

### Form with complex interactions
```
Complete the multi-step survey. For each page: answer all questions, then click Next.
Some questions use dropdown menus and radio buttons. The survey is done when you see "Thank you for your response."
```

### Data extraction
```
Go to the team page and collect the name, title, and email of every team member listed.
Return the results as a formatted list via done().
```

### Navigation challenge
```
Complete every challenge task on this page. Use update_plan to track your progress through each step.
If stuck for 5+ actions on a step, take a screenshot and try execute_js to inspect the DOM.
```
