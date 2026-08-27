import { encodeFunctionData, keccak256, toHex, type Abi, type Address, type Hash, type Hex } from '@zoltar/bot-shared/ethereum'
import type { EcosystemSnapshot, EligibilityResult, OperationEvidence, OperationPlan, OperationPlanDraft, OperationPreflightCall, OperationStep, OperationWalletAssetDebit, PlanningOptions, TokenInventory } from './types.ts'

export const ONE_ATTO_TOKEN = 1n
export const ONE_TOKEN = 10n ** 18n

export function eventTopic(signature: string): Hash {
	return keccak256(toHex(signature))
}

export function eligible(...blockers: Array<string | undefined>): EligibilityResult {
	const actual = blockers.filter((blocker): blocker is string => blocker !== undefined)
	return { blockers: actual, eligible: actual.length === 0 }
}

export function disabled(reason: string): EligibilityResult {
	return { blockers: [reason], eligible: false }
}

export function amount(value: string) {
	if (!/^\d+$/.test(value)) throw new Error(`Invalid unsigned integer: ${value}`)
	return BigInt(value)
}

export function cappedSpend(balance: bigint, reserve: bigint, configuredMaximum: bigint, seed: number, minimum = ONE_ATTO_TOKEN) {
	if (balance <= reserve || configuredMaximum < minimum) return 0n
	const available = balance - reserve
	const cap = available < configuredMaximum ? available : configuredMaximum
	if (cap < minimum) return 0n
	const span = cap - minimum + 1n
	return minimum + (BigInt(seed >>> 0) % span)
}

export function optionAmount(options: PlanningOptions, key: 'maxEthSpendAttoEth' | 'maxRepSpendAttoRep' | 'minimumEthReserveAttoEth' | 'minimumRepReserveAttoRep', fallback: bigint) {
	const configured = options[key]
	return configured === undefined ? fallback : amount(configured)
}

export function mixSeed(seed: number, salt: string) {
	let value = seed >>> 0
	for (let index = 0; index < salt.length; index += 1) {
		const code = salt.charCodeAt(index)
		value ^= code
		value = Math.imul(value, 0x45d9f3b) >>> 0
		value ^= value >>> 16
	}
	return value >>> 0
}

export function canonicalizeOperationMetadata(metadata: OperationPlan['metadata']): OperationPlan['metadata'] {
	return Object.fromEntries(Object.entries(metadata).sort(([left], [right]) => left.localeCompare(right)))
}

export function choose<T>(values: readonly T[], seed: number): T | undefined {
	if (values.length === 0) return undefined
	return values[seed % values.length]
}

export function tokenInventory(snapshot: EcosystemSnapshot, token: Address): TokenInventory | undefined {
	return snapshot.wallet.tokens.find(candidate => candidate.address.toLowerCase() === token.toLowerCase())
}

export function allowance(inventory: TokenInventory | undefined, spender: Address) {
	if (inventory === undefined) return 0n
	const entry = Object.entries(inventory.allowances).find(([address]) => address.toLowerCase() === spender.toLowerCase())
	return entry === undefined || typeof entry[1] !== 'string' ? 0n : amount(entry[1])
}

export function encodeStep(parameters: {
	id: string
	label: string
	abi: Abi
	functionName: string
	args?: readonly unknown[] | undefined
	to: Address
	value?: bigint | undefined
	gasLimit?: bigint | undefined
	evidence?: OperationEvidence[] | undefined
	preflightCalls?: OperationPreflightCall[] | undefined
	walletAssetDebits?: OperationWalletAssetDebit[] | undefined
}): OperationStep {
	if (parameters.walletAssetDebits?.some(debit => debit.kind === 'native')) {
		throw new Error('Native wallet debits are derived from the transaction value')
	}
	const data = parameters.args === undefined ? encodeFunctionData({ abi: parameters.abi, functionName: parameters.functionName }) : encodeFunctionData({ abi: parameters.abi, args: parameters.args, functionName: parameters.functionName })
	const step: OperationStep = {
		data,
		evidence: parameters.evidence ?? [{ kind: 'receipt-success' }],
		gasLimit: (parameters.gasLimit ?? 12_000_000n).toString(),
		id: parameters.id,
		label: parameters.label,
		preflightCalls: [...(parameters.preflightCalls ?? [])],
		to: parameters.to,
		walletAssetDebits: [...(parameters.walletAssetDebits ?? [])],
	}
	if (parameters.value !== undefined) {
		step.value = parameters.value.toString()
		if (parameters.value > 0n) step.walletAssetDebits.push({ amount: parameters.value.toString(), asset: 'ETH', kind: 'native' })
	}
	if (parameters.gasLimit !== undefined) step.gasLimit = parameters.gasLimit.toString()
	return step
}

export function encodePreflightCall(parameters: { abi: Abi; args?: readonly unknown[] | undefined; caller: Address; expectedResult: Hex; functionName: string; label: string; to: Address; value?: bigint | undefined }): OperationPreflightCall {
	const data = parameters.args === undefined ? encodeFunctionData({ abi: parameters.abi, functionName: parameters.functionName }) : encodeFunctionData({ abi: parameters.abi, args: parameters.args, functionName: parameters.functionName })
	return {
		caller: parameters.caller,
		data,
		expectedResult: parameters.expectedResult,
		label: parameters.label,
		to: parameters.to,
		...(parameters.value === undefined ? {} : { value: parameters.value.toString() }),
	}
}

export function erc20WalletDebit(asset: Address, debitAmount: bigint, category: Extract<OperationWalletAssetDebit, { kind: 'erc20' }>['category']): OperationWalletAssetDebit {
	if (debitAmount <= 0n) throw new Error('ERC-20 wallet debit must be positive')
	return { amount: debitAmount.toString(), asset, category, kind: 'erc20' }
}

export function erc1155WalletDebit(asset: Address, tokenId: bigint, debitAmount: bigint): OperationWalletAssetDebit {
	if (tokenId < 0n || debitAmount <= 0n) throw new Error('ERC-1155 wallet debit must use an unsigned token id and positive amount')
	return { amount: debitAmount.toString(), asset, category: 'outcome-share', kind: 'erc1155', tokenId: tokenId.toString() }
}

export function openOracleCreditDebit(openOracle: Address, asset: 'ETH' | Address, debitAmount: bigint, category: Extract<OperationWalletAssetDebit, { kind: 'open-oracle-credit' }>['category']): OperationWalletAssetDebit {
	if (debitAmount <= 0n) throw new Error('OpenOracle credit debit must be positive')
	return { amount: debitAmount.toString(), asset, category, kind: 'open-oracle-credit', openOracle }
}

export function planBase(parameters: {
	snapshot: EcosystemSnapshot
	definitionId: string
	ecosystem: OperationPlan['ecosystem']
	label: string
	risk: OperationPlan['risk']
	steps: OperationStep[]
	postconditions: string[]
	metadata?: Record<string, string | number | boolean>
	priority?: OperationPlan['priority']
	deadlineTimestamp?: string | undefined
	semanticDeadlineBlockNumber?: string | undefined
	lastValidBlockNumber?: string | undefined
}): OperationPlanDraft {
	const priority = parameters.priority ?? 'random'
	const metadata = canonicalizeOperationMetadata(parameters.metadata ?? {})
	const metadataDigest = keccak256(toHex(JSON.stringify(metadata)))
	const plan: OperationPlanDraft = {
		classification: priority === 'urgent' ? 'lifecycle-obligation' : 'selectable',
		createdAtBlock: parameters.snapshot.anchor.blockNumber,
		definitionId: parameters.definitionId,
		ecosystem: parameters.ecosystem,
		id: `${parameters.definitionId}:${parameters.snapshot.anchor.blockNumber}:${metadataDigest}`,
		label: parameters.label,
		metadata,
		obligation: priority === 'urgent',
		postconditions: parameters.postconditions,
		priority,
		risk: parameters.risk,
		steps: parameters.steps,
	}
	if (parameters.deadlineTimestamp !== undefined) plan.deadlineTimestamp = parameters.deadlineTimestamp
	if (parameters.semanticDeadlineBlockNumber !== undefined) {
		plan.semanticDeadlineBlockNumber = parameters.semanticDeadlineBlockNumber
	}
	if (parameters.lastValidBlockNumber !== undefined) plan.lastValidBlockNumber = parameters.lastValidBlockNumber
	return plan
}

export function eventEvidence(emitter: Address, signature: string): OperationEvidence {
	return { emitter, kind: 'event', signature, topic0: eventTopic(signature) }
}

export function erc20AllowanceEvidence(token: Address, owner: Address, spender: Address, expected: bigint): OperationEvidence {
	return {
		abi: 'function allowance(address owner, address spender) view returns (uint256)',
		args: [owner, spender],
		contract: token,
		expected: expected.toString(),
		functionName: 'allowance',
		kind: 'storage-postcondition',
		relation: 'equals',
	}
}

export function randomDeadline(snapshot: EcosystemSnapshot, seed: number) {
	const seconds = 1_800n + BigInt(seed % 1_800)
	return (amount(snapshot.anchor.timestamp) + seconds).toString()
}
