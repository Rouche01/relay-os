# Manifesto (v2)

I'll start with a task: imagine what software looks like once AI has fully played out. I'll answer it at the end. First, the state of things.

## 1. What if reviewing code is the wrong thing to do?

Coding agents can now write most of the code, and the conversation has moved to a worry: how do engineering teams keep up with reviewing all of it?

But what if that's the wrong discussion? What if reviewing code is the wrong thing to be doing at all?

When generation is cheap, code stops being something you maintain and becomes something you regenerate: compiled, disposable, rebuilt on demand. Reviewing it line by line starts to look like proofreading assembly.

We review code to catch bugs, and a bug is behaviour that deviates from the goal. So the thing to get right is the goal. State it as a spec, with explicit rules that any acceptable behaviour must satisfy, and the code can be checked against the spec mechanically instead of by eye. Does that make the next programming language a spec language? There is active research in this space.

## 2. The human reviews intent, and that has to stay meaningful

Verification doesn't remove the human, it moves them. A proof only covers the rules written down, and most real bugs are spec bugs, where the spec missed what the human wanted. So the human approves **intent**, not code.

This has a serious objection: if approving a spec means reading a long document and clicking "OK", we've moved the review bottleneck, not removed it, and people will rubber-stamp. For this to work, approval has to stay meaningful. Our working bets:

- Specs are short and rule-focused. A human approves the rules ("never book without active authority and insurance"), not the implementation.
- Approval shows what is new or changed, not the whole document again.
- The human can see what the rules do on a sample run before approving.

These are bets, not facts, and we test them (see section 6).

## 3. Humans supervise, and agents act

An agent is an actor, like us, that can behave on our behalf. That changes how we use software: we become supervisors who delegate to actors.

I split our interaction with software into two kinds:

- **Intentions**: stating what should happen and approving how.
- **Actions**: doing it ourselves, by choice or because a human-in-the-loop (HITL) checkpoint requires it.

Humans will do more Intentions and fewer Actions, but never be locked out of Acting. An agent can also play the supervisor and produce Intentions of its own.

## 4. Agents need a first-class place to act

Humans act on software through a standard surface: the GUI. Agents have no equivalent. When no human is involved they use APIs and tools, and when a human is involved there is nothing shared.

MCP is the closest thing we have, but it models calls: request, response, done. Acting on a surface that a human also acts on needs more: shared state, handoff in both directions, interruption, and the human taking over at a checkpoint and handing back. MCP doesn't treat acting as a first-class concept.

Until a protocol like that exists, the bridge is the computer itself: an agent operating the same screen a human would. It works with any software, so it's where we start. It isn't where we expect to end.

## 5. The stress test: Relay Desk, in freight

To test these beliefs we're building Relay Desk, starting with freight and logistics operations.

Freight is a good test because the expensive mistakes break hard rules: booking a carrier without active authority or current insurance, paying to bank details that changed recently, booking the same load twice, going below the margin floor. A spec can state these and a validator can enforce them. Much of the work also sits in portals with no usable API, where people are paid to do it by hand.

Each person gets a dedicated streaming computer, and agents see the context from it, so handoffs between a person's work and the Intents running for them stay coherent. The human states an Intent, approves the Spec it produces, and the Spec becomes a workflow that runs on whichever engine it needs. The computer engine is one of several. At a HITL checkpoint the human acts directly on the screen the run was using, then hands back.

Some of this we can guarantee today with validator rules that fail closed. The rest we expect to prove formally as the research matures. The product doesn't wait on the research. The design and the pitch are in [`pitch.md`](./pitch.md).

## 6. What would prove us wrong

A test needs a result that could fail. These would change my mind:

- Operators won't approve specs, or approvals turn reflexive and mistakes get through anyway. The supervisory model is wrong, or the approval design is.
- The rules that matter can't be stated up front. Most costly mistakes would then come from things nobody wrote down, and a spec language wouldn't help.
- A portal-driving agent under the same rules is no safer than a person doing the work by hand.
- Customers who try it keep doing the work themselves and use it as a suggestion tool.

Customer discovery and a design partner are how we find out.

## 7. Returning to the task

So what does software look like once AI has fully played out? My answer is that you stop reading code and start approving intent. Software gets generated from specs and checked against rules. You supervise actors that do most of the acting, and you step in when you choose to or when a checkpoint calls for you. For that to work, humans and agents need somewhere shared to act, with handoff and supervision built in.

The computer engine is the first version of that place. The longer-term goal is a GUI-like protocol for agent sessions that doesn't need a computer engine at all.
