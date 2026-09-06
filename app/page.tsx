import { getUser } from "@netlify/identity";
import { redirect } from "next/navigation";
import ICFApp from "./ICFApp";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getUser();

  if (!user) {
    redirect("/login");
  }

  return <ICFApp />;
}