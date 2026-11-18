import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ maxWidth: 640, margin: "4rem auto" }}>
      <h1>That page is not here</h1>
      <p><Link href="/">Back to today</Link></p>
    </main>
  );
}
