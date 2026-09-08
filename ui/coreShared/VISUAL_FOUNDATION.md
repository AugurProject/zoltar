# Augur visual foundation

The shared UI presents a restrained, near-black operations surface with readable sans-serif text, consistent controls, and semantic status treatments. `css/tokens.css` is the canonical source for color, type, spacing, control height, radius, focus, motion, and responsive layout values. Shared component styling should consume those tokens instead of adding literal colors or geometry.

Zoltar, Statoblast, Trading, and AugurScan use cyan, violet, lime, and teal product accents respectively. An accent identifies the current product and its primary interactive state; it does not replace the neutral surface palette or change component geometry. Yes, No, and Invalid use dedicated outcome tokens and must always retain visible text labels.

Normal content uses the interface sans font at 15–16px. Persistent labels and metadata are at least 13px, while 12px is reserved for nonessential eyebrow text. Monospace is for addresses, hashes, blocks, raw values, and code; the display serif is limited to brand lockups and occasional top-level presentation headings. Interactive targets are at least 44px, radii use the 4/8/12px scale, and spacing uses the 4/8/12/16/24/32/48px scale.

Reuse shared primitives for controls, statuses, fields, sections, records, dialogs, transaction feedback, and empty/loading/error states. Application-specific CSS should own navigation, page composition, information density, and mobile context patterns. Ordinary content must not nest more than two bordered surface levels; use dividers, flat rows, tabs, disclosures, or a detail view for deeper hierarchy. Motion must clarify state and must have a reduced-motion equivalent.
