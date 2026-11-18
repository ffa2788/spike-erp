export function helpNotice(input: {
  fromName: string;
  screen: string;
  recordRef: string;
  message: string;
  ownerEmail: string | null;
}): { to: string[]; subject: string; text: string } | { skip: string } {
  if (!input.ownerEmail?.includes("@")) return { skip: "No owner email is on file." };
  const lines = [
    `${input.fromName} is stuck.`,
    `Screen: ${input.screen || "unknown"}`,
    input.recordRef ? `Record: ${input.recordRef}` : "",
    "",
    input.message.trim(),
  ];
  return {
    to: [input.ownerEmail],
    subject: `Help request from ${input.fromName}`,
    text: lines.filter((line) => line !== "").join("\n"),
  };
}

export function applyHelpAnswer(status: string, answer: string): { ok: true } | { ok: false; error: string } {
  if (!answer.trim()) return { ok: false, error: "Write an answer." };
  if (status === "closed") return { ok: false, error: "This request is closed." };
  if (status !== "open" && status !== "answered") return { ok: false, error: "This request cannot be answered." };
  return { ok: true };
}

export function helpBack(path: string): string {
  const safe = path.startsWith("/") && !path.startsWith("//") ? path : "/";
  const [base, query = ""] = safe.split("?");
  const params = new URLSearchParams(query);
  params.delete("error");
  params.delete("notice");
  params.set("help", "1");
  const next = params.toString();
  return `${base || "/"}${next ? `?${next}` : ""}`;
}
