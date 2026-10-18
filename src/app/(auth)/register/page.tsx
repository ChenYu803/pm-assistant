import RegistrationForm from "@/components/RegisterForm";
import { registrationMode } from "@/lib/launch-policy";

export const dynamic = "force-dynamic";

export default function RegisterPage() {
  return <RegistrationForm inviteRequired={registrationMode() === "invite"} />;
}
