// -------------------------------------------------------------------
// PRESETS — model + prompt combos for the parallel "Hall of Fame" race.
// Cleared: the previous templates were removed. Add your own legitimate
// model/prompt presets here if you want to race several in parallel.
// -------------------------------------------------------------------

export interface HallOfFameCombo {
  id: string           // unique key
  model: string        // OpenRouter model ID
  codename: string     // display name
  description: string  // one-line description
  color: string        // UI badge color (hex)
  system: string       // system prompt with a {QUERY} placeholder
  user: string         // user prompt with a {QUERY} placeholder
  fast?: boolean       // stream tokens immediately
}

export const HALL_OF_FAME: HallOfFameCombo[] = []

// -- Variable injection: replace placeholders with the user's query ----
export function injectQuery(text: string, query: string): string {
  return text
    .replaceAll('{QUERY}', query)
    .replaceAll('{Z}', query)
    .replaceAll('<user_query>', query)
    .replaceAll('</user_query>', '')
}

// -- Apply a combo to a query ----------------------------------------
export function applyHallOfFameCombo(
  combo: HallOfFameCombo,
  query: string,
): { system: string; user: string } {
  return {
    system: injectQuery(combo.system, query),
    user: injectQuery(combo.user, query),
  }
}

// -- Convenience: get combo by id ------------------------------------
export function getComboById(id: string): HallOfFameCombo | undefined {
  return HALL_OF_FAME.find((c) => c.id === id)
}
