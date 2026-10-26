export function normalizeTriggerText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Identify a reply to a saved menu before interpreting its visible title as a start keyword. */
export function getInteractiveReplyEdge(bot: any, incomingId: string, currentNodeId?: string): any {
  if (!incomingId) return undefined;
  const parse = (value: any) => typeof value === 'string' ? JSON.parse(value) : value || {};
  const matches = (bot.edges || []).filter((edge: any) => {
    const data = parse(edge.data);
    if (![data.button_id, data.sourceHandle, edge.sourceHandle].includes(incomingId)) return false;
    const source = bot.nodes?.find((node: any) => node.id === edge.source);
    return ['@whatsapp/send-button-message', '@whatsapp/send-list-message'].includes(parse(source?.data).key);
  });
  return matches.find((edge: any) => edge.source === currentNodeId) || matches[0];
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
