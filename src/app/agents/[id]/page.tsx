import { Suspense } from "react";
import AgentDetailPage from "@/components/pages/AgentDetailPage";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <AgentDetailPage id={decodeURIComponent(id)} />
    </Suspense>
  );
}
