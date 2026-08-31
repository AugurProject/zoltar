import { describe, expect, test } from 'bun:test'
import { getAddress } from '../support/bot-shared.ts'
import type { StrategySettings } from '../../src/config/settings.ts'
import type { EvaluatedOperation } from '../../src/operations/types.ts'
import { applyLiveNoveltyInventoryReadiness, liveInventoryReadinessBlockers } from '../../src/runtime/live-readiness.ts'

const repToken = getAddress('0x0000000000000000000000000000000000000002')
const strategy: Pick<StrategySettings, 'maximumEthPerOperationAttoEth' | 'maximumGasCostAttoEth' | 'maximumRepPerOperationAttoRep' | 'minimumEthReserveAttoEth' | 'minimumRepReserveAttoRep'> = {
	maximumEthPerOperationAttoEth: 7n,
	maximumGasCostAttoEth: 5n,
	maximumRepPerOperationAttoRep: 11n,
	minimumEthReserveAttoEth: 10n,
	minimumRepReserveAttoRep: 20n,
}
const universes = [{ id: 'root', repToken }]

function evaluation(classification: EvaluatedOperation['definition']['classification']): EvaluatedOperation {
	return {
		definition: {
			classification,
			contract: 'Test',
			description: 'Test operation',
			discoveryInputs: [],
			ecosystem: 'zoltar',
			id: `test.${classification}`,
			label: 'Test operation',
			method: 'test',
			risk: 'low',
		},
		eligibility: { blockers: [], eligible: true },
	}
}

describe('continuous live inventory readiness', () => {
	test('blocks only novel selectable work after canonical REP is drained', () => {
		const evaluations = [evaluation('selectable'), evaluation('lifecycle-obligation')]
		const funded = { eth: '22', rep: [{ balance: '31', symbol: 'REP', token: repToken, universeId: 'root' }] }
		expect(liveInventoryReadinessBlockers(funded, universes, strategy)).toEqual([])
		expect(applyLiveNoveltyInventoryReadiness(evaluations, funded, universes, strategy)).toEqual(evaluations)

		const drained = { ...funded, rep: [{ balance: '0', symbol: 'REP', token: repToken, universeId: 'root' }] }
		const guarded = applyLiveNoveltyInventoryReadiness(evaluations, drained, universes, strategy)
		expect(guarded[0]).toMatchObject({ eligibility: { eligible: false } })
		expect(guarded[0]?.eligibility.blockers.join(' ')).toContain('canonical REP inventory')
		expect(guarded[1]).toEqual(evaluations[1])
	})

	test('requires reserves, maximum operation principals, and one maximum gas budget', () => {
		const exactRepBalance = { balance: '31', symbol: 'REP', token: repToken, universeId: 'root' }
		const exactRep = [exactRepBalance]
		expect(liveInventoryReadinessBlockers({ eth: '15', rep: exactRep }, universes, strategy).join(' ')).toContain('one strategy.maximumEthPerOperation principal')
		expect(liveInventoryReadinessBlockers({ eth: '22', rep: [{ ...exactRepBalance, balance: '20' }] }, universes, strategy).join(' ')).toContain('one strategy.maximumRepPerOperation principal')
		expect(liveInventoryReadinessBlockers({ eth: '22', rep: exactRep }, universes, strategy)).toEqual([])
	})
})
