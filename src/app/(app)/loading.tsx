export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="skeleton title" />
      <div className="kpis">
        <div className="skeleton card" />
        <div className="skeleton card" />
        <div className="skeleton card" />
        <div className="skeleton card" />
      </div>
      <div className="skeleton block" />
    </div>
  );
}
