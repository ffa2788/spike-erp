import { Fragment } from "react";
import type { PnlLine } from "@/lib/owner-reports";
import { presentProfit, statementColumns, statementMoney, statementTitle } from "@/lib/pnl-present";

export function ProfitStatement({ rows, from, to, priorFrom }: { rows: PnlLine[]; from: string; to: string; priorFrom: string }) {
  const lines = presentProfit(rows);
  const columns = statementColumns(from, priorFrom);
  return (
    <article className="pnl">
      <header>
        <div className="company">SPER Chemical Corporation</div>
        <div className="doc">Profit and Loss</div>
        <div className="period">{statementTitle(from, to)}</div>
        <div className="example">Example data</div>
      </header>
      <table>
        <thead>
          <tr>
            <th></th>
            <th>{columns.month}</th>
            <th>{columns.prior}</th>
            <th>{columns.ytd}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((row) => {
            if (row.role === "header") return <tr key={row.key} className="header"><td colSpan={4}>{row.label}</td></tr>;
            if (row.role === "note") return <tr key={row.key} className="note"><td colSpan={4}>{row.label}</td></tr>;
            const className = [row.role, row.rule === "above" ? "rule" : "", row.rule === "double" ? "double" : ""].filter(Boolean).join(" ");
            return (
              <Fragment key={row.key}>
                <tr className={className}>
                  <td>{row.label}</td>
                  <td className={row.net && row.month < 0 ? "neg" : ""}>{statementMoney(row.month, Boolean(row.dollar))}</td>
                  <td className={row.net && row.prior < 0 ? "neg" : ""}>{statementMoney(row.prior, Boolean(row.dollar))}</td>
                  <td className={row.net && row.ytd < 0 ? "neg" : ""}>{statementMoney(row.ytd, Boolean(row.dollar))}</td>
                </tr>
                {row.rule === "double" ? <tr className="close"><td colSpan={4}></td></tr> : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </article>
  );
}
