// Renders every Supabase email template to static HTML, written to
// `web/dist/emails/`. Paste the file contents into Supabase Auth → Email
// Templates after running.
//
// Usage:  pnpm run emails:render

import { render } from "@react-email/render";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import ChangeEmail from "./ChangeEmail";
import ConfirmSignup from "./ConfirmSignup";
import InviteUser from "./InviteUser";
import MagicLink from "./MagicLink";
import ResetPassword from "./ResetPassword";

const templates = [
  { name: "confirm-signup", Component: ConfirmSignup },
  { name: "magic-link", Component: MagicLink },
  { name: "invite-user", Component: InviteUser },
  { name: "change-email", Component: ChangeEmail },
  { name: "reset-password", Component: ResetPassword },
];

const outDir = path.resolve(process.cwd(), "dist/emails");

async function main() {
  await mkdir(outDir, { recursive: true });

  for (const { name, Component } of templates) {
    const html = await render(<Component />, { pretty: true });
    const file = path.join(outDir, `${name}.html`);
    await writeFile(file, html, "utf8");
    console.log(`✓ ${path.relative(process.cwd(), file)}`);
  }

  console.log(`\nDone. ${templates.length} templates rendered to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
