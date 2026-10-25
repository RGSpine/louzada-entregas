import { CallLink } from "@/components/dashboard/logistics/CallLink";
import { Button } from "@/components/ui/button";
import type { LogisticsRecordRow } from "@/server/services/logistics";

type Option = { id: string; name: string };

const STATUS_LABEL = {
  PENDENTE: "Pendente",
  EM_ROTA: "Em rota",
  CONCLUIDO: "Realizada",
  CANCELADO: "Cancelada",
} as const;

function formatDay(iso: string | null) {
  if (!iso) return "Sem data";
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${day}/${month}/${year}`;
}

function formatClock(row: LogisticsRecordRow) {
  if (row.timeWindowStart && row.timeWindowEnd) return `${row.timeWindowStart}–${row.timeWindowEnd}`;
  if (row.timeWindowEnd) return `Até ${row.timeWindowEnd}`;
  if (row.timeWindowStart) return `A partir de ${row.timeWindowStart}`;
  return "Sem horário";
}

export function RecordsPanel({
  rows,
  clients,
  couriers,
  filters,
}: {
  rows: LogisticsRecordRow[];
  clients: Option[];
  couriers: Option[];
  filters: {
    query: string;
    date: string;
    type: string;
    client: string;
    courier: string;
  };
}) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold">Registros</h1>
        <p className="text-sm text-muted-foreground">
          Só entram coletas e entregas marcadas como realizadas. A busca combina o dia, o cliente, o entregador e o tipo.
        </p>
      </header>

      <form action="/dashboard/registros" className="depth-card grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="block text-sm md:col-span-2 xl:col-span-3">
          Busca
          <input
            name="q"
            defaultValue={filters.query}
            placeholder="Cliente, entregador ou serviço"
            className="depth-field mt-1 w-full px-2 py-1"
          />
        </label>
        <label className="block text-sm">
          Dia
          <input type="date" name="date" defaultValue={filters.date} className="depth-field mt-1 w-full px-2 py-1" />
        </label>
        <label className="block text-sm">
          Tipo
          <select name="type" defaultValue={filters.type} className="depth-field mt-1 w-full px-2 py-1">
            <option value="">Coleta e entrega</option>
            <option value="COLETA">Coleta</option>
            <option value="ENTREGA">Entrega</option>
          </select>
        </label>
        <label className="block text-sm">
          Cliente
          <select name="client" defaultValue={filters.client} className="depth-field mt-1 w-full px-2 py-1">
            <option value="">Todos os clientes</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Entregador
          <select name="courier" defaultValue={filters.courier} className="depth-field mt-1 w-full px-2 py-1">
            <option value="">Todos os entregadores</option>
            {couriers.map((courier) => (
              <option key={courier.id} value={courier.id}>
                {courier.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <Button type="submit">Buscar</Button>
          <Button type="button" variant="outline" asChild>
            <a href="/dashboard/registros">Limpar</a>
          </Button>
        </div>
      </form>

      <p className="text-sm text-muted-foreground">
        {rows.length === 0 ? "Nenhuma coleta ou entrega com esses filtros." : `${rows.length} registro(s).`}
      </p>

      {rows.length > 0 ? (
        <div className="depth-card overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Dia</th>
                <th className="px-3 py-2 font-medium">Horário</th>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Cliente</th>
                <th className="px-3 py-2 font-medium">Entregador</th>
                <th className="px-3 py-2 font-medium">Comando de</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Serviço</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border/70 align-top last:border-0">
                  <td className="px-3 py-2">{formatDay(row.targetDate)}</td>
                  <td className="px-3 py-2">{formatClock(row)}</td>
                  <td className="px-3 py-2">{row.type === "COLETA" ? "Coleta" : "Entrega"}</td>
                  <td className="px-3 py-2">
                    <p>{row.clientName || "Sem cliente"}</p>
                    {row.clientPhone ? (
                      <CallLink phone={row.clientPhone} who={row.clientName || "o cliente"} />
                    ) : (
                      <p className="text-muted-foreground">Sem telefone</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <p>{row.courierName ?? "Sem entregador"}</p>
                    {row.courierName && row.courierPhone ? (
                      <CallLink phone={row.courierPhone} who={row.courierName} />
                    ) : row.courierName ? (
                      <p className="text-muted-foreground">Sem telefone</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{row.createdByName ?? "—"}</td>
                  <td className="px-3 py-2">{STATUS_LABEL[row.status]}</td>
                  <td className="px-3 py-2">{row.workDescription ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
