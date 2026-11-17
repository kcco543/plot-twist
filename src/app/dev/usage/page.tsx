import { notFound } from "next/navigation";
import { dashboardEnabled } from "@/lib/ai/server/usage";
import { UsageDashboard } from "./UsageDashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "API Usage · PLOT TWIST!" };

/** Development-only API usage dashboard (404 in production unless AI_USAGE_DASHBOARD=1). */
export default function UsagePage() {
  if (!dashboardEnabled()) notFound();
  return <UsageDashboard />;
}
