import { expect, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { asWriteClient, createMockWriteClient, createMulticallStub, getContractFunctionName } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import type { TransactionPlanStep } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { withdrawForkedEscalationDeposits } from '@zoltar/ui-statoblast-shared/protocol/reportingCarryState.js'
import type { CarriedDepositProof } from '@zoltar/ui-statoblast-shared/types/contracts.js'

const owner = '0x00000000000000000000000000000000000000c1' satisfies Address
const question = '0x00000000000000000000000000000000000000a1' satisfies Address
const repToken = '0x00000000000000000000000000000000000000e8' satisfies Address
const rep = 10n ** 18n

test('inherited claim review rechecks the selected proofs and wallet balance in a single simulation', async () => {
	const proof: CarriedDepositProof = {
		depositor: owner,
		amountAttoRep: 4n * rep,
		cumulativeAmountAttoRep: 7n * rep,
		parentDepositIndex: 2n,
		sourceNodeId: 7n,
		leafIndex: 1n,
		merkleMountainRangePeakIndex: 1n,
		merkleMountainRangeSiblings: [],
	}
	let step: TransactionPlanStep | undefined
	let wallet = 12n * rep
	let consumed = false
	const client = asWriteClient(
		createMockWriteClient(
			() => undefined,
			request => {
				if (request.functionName === 'universeId') return 19n
				if (request.functionName === 'repToken') return repToken
				throw new Error(`Unexpected read: ${request.functionName}`)
			},
		),
	)
	client.account = { address: owner, type: 'json-rpc' }
	client.onTransactionPlan = steps => {
		step = steps[0]
	}
	client.multicall = createMulticallStub(({ contracts }) => {
		expect(contracts.map(getContractFunctionName)).toEqual(['balanceOf', 'withdrawForkedEscalationDeposits', 'balanceOf'])
		expect(contracts[0]).toMatchObject({ address: repToken, args: [owner] })
		expect(contracts[1]).toMatchObject({ address: question, args: [1, [proof]] })
		expect(contracts[2]).toMatchObject({ address: repToken, args: [owner] })
		if (consumed) throw new Error('Already claimed')
		return [wallet, undefined, wallet + 6n * rep]
	})

	await withdrawForkedEscalationDeposits(client, question, 'yes', [proof])
	if (step?.validateBeforeSubmit === undefined) throw new Error('Missing inherited claim review check')
	expect(step.reviewTitle).toBe('Claim inherited reporting deposit')
	await step.validateBeforeSubmit()
	expect(step.readReviewRows?.()).toEqual([
		{ label: 'Claim payout', value: '6\u00a0REP' },
		{ label: 'Wallet REP', value: '12\u00a0REP → 18\u00a0REP' },
	])
	wallet = 20n * rep
	await step.validateBeforeSubmit()
	expect(step.readReviewRows?.()[1]?.value).toBe('20\u00a0REP → 26\u00a0REP')
	consumed = true
	await expect(step.validateBeforeSubmit()).rejects.toThrow('Already claimed')
})
