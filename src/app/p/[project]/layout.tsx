import { notFound } from "next/navigation";
import { projectById } from "../../../../server/config.mjs";

// Read at request time: the project list comes from the config file.
export const dynamic = "force-dynamic";
export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ project: string }> }) {
  const { project } = await params;
  if (!projectById(project)) notFound();
  return children;
}
