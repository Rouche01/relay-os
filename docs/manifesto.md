# Manifesto

I'll start with a task: imagine what software looks like once AI has fully played out. We'll come back to it at the end. First, the state of things.

## 1. Reviewing code is the wrong problem

Coding agents can now write most of the code. The conversation has shifted to how engineering teams keep up with reviewing it all.

I think that's the wrong conversation. When generation is cheap, code stops being something you maintain and becomes something you regenerate: compiled, disposable, thrown away and rebuilt on demand. Reviewing it line by line is like proofreading assembly.

Code review exists to catch bugs, and a bug is behaviour that deviates from the goal. So the goal is the thing to get right, not the code. If we can state the goal as a spec, with explicit rules that any acceptable behaviour must satisfy, then we can check the code against the spec mechanically instead of by eye. That points to a next "programming language" that is a spec language. There is active research in this direction.

An honest caveat: a proof only covers the rules written down, and most real bugs are spec bugs, where the spec missed what the human actually wanted. So verification doesn't remove the human. It moves them. The human no longer reviews code. They review and approve **intent**, and the machine guarantees the implementation honours it.

## 2. Humans move from acting to supervising

An agent is an actor, like us, that can behave on our behalf. That changes how we use software. We become supervisors who delegate to actors. We can still act, but as we get used to supervising, we will act less.

For simplicity, I split our interaction with software into two kinds:

- **Intentions**: stating what should happen and approving how.
- **Actions**: doing it ourselves, by choice or because a human-in-the-loop (HITL) checkpoint requires it during a run.

Humans will do more Intentions and some Actions. Agents will do most Actions, and an agent can also play the supervisor and produce Intentions of its own.

## 3. Agents need a first-class place to act

Humans act on software through a standard surface: the GUI. Agents have no equivalent. When no human is involved they use APIs and tools, and when a human is involved we have nothing shared.

MCP is the closest thing we have, but it models calls: request, response, done. Acting on a surface a human also acts on needs more: shared state, handoff in both directions, interruption, and the human taking over at a checkpoint and handing back. I don't think MCP treats acting as a first-class concept.

Until such a protocol exists, the bridge is the computer itself: an agent operating the same screen a human would. It works with any software, so it's where we start. It is not where we expect to end.

## 4. What I believe

- **Code is a throwaway artifact.** Software is generated from specs, and the specs are checked against explicit rules.
- **Humans become supervisors.** Operating systems should be designed around that: run work from Intents, but always let the human Act.

## 5. The stress test: Relay Desk, in freight

To test these beliefs, we're building Relay Desk and starting with freight and logistics operations.

Freight is a good test because the expensive mistakes break hard rules: booking a carrier without active authority or current insurance, paying to bank details that changed recently, booking the same load twice, going below the margin floor. These are exactly the kind of rules a spec can state and a validator can enforce. Much of the work also lives in carrier and broker portals that have no usable API, and today people are paid to do it. Mistakes are irreversible and cost real money, and outcomes are easy to measure.

The model:

- Each human has a **dedicated streaming computer**, and they work on it as they would on any machine.
- Agents see the **context** from that machine, so handoffs between a person's work and the Intents running on their behalf carry the right context.
- The human states an **Intent**. The system turns it into a **Spec** with explicit rules, and the human approves it.
- The approved Spec becomes an **app or workflow**, run by whichever engine the work needs. The computer engine is one of several.
- At **HITL checkpoints**, the human acts directly in the same computer engine the run is using, then hands back.

Our claim, in a sentence: the system cannot book a carrier without verified authority and insurance, below your margin floor, or to unverified bank details, and every booking carries its evidence.

Some of this we can guarantee today with validator rules that fail closed. Some we expect to prove formally as the research matures. The product doesn't wait on the research.

## 6. Beyond the computer

The computer engine is the first surface, not the last. The longer-term goal is a GUI-like protocol for agent sessions that doesn't need a computer engine: a shared, first-class acting surface that humans and agents use together, with handoff and supervision built in.
