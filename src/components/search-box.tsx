"use client";

import { useEffect, useRef } from "react";

export function SearchBox() {
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        field.current?.focus();
        field.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <form className="search-box" action="/search">
      <label className="field">
        <span className="sr">Find an invoice, order, or marketplace number</span>
        <input ref={field} name="q" placeholder="Search invoices, orders, S-, A-, W-, or E-" />
      </label>
      <kbd>⌘K</kbd>
      <button className="btn secondary" type="submit">Search</button>
    </form>
  );
}
