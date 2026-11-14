import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { ROLE_LABEL } from "@/lib/permissions";
import { requireCan } from "@/server/actor";
import { userAction } from "@/server/work-actions";

export const dynamic = "force-dynamic";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCan("manageUsers");
  const query = await readQuery(searchParams);
  const users = await prisma.user.findMany({ orderBy: { name: "asc" } });
  return (
    <>
      <h1>People and roles</h1>
      <p className="lede">The owner manages people. A partner can run the books. Warehouse can ship, receive, and make batches. Read only can look.</p>
      <Flash error={query.error} notice={query.notice} />
      <div className="wrap"><table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Sign-in code</th></tr></thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}><td>{user.name}</td><td>{user.email}</td><td>{ROLE_LABEL[user.role]}</td><td>{user.totpEnabled ? "On" : "Not set up"}</td></tr>
          ))}
        </tbody>
      </table></div>
      <h2>Add a person</h2>
      <form action={userAction}>
        <label className="field">Name<input name="name" required /></label>
        <label className="field">Email<input name="email" type="email" required /></label>
        <label className="field">Role
          <select name="role" defaultValue="PARTNER">
            <option value="OWNER">Owner</option>
            <option value="PARTNER">Partner / accounting</option>
            <option value="WAREHOUSE">Warehouse</option>
            <option value="READONLY">Read only</option>
          </select>
        </label>
        <label className="field">Temporary password<input name="password" type="password" required /></label>
        <button className="btn" type="submit">Add</button>
      </form>
    </>
  );
}
