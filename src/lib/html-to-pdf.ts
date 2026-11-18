import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function chromePath(): string {
  return process.env.CHROME_PATH?.trim() || "/usr/bin/google-chrome";
}

export async function htmlToPdf(html: string, options?: { footerDate?: string }): Promise<Uint8Array> {
  if (options?.footerDate) return pdfWithFooter(html, options.footerDate);
  const dir = await mkdtemp(join(tmpdir(), "spike-plan-"));
  const htmlPath = join(dir, "plan.html");
  const pdfPath = join(dir, "plan.pdf");
  await writeFile(htmlPath, html);
  await new Promise<void>((resolve, reject) => {
    execFile(
      chromePath(),
      ["--headless", "--disable-gpu", "--no-sandbox", "--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`, htmlPath],
      { timeout: 30000 },
      (error) => (error ? reject(error) : resolve()),
    );
  });
  return new Uint8Array(await readFile(pdfPath));
}

async function pdfWithFooter(html: string, footerDate: string): Promise<Uint8Array> {
  const puppeteer = await import("puppeteer-core");
  const browser = await puppeteer.default.launch({
    executablePath: chromePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "letter",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="width:100%;font-size:8px;color:#667085;font-family:Helvetica,Arial,sans-serif;padding:0 0.7in;display:flex;justify-content:space-between;"><span>Generated ${footerDate}</span><span>Page <span class="pageNumber"></span></span></div>`,
      margin: { top: "0.55in", bottom: "0.7in", left: "0.7in", right: "0.7in" },
    });
    return new Uint8Array(pdf);
  } finally {
    await browser.close();
  }
}
