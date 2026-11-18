"use client";

import { useActionState } from "react";
import { peachtreeAction, type PeachtreeState } from "@/server/import-action";

const initial: PeachtreeState = { rows: [], ready: 0, skipped: 0, kind: "" };

export function ImportPage() {
  const [state, action, pending] = useActionState(peachtreeAction, initial);
  return (
    <>
      <h1>Bring in data</h1>
      <p className="lede">
        Peachtree 2011 files can be customers, suppliers, items, accounts, or a journal. SPIKE shows a preview and skips bad rows. Nothing is saved until you confirm.
      </p>
      <p>Amazon and Walmart orders can be imported from a CSV when those connections are not set up. Fees are recorded as an expense, not as sales. Connected accounts are under Sales.</p>
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
