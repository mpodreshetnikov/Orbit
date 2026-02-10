import { redirect } from "next/navigation";

export default function MoneyHome() {
  redirect("/money/transactions");
}
