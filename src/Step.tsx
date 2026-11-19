// A numbered heading that makes each part of the form easy to notice
export default function StepHead({
  n,
  title,
  hint,
  required,
}: {
  n: number
  title: string
  hint?: string
  required?: boolean
}) {
  return (
    <div className="step-head">
      <span className="step-num">{n}</span>
      <div className="step-text">
        <strong>{title}</strong>
        {hint && <span className="step-hint">{hint}</span>}
      </div>
      {required && <span className="req">Required</span>}
    </div>
  )
}
