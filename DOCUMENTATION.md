# 📖 Threadrift Official Documentation

> *"Why spend 40 hours formatting a Docusaurus site when you can just prompt an LLM in 3 seconds?"*

---

## 🛑 Welcome to the Future of "Documentation"

Listen, let's be honest with each other for a second.

It is **2026**. If you came here expecting a 75-page API reference detailing every parameter of a Catmull-Rom tangent calculation or an exhaustive breakdown of every CSS utility class in the studio panel... **I have bad news.**

I am far too lazy to write, format, update, and maintain a static documentation site that will be obsolete the moment I refactor a hook next Tuesday at 2:00 AM. 

And more importantly: **You weren't going to read it anyway.** You were going to `Ctrl+F`, get frustrated, copy a snippet that doesn't quite work, and then paste it into ChatGPT or Claude.

So let's cut out the middleman.

---

## 🤖 The "Real" Documentation Protocol

If you want to know how this codebase works, how to add a custom shader, how to hook up server-side graph generation, or why `applyMagneticSnap()` uses an exponential pull curve:

### Step 1: Open Your Favorite Coding Agent
*(Yep, It's Claude for Everyone 🙄)*

### Step 2: Feed It the Repo
Tell your AI:
> *"Here is the Threadrift repository. Explain how `@threadrift/core`, `@threadrift/react`, and `@threadrift/studio` fit together, and write me a component that generates a dynamic branching graph from an API response."*

### Step 3: Profit
Your AI will read the clean, typed TypeScript definitions, inspect `spline.ts` and `threadrift-store.ts`, and explain it to you 10x better than I ever could.

---

## 🗺️ The TL;DR Cheat Sheet (For Humans with Attention Spans < 15s)

If your internet goes down and you have to use your actual brain:

- **Where is the math?** 
  👉 `packages/core/src/spline.ts` & `physics.ts`
- **Where is the 60fps camera loop?** 
  👉 `packages/react/src/components/ThreadriftCanvas.tsx` (Look for the GSAP subscriber that bypasses React re-renders).
- **Where are the spatial HTML elements anchored?** 
  👉 `<Threadrift.Node id={...}>` in `packages/react/src/components/Node.tsx`. It renders inside an SVG `<foreignObject>` so it literally can't drift.
- **Where is the state & graph mutation logic?** 
  👉 `packages/react/src/store/threadrift-store.ts` (Zustand + auto-save debouncing).
- **Where is the visual editor panel?** 
  👉 `packages/studio/src/editor/EditorPanel.tsx`.

---

## ❓ FAQ

**Q: Is this lazy?**  
A: Absolutely. But it's *efficient* laziness.

**Q: What if the AI hallucinates?**  
A: The TypeScript types in `@threadrift/core` are strictly typed with `dts` outputs. If it hallucinates, `bun run build` will yell at you anyway.

**Q: Can I submit a PR to write "real" docs?**  
A: Only if it's shorter and funnier than this file.

---

*Happy drifting through the threads.* 🌌
