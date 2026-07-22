/** Normalize provider plan labels for display without inventing account data. */
export function displayPlanName(
  planName: string | null,
  claudeAiLabel = "Claude AI",
): string | null {
  const normalized = planName?.trim();
  if (!normalized) return null;
  return normalized.toLowerCase() === "default_claude_ai"
    ? claudeAiLabel
    : normalized;
}
