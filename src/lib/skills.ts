/**
 * NEXUS Skills — capability modules the model auto-selects per task.
 * --------------------------------------------------------------------
 * A "skill" is a named bundle of expert guidance (and a hint about when it
 * applies). The model is shown a compact router of available skills and picks
 * the most relevant one(s) based on the task's complexity — exactly like the
 * user converses normally and the AI decides which tool to reach for.
 *
 * This module is pure (no server/browser deps) so it can be imported from the
 * agent loop (server), the chat composer, and the settings UI alike.
 */

export interface NexusSkill {
  /** Stable id used in settings + when passing the enabled set to the agent. */
  id: string
  /** Display name for the settings UI. */
  name: string
  /** Emoji used in the settings UI. */
  emoji: string
  /** One-line, user-facing description (settings UI). */
  description: string
  /** Model-facing: when this skill should kick in (used in the router list). */
  whenToUse: string
  /** Model-facing: the full expert playbook injected when the skill is active. */
  guidance: string
  /** Heuristic that auto-activates the full guidance when the prompt matches. */
  match: RegExp
}

export const SKILLS: NexusSkill[] = [
  {
    id: 'web-design',
    name: 'Web Design',
    emoji: '🎨',
    description:
      'Builds modern, premium front-ends — landing pages, sites, UI components — production-ready.',
    whenToUse:
      'the user wants a website, landing page, web UI, component, or any HTML/CSS/JS front-end.',
    match:
      /\b(web\s?site|website|land(ing)?\s?page|p[áa]gina\s?web|sitio\s?web|front[\s-]?end|frontend|html|css|tailwind|react\s?component|componente|ui\s?(design|kit)?|interfaz|dashboard|portfolio|portafolio|hero\s?section|navbar)\b/i,
    guidance: `### Skill: Web Design (premium front-end)
You are a world-class product designer and senior front-end engineer. Deliver work that looks like a top design studio shipped it.

Output rules:
- Ship COMPLETE, production-ready, copy-paste-runnable code. No placeholders, no "TODO", no "add your content here", no truncation.
- Default to a single self-contained \`.html\` file (CSS + JS inlined) unless the user asks for a framework/multi-file. It must open and work by double-clicking, with zero broken external dependencies.
- ALWAYS do BOTH: (1) save the file(s) to the sandbox with write_file so the user gets a downloadable file, AND (2) include the full final code in your reply so they can copy-paste it directly. Never leave the only copy trapped in the sandbox.

Design bar (every build):
- Strong typographic scale and generous whitespace; a cohesive color system with one confident accent; consistent radii, borders and shadows.
- Tasteful motion: hover states, scroll reveals, micro-interactions. Modern aesthetics where they fit (glassmorphism, soft gradients, subtle grain, depth).
- Mobile-first and fully responsive (sensible breakpoints).
- Accessible: semantic HTML, sufficient contrast, visible focus states, alt text, and \`prefers-reduced-motion\` honored.
- Realistic, believable copy — never lorem ipsum. For imagery use inline SVG, CSS gradients, or a reliable placeholder service so nothing renders broken offline.
- Performance: system font stack or a single web font, no layout shift, no dead libraries.
- Finishing touches: \`<title>\`, meta description, favicon (inline data-URI is fine), and a coherent footer.`,
  },
  {
    id: 'planning',
    name: 'Planning',
    emoji: '🗺️',
    description:
      'Breaks complex, multi-step, or ambiguous tasks into a clear plan before executing.',
    whenToUse:
      'the task is complex, multi-step, ambiguous, or spans several files/stages and benefits from a plan first.',
    match:
      /\b(plan|planning|step[\s-]?by[\s-]?step|roadmap|architect|design\s+(a|the)\s+system|multi[\s-]?step|break\s+down|estrateg|organiz|proyecto\s+completo|build\s+(an?\s+)?(app|application|system|platform))\b/i,
    guidance: `### Skill: Planning
For complex, multi-step, or ambiguous work, plan before you act.
- Open with a short, numbered plan: the goal, the key steps, the deliverables, and any assumptions you're making. Keep it tight — no padding.
- Then execute the plan. Re-plan briefly if you discover something that changes the approach.
- For simple, one-shot requests, skip the plan and just answer — don't over-ceremony trivial tasks.`,
  },
  {
    id: 'autonomous-agent',
    name: 'Autonomous Agent',
    emoji: '🤖',
    description:
      'Runs real multi-step work in the sandbox — code, data, files — verifying results as it goes.',
    whenToUse:
      'the task needs real execution: running/testing code, calculations, scraping, data processing, or producing files.',
    match:
      /\b(run|execute|ejecut|build\s+and\s+test|scrape|crawl|automate|automatiz|calcul|process\s+(this|the|my)\s+(data|file|csv)|genera(r|te)\s+(un|a|the)\s+(file|archivo|report|dataset)|script\s+that)\b/i,
    guidance: `### Skill: Autonomous Agent
For tasks that need real execution, work like a careful operator, not a one-shot guesser.
- Work ReAct-style: take ONE action with a tool, observe the actual result, adapt, repeat. Don't batch blind steps.
- Install whatever you need (pip/apt). Prefer running code to verify over claiming a result from memory — never fabricate output you didn't actually produce.
- When something fails, read the error and debug it; retry with a fix instead of giving up.
- Save real deliverables as files (they're returned to the user as downloadable artifacts).
- Finish with a concise summary: what you did, the verified result, and which files you produced.`,
  },
  {
    id: 'data-analysis',
    name: 'Data Analysis',
    emoji: '📊',
    description:
      'Analyzes data — CSV/Excel/JSON — with real stats, cleaning, and downloadable charts.',
    whenToUse:
      'the user has data to explore, clean, summarize, correlate, or visualize (CSV, Excel, JSON, dataframes).',
    match:
      /\b(data\s?analysis|analiz(e|ar)\s+(los?\s+)?datos|dataset|datos|csv|excel|spreadsheet|hoja\s+de\s+c[áa]lculo|pandas|dataframe|statistic|estad[íi]stic|correlat|correlaci|visualiz|chart|gr[áa]fic[oa]|plot|histogram|distribuci[óo]n)\b/i,
    guidance: `### Skill: Data Analysis
You are a rigorous data analyst. Compute real answers — never eyeball or invent numbers.
- Load the data and inspect it first: shape, columns, dtypes, missing values, a few sample rows.
- Clean as needed: fix types, handle nulls/duplicates, normalize categories — and state what you changed.
- Analyze to answer the actual question: descriptive stats, group-bys, correlations, trends. Use pandas/numpy (install if needed).
- Visualize when it helps: generate charts (matplotlib/plotly) and SAVE them as image files so they come back as downloadable artifacts. Save cleaned/derived data as CSV too when useful.
- Report the concrete findings (the real figures) in a short summary, with the key numbers inline — not just "analysis complete".`,
  },
  {
    id: 'debugging',
    name: 'Debugging',
    emoji: '🐛',
    description:
      'Reproduces, isolates, and fixes bugs — then verifies the fix actually works in the sandbox.',
    whenToUse:
      'the user has broken code, an error, a traceback, or behavior that does not work as expected.',
    match:
      /\b(debug|bug|error|traceback|stack\s?trace|exception|crash|no\s+funciona|no\s+sirve|doesn'?t\s+work|isn'?t\s+working|won'?t\s+(run|compile)|fix\s+(this|the|my)\s+(code|bug|error)|arregl|por\s+qu[ée]\s+(no\s+)?(funciona|falla)|falla)\b/i,
    guidance: `### Skill: Debugging
You are a senior debugger. Diagnose with evidence, don't guess.
- Reproduce first: build the smallest repro and run it in the sandbox to see the real failure. Read the actual error/traceback carefully.
- Isolate the root cause: form a hypothesis, test it, narrow down. Distinguish the symptom from the cause.
- Fix minimally and verify: apply a targeted change, then RE-RUN to confirm it's actually fixed. Iterate until it passes; don't claim a fix you didn't verify.
- Explain clearly: the root cause, why it happened, and the corrected code. Prefer the smallest change that fixes it correctly.`,
  },
]

const ROUTER_HEADER = `## NEXUS Skills (auto-select by task complexity)
You have specialized skills. Read the task, judge its complexity, and silently apply the most relevant skill(s). Don't announce which skill you picked. For simple conversation, explanations, or quick questions, use NO skill and just answer. Available skills:`

/**
 * Build the skill instruction block injected into the system prompt.
 *
 * - Always lists the enabled skills as a router so the model can self-select.
 * - When the user's text clearly matches a skill, also injects that skill's
 *   full expert guidance so even smaller models get the deep playbook.
 *
 * @param userText  the latest user message (for heuristic matching)
 * @param enabledIds  ids of enabled skills; when omitted, all skills are on
 * @returns the block to append to the system prompt, or '' if none enabled
 */
export function buildSkillContext(userText: string, enabledIds?: string[]): string {
  const enabled = enabledIds
    ? SKILLS.filter((s) => enabledIds.includes(s.id))
    : SKILLS
  if (enabled.length === 0) return ''

  const router = [
    ROUTER_HEADER,
    ...enabled.map((s) => `- **${s.id}** — use when ${s.whenToUse}`),
  ].join('\n')

  const text = userText || ''
  const active = enabled.filter((s) => s.match.test(text))
  const playbooks = active.length
    ? '\n\n' + active.map((s) => s.guidance).join('\n\n')
    : ''

  return `\n\n---\n${router}${playbooks}`
}
