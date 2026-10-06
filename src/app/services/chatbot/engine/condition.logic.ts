function variablePath(value: string): string {
  return value.trim().replace(/^\{\{\s*|\s*\}\}$/g, '').trim();
}

export function getConditionValue(variables: any, field: string): any {
  const path = variablePath(field);
  if (!path) return undefined;
  // The flow editor exposes this alias for the success flag in the HTTP body.
  if (path === 'http_response_success' && variables?.http_response?.success !== undefined) {
    return variables.http_response.success;
  }
  return path.split('.').reduce((value, key) => {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) return undefined;
    return value != null && Object.prototype.hasOwnProperty.call(value, key)
      ? value[key]
      : undefined;
  }, variables);
}

function compareCondition(condition: any, variables: any): boolean {
  if (!condition || typeof condition.field !== 'string' || !variablePath(condition.field)) {
    throw new Error('Condition requires a variable field');
  }

  const actual = getConditionValue(variables, condition.field);
  const rawExpected = condition.value;
  const expected = typeof rawExpected === 'string' && /^\s*\{\{.*\}\}\s*$/.test(rawExpected)
    ? getConditionValue(variables, rawExpected)
    : rawExpected;
  const comparator = String(condition.comparator || 'equals').replace(/[\s_-]/g, '').toLowerCase();
  const empty = actual == null || actual === '' || (Array.isArray(actual) && actual.length === 0);
  const text = (value: any) => String(value).toLowerCase();
  const equals = actual !== undefined && expected !== undefined && text(actual) === text(expected);

  switch (comparator) {
    case 'equals': case 'equal': case 'eq': case '==': case '===':
      return equals;
    case 'notequals': case 'notequal': case 'neq': case '!=': case '!==':
      return actual !== undefined && expected !== undefined && !equals;
    case 'exists': case 'isnotnull':
      return actual != null;
    case 'notexists': case 'isnull':
      return actual == null;
    case 'isempty': case 'empty':
      return empty;
    case 'isnotempty': case 'notempty':
      return !empty;
    case 'contains': case 'notcontains': {
      if (actual == null || expected == null) return false;
      const contains = Array.isArray(actual)
        ? actual.some(value => text(value) === text(expected))
        : text(actual).includes(text(expected));
      return comparator === 'contains' ? contains : !contains;
    }
    case 'startswith':
      return actual != null && expected != null && text(actual).startsWith(text(expected));
    case 'endswith':
      return actual != null && expected != null && text(actual).endsWith(text(expected));
    case 'greaterthan': case 'gt': case '>':
    case 'greaterthanorequal': case 'greaterthanorequals': case 'gte': case '>=':
    case 'lessthan': case 'lt': case '<':
    case 'lessthanorequal': case 'lessthanorequals': case 'lte': case '<=': {
      if (actual == null || expected == null || actual === '' || expected === '' ||
          !['string', 'number'].includes(typeof actual) || !['string', 'number'].includes(typeof expected)) return false;
      const left = Number(actual);
      const right = Number(expected);
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
      if (['greaterthan', 'gt', '>'].includes(comparator)) return left > right;
      if (['greaterthanorequal', 'greaterthanorequals', 'gte', '>='].includes(comparator)) return left >= right;
      if (['lessthan', 'lt', '<'].includes(comparator)) return left < right;
      return left <= right;
    }
    default:
      throw new Error(`Unsupported condition comparator: ${condition.comparator}`);
  }
}

export function evaluateConditions(attributes: any, variables: any): boolean {
  const conditions = attributes?.conditions;
  // Older flows use a condition node solely to branch on the HTTP result.
  if (conditions == null || (Array.isArray(conditions) && conditions.length === 0)) {
    return variables?.http_response?.success === true;
  }
  if (!Array.isArray(conditions)) throw new Error('Conditions must be an array');
  const operator = String(attributes?.operator || 'and').toLowerCase();
  if (!['and', 'or'].includes(operator)) throw new Error(`Unsupported condition operator: ${operator}`);
  const results = conditions.map(condition => compareCondition(condition, variables));
  return operator === 'or' ? results.some(Boolean) : results.every(Boolean);
}

export function getConditionBranch(edge: any): boolean | undefined {
  const data = typeof edge.data === 'string' ? JSON.parse(edge.data) : edge.data;
  for (const value of [data?.condition, data?.branch, edge.sourceHandle, data?.sourceHandle, edge.label]) {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') continue;
    const match = value.trim().toLowerCase().match(/^(?:condition-)?(true|false)(?:-.*)?$/);
    if (match) return match[1] === 'true';
  }
  return undefined;
}
