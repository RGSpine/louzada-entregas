export type ContactUpdate = {
  clientName: string;
  address: string | null;
  phone: string | null;
};

function titleName(raw: string): string {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function clauseUpdates(clause: string): ContactUpdate | null {
  const address = clause.match(/\bendere[cç]o\s+(?:d[aeo]\s+)?(.+?)\s+(?:é|eh|\be\b)\s+(.+)$/i);
  const phone = clause.match(/\b(?:telefone|fone|celular)\s+(?:d[aeo]\s+)?(.+?)\s+(?:é|eh|\be\b)\s+(.+)$/i);
  const clientName = titleName((address?.[1] ?? phone?.[1] ?? "").trim());
  if (!clientName) return null;
  const street = address?.[2]?.trim().replace(/[.;]+$/, "") ?? "";
  const number = (phone?.[2] ?? "").replace(/[^\d\s/+()-]/g, " ").replace(/\s+/g, " ").trim();
  if (!street && number.length < 8) return null;
  return {
    clientName,
    address: street ? street.slice(0, 2000) : null,
    phone: number.length >= 8 ? number.slice(0, 40) : null,
  };
}

/** Completa endereço ou telefone de um cliente já citado. Não cria a pessoa. */
export function interpretContactUpdates(transcript: string): ContactUpdate[] {
  const byName = new Map<string, ContactUpdate>();
  for (const clause of transcript.split(/[\n/.;]+/)) {
    const update = clauseUpdates(clause.trim());
    if (!update) continue;
    const key = update.clientName.toLocaleLowerCase("pt-BR");
    const current = byName.get(key);
    byName.set(key, {
      clientName: update.clientName,
      address: update.address ?? current?.address ?? null,
      phone: update.phone ?? current?.phone ?? null,
    });
  }
  return [...byName.values()];
}
