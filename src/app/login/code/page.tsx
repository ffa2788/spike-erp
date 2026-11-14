import { Flash } from "@/components/ui";
import { verifyCode } from "@/server/auth-actions";

export const dynamic = "force-dynamic";

export default async function CodePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : "";
  return (
    <main style={{ maxWidth: 560, margin: "4rem auto" }}>
      <h1>Enter your code</h1>
      <p className="lede">Open the authenticator app and type the 6-digit code for SPIKE.</p>
      <Flash error={error} />
      <form action={verifyCode} className="panel" style={{ padding: "1rem" }}>
        <label className="field">
          6-digit code
          <input name="code" inputMode="numeric" autoComplete="one-time-code" required />
        </label>
        <button className="btn" type="submit">Continue</button>
      </form>
    </main>
  );
}
