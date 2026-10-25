import { interpretContactUpdates, type ContactUpdate } from "@/lib/logistics/contact-update";

export type SpokenCourier = { name: string; phone: string | null };

export type DirectorySpeech = {
  clients: ContactUpdate[];
  couriers: SpokenCourier[];
};

function titleName(raw: string): string {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function cleanName(raw: string): string {
  const clipped = raw
    .replace(/\s+(?:com\s+)?(?:o\s+)?(?:endere[cç]o|telefone|fone|celular)\b.*$/i, "")
    .replace(/[.,;]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return titleName(clipped);
}

function detailsInClause(raw: string): { address: string | null; phone: string | null } {
  const address = raw.match(
    /\bendere[cç]o\s+(?:é|eh|\be\b)\s+(.+?)(?=\s+(?:e\s+)?(?:o\s+)?(?:telefone|fone|celular)\b|$)/i,
  );
  const phone = raw.match(/\b(?:telefone|fone|celular)\s+(?:é|eh|\be\b)\s+(.+)$/i);
  const street = address?.[1]?.replace(/[.,;]+$/g, "").trim() ?? "";
  const number = (phone?.[1] ?? "").replace(/[^\d\s/+()-]/g, " ").replace(/\s+/g, " ").trim();
  return {
    address: street ? street.slice(0, 2000) : null,
    phone: number.length >= 8 ? number.slice(0, 40) : null,
  };
}

function rememberClient(byName: Map<string, ContactUpdate>, update: ContactUpdate) {
  const key = update.clientName.toLocaleLowerCase("pt-BR");
  const current = byName.get(key);
  byName.set(key, {
    clientName: update.clientName,
    address: update.address ?? current?.address ?? null,
    phone: update.phone ?? current?.phone ?? null,
  });
}

function rememberCourier(byName: Map<string, SpokenCourier>, name: string, phone: string | null) {
  const key = name.toLocaleLowerCase("pt-BR");
  const current = byName.get(key);
  byName.set(key, { name, phone: phone ?? current?.phone ?? null });
}

/** Cadastro falado de cliente ou entregador. Não cria coleta nem entrega. */
export function interpretDirectorySpeech(transcript: string): DirectorySpeech {
  const clients = new Map<string, ContactUpdate>();
  for (const update of interpretContactUpdates(transcript)) rememberClient(clients, update);
  const couriers = new Map<string, SpokenCourier>();

  for (const clause of transcript.split(/[\n/;]+/)) {
    const text = clause.trim();
    if (!text) continue;

    const courierPhone = text.match(
      /\b(?:telefone|fone|celular)\s+d[oe]\s+entregador\s+(.+?)\s+(?:é|eh|\be\b)\s+(.+)$/i,
    );
    if (courierPhone?.[1]) {
      const name = cleanName(courierPhone[1]);
      const number = courierPhone[2]?.replace(/[^\d\s/+()-]/g, " ").replace(/\s+/g, " ").trim() ?? "";
      if (name) rememberCourier(couriers, name, number.length >= 8 ? number.slice(0, 40) : null);
    }

    const courier = text.match(
      /\b(?:cadastr\w*|novo|adicion\w*)\s+(?:um\s+|o\s+)?entregador\s+(.+)$/i,
    );
    if (courier?.[1]) {
      const name = cleanName(courier[1]);
      const phone = detailsInClause(courier[1]).phone;
      if (name) rememberCourier(couriers, name, phone);
    }

    const client = text.match(/\b(?:cadastr\w*|novo)\s+(?:um\s+|o\s+)?cliente\s+(.+)$/i);
    if (client?.[1]) {
      const name = cleanName(client[1]);
      const details = detailsInClause(client[1]);
      if (name) {
        rememberClient(clients, {
          clientName: name,
          address: details.address,
          phone: details.phone,
        });
      }
    }
  }

  return { clients: [...clients.values()], couriers: [...couriers.values()] };
}
