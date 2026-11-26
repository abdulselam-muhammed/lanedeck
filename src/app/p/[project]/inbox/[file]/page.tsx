import { Suspense } from "react";
import InboxPage from "@/components/pages/InboxPage";

export default function Page() {
  return (
    <Suspense>
      <InboxPage />
    </Suspense>
  );
}
