import PrsPage from "@/components/pages/PrsPage";
import { ts } from "../../../../../server/i18n/server.mjs";

export const dynamic = "force-dynamic";
export function generateMetadata() {
  return { title: ts("prs.title") };
}

export default function Page() {
  return <PrsPage />;
}
