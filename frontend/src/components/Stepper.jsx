const STEPS = [['draft', 'Draft'], ['quotation', 'Quotation'], ['confirmed', 'Confirmed'], ['active', 'Active'], ['closed', 'Closed']];

// Shows where a subscription stands: Draft -> Quotation -> Confirmed -> Active -> Closed.
export default function Stepper({ status }) {
  const idx = STEPS.findIndex(([s]) => s === status);
  return (
    <div className="stepper" aria-label={`Status: ${status}`}>
      {STEPS.map(([s, label], i) => (
        <div key={s} className={`step ${i < idx ? 'done' : ''} ${i === idx ? 'current' : ''}`}>{label}</div>
      ))}
    </div>
  );
}
