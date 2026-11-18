import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { requireActor } from "@/server/actor";
import { changePassword } from "@/server/account-actions";

export const dynamic = "force-dynamic";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActor();
  const query = await readQuery(searchParams);
  const user = await prisma.user.findUnique({ where: { id: actor.id } });
  return (
    <>
      <h1>My account</h1>
      <p className="lede">
        {user?.email}. {user?.mustChangePassword ? "Choose a new password before you continue." : "Change the password for this sign-in."}
      </p>
      <Flash error={query.error} notice={query.notice} />
      <form action={changePassword}>
        <label className="field">Current password<input name="current" type="password" autoComplete="current-password" required /></label>
        <label className="field">New password <span>At least 8 characters.</span><input name="next" type="password" autoComplete="new-password" required minLength={8} /></label>
        <label className="field">Confirm new password<input name="confirm" type="password" autoComplete="new-password" required minLength={8} /></label>
        <button className="btn" type="submit">Change password</button>
      </form>
    </>
  );
}
