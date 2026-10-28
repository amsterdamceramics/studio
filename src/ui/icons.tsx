/** Small line icons drawn at 16 px on a 16 grid, in the weight of the text beside them. */
const Icon = ({ d, label }: { d: string; label?: string }) => (
  <svg className="icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden={label ? undefined : true} aria-label={label}>
    <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const Plus = () => <Icon d="M8 3.5v9M3.5 8h9" />
export const Minus = () => <Icon d="M3.5 8h9" />
export const ResetIcon = () => <Icon d="M3.5 7.5a4.5 4.5 0 1 1 1.3 3.2M3.5 3.5v4h4" />
export const Chevron = () => <Icon d="M4 6l4 4 4-4" />

/** Arrange icons: a bar for the edge, a block for the text, as in Keynote's Arrange panel. */
export const AlignLeft = () => <Icon d="M2.5 2.5v11M5.5 5.5h7M5.5 10.5h4" />
export const AlignCentre = () => <Icon d="M8 2.5v11M4 5.5h8M5.5 10.5h5" />
export const AlignRight = () => <Icon d="M13.5 2.5v11M3.5 5.5h7M6.5 10.5h4" />
export const AlignTop = () => <Icon d="M2.5 2.5h11M5.5 5.5v7M10.5 5.5v4" />
export const AlignMiddle = () => <Icon d="M2.5 8h11M5.5 4v8M10.5 5.5v5" />
export const AlignBottom = () => <Icon d="M2.5 13.5h11M5.5 3.5v7M10.5 6.5v4" />
