import { describe, expect, test } from 'bun:test'
import { deriveSecurityPoolLifecycleState } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/securityPoolState.js'

describe('security pool state axes', () => {
	test.each<[Parameters<typeof deriveSecurityPoolLifecycleState>[0], ReturnType<typeof deriveSecurityPoolLifecycleState>]>([
		[{ questionOutcome: 'none', systemState: 'operational' }, 'operational'],
		[{ questionOutcome: 'yes', systemState: 'operational' }, 'ended'],
		[{ questionOutcome: 'none', systemState: 'operational', universeHasForked: true }, 'poolForked'],
		[{ questionOutcome: 'yes', systemState: 'operational', universeHasForked: true }, 'ended'],
		[{ questionOutcome: 'yes', systemState: 'forkMigration' }, 'forkMigration'],
		[{ questionOutcome: 'none', systemState: undefined }, undefined],
	])('derives lifecycle state from %o', (input, expected) => {
		expect(deriveSecurityPoolLifecycleState(input)).toBe(expected)
	})
})
