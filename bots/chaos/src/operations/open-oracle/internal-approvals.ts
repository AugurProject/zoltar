import { openOracleAbi } from '@zoltar/bot-shared/contracts/abi'
import { amount, choose, eligible, encodeStep, eventTopic, mixSeed, ONE_TOKEN, optionAmount, planBase } from '../planning.ts'
import type { EcosystemSnapshot, OperationDefinition, OperationEvidence, PlanningOptions } from '../types.ts'
import { minAmount } from './planning.ts'

const OPEN_ORACLE_INTERNAL_APPROVAL_STEP_GAS_LIMIT = 200_000n

function internalApprovalCandidates(snapshot: EcosystemSnapshot, options: PlanningOptions) {
	const knownRep = new Set(snapshot.universes.map(universe => universe.repToken.toLowerCase()))
	return snapshot.wallet.tokens.flatMap(token => {
		const isWeth = token.address.toLowerCase() === snapshot.deployments.weth.toLowerCase()
		const isRep = knownRep.has(token.address.toLowerCase())
		if ((!isWeth && !isRep) || token.openOracleInternalAllowanceToSelf === undefined) return []
		const current = amount(token.openOracleInternalAllowanceToSelf)
		if (current !== 0n) return [{ current, target: 0n, token: token.address }]
		const configuredMaximum = isRep ? optionAmount(options, 'maxRepSpendAttoRep', ONE_TOKEN) : optionAmount(options, 'maxEthSpendAttoEth', 10n ** 16n)
		const target = minAmount(configuredMaximum, ONE_TOKEN)
		return target === 0n ? [] : [{ current, target, token: token.address }]
	})
}

function internalApprovalEvidence(snapshot: EcosystemSnapshot, token: `0x${string}`, target: bigint): OperationEvidence[] {
	const signature = 'InternalApproval(address,address,address,uint256)'
	return [
		{
			abi: 'event InternalApproval(address indexed owner, address indexed spender, address indexed token, uint256 amount)',
			emitter: snapshot.deployments.openOracle,
			equals: target.toString(),
			field: 'amount',
			indexed: { owner: snapshot.wallet.address, spender: snapshot.wallet.address, token },
			kind: 'decoded-event-field',
			signature,
			topic0: eventTopic(signature),
		},
		{
			abi: 'function internalAllowance(address owner, address spender, address token) view returns (uint256)',
			args: [snapshot.wallet.address, snapshot.wallet.address, token],
			contract: snapshot.deployments.openOracle,
			expected: target.toString(),
			functionName: 'internalAllowance',
			kind: 'storage-postcondition',
			relation: 'equals',
		},
	]
}

export const approveInternal: OperationDefinition = {
	buildPlan(snapshot, options) {
		const candidate = choose(internalApprovalCandidates(snapshot, options), mixSeed(options.seed, approveInternal.id))
		if (candidate === undefined) return undefined
		return planBase({
			definitionId: approveInternal.id,
			ecosystem: 'open-oracle',
			label: candidate.target === 0n ? 'Revoke self-only OpenOracle internal allowance' : 'Set self-only OpenOracle internal allowance',
			lastValidBlockNumber: (BigInt(snapshot.anchor.blockNumber) + 1n).toString(),
			metadata: { allowanceBefore: candidate.current.toString(), allowanceTarget: candidate.target.toString(), owner: snapshot.wallet.address, spender: snapshot.wallet.address, token: candidate.token },
			postconditions: ['The wallet-to-self internal allowance equals the bounded target and no external spender is authorized'],
			risk: 'low',
			snapshot,
			steps: [
				encodeStep({
					abi: openOracleAbi,
					args: [snapshot.wallet.address, candidate.token, candidate.target],
					evidence: internalApprovalEvidence(snapshot, candidate.token, candidate.target),
					functionName: 'approveInternal',
					gasLimit: OPEN_ORACLE_INTERNAL_APPROVAL_STEP_GAS_LIMIT,
					id: `approve-internal-self-${candidate.token}`,
					label: candidate.target === 0n ? 'Revoke internal self-allowance' : 'Set internal self-allowance',
					to: snapshot.deployments.openOracle,
				}),
			],
		})
	},
	classification: 'selectable',
	contract: 'OpenOracle',
	description: 'Toggles a bounded internal allowance only from the configured wallet to itself, so no external spender gains authority over OpenOracle credit.',
	discoveryInputs: ['anchored wallet-to-self internal allowances', 'canonical WETH/REP token set', 'operation spend caps'],
	ecosystem: 'open-oracle',
	evaluate: (snapshot, options) => eligible(internalApprovalCandidates(snapshot, options).length === 0 ? 'No canonical token has a discovered self-allowance that can be safely toggled within policy' : undefined),
	id: 'open-oracle.approve-internal',
	label: 'Manage self-only OpenOracle allowance',
	method: 'approveInternal',
	risk: 'low',
}
