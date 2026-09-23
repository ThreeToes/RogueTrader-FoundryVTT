# Architecture

The rules engine is layered, and the layers only depend **inward**. This document
is the contract; `src/roguetrader/architecture.test.ts` enforces it mechanically,
so a violation fails `bun test` instead of quietly rotting the design.

## Layers

```
  presentation   sheets, dialogs, creators        (Foundry UI)
        │
  application    use cases + ports                (no Foundry globals)
        │
  domain         rules over the ActorView model   (no Foundry globals)
        │
  rules-engine   the pure kernel                  (no Foundry, no i18n, no I/O)
```

`infrastructure/` sits beside `application`/`domain` and is the **only** place that
implements the ports with real Foundry APIs. `bootstrap/` is the composition root.

| Layer | Path | May import |
| --- | --- | --- |
| Kernel | `src/rules-engine/src/**` | other kernel files only |
| Domain | `src/roguetrader/domain/**` | kernel, `domain/**` |
| Application | `src/roguetrader/application/**` | kernel, domain, `application/ports` |
| Infrastructure | `src/roguetrader/infrastructure/**` | everything below + Foundry |
| Presentation | `src/roguetrader/presentation/**`, `sheet/**` | everything below + Foundry |
| Bootstrap | `src/roguetrader/bootstrap/**` | everything + Foundry |

**Never allowed below `infrastructure`:** the globals `foundry`, `game`, `CONFIG`,
`ui`, `Hooks`, `canvas`, or an import from `fvtt-types`. If a rule needs a die, a
chat card, a compendium, the current target, a translation or a clock, it takes it
from `application/ports.ts`.

## The ports

```ts
interface Ports {
  dice:        { roll(formula): Promise<DiceResult> };
  chat:        { post(actor, template, vars, flags?): Promise<{ id? } | undefined>;
                 postHtml(actor, content): Promise<{ id? } | undefined>;
                 update(messageId, data): Promise<void> };
  targets:     { view(): ActorView | null; actor(): unknown | null };
  clock:       { round(): number };
  notify:      { warn(key, vars?): void; info(key, vars?): void };
  i18n:        { t(key, vars?): string };
  config:      { homebrew(): unknown; originTraits(): unknown[] };
  content:     { capabilities(): ContentCapabilities;
                 documents(packId): Promise<unknown[]>;
                 find(packId, name): Promise<ContentTable | null> };
  actors:      { update(actor, patch): Promise<void>;
                 createEffects(actor, data): Promise<void>;
                 deleteEffects(actor, ids): Promise<void> };
  permissions: { canRoll(actor): boolean };
}
```

(`content` is the `ContentPort` — capability probe, pack documents, find-by-name.)

Domain and application return **i18n keys**, not localized strings; presentation
localizes. That is what makes the rules runnable headlessly in tests.

## The read model

`domain/` and `application/` never take a Foundry `Actor`. They take an
`ActorView` — a plain, typed snapshot built once per roll by
`infrastructure/foundry/actor-view.ts`. (The `rules/` layer is still
Foundry-coupled here: `rules/adapter.ts` and `rules/roll-contract.ts` accept
Foundry `Actor` documents; see bead `foundryvtt-rogue-trader-5xue`.)

```ts
interface ActorView {
  id: string; uuid: string; name: string; type: ActorType;
  characteristics: Record<string, { value: number; unnatural: number }>;
  system: CharacterSystem | ShipSystem | VehicleSystem | /* … */;
  items: readonly ItemView[];
  effects: readonly EffectView[];
  item(id: string): ItemView | undefined;
  ofType(...types: ItemType[]): readonly ItemView[];
}
```

This is the single place the system's document shape is asserted, which is why the
rules layer has no `as unknown as` casts and why tests build real fixtures.

## Content-optional rules (owner requirement)

**Manual entry is the baseline; content only adds automation.** The public install
ships zero compendium packs, so:

- With **no content**, a player rolls the base target and sets modifiers by hand in
  the TestDialog. Every flow completes; nothing is gated on a pack.
- Installing content only *adds* automation — relevant modifiers pre-fill from the
  owned items and the packs, and table lookups resolve. There are **no settings to
  configure**: packs are auto-detected at call time.

Every content dependency goes through the `ContentPort` (`application/ports.ts`);
its Foundry implementation (`infrastructure/foundry/content.ts`) returns `[]`/`null`
rather than throwing, and each consumer has a documented fallback:

| Content missing | Fallback |
| --- | --- |
| Critical RollTables | kernel still computes severity/location; the critical is recorded and the card says to apply the table effect manually |
| Psychic Phenomena tables | the roll + total are still posted; the card says to look the result up manually |
| Origin traits / skill catalog / warrant / origins | contribute nothing; the player sets modifiers/items manually |
| Affliction / talent grants | show the name; link only when the pack resolves |
| Ship / game tables | kernel defaults where the rules allow |

A pack-less run is a supported configuration, covered by tests using the
`NO_CONTENT_PORT`. **Never a broken card, never a silent no-op, never a blocked
roll.**

## One effect engine

Effect kinds are registered once with their metadata (channel, key grammar,
liveness, applicability, and how they become a `Modifier` or a typed payload). One
`collectEffects(view, query)` walk serves every consumer. Adding an effect kind is a
single registration — not a new collector.

## Adding things

| To add… | You touch |
| --- | --- |
| an effect kind | one registration in `domain/effects/registry.ts` |
| a roll kind | one `RollDefinition` (exhaustive map → compile error if missing) |
| a new FFG system (DH2, BC…) | a `RuleProfile`/`SystemProfile` + registries + a `bootstrap` wiring, **plus** hoisting the system-neutral layers (`domain`, `application`, `presentation/rolls`, `rules/funnel`, `infrastructure`) out of `src/roguetrader/` — the current `RuleProfile` is far too thin to express another system. See epic `foundryvtt-rogue-trader-hr6r` and its children |
| an item type | its DataModel + the `ActorView` builder mapping |
| a house rule | homebrew profile data, read through `ports.config` |

## Enforcement

`src/roguetrader/architecture.test.ts` scans the six directories in its
`LAYER_DIRS` table — kernel (`src/rules-engine/src`), domain, application,
infrastructure, presentation and bootstrap — and fails on any import or
Foundry-global use that breaks the table above. Everything else (notably
`src/roguetrader/rules/**` and `src/roguetrader/sheet/**`) falls into an
unchecked `other` bucket and is **not** scanned; bead
`foundryvtt-rogue-trader-5xue` tracks bringing those directories under
enforcement. Run `bun test` after a structural change — it is the guard rail
that keeps this document true.
