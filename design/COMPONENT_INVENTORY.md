# Faultspan Component Inventory

Source surfaces: `apps/web/components/*`, the case workspace, create-case wizard, evidence dialog, and tweak panel.

## Foundations

- **Tokens:** cool-neutral color scale, cyan primary, semantic green/amber/red, 8px spacing with 4px micro-step, 2/4/8px radii, one overlay shadow, quiet 160/220ms motion.
- **Typography:** IBM Plex Sans Variable for interface text and IBM Plex Mono for hashes, addresses, timestamps, and identifiers.
- **Layout:** fixed desktop navigation, sticky utility bar, 90rem content maximum, graph/inspector split, ledger fallback below 560px.

## Atoms

### Button

- Purpose: initiate an action or change local state.
- Variants: primary, secondary, ghost, icon.
- States: default, hover, active, focus-visible, disabled, loading through label replacement.
- Tokens: primary, surface, border, radius-sm, motion-fast.
- Accessibility: native `button`; 44px minimum target.
- Do: use one primary action per decision group.
- Don't: use primary styling for navigation or passive status.

### Status / Finding badge

- Purpose: communicate case or span state.
- Variants: disputed, complied, contributed, caused failure, insufficient evidence.
- States: static; not interactive.
- Composition: semantic icon + text + color.
- Accessibility: never color-only.
- Do: use the exact adjudication vocabulary.
- Don't: shorten `INSUFFICIENT_EVIDENCE` to a guilt-adjacent label.

### Field

- Purpose: collect commitment, address, bond, span, and evidence data.
- Variants: input, number, select, textarea.
- States: default, focus, required, invalid, disabled.
- Accessibility: visible label, supporting description, specific tied error.

### Mono value

- Purpose: display an address, digest, timestamp, transaction hash, or amount requiring scan precision.
- Do: truncate visually while preserving a copyable full value where available.
- Don't: use monospace for long prose.

## Molecules

### Wallet control

- Purpose: request a browser wallet and show the selected address.
- States: disconnected, connecting, connected, rejected, unavailable.
- Accessibility: error is linked through `aria-describedby`.

### Transaction banner

- Purpose: keep asynchronous Studionet state visible.
- Variants: submitting, accepted, finalized, failed.
- Do: show the transaction hash when available.
- Don't: treat finalization alone as successful execution.

### Provider identity

- Purpose: connect human-readable agent identity to its on-chain address.
- Composition: agent mark, name, truncated address.

### Evidence row

- Purpose: open or inspect one evidence object.
- Composition: source icon, label, kind, digest, external/open affordance.
- States: default, hover, focus.

### Verdict callout

- Purpose: explain one consensus finding and its causal basis.
- Semantic left border is intentional because this is a true adjudication callout.

## Organisms

### Sidebar navigation

- Purpose: navigate distinct product jobs: cases, obligations, evidence, integration.
- Responsive behavior: becomes a horizontal scrollable strip on small screens.

### Case facts

- Purpose: summarize bonded value, evidence state, adjudication phase, and possible recovery.
- These are decision-relevant facts, not vanity metrics.

### Liability graph

- Purpose: show delegation topology and causal attribution.
- States: node default, hover, active, selected, keyboard focus.
- Accessibility: graph controls are native buttons; a semantic ledger contains the same information.
- Do: limit the MVP to eight spans.
- Don't: encode finding by connector color alone.

### Case ledger

- Purpose: accessible and mobile-friendly alternative to the graph.
- Composition: obligation, provider, bond, finding.
- Responsive behavior: hides secondary provider/bond columns only on very narrow screens.

### Span inspector

- Purpose: collocate obligation, provider, evidence, verdict explanation, bond, and deterministic recovery rule.
- Composition: provider identity, evidence rows, verdict callout, bond facts.

### Case-record tabs

- Purpose: switch between evidence, settlement, and activity jobs.
- States: selected tab uses `aria-selected` and a visible underline.
- Gap: arrow-key roving focus should be added if tabs expand beyond the prototype.

### Create-case dialog

- Purpose: gather root commitment, coordinator, and recovery rule.
- States: three steps, validation error, submitting, local draft success, Studionet success/failure.
- Accessibility: native dialog, Escape close, linked validation.

### Evidence dialog

- Purpose: create a wallet-signed public evidence object.
- States: disconnected error, signing, upload success/failure.
- Safety: persistent warning against secrets and personal data.

### Tweak panel

- Purpose: compare surface tone, density, graph/ledger representation, and primary hue.
- Persistence: `faultspan:design-tweaks:v1` in local storage.
- The panel disappears completely when closed.

## Templates

- **Case workspace:** case heading → facts → transaction state → graph and inspector → case record.
- **Case creation:** staged commitment wizard.
- **Evidence submission:** public-data warning → span selection → signed statement → content-addressed receipt.

## Known system gaps

- No toast queue; transaction and form feedback are currently contextual.
- No full dropdown/menu primitive is needed yet.
- No destructive button variant is admitted because the current UI exposes no destructive operation.
- Tabs need full arrow-key behavior before production accessibility claims.
- Wallet account/network-change subscriptions are not yet implemented.

