# Future plans

Decisions about where this goes next, recorded so the reasoning isn't lost.
"Now" is what we build on today; everything else is intent, not a commitment.

## Now: Claude through the MCP connector

The agent is Claude in the Claude app, connected to the TripAgent/Routsy
server. The planner, the Chrome extension and the iPhone app are views of the
same store; Claude is the conversation. This costs nothing beyond the Claude
subscription and needs no chat UI of our own.

Why first: it works today, every tool and rule (record for review, approve,
pick, "ask, never guess" what a price covers) already lives on the server, and
nothing about it is thrown away by the step below.

## Later: a built-in agent, as a paid feature

A chat inside the planner and the iPhone app that talks to Claude directly,
without the Claude app. Offered as a priced feature, because it runs on our
API usage rather than the user's subscription.

### Shape (decided)

- **The agent loop runs on the server, never on the phone.** The Routsy worker
  gets a chat endpoint. It holds the Anthropic API key as a Cloudflare secret
  (an API key compiled into an iOS app can be extracted by anyone), takes the
  user's message (text, a screenshot, pasted page text), calls the Claude API
  and streams the reply back. The user's token in the URL stays their login.
- **The tools are the ones we already have.** The Claude API's own MCP
  connector (`mcp_servers` plus an `mcp_toolset` tool, beta
  `mcp-client-2025-11-20`) points at Routsy itself, so add / approve / dismiss /
  pick / show, the review-before-apply flow and the price-basis rule are
  reused as they are. No tool-calling loop of our own. The server's current
  instructions become the system prompt.
- **Both front doors stay open.** The Claude-app connector keeps working next
  to the built-in agent; they share the store.
- **Clients:** a chat screen in the planner and in the iPhone app. Voice is
  on-device speech-to-text into the text field (free). Screenshots go up as
  images, which the API reads natively.

### Models and cost (estimates, not measurements)

Prices per million tokens at the time of writing: Haiku 5.5 $0.10 in /
$0.50 out; Sonnet 5.5 $2 / $10; Opus 5.5 $4 / $20. A screenshot turn is
roughly 3–5K tokens in and 1K out: about half a cent on Sonnet, a few cents on
Opus, a tenth of a cent on Haiku. Likely split: Opus or Sonnet for the
conversation (the judgement of asking before recording matters), Haiku for bulk
transcription. Include the server-side refusal fallback by default. Measure
before pricing the feature.

### What we take on

Conversation history, streaming, retries and rate limits, image size limits,
a chat UI on two platforms, and model/prompt tuning. None of it is hard; all of
it is ours to maintain, where today the Claude app does it.

### Ruled out for this

Managed Agents (hosts a sandbox with files and bash; not needed here) and the
Claude Agent SDK (a coding-agent harness; wrong shape for a travel assistant).

### Before starting

1. Push the Routsy checkout: the endpoint belongs in the deployed server, and
   this repo's `mcp-server/` is the older version.
2. Create an Anthropic Console API key and store it as a worker secret.
3. Decide the pricing model (per month, or metered on usage).

## Other directions discussed

- **Time management.** Widen the assistant from trips to calendar and tasks:
  approved trip items proposed as calendar events (review first, as with
  options), trip to-dos (book before the fare moves, recheck a stale price)
  alongside other tasks, a daily brief, and preferences such as working hours
  and travel buffers. The calendar side already exists as Claude plus the
  Google Calendar connector; what's missing is the thin layer joining it to
  trips and tasks. Open questions: where tasks live today, calendar-only or
  goals/habits too, and what a normal morning's request sounds like.
- **A form inside the Claude app** (an MCP App, `ui://` resource). Claude's
  docs confirm claude.ai on the web renders these; not confirmed for a
  user-added connector in the iPhone app, which is why the planner cards came
  first.
- **Interactive input in the planner is done** (cards, paste, screenshot) and
  the iPhone app exists; both remain the fallback if the Claude app can't do
  something.
