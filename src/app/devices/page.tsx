import { DevicesPage } from "@/components/pages/MachinePages";
import { ts } from "../../../server/i18n/server.mjs";

export const dynamic = "force-dynamic";
export const generateMetadata = () => ({ title: ts("pages.devices.title") });
export default function Page() {
  return <DevicesPage />;
}
