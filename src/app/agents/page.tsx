import { Suspense } from "react";
import AgentsPage from "@/components/pages/AgentsPage";

export default function Page() {
  return (
    <Suspense>
      <AgentsPage />
    </Suspense>
  );
}
