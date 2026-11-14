import { Flash } from "@/components/ui";
import { enrollmentQr, enroll } from "@/server/auth-actions";

export const dynamic = "force-dynamic";

export default async function EnrollPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : "";
  const setup = await enrollmentQr();
  return (
    <main style={{ maxWidth: 640, margin: "4rem auto" }}>
      <h1>Set up the sign-in code</h1>
      <p className="lede">
        In an authenticator app, add an account. Scan the picture or type the secret, then enter the 6-digit code.
      </p>
      <Flash error={error} />
      {setup && (
        <form action={enroll} className="panel" style={{ padding: "1rem" }}>
          <img src={setup.qr} alt="Authenticator setup code" width={280} height={280} />
          <p>Secret: <strong>{setup.secret}</strong></p>
          <label className="field">
            6-digit code
            <input name="code" inputMode="numeric" autoComplete="one-time-code" required />
          </label>
          <button className="btn" type="submit">Turn on the code and sign in</button>
        </form>
      )}
    </main>
  );
}
