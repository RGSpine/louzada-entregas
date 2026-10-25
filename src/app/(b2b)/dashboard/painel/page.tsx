import { DateTime } from "luxon";

import { DayPanel } from "@/components/dashboard/logistics/DayPanel";
import { listDayTasks, listMotoboys } from "@/server/services/logistics";

export default async function PainelPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  const today = DateTime.now().setZone("America/Sao_Paulo").toFormat("yyyy-LL-dd");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "") ? params.date! : today;
  const [tasks, motoboys] = await Promise.all([listDayTasks(date), listMotoboys()]);
  return <DayPanel date={date} tasks={tasks} motoboys={motoboys} />;
}
