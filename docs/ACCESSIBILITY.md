# Accessibility evidence and remaining certification work

Target: WCAG 2.2 Level AA for the local Foundry and Workflow Studio, including template selection and owner GitHub approval forms.

This is an implementation and verification record, not an independent accessibility certificate or a complete conformance claim. Automated checks cannot establish every WCAG success criterion.

## Implemented and automated coverage

- Labelled controls, named dialogs and live status messages; text-only repository content.
- Keyboard mode selection using arrow/Home/End keys, native dialog Escape handling, focus return and skip navigation.
- Shared visible focus indication, forced-colours focus/borders and reduced-motion support.
- 320 and 640 CSS-pixel page reflow checks.
- Three appearance themes, sampled visible text contrast and input boundaries.
- axe-core 4.14.0 WCAG A/AA rules across page, theme, reflow and modal states.
- Separate connected GitHub fixture/approval state audit, inert hostile README rendering and draft-only template application.
- Server-side authentication and exact saved approvals do not rely on visual or assistive UI state.

Run test/accessibility-browser-check.js with the host-provided Chrome, Playwright and PNGJS paths. Its local artifacts/accessibility/report.json retains violations, incomplete/manual-review results and sampling limitations. The GitHub account browser fixture runs separately; it does not contact GitHub.

## Still required before claiming full conformance

An independent evaluator should cover complete user journeys in NVDA/Chrome and Narrator/Edge, spoken reading order and announcements, keyboard-only operation through every dynamic/error/recovery state, high contrast and text spacing overrides, 200–400% zoom, focus visibility around sticky controls, actual touch targets and alternative input, physical displays and all axe incomplete results.

Also assess understandable instructions/errors, accessible authentication recovery, repeated-content bypass, status timing, any future media and language changes, and new external write states. Record criterion-by-criterion A/AA results, test versions, assistive technologies and any exceptions before issuing a conformance statement. A green automated report alone is insufficient.

Templates are practical starters supported by this engine, not a statistically ranked popularity list. GitHub's official starter-workflows catalog spans CI, deployment and automation; those execution capabilities are not enabled in Sector7's local text templates.

References: https://www.w3.org/TR/WCAG22/ and https://github.com/actions/starter-workflows .

## 2 November 2026 · Extended acceptance

The retained accessibility-journey browser check covers keyboard focus visibility through both pages (31 Foundry and 25 Studio focus targets), ordinary layout, increased WCAG text spacing at 320 CSS pixels, forced colours, native dialog page-focus containment/restoration and missing-credential recovery instructions. The initial reproduction found Studio controls hidden behind sticky toolbars; the presentation-only focus guard now measures their real heights and reveals focused content in its scroll containers.

The test waits for rendering after keyboard input. Browser-chrome focus is allowed during native dialog traversal; page content outside an open dialog remains inert. Escape restoration is checked after the close event, rather than before it runs.

The main axe scan's generic-container ARIA-name review items were resolved by assigning suitable group/region semantics. Plus/minus zoom symbols are graphical symbols with descriptive accessible names; W3C's Label in Name guidance distinguishes these from human-language visible labels. Gradient contrast review remains supported by rendered-pixel sampling, with its documented bounds.

The account panel also offers an explicit Load repositories action after a connected page reload. It does not perform an automatic upstream read merely because the page opens.

This extends automated browser evidence, not independent certification. The owner chose to keep the independent screen-reader and physical-device audit open. Current references checked on 2 November 2026:
- https://www.w3.org/WAI/WCAG22/Understanding/text-spacing
- https://www.w3.org/WAI/WCAG22/Understanding/label-in-name
