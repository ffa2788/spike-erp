"use client";

import { useActionState } from "react";
import { peachtreeAction, type PeachtreeState } from "@/server/import-action";

const initial: PeachtreeState = { rows: [], ready: 0, skipped: 0, kind: "" };

export default function ImportPage() {
  const [state, action, pending] = useActionState(peachtreeAction, initial);
  return (
    <>
      <h1>Bring in data</h1>
      <p className="lede">
        Peachtree 2011 files can be customers, suppliers, items, accounts, or a journal. SPIKE shows a preview and skips bad rows. Nothing is saved until you confirm.
      </p>
      <p>Amazon orders are a file import only. SPIKE does not connect to Amazon. Fees are recorded as an expense, not as sales.</p>
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
            <option value="amazon">Amazon orders</option>
          </select>
        </label>
        <label className="field">File<input type="file" name="file" accept=".csv,text/csv" /></label>
        <label className="field">Or paste<textarea name="csv" defaultValue={state.csv ?? ""} /></label>
        <button className="btn" type="submit" disabled={pending}>Preview</button>
        {state.rows.length > 0 && state.kind !== "amazon" && (
          <button className="btn secondary" type="submit" name="commit" value="yes">Import {state.ready} good rows</button>
        )}
        {state.kind === "amazon" && state.ready > 0 && (
          <button className="btn secondary" type="submit" name="commit" value="yes">Import {state.ready} Amazon orders</button>
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
        <li><a href="/examples/amazon-orders.csv">Amazon orders</a></li>
        <li><a href="/examples/bank-statement.csv">Bank statement</a></li>
      </ul>
    </>
  );
}
