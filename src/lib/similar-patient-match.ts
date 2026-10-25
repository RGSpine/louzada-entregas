/**
 * Matching de nomes similares / homônimos para Nova Evolução.
 * Puro (sem I/O) — usado por `findSimilarPatients` e testes.
 */

export type SimilarPatientCandidate = {
  id: string;
  name: string;
  age: string | null;
  diagnosis: string | null;
  evolutionCount: number;
};

/** Distância de Levenshtein entre duas strings. */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i]![j] = matrix[i - 1]![j - 1]!;
      } else {
        matrix[i]![j] = Math.min(
          matrix[i - 1]![j - 1]! + 1,
          matrix[i]![j - 1]! + 1,
          matrix[i - 1]![j]! + 1,
        );
      }
    }
  }
  return matrix[b.length]![a.length]!;
}

/** Normaliza nome para comparação (remove acentos, lowercase, trim). */
export function normalizePatientName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Variação só de gênero (Roberto/Roberta) — não deve alertar.
 */
export function isGenderNameVariation(name1: string, name2: string): boolean {
  const n1 = normalizePatientName(name1);
  const n2 = normalizePatientName(name2);

  const genderPairs: [RegExp, string][] = [
    [/o$/, "a"],
    [/a$/, "o"],
    [/os$/, "as"],
    [/as$/, "os"],
  ];

  for (const [pattern, replacement] of genderPairs) {
    if (n1.replace(pattern, replacement) === n2) {
      return true;
    }
  }

  return false;
}

/**
 * Filtra pacientes do escopo cujo nome é igual ou similar ao digitado/falado.
 */
export function matchSimilarPatients(
  patientName: string,
  patients: SimilarPatientCandidate[],
): SimilarPatientCandidate[] {
  if (!patientName || patientName.trim().length < 2) {
    return [];
  }

  const normalizedInput = normalizePatientName(patientName);
  const inputFirstName = normalizedInput.split(" ")[0] ?? "";
  const similarPatients: SimilarPatientCandidate[] = [];

  for (const patient of patients) {
    const normalizedExisting = normalizePatientName(patient.name);
    const existingFirstName = normalizedExisting.split(" ")[0] ?? "";

    if (normalizedExisting === normalizedInput) {
      similarPatients.push(patient);
      continue;
    }

    if (inputFirstName === existingFirstName && inputFirstName.length >= 3) {
      similarPatients.push(patient);
      continue;
    }

    if (inputFirstName.length >= 3 && existingFirstName.length >= 3) {
      const distance = levenshteinDistance(inputFirstName, existingFirstName);
      const maxLen = Math.max(inputFirstName.length, existingFirstName.length);
      const similarity = 1 - distance / maxLen;

      if (similarity >= 0.75 && distance <= 2) {
        if (!isGenderNameVariation(inputFirstName, existingFirstName)) {
          similarPatients.push(patient);
          continue;
        }
      }
    }

    if (normalizedInput.length >= 5 && normalizedExisting.length >= 5) {
      const fullDistance = levenshteinDistance(normalizedInput, normalizedExisting);
      const fullMaxLen = Math.max(normalizedInput.length, normalizedExisting.length);
      const fullSimilarity = 1 - fullDistance / fullMaxLen;

      if (fullSimilarity >= 0.8 && fullDistance <= 3) {
        if (!isGenderNameVariation(normalizedInput, normalizedExisting)) {
          if (!similarPatients.find((p) => p.id === patient.id)) {
            similarPatients.push(patient);
          }
        }
      }
    }
  }

  return similarPatients;
}
