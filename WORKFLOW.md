# AI-Augmented Development Workflow

This document defines exactly how we use Claude Code to build `discovery-engine`. It exists because "just prompt Claude Code per phase" leaves too much to inference — this is the fix.

## The Core Loop: Specify → Plan → Implement → Validate

Every phase in `/specs/` goes through all four stages, in order, with a human checkpoint between each one. Do not let a phase skip a stage, even when it feels obvious.

```
 ┌───────────┐    ┌──────────┐    ┌─────────────┐    ┌──────────┐
 │  SPECIFY   │───►│   PLAN    │───►│  IMPLEMENT   │───►│ VALIDATE  │
 │ (done by us,│    │ (Claude   │    │ (Claude Code, │    │ (you,     │
 │  before any │    │  Code,    │    │  on a branch) │    │  against  │
 │  code)      │    │  no code) │    │               │    │  the spec)│
 └───────────┘    └──────────┘    └─────────────┘    └──────────┘
       ▲                                                     │
       └─────────────────── next phase ◄──────────────────────┘
```

### Stage 1 — Specify (already done, per phase, in `/specs/`)

Each spec is a real file with: context, numbered functional requirements, interfaces/contracts, explicit non-functional requirements, explicit out-of-scope items, and acceptance criteria written as checkable statements. This is the source of truth — Claude Code implements *against* it, not against a paraphrase of it typed into chat.

### Stage 2 — Plan (Claude Code, before touching code)

1. Start a **new session** for the phase (don't carry over context from the previous phase — this avoids context rot and stale assumptions).
2. Give Claude Code this instruction, pointing at the specific spec file:

   > Read `/specs/0X-phase-name.md` and `CLAUDE.md`. Do not write any code yet. Produce an implementation plan: the files you'll create or modify, the key function/endpoint signatures, the order you'll build them in, and any assumptions you're making. If anything in the spec is ambiguous or underspecified, list it explicitly as a question instead of silently picking an interpretation.

3. **Read the plan.** This is the actual review gate — it's far cheaper to correct a wrong plan than wrong code. If Claude Code asked clarifying questions, answer them here, in writing, before proceeding (the answers become part of the record for that phase).
4. Only once the plan looks right: *"Approved — implement this on a new branch `phase-N-name`."*

### Stage 3 — Implement

- Claude Code creates the branch and implements against the approved plan.
- Tests are written alongside the implementation, not as an afterthought — this is enforced in `CLAUDE.md`.
- If Claude Code hits a decision the spec/plan didn't cover mid-implementation, it should stop and ask rather than silently choosing — this is also enforced in `CLAUDE.md`, but worth reinforcing if you see it guessing.

### Stage 4 — Validate (you, not Claude Code, own this gate)

- Run the phase's **Acceptance Criteria** checklist from its spec file, literally, one by one.
- Spot-check the actual behavior, not just "tests pass" — e.g. for Phase 2, manually look at a few `extracted_attributes` results against the raw listing text.
- Only after validation passes: merge the branch, move to the next phase's spec.

## Session Hygiene

- **One phase per session.** Don't chain multiple phases in one long conversation — context accumulates and quality degrades over long sessions (this is a documented effect, not superstition). Start fresh, point Claude Code back at `CLAUDE.md` + the relevant spec.
- **Use `/clear` (or a new session) between unrelated tasks** even within a phase, if you go off on a tangent (e.g. debugging an unrelated Docker issue).
- Keep `CLAUDE.md` itself short — it's loaded every session. If it starts accumulating one-off notes, move them into the relevant spec instead.

## What This Fixes vs. the Original Plan

| Before | Now |
|---|---|
| One paragraph "prompt" per phase | Full spec file with numbered requirements, interfaces, explicit non-goals |
| Claude Code writes code immediately | Claude Code plans first, you review the plan before code exists |
| Ambiguities silently resolved by the model | Ambiguities must be surfaced as explicit questions |
| "Done" = code compiles | "Done" = spec's acceptance criteria checklist verified |
| All context in one long-running chat | One phase per session, fresh context, pointed at persistent files |

## Escalation Rule

If you notice Claude Code making an architectural decision that isn't in `CLAUDE.md` or the current spec (e.g. picking a caching strategy, changing an error-handling pattern), stop it, and decide explicitly whether that decision should be: (a) answered ad hoc for this phase only, or (b) promoted into `CLAUDE.md` as a standing rule so it doesn't have to be decided again. Rule (b) is usually right if it's the kind of thing that should be consistent across the whole codebase.
