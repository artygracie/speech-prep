import { RolePage } from "@/components/role-page";
import { roleBySlug } from "@/lib/roles";

const role = roleBySlug("father-of-the-bride-speech")!;

export const metadata = {
  title: role.title,
  description: role.metaDescription,
  alternates: { canonical: `/${role.slug}` },
};

export default function Page() {
  return <RolePage role={role} />;
}
