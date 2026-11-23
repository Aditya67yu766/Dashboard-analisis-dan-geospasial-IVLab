const DISEASE_GROUPS: Record<string, Set<string>> = {};

export function diseaseGroup(target: unknown): string {
  const value = String(target ?? '').trim();
  if (!value) return value;
  const lower = value.toLowerCase();
  const group = /influenza/.test(lower) || /^(ai|aiv|hpai|lpai)([^a-z]|$)/.test(lower) ? 'Influenza' : value;
  DISEASE_GROUPS[group] = DISEASE_GROUPS[group] ?? new Set<string>();
  DISEASE_GROUPS[group].add(value);
  return group;
}

export function diseaseSubtypes(group: string): string[] {
  return [...(DISEASE_GROUPS[group] ?? [])].sort((a, b) => a.localeCompare(b, 'id'));
}
