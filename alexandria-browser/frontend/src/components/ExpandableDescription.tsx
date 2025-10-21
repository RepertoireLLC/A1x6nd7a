import { useEffect, useMemo, useState } from "react";

import { buildDescriptionPreview } from "../utils/format";

interface ExpandableDescriptionProps {
  text: string;
  previewCharLimit?: number;
  className?: string;
  paragraphClassName?: string;
  expandLabel?: string;
  collapseLabel?: string;
}

export function ExpandableDescription({
  text,
  previewCharLimit = 200,
  className,
  paragraphClassName,
  expandLabel = "Show full description",
  collapseLabel = "Show less"
}: ExpandableDescriptionProps) {
  const normalizedText = useMemo(() => text.trim().replace(/\s+/g, " "), [text]);
  const [expanded, setExpanded] = useState(false);

  const { preview, truncated } = useMemo(
    () => buildDescriptionPreview(normalizedText, previewCharLimit),
    [normalizedText, previewCharLimit]
  );

  useEffect(() => {
    setExpanded(false);
  }, [normalizedText]);

  if (!normalizedText) {
    return null;
  }

  if (!truncated) {
    return <p className={paragraphClassName}>{normalizedText}</p>;
  }

  const containerClasses = ["expandable-description", className].filter(Boolean).join(" ");

  return (
    <div className={containerClasses}>
      <p className={paragraphClassName}>{expanded ? normalizedText : preview}</p>
      <button
        type="button"
        className="description-toggle"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
      >
        {expanded ? collapseLabel : expandLabel}
      </button>
    </div>
  );
}
