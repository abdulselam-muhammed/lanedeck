import { Suspense } from "react";
import AllInboxPage from "@/components/pages/AllInboxPage";

export const dynamic = "force-dynamic";
export default function Page() {
  return (
    <Suspense>
      <AllInboxPage />
    </Suspense>
  );
}
