import { redirect } from "next/navigation";
import { currentMonthKey } from "@/lib/dashboard-data";

export default function WrappedIndexPage() {
  redirect(`/wrapped/${currentMonthKey()}`);
}
