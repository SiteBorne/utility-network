# Agentverse A2A Registration (SUN-1100 checkpoint 2)

SITEBORNE already has everything the Agentverse "External Agent" A2A flow needs:
a real, publicly reachable A2A endpoint
(`POST https://utility.siteborne.net/a2a`) and a real, signed, publicly
reachable Agent Card
(`https://utility.siteborne.net/.well-known/agent-card.json`, ES256, verifies
against the live JWKS). No code change was required to reach this point --
criterion 2 is blocked purely on one interactive UI step that only a human can
complete.

## Correction to an earlier assumption

An earlier checkpoint assumed Agentverse registration required creating an
account and generating an `AGENTVERSE_KEY` API key. That assumption was wrong
for this specific flow. Per the official A2A onboarding documentation
(<https://docs.agentverse.ai/documentation/launch-agents/agentverse-sdk/a-2-a-agents>):
an Agentverse account and login **is** required, but **no API key** is required
for registering an existing external A2A agent. The `AGENTVERSE_KEY` requirement
documented elsewhere applies to the separate Python `uAgents` SDK
programmatic-registration path, not this one.

## Exact UI steps (human-only -- do not paste the resulting value into chat)

1. Log in to <https://agentverse.ai/> with an Agentverse account (create one if
   none exists yet -- account creation is outside what this session may
   perform).
2. Go to the **Agents** tab -> **Launch an Agent**.
3. Choose **External Agent**.
4. Choose **A2A Protocol**.
5. Enter an agent name (e.g. "SITEBORNE Utility Network"); an agent handle
   auto-generates.
6. Add keywords describing the agent (e.g. company evidence, web context
   verification, document evidence extraction, agent output verification).
7. When prompted for the agent's endpoint / Agent Card URL, supply:
   `https://utility.siteborne.net/.well-known/agent-card.json`
8. Review the registration details Agentverse shows. It will display an
   **AGENT_URI** string.
9. Click **Evaluate my Agent's registration** to validate.
10. On success, click **View My Agent**.

## After you have the AGENT_URI

Put it in your local `.dev.vars` (gitignored, never committed) as:

```
AGENTVERSE_AGENT_URI=<the value Agentverse gave you>
```

Do not paste it into chat. Once it's present locally, resume this task --
presence-check only, then complete the documented Agentverse-side registration
mechanism (exactly once), then read-after-write verify public visibility via
Agentverse's own public search (`POST https://agentverse.ai/v1/search/agents`)
before marking criterion 2 `PASS`.

It is not yet established whether SITEBORNE's own Worker code needs to read or
reference `AGENTVERSE_AGENT_URI` at runtime, or whether it is purely a one-time
registration-time value Agentverse itself retains -- the official docs' generic
code sample (`agentverse_init(AGENT_URI)`) is written for the Python `uAgents`
SDK and may not apply as-is to an already-external, non-uAgents HTTP A2A server.
Resolve this only once a real AGENT_URI exists; do not guess or fabricate an
integration now.
