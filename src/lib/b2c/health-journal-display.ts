export type HealthJournalSource = "text" | "audio" | "mixed";

export type HealthJournalEntryView = {
  id: string;
  body: string;
  source: HealthJournalSource;
  createdAt: string;
  profileName: string | null;
};

export function journalSourceLabel(source: HealthJournalSource): string {
  if (source === "audio") return "Áudio";
  if (source === "mixed") return "Texto e áudio";
  return "Texto";
}
