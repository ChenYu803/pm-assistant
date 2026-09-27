import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { findMysqlUserById } from "@/lib/mysql-account-workspace";
import ProfilePage from "@/components/ProfilePage";

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=%2Fprofile");
  const user = await findMysqlUserById(session.user.id);
  if (!user) redirect("/login?callbackUrl=%2Fprofile");
  return <ProfilePage email={user.email} initialNickname={user.nickname ?? ""} />;
}
