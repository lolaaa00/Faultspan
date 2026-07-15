# Faultspan Design Discovery

This record resolves the design questions from the existing master plan and build brief.

## Audience

- Primary: GenLayer × Denarii Labs accelerator judges.
- Secondary: developers building A2A and x402 agent-commerce systems.
- Tertiary: buyers and coordinator agents inspecting a disputed job.

## Primary goal

Make multi-hop failure attribution understandable in five seconds, then let a reviewer inspect the obligation, evidence, verdict, and economic result without trusting a black-box AI claim.

## Output and fidelity

- High-fidelity responsive browser application.
- Desktop-first case workspace with an accessible mobile list fallback.
- Three early layout directions in one wireframe canvas.
- One stateful prototype built from the recommended direction.
- One concise 16:9 HTML judge deck without speaker notes.

## Desired feel

**Forensic. Precise. Calm.**

The product should feel closer to an incident-analysis workspace or financial case file than a crypto casino, generic SaaS dashboard, or AI chatbot.

## Exploration axes

- Primary information model: ledger vs graph vs timeline.
- Density: compact evidence workspace vs spacious narrative.
- Interaction: persistent inspector vs modal drill-down.
- Visual emphasis: obligation topology vs verdict outcome.

## Chosen direction

**Evidence graph**, with the case ledger used as the accessible/mobile alternate representation.

Why:

- The dependency graph is the product's unique mechanism.
- The persistent inspector keeps evidence and economic consequences adjacent.
- It creates a memorable live demo without turning the product into decoration.
- The ledger fallback makes the same information keyboard- and screen-reader-friendly.

## Rejected defaults

- Purple or pink gradients.
- Glassmorphism.
- Giant empty hero sections.
- Metric cards without a decision attached.
- Chat-first interaction.
- Decorative AI or robot imagery.
- Every object inside a large rounded card.
- Color-only verdict states.

## Tweak surface

The prototype exposes only meaningful choices:

- Light/dark tone.
- Comfortable/compact density.
- Graph/ledger case representation.
- Primary cyan hue.

Values persist locally under the namespaced key `faultspan:design-tweaks:v1`.

