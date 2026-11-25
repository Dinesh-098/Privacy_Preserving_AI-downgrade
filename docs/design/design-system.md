# Design system

The application serves a living example at `/design-system`. Dark and light themes in `frontend/src/styles.css` share semantic roles. IBM Plex Sans is bundled for UI text and IBM Plex Mono for identifiers, timestamps, hashes and numeric values. Tabler provides the base icon set. The original geometric lens mark is in `frontend/public/mark.svg`.

## Visual decisions

| Role | Rendering |
|---|---|
| Workspace layers | Navy rail, near-charcoal surface, bordered panels and inset tables |
| Table density | Compact, default and comfortable, with stable headings and semantic tables |
| Interaction | Muted blue for selected rows, primary actions and the focus ring |
| Attribution | Monospace case, evidence, dataset and run references, with copyable hashes |
| Privacy | Teal on successfully applied controls, explicit fixture badges and visible redaction |
| State | Text accompanies every badge, progress value and integrity result |
| Motion | Short transitions on drawers and protection preview, with system and Settings overrides |

Components live in `components.tsx`. Radix owns focus and modal keyboard behavior. The application uses paginated records, bounded queries, lazy canvas charts, UTC timestamps and explanatory empty states. The route shell provides the case switcher, search, presentation controls and background jobs. User events trigger transformations and chart actions.

## Source and correlation encoding

| Source or relation | Visual |
|---|---|
| Authentication | Blue circle and lane label |
| Process | Ochre square and lane label |
| Red-team | Coral diamond, labelled reference |
| Synthetic | Teal triangle and fixture or synthetic label |
| Identifier association | Teal link and R2 criterion |
| Temporal association | Dashed link and R3 criterion |
| Model flag | Blue text badge with explicit Model flag label |

Canvas charts include a text description, exact data table, CSV and PNG controls. The Lab displays measured points and comparisons, and includes E4 budget scope with the recorded accountant. ECharts and its renderer load only for routes and tabs that display charts.

## Visual checklist

| Pattern absent in the checked UI | Result |
|---|---|
| Purple, pink and indigo gradients, glow, blur and glass panels | Yes |
| Emoji, generic AI graphics and assistant avatar | Yes |
| Repeated large KPI cards and centered marketing hero | Yes |
| Oversized radii, repetitive shadows and pill layouts | Yes |
| Filler badges, placeholder copy, fake avatars or notifications | Yes |
| Default component-library theme and remote fonts | Yes |

The screenshot matrix records empty and example-case states in both themes across desktop widths. See the screenshot stage folders and the verification document for the run conditions.
