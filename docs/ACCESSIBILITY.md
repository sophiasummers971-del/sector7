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
