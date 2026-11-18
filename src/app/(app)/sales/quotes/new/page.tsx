import { redirect } from "next/navigation";

export default function Page() {
  redirect("/sales?tab=quotes&new=1");
}
