export const PATIENT_MAP_SECTION_SLUGS = [
  "captar",
  "estado",
  "hoje",
  "relato",
  "agenda",
  "consultas",
  "linha",
  "perguntas",
] as const;

export type PatientMapSectionSlug = (typeof PATIENT_MAP_SECTION_SLUGS)[number];

export type PatientMapSection = {
  slug: PatientMapSectionSlug;
  href: string;
  label: string;
  title: string;
  subtitle: string;
  step: string;
};

export const PATIENT_MAP_SECTIONS: readonly PatientMapSection[] = [
  {
    slug: "captar",
    href: "/mapa-saude/captar",
    label: "Captar",
    title: "Registrar consulta",
    subtitle:
      "Grave o áudio (até 6 min) e, se quiser, anexe até 3 laudos. A IA organiza tudo no seu mapa.",
    step: "1",
  },
  {
    slug: "estado",
    href: "/mapa-saude/estado",
    label: "Estado",
    title: "Seu estado de saúde",
    subtitle:
      "Resumo geral extraído pela IA a partir das consultas e exames que você enviou.",
    step: "2",
  },
  {
    slug: "hoje",
    href: "/mapa-saude/hoje",
    label: "Hoje",
    title: "Como você está hoje",
    subtitle:
      "Água, sono, urina, fezes e movimento. Opcional — complementa o panorama, não substitui uma consulta.",
    step: "3",
  },
  {
    slug: "relato",
    href: "/mapa-saude/relato",
    label: "Relato",
    title: "O que você sentiu",
    subtitle:
      "Escreva ou grave um relato longo, separado da consulta. A IA cruza com o mapa e, se fizer sentido, indica um profissional.",
    step: "4",
  },
  {
    slug: "agenda",
    href: "/mapa-saude/agenda",
    label: "Agenda",
    title: "Sua agenda de cuidado",
    subtitle:
      "Próximas consultas, o que já foi feito e as últimas atividades geradas pela IA.",
    step: "5",
  },
  {
    slug: "consultas",
    href: "/mapa-saude/consultas",
    label: "Consultas",
    title: "O que foi dito nas consultas",
    subtitle:
      "Toque em cada consulta para ler a explicação, recomendações e orientações.",
    step: "6",
  },
  {
    slug: "linha",
    href: "/mapa-saude/linha",
    label: "Linha",
    title: "Linha do cuidado",
    subtitle:
      "Relatos e consultas na ordem em que aconteceram. Você escolhe qual profissional vê esta linha.",
    step: "7",
  },
  {
    slug: "perguntas",
    href: "/mapa-saude/perguntas",
    label: "Perguntas",
    title: "Assistente clínico",
    subtitle:
      "Pergunte sobre o que foi dito, o panorama ou o que fazer a seguir. Fontes científicas só se você pedir.",
    step: "8",
  },
];

export function isPatientMapSectionSlug(
  value: string,
): value is PatientMapSectionSlug {
  return (PATIENT_MAP_SECTION_SLUGS as readonly string[]).includes(value);
}

export function patientMapSection(slug: PatientMapSectionSlug): PatientMapSection {
  const section = PATIENT_MAP_SECTIONS.find((item) => item.slug === slug);
  if (!section) throw new Error("Função do mapa desconhecida.");
  return section;
}
