export function normalizeRegistrationPhoneNumber(phone: string | number | null | undefined): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  // A national number can itself start with 91; only strip a 12-digit prefix.
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
}

export function getPhoneNumberVariants(phone: string | number | null | undefined): string[] {
  const original = String(phone ?? '').trim();
  const variants = new Set([original]);
  // Email logins and other identifiers must not be interpreted as numbers.
  if (!/^[+\d\s().-]+$/.test(original)) return [...variants];
  const digits = original.replace(/\D/g, '');
  const national = normalizeRegistrationPhoneNumber(digits);
  variants.add(digits);
  if (national.length === 10) {
    variants.add(national);
    variants.add(`91${national}`);
    variants.add(`+91${national}`);
  }
  return [...variants];
}
