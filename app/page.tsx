import { getUser } from "@netlify/identity";
import { redirect } from "next/navigation";
import ICFApp from "./ICFApp";

export const dynamic = "force-dynamic";

export default async function Home() {
  const isDevelopment =
    process.env.NODE_ENV === "development";

  if (!isDevelopment) {
    const user = await getUser();

    if (!user) {
      redirect("/login");
    }
  }

  return <ICFApp />;
}