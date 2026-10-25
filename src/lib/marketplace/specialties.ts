import { professionOptions } from "@/lib/profession-options";

export type SpecialtySeed = {
  slug: string;
  name: string;
  description: string;
};

export function slugifyProfession(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Mesmas opções do dropdown de cadastro — fonte única. */
export const MARKETPLACE_SPECIALTY_CATALOG: readonly SpecialtySeed[] =
  professionOptions.map((option) => ({
    slug: slugifyProfession(option.value),
    name: option.label,
    description: `${option.label} — conselho ${option.council}.`,
  }));

export const MARKETPLACE_SPECIALTY_SLUGS = MARKETPLACE_SPECIALTY_CATALOG.map(
  (item) => item.slug,
);

export const DEFAULT_MARKETPLACE_SPECIALTY_SLUG = slugifyProfession("Fisioterapeuta");

/** Slugs do catálogo fantasia → slugs reais do cadastro. */
export const LEGACY_SPECIALTY_SLUG_ALIASES: Readonly<Record<string, string>> = {
  fisioterapia: "fisioterapeuta",
  fonoaudiologia: "fonoaudiologo",
  "terapia-ocupacional": "terapeuta-ocupacional",
  psicologia: "psicologo",
  nutricao: "nutricionista",
};

const PROFESSION_TO_SLUG = new Map<string, string>();
for (const option of professionOptions) {
  const slug = slugifyProfession(option.value);
  PROFESSION_TO_SLUG.set(slugifyProfession(option.value), slug);
  PROFESSION_TO_SLUG.set(slugifyProfession(option.label), slug);
}

export function specialtySlugFromProfession(profession: string | null | undefined): string {
  const key = slugifyProfession(profession ?? "");
  if (!key) return DEFAULT_MARKETPLACE_SPECIALTY_SLUG;
  return PROFESSION_TO_SLUG.get(key) ?? DEFAULT_MARKETPLACE_SPECIALTY_SLUG;
}

/** Slugs que a busca B2C deve aceitar para o texto digitado/selecionado. */
export function matchingSpecialtySlugs(query: string): string[] {
  const slug = slugifyProfession(query);
  const slugs = new Set<string>();
  if (MARKETPLACE_SPECIALTY_SLUGS.includes(slug)) slugs.add(slug);
  const alias = LEGACY_SPECIALTY_SLUG_ALIASES[slug];
  if (alias) slugs.add(alias);
  for (const item of MARKETPLACE_SPECIALTY_CATALOG) {
    if (slugifyProfession(item.name) === slug) slugs.add(item.slug);
  }
  return [...slugs];
}
