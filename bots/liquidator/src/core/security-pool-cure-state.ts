import type { SecurityPoolObservation, SecurityPoolPosition } from '#monitoring/security-pool-monitor'
import { securityPoolTakeoverSource } from '@zoltar/statoblast-shared/statoblast/securityPool'

/** Match the authenticated index's unpaid atomic cure that precedes every takeover. */
export function securityPoolCureOutcome(observation: SecurityPoolObservation, position: SecurityPoolPosition) {
	return securityPoolTakeoverSource(observation.snapshot, position)
}
