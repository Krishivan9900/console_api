export function normalizeTriggerText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function matchesTriggerKeyword(text: string, keyword: string): boolean {
  const input = normalizeTriggerText(text);
  const trigger = normalizeTriggerText(keyword);
  if (!input || !trigger) return false;
  if (input === trigger) return true;
  const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match a keyword/phrase in a sentence, without matching "hi" inside "this".
  return new RegExp(`(^|[^\\p{L}\\p{N}\\p{M}_])${escaped}($|[^\\p{L}\\p{N}\\p{M}_])`, 'u').test(input);
}

export function selectTriggeredBot(candidates: any[], text: string): any | null {
  const input = normalizeTriggerText(text);
  const matches = candidates.filter(candidate =>
    typeof candidate.trigger_word === 'string' && matchesTriggerKeyword(input, candidate.trigger_word)
  );
  matches.sort((left, right) => {
    const leftKeyword = normalizeTriggerText(left.trigger_word);
    const rightKeyword = normalizeTriggerText(right.trigger_word);
    const exactPriority = Number(rightKeyword === input) - Number(leftKeyword === input);
    return exactPriority || rightKeyword.length - leftKeyword.length || String(left.id).localeCompare(String(right.id));
  });
  return matches[0] || null;
}
