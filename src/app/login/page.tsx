import { Flash } from "@/components/ui";
import { login } from "@/server/auth-actions";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : "";
  const notice = typeof params.notice === "string" ? params.notice : "";
  return (
    <main style={{ maxWidth: 560, margin: "4rem auto" }}>
      <h1>SPIKE</h1>
      <p className="lede">Sales, planning, inventory, and books for SPER Chemical in Clearwater.</p>
      <Flash error={error} notice={notice} />
      <form action={login} className="panel" style={{ padding: "1rem" }}>
        <label className="field">
          Email
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label className="field">
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button className="btn" type="submit">Sign in</button>
      </form>
    </main>
  );
}
