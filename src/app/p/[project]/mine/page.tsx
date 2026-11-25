import MinePage from "@/components/pages/MinePage";
import { ts } from "../../../../../server/i18n/server.mjs";

export const dynamic = "force-dynamic";
export function generateMetadata() {
  return { title: ts("mine.title") };
}

export default function Page() {
  return <MinePage />;
}
