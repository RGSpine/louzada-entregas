import { DentistDirectory } from "@/components/dashboard/logistics/DentistDirectory";
import { listDentists, listMotoboys } from "@/server/services/logistics";

export default async function DentistasPage() {
  const [dentists, motoboys] = await Promise.all([listDentists(), listMotoboys()]);
  return (
    <DentistDirectory
      motoboys={motoboys}
      dentists={dentists.map((dentist) => ({
        id: dentist.id,
        name: dentist.name,
        clinicName: dentist.clinicName,
        address: dentist.address,
        phone: dentist.phone,
        routeNote: dentist.routeNote,
        aliases: dentist.aliases,
      }))}
    />
  );
}
