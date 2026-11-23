"use client";

import { useActionState, useState } from "react";
import { IMPORT_ORDER, KIND_LABEL } from "@/lib/import-bundle";
import { commitBundleAction, peachtreeAction, previewBundleAction, type BundleState, type PeachtreeState } from "@/server/import-action";

const initial: PeachtreeState = { rows: [], ready: 0, skipped: 0, kind: "" };

export function ImportPage() {
  const [state, action, pending] = useActionState(peachtreeAction, initial);
  const [bundle, setBundle] = useState<BundleState | null>(null);
  const [busy, setBusy] = useState(false);

  async function take(list: FileList | null) {
    if (!list?.length) return;
    const data = new FormData();
    for (const file of list) data.append("files", file);
    setBusy(true);
    setBundle(await previewBundleAction(data));
    setBusy(false);
  }

  async function changeKind(index: number, kind: string) {
    if (!bundle) return;
    const data = new FormData();
    bundle.files.forEach((file, fileIndex) => {
      data.append("name", file.name);
      data.append("csv", file.csv);
      data.append("kind", fileIndex === index ? kind : file.kind);
    });
    setBusy(true);
    setBundle(await previewBundleAction(data));
    setBusy(false);
  }

  return (
    <>
      <h1>Bring in data</h1>
      <p className="lede">
        Drop every Peachtree file at once. SPIKE reads CSV and Excel, detects each file, and posts them in cutover order. Bad rows are named and skipped. Importing the same files again does not create duplicates.
      </p>
      <div
        className="dropzone"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void take(event.dataTransfer.files);
        }}
      >
        <p>Drop files here, or choose them.</p>
        <input type="file" multiple accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void take(event.target.files)} />
      </div>
      {busy && <p className="muted">Reading the files…</p>}
      {bundle?.error && <div className="banner bad">Problem: {bundle.error}</div>}
      {bundle?.notice && <div className="banner good">Done: {bundle.notice}</div>}
      {bundle && bundle.files.length > 0 && (
        <>
          <div className="wrap"><table>
            <thead><tr><th>Order</th><th>File</th><th>Kind</th><th className="num">Ready</th></tr></thead>
            <tbody>
              {bundle.files.map((file, index) => (
                <tr key={`${file.name}-${index}`}>
                  <td>{index + 1}</td>
                  <td>{file.name}</td>
                  <td>
                    <select value={file.kind} onChange={(event) => void changeKind(index, event.target.value)}>
                      <option value="">Choose</option>
                      {IMPORT_ORDER.map((kind) => <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>)}
                    </select>
                  </td>
                  <td className="num">{file.ready}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <p>{bundle.okRows} rows are ready. {bundle.roles.length} roles added. {bundle.errors.length} rows have errors.</p>
          {bundle.roles.length > 0 && (
            <div className="wrap"><table>
              <thead><tr><th>File</th><th>Row</th><th>Company</th><th>Notes</th></tr></thead>
              <tbody>
                {bundle.roles.map((row) => (
                  <tr key={`role-${row.file}-${row.rowNumber}`}>
                    <td>{row.file}</td>
                    <td>{row.rowNumber}</td>
                    <td>{row.summary}</td>
                    <td>Role added</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
          {bundle.errors.length > 0 && (
            <div className="wrap"><table>
              <thead><tr><th>File</th><th>Row</th><th>What SPIKE read</th><th>Notes</th></tr></thead>
              <tbody>
                {bundle.errors.map((row) => (
                  <tr key={`${row.file}-${row.rowNumber}-${row.summary}`}>
                    <td>{row.file}</td>
                    <td>{row.rowNumber}</td>
                    <td>{row.summary}</td>
                    <td>{row.messages.join(" ")}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
          <h2>Tie-out</h2>
          <ul>
            {bundle.checks.map((check) => (
              <li key={check.name}>{check.ok ? "OK" : "Check"} · {check.name}: {check.detail}</li>
            ))}
          </ul>
          <form action={async (formData) => setBundle(await commitBundleAction(formData))}>
            {bundle.files.map((file, index) => (
              <span key={`${file.name}-${index}`}>
                <input type="hidden" name="name" value={file.name} />
                <input type="hidden" name="kind" value={file.kind} />
                <input type="hidden" name="csv" value={file.csv} />
              </span>
            ))}
            {bundle.files.some((file) => file.kind === "stock" || file.kind === "trial") && (
              <label className="field">As-of date for the opening trial balance and stock count
                <input type="date" name="asOf" required key={bundle.asOf || "choose"} defaultValue={bundle.asOf} />
              </label>
            )}
            <button className="btn" type="submit" disabled={busy || bundle.files.every((file) => !file.kind)}>Confirm and import</button>
          </form>
        </>
      )}
      <h2>One file</h2>
      <p>Amazon and Walmart orders, or a single file if you would rather paste it.</p>
      {state.error && <div className="banner bad">Problem: {state.error}</div>}
      {state.notice && <div className="banner good">Done: {state.notice}</div>}
      <form action={action}>
        <label className="field">What is this file?
          <select name="kind" defaultValue={state.kind || ""}>
            <option value="">Let SPIKE decide</option>
            <option value="customers">Customers</option>
            <option value="vendors">Suppliers</option>
            <option value="items">Items</option>
            <option value="accounts">Accounts</option>
            <option value="journal">Journal</option>
            <option value="stock">Opening stock count</option>
            <option value="ar">Open customer invoices</option>
            <option value="ap">Open vendor bills</option>
            <option value="trial">Opening trial balance</option>
            <option value="formula">Formulas</option>
            <option value="bom">Packaging lists</option>
            <option value="amazon">Amazon orders</option>
            <option value="walmart">Walmart orders</option>
          </select>
        </label>
        <label className="field">File<input type="file" name="file" accept=".csv,text/csv" /></label>
        <label className="field">Or paste<textarea name="csv" defaultValue={state.csv ?? ""} /></label>
        <label className="field">As-of date (opening trial balance and stock count)
          <input type="date" name="asOf" key={state.asOf || "one-asof"} defaultValue={state.asOf ?? ""} />
        </label>
        <button className="btn" type="submit" disabled={pending}>Preview</button>
        {state.rows.length > 0 && state.kind !== "amazon" && state.kind !== "walmart" && (
          <button className="btn secondary" type="submit" name="commit" value="yes">Import {state.ready} good rows</button>
        )}
        {(state.kind === "amazon" || state.kind === "walmart") && state.ready > 0 && (
          <button className="btn secondary" type="submit" name="commit" value="yes">Import {state.ready} {state.kind === "walmart" ? "Walmart" : "Amazon"} orders</button>
        )}
      </form>
      {state.rows.length > 0 && (
        <div className="wrap">
          <table>
            <thead><tr><th>Row</th><th>Status</th><th>What SPIKE read</th><th>Notes</th></tr></thead>
            <tbody>
              {state.rows.map((row) => (
                <tr key={row.rowNumber}>
                  <td>{row.rowNumber}</td>
                  <td>{row.status}</td>
                  <td>{row.summary}</td>
                  <td>{row.messages.join(" ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h2>Example files</h2>
      <ul>
        <li><a href="/examples/peachtree-customers.csv">Customers</a></li>
        <li><a href="/examples/peachtree-items.csv">Items</a></li>
        <li><a href="/examples/peachtree-journal.csv">Journal</a></li>
        <li><a href="/examples/peachtree-stock.csv">Opening stock</a></li>
        <li><a href="/examples/peachtree-ar.csv">Open invoices</a></li>
        <li><a href="/examples/peachtree-ap.csv">Open bills</a></li>
        <li><a href="/examples/peachtree-trial.csv">Opening trial balance</a></li>
        <li><a href="/examples/peachtree-formula.csv">Formulas</a></li>
        <li><a href="/examples/peachtree-bom.csv">Packaging lists</a></li>
        <li><a href="/examples/amazon-orders.csv">Amazon orders</a></li>
        <li><a href="/examples/bank-statement.csv">Bank statement</a></li>
      </ul>
    </>
  );
}
