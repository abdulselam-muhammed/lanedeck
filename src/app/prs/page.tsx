import { redirect } from "next/navigation";
import { project } from "../../../server/config.mjs";

// Old route: the first project's page.
export const dynamic = "force-dynamic";
export default function Page() {
  redirect(`/p/${project().id}/prs`);
}
