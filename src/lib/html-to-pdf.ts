import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function htmlToPdf(html: string): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), "spike-plan-"));
  const htmlPath = join(dir, "plan.html");
  const pdfPath = join(dir, "plan.pdf");
  await writeFile(htmlPath, html);
  await new Promise<void>((resolve, reject) => {
    execFile(
      "google-chrome",
      ["--headless", "--disable-gpu", "--no-sandbox", "--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`, htmlPath],
      { timeout: 30000 },
      (error) => (error ? reject(error) : resolve()),
    );
  });
  return new Uint8Array(await readFile(pdfPath));
}
