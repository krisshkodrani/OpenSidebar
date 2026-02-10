# RFC: Swarm Mode Configuration Fix

## Error

Kimi Swarm mode is not properly activated. The current implementation:

1. Uses wrong model (`moonshotai/moonshot-v1-128k` instead of `moonshotai/kimi-k2.5`)
2. Missing required `mode: "agent_swarm"` parameter in API request

This causes the API to treat requests as standard completions instead of triggering server-side agent orchestration, leading to rate limiting (429 errors) and lack of parallel sub-agent execution.

## Root Cause

The implementation was based on outdated documentation or incorrect assumptions about the Kimi API through OpenRouter. Kimi K2.5 requires:

- Specific model identifier: `moonshotai/kimi-k2.5`
- Mode parameter: `mode: "agent_swarm"` passed in the request body

## Solution

Update the swarm implementation to use the correct model and parameters:

1. **Change MODEL_NAME** from `moonshotai/moonshot-v1-128k` to `moonshotai/kimi-k2.5`

2. **Add mode parameter** to the API request body

3. **Update SwarmRequest interface** to include optional mode field

4. **Consider adding extra_body support** if OpenRouter requires nested parameters

## Implementation

### Model Update

```typescript
const MODEL_NAME = "moonshotai/kimi-k2.5"; // Changed from moonshot-v1-128k
```

### Request Body Update

```typescript
const requestBody: SwarmRequest = {
  model: MODEL_NAME,
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ],
  max_tokens: 4000,
  temperature: 0.3,
  stream: true,
  mode: "agent_swarm", // Required for swarm activation
};
```

### Interface Update

```typescript
interface SwarmRequest {
  model: string;
  messages: { role: string; content: string }[];
  temperature: number;
  max_tokens: number;
  stream: boolean;
  mode?: "agent_swarm"; // Optional but recommended for typing
}
```

## OpenRouter Compatibility

OpenRouter uses an OpenAI-compatible API. Some SDKs may require passing extra parameters via `extra_body`:

```typescript
// If standard body doesn't work, try:
body: JSON.stringify({
  model: MODEL_NAME,
  messages: [...],
  max_tokens: 4000,
  temperature: 0.3,
  stream: true,
  extra_body: {
    mode: "agent_swarm"
  }
})
```

Start with the simple approach (direct `mode` parameter), and only use `extra_body` if testing reveals it's needed.

## Files to Modify

- `src/background/swarm.ts`

## Testing

- Test swarm activation with valid OpenRouter API key
- Verify response triggers actual server-side agent orchestration
- Monitor for 429 errors (should be reduced with proper swarm mode)
- Check response times (swarm mode has higher latency due to parallel execution)

## Success Criteria

- [ ] Model name is `moonshotai/kimi-k2.5`
- [ ] API requests include `mode: "agent_swarm"` parameter
- [ ] Responses show evidence of parallel sub-agent execution (longer initial latency, comprehensive results)
- [ ] Reduced 429 errors compared to current implementation
- [ ] All swarm tests pass

## References

- Kimi K2.5 Documentation: Agent Swarm mode
- OpenRouter API Documentation
- Current error logs showing 429 rate limiting
