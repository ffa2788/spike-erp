import Link from "next/link";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { ROLE_LABEL } from "@/lib/permissions";
import { requireCan } from "@/server/actor";
import { resetUserPassword } from "@/server/account-actions";
import { userAction } from "@/server/work-actions";

export const dynamic = "force-dynamic";

export async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireCan("manageUsers");
  const query = await readQuery(searchParams);
  const users = await prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  return (
    <>
      <h1>People and roles</h1>
      <p className="lede">Only FFA and Chris sign in. Both see the whole operation. Trevor does not have a login. He receives the weekly work list by email.</p>
      <Flash error={query.error} notice={query.notice} />
      <div className="wrap"><table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Sign-in code</th><th>Temporary password</th></tr></thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.name}</td>
              <td>{user.email}</td>
              <td>{ROLE_LABEL[user.role]}</td>
              <td>{user.totpEnabled ? "On" : "Not set up"}</td>
              <td>
                {user.id === actor.id ? <Link href="/account">My account</Link> : (
                  <form action={resetUserPassword} className="row">
                    <input type="hidden" name="userId" value={user.id} />
                    <input name="password" type="password" required minLength={8} autoComplete="new-password" aria-label={`Temporary password for ${user.name}`} />
                    <button className="btn secondary" type="submit">Set</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <p className="muted">A temporary password is at least 8 characters. They choose a new one at the next sign-in.</p>
      <h2>Add a person</h2>
      <form action={userAction}>
        <label className="field">Name<input name="name" required /></label>
        <label className="field">Email<input name="email" type="email" required /></label>
        <label className="field">Role
          <select name="role" defaultValue="PARTNER">
            <option value="OWNER">Owner</option>
            <option value="PARTNER">Office</option>
          </select>
        </label>
        <label className="field">Temporary password <span>At least 8 characters.</span><input name="password" type="password" required minLength={8} autoComplete="new-password" /></label>
        <button className="btn" type="submit">Add</button>
      </form>
    </>
  );
}
