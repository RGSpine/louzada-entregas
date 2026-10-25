import { RecordsPanel } from "@/components/dashboard/logistics/RecordsPanel";
import { listDentists, listLogisticsRecords, listMotoboys } from "@/server/services/logistics";

function clean(value: string | undefined) {
  const text = value?.trim() ?? "";
  return text;
}

export default async function RegistrosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; date?: string; type?: string; client?: string; courier?: string }>;
}) {
  const params = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "") ? params.date! : "";
  const type = params.type === "COLETA" || params.type === "ENTREGA" ? params.type : "";
  const client = clean(params.client);
  const courier = clean(params.courier);
  const query = clean(params.q).slice(0, 80);

  const [rows, dentists, motoboys] = await Promise.all([
    listLogisticsRecords({
      query,
      date: date || null,
      type: type || null,
      dentistClientId: client || null,
      motoboyIntraUserId: courier || null,
    }),
    listDentists(),
    listMotoboys(),
  ]);

  return (
    <RecordsPanel
      rows={rows}
      clients={dentists.map((dentist) => ({ id: dentist.id, name: dentist.name }))}
      couriers={motoboys.map((motoboy) => ({ id: motoboy.id, name: motoboy.name }))}
      filters={{ query, date, type, client, courier }}
    />
  );
}
