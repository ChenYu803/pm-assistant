import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { findMysqlUserById } from "@/lib/mysql-account-workspace";
import { isDesignatedAdmin } from "@/lib/account-controls";
import ProfilePage from "@/components/ProfilePage";
import { readCreditStatement } from "@/lib/credits-ledger";

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=%2Fprofile");
  const user = await findMysqlUserById(session.user.id);
  if (!user) redirect("/login?callbackUrl=%2Fprofile");
  if (user.account_status !== "active") redirect("/login");
  const credits = await readCreditStatement(user.id);
  return <ProfilePage credits={credits} email={user.email} initialNickname={user.nickname ?? ""} isAdmin={user.account_status === "active" && isDesignatedAdmin(user.email)} />;
}
