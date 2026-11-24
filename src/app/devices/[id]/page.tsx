import { DevicePage } from "@/components/pages/MachinePages";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DevicePage id={decodeURIComponent(id)} />;
}
