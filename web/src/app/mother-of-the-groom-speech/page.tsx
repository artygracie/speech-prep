import { RolePage } from "@/components/role-page";
import { roleBySlug } from "@/lib/roles";

const role = roleBySlug("mother-of-the-groom-speech")!;

export const metadata = {
  title: role.title,
  description: role.metaDescription,
  alternates: { canonical: `/${role.slug}` },
};

export default function Page() {
  return <RolePage role={role} />;
}
