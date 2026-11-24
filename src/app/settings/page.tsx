import { Suspense } from "react";
import SettingsPage from "@/components/pages/SettingsPage";

export const metadata = { title: "Settings" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SettingsPage />
    </Suspense>
  );
}
