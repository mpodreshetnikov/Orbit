export function looksLikeIcdCodeQuery(query: string): boolean {
  return /^[A-Z][0-9]/i.test(query.trim());
}

export function buildIcd10CandidateCodes(query: string, maxCandidates = 15): string[] {
  const upperQuery = query.toUpperCase().trim();
  const codeMatch = upperQuery.match(/^([A-Z])([0-9]{0,2})\.?([0-9]?)$/);
  if (!codeMatch) return [];

  const letter = codeMatch[1];
  const num1 = codeMatch[2] || "";
  const num2 = codeMatch[3] || "";
  const codesToTry: string[] = [];

  if (num1.length === 2 && num2) {
    const baseNum = parseInt(num2, 10);
    for (let i = Math.max(0, baseNum - 2); i <= Math.min(9, baseNum + 5); i++) {
      codesToTry.push(`${letter}${num1}.${i}`);
    }
  } else if (num1.length === 2) {
    codesToTry.push(`${letter}${num1}`);
    for (let i = 0; i <= 9; i++) {
      codesToTry.push(`${letter}${num1}.${i}`);
    }
  } else if (num1.length === 1) {
    for (let i = 0; i <= 9; i++) {
      codesToTry.push(`${letter}${num1}${i}`);
    }
  } else {
    for (let i = 0; i <= 9; i++) {
      codesToTry.push(`${letter}0${i}`);
      if (i <= 5) codesToTry.push(`${letter}${i}0`);
    }
  }

  const deduped = Array.from(new Set(codesToTry));
  return deduped.slice(0, Math.max(1, maxCandidates));
}
