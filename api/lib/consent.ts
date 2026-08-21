/** Dataset publication requires an explicit JSON boolean true. */
export function isExplicitDataContribution(value: unknown): value is true {
  return value === true
}

export function datasetContributionResult(datasetId: string | null):
  | { contributed: true; entry_id: string }
  | { contributed: false } {
  return datasetId !== null
    ? { contributed: true, entry_id: datasetId }
    : { contributed: false }
}
