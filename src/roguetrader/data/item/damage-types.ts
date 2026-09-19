/**
 * Compatibility shim (epic kof0, phase 1): damage types moved to the domain
 * model (`domain/model/damage.ts`). Re-exported here so existing import paths
 * keep working during the migration; new code should import from
 * `domain/model` directly.
 */
export { DamageType, normaliseDamageType } from "../../domain/model/damage";
