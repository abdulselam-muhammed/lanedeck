import { redirect } from "next/navigation";
import { project } from "../../../../server/config.mjs";

// Old route: the first project's page.
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  redirect(`/p/${project().id}/flow/${file}`);
}
