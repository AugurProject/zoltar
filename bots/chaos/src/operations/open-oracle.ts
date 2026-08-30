import { encodeAbiParameters, getAddress, zeroAddress } from '@zoltar/bot-shared/ethereum'
import { erc20Abi, openOracleAbi, wethAbi } from '../contracts/abi.ts'
import { OPEN_ORACLE_SETTLEMENT_STEP_GAS_LIMIT, trustedOpenOracleReportPredicate } from '../monitoring/protocol-index.ts'
import { allowance, amount, cappedSpend, choose, disabled, eligible, encodePreflightCall, encodeStep, erc20AllowanceEvidence, erc20WalletDebit, eventEvidence, eventTopic, mixSeed, ONE_TOKEN, openOracleCreditDebit, optionAmount, planBase, tokenInventory } from './planning.ts'
import { requiredTimestampSafetySeconds, requiredWorkflowSafetyBlocks } from './timing.ts'
import type { EcosystemSnapshot, OperationContinuationContext, OperationDefinition, OperationEvidence, OperationPlan, OperationStep, OperationWalletAssetDebit, OracleGameSnapshot, PlanningOptions } from './types.ts'

const MAX_UINT128 = (1n << 128n) - 1n
const OPEN_ORACLE_CREDIT_STEP_GAS_LIMIT = 500_000n
const OPEN_ORACLE_INTERNAL_APPROVAL_STEP_GAS_LIMIT = 200_000n
const DEFAULT_PUSH_OR_CREDIT_GAS_LIMIT = 50_000n
const MINIMUM_CUSTOM_PUSH_OR_CREDIT_GAS_LIMIT = 30_000n
const MAXIMUM_CUSTOM_PUSH_OR_CREDIT_GAS_LIMIT = 100_000n
const minAmount = (left: bigint, right: bigint) => (left < right ? left : right)

function reportWindow(snapshot: EcosystemSnapshot, report: OracleGameSnapshot, options: PlanningOptions, prerequisiteCount = 0) {
	const timestampClock = (report.flags & 1) !== 0
	const current = amount(timestampClock ? snapshot.anchor.timestamp : snapshot.anchor.blockNumber)
	const opened = amount(report.reportTimestamp) + amount(report.disputeDelay)
	const closes = amount(report.reportTimestamp) + amount(report.settlementTime)
	return { closes, current, opened, safetyMargin: timestampClock ? requiredTimestampSafetySeconds(options, prerequisiteCount) : requiredWorkflowSafetyBlocks(prerequisiteCount), timestampClock }
}

function tokenDebit(snapshot: EcosystemSnapshot, token: `0x${string}`, debitAmount: bigint): OperationWalletAssetDebit[] {
	if (debitAmount === 0n || token === zeroAddress) return []
	let category: Extract<OperationWalletAssetDebit, { kind: 'erc20' }>['category'] = 'other'
	if (snapshot.universes.some(universe => universe.repToken.toLowerCase() === token.toLowerCase())) category = 'rep'
	else if (token.toLowerCase() === snapshot.deployments.weth.toLowerCase()) category = 'weth'
	return [erc20WalletDebit(token, debitAmount, category)]
}

function creditDebit(snapshot: EcosystemSnapshot, token: `0x${string}`, debitAmount: bigint): OperationWalletAssetDebit[] {
	if (debitAmount === 0n) return []
	let category: Extract<OperationWalletAssetDebit, { kind: 'open-oracle-credit' }>['category'] = 'other'
	if (snapshot.universes.some(universe => universe.repToken.toLowerCase() === token.toLowerCase())) category = 'rep'
	else if (token.toLowerCase() === snapshot.deployments.weth.toLowerCase()) category = 'weth'
	return [openOracleCreditDebit(snapshot.deployments.openOracle, token === zeroAddress ? 'ETH' : token, debitAmount, category)]
}

function tokenHolderEvidence(snapshot: EcosystemSnapshot, token: `0x${string}`, expected: bigint): OperationEvidence {
	return {
		abi: 'function tokenHolder(address owner, address token) view returns (uint256)',
		args: [snapshot.wallet.address, token],
		contract: snapshot.deployments.openOracle,
		expected: expected.toString(),
		functionName: 'tokenHolder',
		kind: 'storage-postcondition',
		relation: 'at-least',
	}
}

function exactTokenTransferEvidence(snapshot: EcosystemSnapshot, token: `0x${string}`, expected: bigint): OperationEvidence {
	return {
		abi: 'event Transfer(address indexed from, address indexed to, uint256 value)',
		emitter: token,
		equals: expected.toString(),
		field: 'value',
		indexed: { from: snapshot.deployments.openOracle, to: snapshot.wallet.address },
		kind: 'decoded-event-field',
		signature: 'Transfer(address,address,uint256)',
		topic0: eventTopic('Transfer(address,address,uint256)'),
	}
}

function trustedReportPredicate(snapshot: EcosystemSnapshot) {
	return trustedOpenOracleReportPredicate({
		coordinatorReports: snapshot.pools.flatMap(pool => (pool.pendingReportId === '0' ? [] : [{ coordinator: pool.coordinator, pendingReportId: pool.pendingReportId, repToken: pool.repToken }])),
		maximumSettlementStepGasLimit: OPEN_ORACLE_SETTLEMENT_STEP_GAS_LIMIT,
		openOracle: snapshot.deployments.openOracle,
		trustedRepTokens: snapshot.universes.map(universe => universe.repToken),
		wallet: snapshot.wallet.address,
		weth: snapshot.deployments.weth,
	})
}

function hasActiveSignerReport(snapshot: EcosystemSnapshot) {
	const trustedReport = trustedReportPredicate(snapshot)
	return snapshot.reports.some(report => report.settlementTimestamp === '0' && trustedReport(report) && report.helper.creator.toLowerCase() === snapshot.wallet.address.toLowerCase())
}

function ethSpend(snapshot: EcosystemSnapshot, options: PlanningOptions, salt: string) {
	return cappedSpend(amount(snapshot.wallet.ethBalanceAttoEth), optionAmount(options, 'minimumEthReserveAttoEth', 10n ** 16n), optionAmount(options, 'maxEthSpendAttoEth', 10n ** 16n), mixSeed(options.seed, salt))
}

function tokenSpend(snapshot: EcosystemSnapshot, tokenAddress: `0x${string}`, options: PlanningOptions, salt: string) {
	const token = tokenInventory(snapshot, tokenAddress)
	const isRep = snapshot.universes.some(universe => universe.repToken.toLowerCase() === tokenAddress.toLowerCase())
	const reserve = isRep ? optionAmount(options, 'minimumRepReserveAttoRep', ONE_TOKEN) : 1n
	const maximum = isRep ? optionAmount(options, 'maxRepSpendAttoRep', ONE_TOKEN) : optionAmount(options, 'maxEthSpendAttoEth', 10n ** 16n)
	return cappedSpend(token === undefined ? 0n : amount(token.balance), reserve, maximum, mixSeed(options.seed, salt))
}

function approveToken(snapshot: EcosystemSnapshot, tokenAddress: `0x${string}`, required: bigint) {
	if (required === 0n || tokenAddress === zeroAddress) return []
	const inventory = tokenInventory(snapshot, tokenAddress)
	if (allowance(inventory, snapshot.deployments.openOracle) >= required) return []
	return [openOracleApprovalStep(snapshot, tokenAddress, snapshot.deployments.openOracle, required)]
}

type OpenOracleApprovalRequirement = {
	id: string
	required: bigint
	spender: `0x${string}`
	token: `0x${string}`
}

function openOracleApprovalStep(snapshot: EcosystemSnapshot, token: `0x${string}`, spender: `0x${string}`, required: bigint, id = `approve-${token}`, label = 'Approve token for OpenOracle') {
	return encodeStep({ abi: erc20Abi, args: [spender, required], evidence: [erc20AllowanceEvidence(token, snapshot.wallet.address, spender, required)], functionName: 'approve', id, label, to: token })
}

function requiredMetadataString(metadata: OperationPlan['metadata'], key: string) {
	const value = metadata[key]
	if (typeof value !== 'string' || value.length === 0) throw new Error(`OpenOracle continuation metadata ${key} is missing`)
	return value
}

function requiredMetadataAmount(metadata: OperationPlan['metadata'], key: string) {
	const value = requiredMetadataString(metadata, key)
	if (!/^(?:0|[1-9][0-9]*)$/.test(value)) throw new Error(`OpenOracle continuation metadata ${key} is not canonical`)
	return BigInt(value)
}

function requiredMetadataAddress(metadata: OperationPlan['metadata'], key: string) {
	return getAddress(requiredMetadataString(metadata, key))
}

function requiredMetadataBoolean(metadata: OperationPlan['metadata'], key: string) {
	const value = metadata[key]
	if (typeof value !== 'boolean') throw new Error(`OpenOracle continuation metadata ${key} is missing`)
	return value
}

function exactPreviousApproval(previousPlan: OperationPlan, snapshot: EcosystemSnapshot, requirement: OpenOracleApprovalRequirement) {
	const previous = previousPlan.steps.find(step => step.id === requirement.id)
	if (previous === undefined) return undefined
	const expected = openOracleApprovalStep(snapshot, requirement.token, requirement.spender, requirement.required, requirement.id)
	return previous.to.toLowerCase() === expected.to.toLowerCase() && previous.data === expected.data ? previous : undefined
}

function preparedApprovalState(snapshot: EcosystemSnapshot, context: OperationContinuationContext, requirements: readonly OpenOracleApprovalRequirement[]) {
	for (const requirement of requirements) {
		const previous = exactPreviousApproval(context.previousPlan, snapshot, requirement)
		if (context.previousPlan.steps.some(step => step.id === requirement.id) && previous === undefined) return false
		if (previous !== undefined && context.confirmedStepIds.includes(requirement.id)) {
			if (allowance(tokenInventory(snapshot, requirement.token), requirement.spender) !== requirement.required) return false
		} else if (previous === undefined && allowance(tokenInventory(snapshot, requirement.token), requirement.spender) < requirement.required) {
			return false
		}
	}
	return true
}

function remainingApprovalSteps(snapshot: EcosystemSnapshot, context: OperationContinuationContext, requirements: readonly OpenOracleApprovalRequirement[]) {
	return requirements.flatMap(requirement => {
		const previous = exactPreviousApproval(context.previousPlan, snapshot, requirement)
		if (previous === undefined || context.confirmedStepIds.includes(requirement.id)) return []
		return [openOracleApprovalStep(snapshot, requirement.token, requirement.spender, requirement.required, requirement.id)]
	})
}

function cleanupApprovalRequirements(snapshot: EcosystemSnapshot, context: OperationContinuationContext, requirements: readonly OpenOracleApprovalRequirement[]) {
	return requirements.filter(requirement => context.confirmedStepIds.includes(requirement.id) && exactPreviousApproval(context.previousPlan, snapshot, requirement) !== undefined)
}

function openOracleCleanupPlan(snapshot: EcosystemSnapshot, context: OperationContinuationContext, requirements: readonly OpenOracleApprovalRequirement[], label: string, risk: OperationPlan['risk']) {
	const cleanup = cleanupApprovalRequirements(snapshot, context, requirements)
	if (cleanup.length === 0) return undefined
	return planBase({
		continuationDisposition: 'cleanup-only',
		definitionId: context.previousPlan.definitionId,
		ecosystem: 'open-oracle',
		label,
		metadata: context.previousPlan.metadata,
		postconditions: ['Every confirmed workflow-created OpenOracle token allowance is zero'],
		risk,
		snapshot,
		steps: cleanup.map(requirement => openOracleApprovalStep(snapshot, requirement.token, requirement.spender, 0n, `revoke-${requirement.id}`, 'Revoke workflow-created OpenOracle approval')),
	})
}

function maximumCleanupCount(previousPlan: OperationPlan, snapshot: EcosystemSnapshot, requirements: readonly OpenOracleApprovalRequirement[]) {
	const count = requirements.filter(requirement => exactPreviousApproval(previousPlan, snapshot, requirement) !== undefined).length
	return count === 0 ? undefined : count
}

function contributionFunding(snapshot: EcosystemSnapshot, tokenAddress: `0x${string}`, required: bigint, options: PlanningOptions) {
	const inventory = tokenInventory(snapshot, tokenAddress)
	const internalCredit = tokenAddress === zeroAddress ? amount(snapshot.wallet.openOracleEthCredit) : amount(inventory?.openOracleCredit ?? '0')
	const internalAvailable = internalCredit <= 1n ? 0n : internalCredit - 1n
	const internalRequired = required < internalAvailable ? required : internalAvailable
	const externalRequired = required > internalAvailable ? required - internalAvailable : 0n
	const isNative = tokenAddress === zeroAddress
	const isRep = snapshot.universes.some(universe => universe.repToken.toLowerCase() === tokenAddress.toLowerCase())
	let reserve = 1n
	if (isNative) reserve = optionAmount(options, 'minimumEthReserveAttoEth', 10n ** 16n)
	else if (isRep) reserve = optionAmount(options, 'minimumRepReserveAttoRep', ONE_TOKEN)
	const maximum = isRep ? optionAmount(options, 'maxRepSpendAttoRep', ONE_TOKEN) : optionAmount(options, 'maxEthSpendAttoEth', 10n ** 16n)
	const externalBalance = isNative ? amount(snapshot.wallet.ethBalanceAttoEth) : amount(inventory?.balance ?? '0')
	const combinedBalance = externalBalance + internalAvailable
	const fundingAffordable = isRep ? externalBalance >= externalRequired && (required === 0n || combinedBalance >= reserve + required) : externalRequired === 0n || externalBalance >= reserve + externalRequired
	return {
		affordable: required <= maximum && fundingAffordable,
		externalRequired,
		internalRequired,
		maximumWalletDebit: externalRequired,
	}
}

function disputeQuote(snapshot: EcosystemSnapshot, report: OracleGameSnapshot, options: PlanningOptions) {
	const old1 = amount(report.currentAmount1)
	const old2 = amount(report.currentAmount2)
	if (old1 === 0n || old2 === 0n) return undefined
	const halt = amount(report.escalationHalt)
	const multiplied = (old1 * BigInt(report.multiplier)) / 100n
	let new1 = old1 + 1n
	if (halt > old1) new1 = multiplied > halt ? halt : multiplied
	const reportSeed = Number(BigInt(report.reportId) & 0xffff_ffffn)
	const direction = mixSeed(reportSeed, `${report.reportId}:price`) % 2 === 0 ? 99n : 101n
	const quotedAmount2 = (old2 * new1 * direction) / (old1 * 100n)
	const new2 = quotedAmount2 === 0n ? 1n : quotedAmount2
	if (new1 === 0n || new1 > MAX_UINT128 || new2 > MAX_UINT128) return undefined
	const swapToken2 = new2 * old1 > old2 * new1
	const selfDispute = report.currentReporter.toLowerCase() === snapshot.wallet.address.toLowerCase()
	const protocolFeeBase = swapToken2 ? old2 : old1
	const fee = (protocolFeeBase * BigInt(report.game.feePercentage)) / 10_000_000n
	const protocolFee = (protocolFeeBase * BigInt(report.game.protocolFee)) / 10_000_000n
	let required1: bigint
	if (swapToken2) required1 = new1 - old1
	else if (selfDispute) required1 = new1 - old1 + protocolFee
	else required1 = new1 + old1 + fee + protocolFee
	let required2 = 0n
	if (swapToken2 && selfDispute) required2 = new2 + protocolFee > old2 ? new2 + protocolFee - old2 : 0n
	else if (swapToken2) required2 = new2 + old2 + fee + protocolFee
	else if (new2 > old2) required2 = new2 - old2
	const token1 = contributionFunding(snapshot, report.token1, required1, options)
	const token2 = contributionFunding(snapshot, report.token2, required2, options)
	return {
		affordable: token1.affordable && token2.affordable,
		external1: token1.externalRequired,
		external2: token2.externalRequired,
		internal1: token1.internalRequired,
		internal2: token2.internalRequired,
		maximumWalletDebit1: token1.maximumWalletDebit,
		maximumWalletDebit2: token2.maximumWalletDebit,
		new1,
		new2,
		selfDispute,
	}
}

function disputeWindow(snapshot: EcosystemSnapshot, report: OracleGameSnapshot, quote: NonNullable<ReturnType<typeof disputeQuote>>, options: PlanningOptions) {
	const prerequisites = approveToken(snapshot, report.token1, quote.external1).length + approveToken(snapshot, report.token2, quote.external2).length
	return reportWindow(snapshot, report, options, prerequisites)
}

function disputableReport(snapshot: EcosystemSnapshot, report: OracleGameSnapshot, options: PlanningOptions) {
	if (report.settlementTimestamp !== '0') return false
	const quote = disputeQuote(snapshot, report, options)
	if (quote === undefined || !quote.affordable) return false
	const window = disputeWindow(snapshot, report, quote, options)
	return window.current >= window.opened && window.current + window.safetyMargin < window.closes
}

function oracleGame(report: OracleGameSnapshot) {
	return {
		callbackContract: report.game.callbackContract,
		callbackGasLimit: report.game.callbackGasLimit,
		currentAmount1: BigInt(report.currentAmount1),
		currentAmount2: BigInt(report.currentAmount2),
		currentReporter: report.currentReporter,
		disputeDelay: BigInt(report.disputeDelay),
		escalationHalt: BigInt(report.escalationHalt),
		feePercentage: report.game.feePercentage,
		flags: report.flags,
		lastReportOppoTime: BigInt(report.game.lastReportOppoTime),
		multiplier: report.multiplier,
		numReports: report.game.numReports,
		protocolFee: report.game.protocolFee,
		protocolFeeRecipient: report.game.protocolFeeRecipient,
		reportTimestamp: BigInt(report.reportTimestamp),
		settlementTime: BigInt(report.settlementTime),
		settlementTimestamp: BigInt(report.settlementTimestamp),
		settlerReward: BigInt(report.game.settlerReward),
		token1: report.token1,
		token2: report.token2,
	}
}

function oracleHelper(report: OracleGameSnapshot) {
	return {
		blockNumber: BigInt(report.helper.blockNumber),
		blockTimestamp: BigInt(report.helper.blockTimestamp),
		creator: report.helper.creator,
		reportId: BigInt(report.reportId),
	}
}

const zeroTiming = { blockNumber: 0n, blockNumberBound: 0n, blockTimestamp: 0n, blockTimestampBound: 0n }

function wethDefinition(mode: 'wrap' | 'unwrap'): OperationDefinition {
	const id = `open-oracle.weth.${mode}`
	return {
		buildPlan(snapshot, options) {
			const value = mode === 'wrap' ? ethSpend(snapshot, options, id) : tokenSpend(snapshot, snapshot.deployments.weth, options, id)
			if (value === 0n) return undefined
			return planBase({
				definitionId: id,
				ecosystem: 'open-oracle',
				label: `${mode} WETH`,
				metadata: { amountAttoEth: value.toString() },
				postconditions: [mode === 'wrap' ? 'WETH increases and ETH decreases by the wrapped principal plus gas' : 'WETH decreases and ETH increases by the unwrapped principal less gas'],
				risk: 'low',
				snapshot,
				steps: [
					encodeStep({
						abi: wethAbi,
						args: mode === 'unwrap' ? [value] : undefined,
						evidence: [eventEvidence(snapshot.deployments.weth, mode === 'wrap' ? 'Deposit(address,uint256)' : 'Withdrawal(address,uint256)')],
						functionName: mode === 'wrap' ? 'deposit' : 'withdraw',
						id: mode,
						label: `${mode} WETH`,
						to: snapshot.deployments.weth,
						value: mode === 'wrap' ? value : undefined,
						walletAssetDebits: mode === 'unwrap' ? tokenDebit(snapshot, snapshot.deployments.weth, value) : [],
					}),
				],
			})
		},
		classification: 'selectable',
		contract: 'WETH9',
		description: `${mode === 'wrap' ? 'Wraps spendable ETH as WETH' : 'Returns a bounded WETH balance to ETH'}.`,
		discoveryInputs: ['ETH reserve', 'WETH balance', 'spend caps'],
		ecosystem: 'open-oracle',
		evaluate(snapshot, options) {
			const value = mode === 'wrap' ? ethSpend(snapshot, options, id) : tokenSpend(snapshot, snapshot.deployments.weth, options, id)
			return eligible(value === 0n ? `No ${mode === 'wrap' ? 'ETH' : 'WETH'} is spendable` : undefined)
		},
		id,
		label: `${mode} WETH`,
		method: mode === 'wrap' ? 'deposit' : 'withdraw',
		risk: 'low',
	}
}

const deposit: OperationDefinition = {
	buildPlan(snapshot, options) {
		const knownRep = new Set(snapshot.universes.map(universe => universe.repToken.toLowerCase()))
		const candidates = snapshot.wallet.tokens
			.filter(token => token.address.toLowerCase() === snapshot.deployments.weth.toLowerCase() || knownRep.has(token.address.toLowerCase()))
			.filter(token => tokenSpend(snapshot, token.address, options, `${deposit.id}:${token.address}`) > 0n)
			.map(token => ({ address: token.address, credit: token.openOracleCredit, spend: minAmount(tokenSpend(snapshot, token.address, options, `${deposit.id}:${token.address}`), MAX_UINT128) }))
		const token = choose(candidates, mixSeed(options.seed, deposit.id))
		if (token === undefined) return undefined
		const spend = token.spend
		if (spend === 0n) return undefined
		const steps = approveToken(snapshot, token.address, spend)
		steps.push(
			encodeStep({
				abi: openOracleAbi,
				args: [token.address, spend, snapshot.wallet.address],
				evidence: [tokenHolderEvidence(snapshot, token.address, amount(token.credit) === 0n ? spend + 1n : amount(token.credit) + spend)],
				functionName: 'deposit',
				id: 'deposit',
				label: 'Deposit into OpenOracle internal balance',
				to: snapshot.deployments.openOracle,
				walletAssetDebits: tokenDebit(snapshot, token.address, spend),
			}),
		)
		return planBase({
			definitionId: deposit.id,
			ecosystem: 'open-oracle',
			label: deposit.label,
			maximumCleanupTransactionCount: steps.length > 1 ? steps.length - 1 : undefined,
			metadata: { amount: spend.toString(), openOracle: snapshot.deployments.openOracle, token: token.address },
			postconditions: ['OpenOracle internal credit increases by the deposited amount'],
			risk: 'medium',
			snapshot,
			steps,
		})
	},
	buildContinuationPlan(snapshot, options, context) {
		const spend = requiredMetadataAmount(context.previousPlan.metadata, 'amount')
		const token = requiredMetadataAddress(context.previousPlan.metadata, 'token')
		const openOracle = requiredMetadataAddress(context.previousPlan.metadata, 'openOracle')
		const requirement = { id: `approve-${token}`, required: spend, spender: openOracle, token }
		const requirements = [requirement]
		const cleanup = () => openOracleCleanupPlan(snapshot, context, requirements, 'Clean up OpenOracle deposit approval', 'medium')
		if (context.continuationDisposition === 'cleanup-only') return cleanup()
		const inventory = tokenInventory(snapshot, token)
		const knownRep = snapshot.universes.some(universe => universe.repToken.toLowerCase() === token.toLowerCase())
		const canonicalToken = token.toLowerCase() === snapshot.deployments.weth.toLowerCase() || knownRep
		const reserve = knownRep ? optionAmount(options, 'minimumRepReserveAttoRep', ONE_TOKEN) : 1n
		const maximum = knownRep ? optionAmount(options, 'maxRepSpendAttoRep', ONE_TOKEN) : optionAmount(options, 'maxEthSpendAttoEth', 10n ** 16n)
		if (snapshot.deployments.openOracle.toLowerCase() !== openOracle.toLowerCase() || !canonicalToken || spend === 0n || spend > MAX_UINT128 || spend > maximum || inventory === undefined || amount(inventory.balance) < reserve + spend || !preparedApprovalState(snapshot, context, requirements)) return cleanup()
		const steps = remainingApprovalSteps(snapshot, context, requirements)
		steps.push(
			encodeStep({
				abi: openOracleAbi,
				args: [token, spend, snapshot.wallet.address],
				evidence: [tokenHolderEvidence(snapshot, token, amount(inventory.openOracleCredit) === 0n ? spend + 1n : amount(inventory.openOracleCredit) + spend)],
				functionName: 'deposit',
				id: 'deposit',
				label: 'Deposit into OpenOracle internal balance',
				to: openOracle,
				walletAssetDebits: tokenDebit(snapshot, token, spend),
			}),
		)
		return planBase({
			definitionId: deposit.id,
			ecosystem: 'open-oracle',
			label: deposit.label,
			maximumCleanupTransactionCount: maximumCleanupCount(context.previousPlan, snapshot, requirements),
			metadata: context.previousPlan.metadata,
			postconditions: ['OpenOracle internal credit increases by the deposited amount'],
			risk: 'medium',
			snapshot,
			steps,
		})
	},
	classification: 'selectable',
	contract: 'OpenOracle',
	description: 'Deposits bounded canonical WETH or REP into wallet-owned OpenOracle credit. Native deposits are intentionally unavailable because native credit has no exactly verifiable automated sweep.',
	discoveryInputs: ['canonical WETH/REP balances, reserves, caps, and OpenOracle allowances'],
	ecosystem: 'open-oracle',
	evaluate(snapshot, options) {
		const knownRep = new Set(snapshot.universes.map(universe => universe.repToken.toLowerCase()))
		const found = snapshot.wallet.tokens.some(token => (token.address.toLowerCase() === snapshot.deployments.weth.toLowerCase() || knownRep.has(token.address.toLowerCase())) && tokenSpend(snapshot, token.address, options, `${deposit.id}:${token.address}`) > 0n)
		return eligible(found ? undefined : 'No canonical WETH or REP balance is spendable within its reserve and operation cap; native deposits are intentionally unavailable')
	},
	id: 'open-oracle.deposit',
	label: 'Deposit OpenOracle credit',
	method: 'deposit',
	risk: 'medium',
}

function creditDefinition(mode: 'withdraw' | 'withdraw-to' | 'push-or-credit'): OperationDefinition {
	const id = `open-oracle.${mode}`
	const method = {
		'push-or-credit': 'pushOrCredit',
		withdraw: 'withdraw',
		'withdraw-to': 'withdrawTo',
	}[mode]
	const candidates = (snapshot: EcosystemSnapshot) => {
		const knownRep = new Set(snapshot.universes.map(universe => universe.repToken.toLowerCase()))
		const tokens = snapshot.wallet.tokens.filter(token => amount(token.openOracleCredit) > 1n && (token.address.toLowerCase() === snapshot.deployments.weth.toLowerCase() || knownRep.has(token.address.toLowerCase()))).map(token => ({ address: token.address, credit: token.openOracleCredit }))
		return tokens
	}
	const build = (snapshot: EcosystemSnapshot, options: PlanningOptions, token: ReturnType<typeof candidates>[number]) => {
		const tokenAddress = token.address
		const creditBefore = amount(token.credit)
		const available = creditBefore - 1n
		const spend = available > ONE_TOKEN ? ONE_TOKEN : available
		const pushVariantSeed = mixSeed(options.seed, `${id}:overload`)
		const useCustomPushGasLimit = mode === 'push-or-credit' && pushVariantSeed % 2 === 1
		const customPushGasLimit = MINIMUM_CUSTOM_PUSH_OR_CREDIT_GAS_LIMIT + (BigInt(mixSeed(options.seed, `${id}:gas-limit`)) % (MAXIMUM_CUSTOM_PUSH_OR_CREDIT_GAS_LIMIT - MINIMUM_CUSTOM_PUSH_OR_CREDIT_GAS_LIMIT + 1n))
		const pushGasLimit = useCustomPushGasLimit ? customPushGasLimit : DEFAULT_PUSH_OR_CREDIT_GAS_LIMIT
		const args = (() => {
			if (mode === 'withdraw') return [tokenAddress, spend] as const
			if (mode === 'withdraw-to') return [tokenAddress, spend, snapshot.wallet.address] as const
			if (useCustomPushGasLimit) return [tokenAddress, snapshot.wallet.address, spend, pushGasLimit] as const
			return [tokenAddress, snapshot.wallet.address, spend] as const
		})()
		const evidence: OperationEvidence[] = [tokenHolderEvidence(snapshot, tokenAddress, creditBefore - spend), exactTokenTransferEvidence(snapshot, tokenAddress, spend)]
		const preflightCalls =
			mode === 'withdraw' || mode === 'withdraw-to'
				? [
						encodePreflightCall({
							abi: openOracleAbi,
							args,
							caller: snapshot.wallet.address,
							expectedResult: encodeAbiParameters([{ type: 'uint256' }], [spend]),
							functionName: method,
							label: `Prove the fixed OpenOracle ${mode === 'withdraw-to' ? 'self-recipient withdrawal' : 'withdrawal'} still debits its full amount`,
							to: snapshot.deployments.openOracle,
						}),
					]
				: []
		let methodSignature = 'pushOrCredit(address,address,uint128)'
		if (mode === 'withdraw') methodSignature = 'withdraw(address,uint256)'
		else if (mode === 'withdraw-to') methodSignature = 'withdrawTo(address,uint256,address)'
		else if (useCustomPushGasLimit) methodSignature = 'pushOrCredit(address,address,uint128,uint32)'
		const stepId = useCustomPushGasLimit ? `${mode}-custom-gas` : mode
		const label = {
			'push-or-credit': 'Push or credit OpenOracle balance',
			withdraw: 'Withdraw OpenOracle credit',
			'withdraw-to': 'Withdraw OpenOracle credit to self',
		}[mode]
		return planBase({
			definitionId: id,
			ecosystem: 'open-oracle',
			label,
			lastValidBlockNumber: (BigInt(snapshot.anchor.blockNumber) + 1n).toString(),
			metadata: { amount: spend.toString(), creditBefore: creditBefore.toString(), methodSignature, recipient: snapshot.wallet.address, token: tokenAddress, ...(mode === 'push-or-credit' ? { forwardedGasLimit: pushGasLimit.toString() } : {}) },
			postconditions: ['Internal credit decreases and the configured wallet receives the asset externally or as fallback credit'],
			priority: 'random',
			risk: 'low',
			snapshot,
			steps: [
				encodeStep({
					abi: openOracleAbi,
					args,
					evidence,
					functionName: method,
					gasLimit: OPEN_ORACLE_CREDIT_STEP_GAS_LIMIT,
					id: stepId,
					label: methodSignature,
					preflightCalls,
					to: snapshot.deployments.openOracle,
				}),
			],
		})
	}
	return {
		buildPlan(snapshot, options) {
			const token = choose(candidates(snapshot), mixSeed(options.seed, id))
			return token === undefined ? undefined : build(snapshot, options, token)
		},
		classification: 'selectable',
		contract: 'OpenOracle',
		description: `${mode === 'withdraw-to' ? 'withdraw-to with the configured wallet fixed as recipient' : mode} from wallet-owned WETH or REP OpenOracle internal credit. Native credit withdrawal/push is excluded because the contract emits no exact native-transfer evidence.`,
		discoveryInputs: ['OpenOracle tokenHolder balances'],
		ecosystem: 'open-oracle',
		evaluate(snapshot) {
			const knownRep = new Set(snapshot.universes.map(universe => universe.repToken.toLowerCase()))
			const found = snapshot.wallet.tokens.some(token => amount(token.openOracleCredit) > 1n && (token.address.toLowerCase() === snapshot.deployments.weth.toLowerCase() || knownRep.has(token.address.toLowerCase())))
			return eligible(found ? undefined : 'No withdrawable OpenOracle credit')
		},
		id,
		label: mode,
		method,
		risk: 'low',
	}
}

const dust: OperationDefinition = {
	buildPlan(snapshot) {
		const rep = snapshot.universes.find(universe => universe.id === '0')?.repToken
		if (rep === undefined) return undefined
		const wethCredit = amount(tokenInventory(snapshot, snapshot.deployments.weth)?.openOracleCredit ?? '0')
		const repCredit = amount(tokenInventory(snapshot, rep)?.openOracleCredit ?? '0')
		if (wethCredit > 0n && repCredit > 0n) return undefined
		return planBase({
			definitionId: dust.id,
			ecosystem: 'open-oracle',
			label: dust.label,
			metadata: { token1: snapshot.deployments.weth, token2: rep },
			postconditions: ['Both internal token slots contain their one-unit sentinel'],
			risk: 'low',
			snapshot,
			steps: [
				encodeStep({
					abi: openOracleAbi,
					args: [snapshot.deployments.weth, rep],
					evidence: [snapshot.deployments.weth, rep].map(token => {
						const credit = amount(tokenInventory(snapshot, token)?.openOracleCredit ?? '0')
						return tokenHolderEvidence(snapshot, token, credit > 0n ? credit : 1n)
					}),
					functionName: 'dust',
					id: 'dust',
					label: 'Initialize OpenOracle dust sentinels',
					to: snapshot.deployments.openOracle,
				}),
			],
		})
	},
	classification: 'selectable',
	contract: 'OpenOracle',
	description: 'Idempotently initializes OpenOracle internal balance sentinels for WETH and REP.',
	discoveryInputs: ['root-universe REP token', 'WETH deployment'],
	ecosystem: 'open-oracle',
	evaluate(snapshot) {
		const rep = snapshot.universes.find(universe => universe.id === '0')?.repToken
		if (rep === undefined) return eligible('Root universe is unavailable')
		const initialized = amount(tokenInventory(snapshot, snapshot.deployments.weth)?.openOracleCredit ?? '0') > 0n && amount(tokenInventory(snapshot, rep)?.openOracleCredit ?? '0') > 0n
		return eligible(initialized ? 'Both OpenOracle dust sentinels are already initialized' : undefined)
	},
	id: 'open-oracle.dust',
	label: 'Initialize OpenOracle dust',
	method: 'dust',
	risk: 'low',
}

const report: OperationDefinition = {
	buildPlan(snapshot, options) {
		if (hasActiveSignerReport(snapshot)) return undefined
		const rep = snapshot.universes[0]?.repToken
		if (rep === undefined) return undefined
		const amount1 = minAmount(tokenSpend(snapshot, snapshot.deployments.weth, options, 'report-weth'), MAX_UINT128 / 100n)
		const amount2 = minAmount(tokenSpend(snapshot, rep, options, 'report-rep'), MAX_UINT128)
		if (amount1 === 0n || amount2 === 0n) return undefined
		const params = {
			callbackContract: zeroAddress,
			callbackGasLimit: 0,
			currentAmount1: amount1,
			currentAmount2: amount2,
			currentReporter: snapshot.wallet.address,
			disputeDelay: 60,
			escalationHalt: amount1 * 100n,
			feePercentage: 0,
			flags: 7,
			lastReportOppoTime: 0,
			multiplier: 140,
			numReports: 0,
			protocolFee: 0,
			protocolFeeRecipient: zeroAddress,
			reportTimestamp: 0,
			settlementTime: 900,
			settlementTimestamp: 0,
			settlerReward: 0,
			token1: snapshot.deployments.weth,
			token2: rep,
		}
		const steps = approveToken(snapshot, snapshot.deployments.weth, amount1)
		steps.push(...approveToken(snapshot, rep, amount2))
		steps.push(
			encodeStep({
				abi: openOracleAbi,
				args: [params, false, false, zeroTiming],
				evidence: [eventEvidence(snapshot.deployments.openOracle, 'ReportSubmitted(uint256,bytes)')],
				functionName: 'report',
				id: 'report',
				label: 'Submit OpenOracle report',
				to: snapshot.deployments.openOracle,
				walletAssetDebits: [...tokenDebit(snapshot, snapshot.deployments.weth, amount1), ...tokenDebit(snapshot, rep, amount2)],
			}),
		)
		return planBase({
			definitionId: report.id,
			ecosystem: 'open-oracle',
			label: report.label,
			maximumCleanupTransactionCount: steps.length > 1 ? steps.length - 1 : undefined,
			metadata: { amount1: amount1.toString(), amount2: amount2.toString(), openOracle: snapshot.deployments.openOracle, token1: snapshot.deployments.weth, token2: rep },
			postconditions: ['ReportSubmitted identifies a new indexed report that becomes a settlement obligation'],
			risk: 'high',
			snapshot,
			steps,
		})
	},
	buildContinuationPlan(snapshot, options, context) {
		const amount1 = requiredMetadataAmount(context.previousPlan.metadata, 'amount1')
		const amount2 = requiredMetadataAmount(context.previousPlan.metadata, 'amount2')
		const openOracle = requiredMetadataAddress(context.previousPlan.metadata, 'openOracle')
		const token1 = requiredMetadataAddress(context.previousPlan.metadata, 'token1')
		const token2 = requiredMetadataAddress(context.previousPlan.metadata, 'token2')
		const requirements = [
			{ id: `approve-${token1}`, required: amount1, spender: openOracle, token: token1 },
			{ id: `approve-${token2}`, required: amount2, spender: openOracle, token: token2 },
		]
		const cleanup = () => openOracleCleanupPlan(snapshot, context, requirements, 'Clean up OpenOracle report approvals', 'high')
		if (context.continuationDisposition === 'cleanup-only') return cleanup()
		const rootRep = snapshot.universes[0]?.repToken
		const token1Inventory = tokenInventory(snapshot, token1)
		const token2Inventory = tokenInventory(snapshot, token2)
		const safe =
			options.allowHighRisk === true &&
			!hasActiveSignerReport(snapshot) &&
			snapshot.deployments.openOracle.toLowerCase() === openOracle.toLowerCase() &&
			snapshot.deployments.weth.toLowerCase() === token1.toLowerCase() &&
			rootRep?.toLowerCase() === token2.toLowerCase() &&
			amount1 > 0n &&
			amount1 <= MAX_UINT128 / 100n &&
			amount2 > 0n &&
			amount2 <= MAX_UINT128 &&
			amount1 <= optionAmount(options, 'maxEthSpendAttoEth', 10n ** 16n) &&
			amount2 <= optionAmount(options, 'maxRepSpendAttoRep', ONE_TOKEN) &&
			token1Inventory !== undefined &&
			amount(token1Inventory.balance) >= amount1 + 1n &&
			token2Inventory !== undefined &&
			amount(token2Inventory.balance) >= amount2 + optionAmount(options, 'minimumRepReserveAttoRep', ONE_TOKEN) &&
			preparedApprovalState(snapshot, context, requirements)
		if (!safe) return cleanup()
		const params = {
			callbackContract: zeroAddress,
			callbackGasLimit: 0,
			currentAmount1: amount1,
			currentAmount2: amount2,
			currentReporter: snapshot.wallet.address,
			disputeDelay: 60,
			escalationHalt: amount1 * 100n,
			feePercentage: 0,
			flags: 7,
			lastReportOppoTime: 0,
			multiplier: 140,
			numReports: 0,
			protocolFee: 0,
			protocolFeeRecipient: zeroAddress,
			reportTimestamp: 0,
			settlementTime: 900,
			settlementTimestamp: 0,
			settlerReward: 0,
			token1,
			token2,
		}
		const steps = remainingApprovalSteps(snapshot, context, requirements)
		steps.push(
			encodeStep({
				abi: openOracleAbi,
				args: [params, false, false, zeroTiming],
				evidence: [eventEvidence(openOracle, 'ReportSubmitted(uint256,bytes)')],
				functionName: 'report',
				id: 'report',
				label: 'Submit OpenOracle report',
				to: openOracle,
				walletAssetDebits: [...tokenDebit(snapshot, token1, amount1), ...tokenDebit(snapshot, token2, amount2)],
			}),
		)
		return planBase({
			definitionId: report.id,
			ecosystem: 'open-oracle',
			label: report.label,
			maximumCleanupTransactionCount: maximumCleanupCount(context.previousPlan, snapshot, requirements),
			metadata: context.previousPlan.metadata,
			postconditions: ['ReportSubmitted identifies a new indexed report that becomes a settlement obligation'],
			risk: 'high',
			snapshot,
			steps,
		})
	},
	classification: 'selectable',
	contract: 'OpenOracle',
	description: 'Creates a bounded, stored, timestamp-clock WETH/REP report with recoverable preimage data.',
	discoveryInputs: ['WETH and REP balances/allowances', 'durable report index'],
	ecosystem: 'open-oracle',
	evaluate(snapshot, options) {
		const rep = snapshot.universes[0]?.repToken
		return eligible(
			options.allowHighRisk === true ? undefined : 'High-risk operations are disabled',
			hasActiveSignerReport(snapshot) ? 'A signer-created OpenOracle report is still unresolved' : undefined,
			rep === undefined ? 'Root REP is unavailable' : undefined,
			minAmount(tokenSpend(snapshot, snapshot.deployments.weth, options, 'report-weth'), MAX_UINT128 / 100n) === 0n ? 'No WETH is spendable within policy and uint128 report bounds' : undefined,
			rep === undefined || minAmount(tokenSpend(snapshot, rep, options, 'report-rep'), MAX_UINT128) === 0n ? 'No REP is spendable within policy and uint128 report bounds' : undefined,
		)
	},
	id: 'open-oracle.report',
	label: 'Submit OpenOracle report',
	method: 'report',
	risk: 'high',
}

function reportOperation(mode: 'dispute' | 'settle'): OperationDefinition {
	const id = `open-oracle.${mode}`
	const candidates = (snapshot: EcosystemSnapshot, options: PlanningOptions) => {
		const trustedReport = trustedReportPredicate(snapshot)
		return snapshot.reports.filter(candidate => {
			if (!trustedReport(candidate)) return false
			if (candidate.settlementTimestamp !== '0') return false
			if (mode === 'dispute') return disputableReport(snapshot, candidate, options)
			const window = reportWindow(snapshot, candidate, options)
			return window.current >= window.closes
		})
	}
	const build = (snapshot: EcosystemSnapshot, options: PlanningOptions, selected: OracleGameSnapshot) => {
		let args: readonly unknown[]
		let steps: OperationStep[] = []
		if (mode === 'settle') args = [BigInt(selected.reportId), oracleGame(selected), oracleHelper(selected)]
		else {
			const quote = disputeQuote(snapshot, selected, options)
			if (quote === undefined || !quote.affordable) return undefined
			steps = approveToken(snapshot, selected.token1, quote.external1)
			steps.push(...approveToken(snapshot, selected.token2, quote.external2))
			args = [BigInt(selected.reportId), quote.new1, quote.new2, snapshot.wallet.address, true, true, oracleGame(selected), oracleHelper(selected), zeroTiming]
		}
		const quote = mode === 'dispute' ? disputeQuote(snapshot, selected, options) : undefined
		if (mode === 'dispute' && quote === undefined) return undefined
		const nativeValue = quote === undefined ? 0n : (selected.token1 === zeroAddress ? quote.maximumWalletDebit1 : 0n) + (selected.token2 === zeroAddress ? quote.maximumWalletDebit2 : 0n)
		steps.push(
			encodeStep({
				abi: openOracleAbi,
				args,
				evidence: [eventEvidence(selected.openOracle, mode === 'settle' ? 'ReportSettled(uint256)' : 'ReportDisputed(uint256,bytes)')],
				functionName: mode,
				id: `${mode}-${selected.reportId}`,
				label: `${mode} report ${selected.reportId}`,
				to: selected.openOracle,
				gasLimit: mode === 'settle' ? OPEN_ORACLE_SETTLEMENT_STEP_GAS_LIMIT : undefined,
				value: nativeValue > 0n ? nativeValue : undefined,
				walletAssetDebits: quote === undefined ? [] : [...creditDebit(snapshot, selected.token1, quote.internal1), ...creditDebit(snapshot, selected.token2, quote.internal2), ...tokenDebit(snapshot, selected.token1, quote.maximumWalletDebit1), ...tokenDebit(snapshot, selected.token2, quote.maximumWalletDebit2)],
			}),
		)
		const window = mode === 'dispute' && quote !== undefined ? disputeWindow(snapshot, selected, quote, options) : reportWindow(snapshot, selected, options)
		return planBase({
			deadlineTimestamp: mode === 'dispute' && window.timestampClock ? window.closes.toString() : undefined,
			definitionId: id,
			ecosystem: 'open-oracle',
			label: `${mode} OpenOracle report`,
			lastValidBlockNumber: mode === 'dispute' && !window.timestampClock ? (window.closes - 1n).toString() : undefined,
			maximumCleanupTransactionCount: mode === 'dispute' && steps.length > 1 ? steps.length - 1 : undefined,
			semanticDeadlineBlockNumber: mode === 'dispute' && !window.timestampClock ? (window.closes - 1n).toString() : undefined,
			metadata: {
				deadlineBlock: mode === 'dispute' && !window.timestampClock ? (window.closes - 1n).toString() : '0',
				...(quote === undefined
					? {}
					: {
							external1: quote.external1.toString(),
							external2: quote.external2.toString(),
							internal1: quote.internal1.toString(),
							internal2: quote.internal2.toString(),
							newAmount1: quote.new1.toString(),
							newAmount2: quote.new2.toString(),
							openOracle: selected.openOracle,
							token1: selected.token1,
							token2: selected.token2,
						}),
				reportId: selected.reportId,
				selfDispute: quote?.selfDispute ?? false,
				stateHash: selected.stateHash,
			},
			postconditions: [mode === 'settle' ? 'The report state has a nonzero settlement timestamp and ReportSettled is emitted' : 'The indexed report preimage advances to the disputed state'],
			priority: mode === 'settle' ? 'urgent' : 'random',
			risk: mode === 'settle' ? 'low' : 'high',
			snapshot,
			steps,
		})
	}
	const disputeContinuationMethods =
		mode === 'dispute'
			? {
					buildContinuationPlan(snapshot: EcosystemSnapshot, options: PlanningOptions, context: OperationContinuationContext) {
						const openOracle = requiredMetadataAddress(context.previousPlan.metadata, 'openOracle')
						const token1 = requiredMetadataAddress(context.previousPlan.metadata, 'token1')
						const token2 = requiredMetadataAddress(context.previousPlan.metadata, 'token2')
						const external1 = requiredMetadataAmount(context.previousPlan.metadata, 'external1')
						const external2 = requiredMetadataAmount(context.previousPlan.metadata, 'external2')
						const requirements = [...(external1 === 0n || token1 === zeroAddress ? [] : [{ id: `approve-${token1}`, required: external1, spender: openOracle, token: token1 }]), ...(external2 === 0n || token2 === zeroAddress ? [] : [{ id: `approve-${token2}`, required: external2, spender: openOracle, token: token2 }])]
						const cleanup = () => openOracleCleanupPlan(snapshot, context, requirements, 'Clean up OpenOracle dispute approvals', 'high')
						if (context.continuationDisposition === 'cleanup-only') return cleanup()
						const reportId = requiredMetadataString(context.previousPlan.metadata, 'reportId')
						const stateHash = requiredMetadataString(context.previousPlan.metadata, 'stateHash')
						const selected = snapshot.reports.find(candidate => candidate.reportId === reportId)
						const quote = selected === undefined ? undefined : disputeQuote(snapshot, selected, options)
						const quoteMatches =
							quote !== undefined &&
							quote.affordable &&
							quote.external1 === external1 &&
							quote.external2 === external2 &&
							quote.internal1 === requiredMetadataAmount(context.previousPlan.metadata, 'internal1') &&
							quote.internal2 === requiredMetadataAmount(context.previousPlan.metadata, 'internal2') &&
							quote.new1 === requiredMetadataAmount(context.previousPlan.metadata, 'newAmount1') &&
							quote.new2 === requiredMetadataAmount(context.previousPlan.metadata, 'newAmount2') &&
							quote.selfDispute === requiredMetadataBoolean(context.previousPlan.metadata, 'selfDispute')
						if (
							options.allowHighRisk !== true ||
							selected === undefined ||
							selected.stateHash !== stateHash ||
							selected.openOracle.toLowerCase() !== openOracle.toLowerCase() ||
							selected.token1.toLowerCase() !== token1.toLowerCase() ||
							selected.token2.toLowerCase() !== token2.toLowerCase() ||
							snapshot.deployments.openOracle.toLowerCase() !== openOracle.toLowerCase() ||
							!disputableReport(snapshot, selected, options) ||
							!quoteMatches ||
							!preparedApprovalState(snapshot, context, requirements)
						)
							return cleanup()
						const rebuilt = build(snapshot, options, selected)
						if (rebuilt === undefined) return cleanup()
						const freshApprovals = rebuilt.steps.filter(step => step.id.startsWith('approve-'))
						const cleanupCount = cleanupApprovalRequirements(snapshot, context, requirements).length + freshApprovals.length
						return {
							...rebuilt,
							...(cleanupCount === 0 ? {} : { maximumCleanupTransactionCount: cleanupCount }),
							metadata: context.previousPlan.metadata,
						}
					},
				}
			: {}
	const settlementPresence = (snapshot: EcosystemSnapshot, options: PlanningOptions) => {
		const trustedReport = trustedReportPredicate(snapshot)
		return snapshot.reports.flatMap(selected => {
			if (!trustedReport(selected)) return []
			if (selected.settlementTimestamp !== '0') return []
			const window = reportWindow(snapshot, selected, options)
			if (window.current < window.closes) return []
			return [{ deadlineBlock: '0', reportId: selected.reportId, selfDispute: false, stateHash: selected.stateHash }]
		})
	}
	const lifecycleMethods =
		mode === 'settle'
			? {
					buildLifecyclePlans(snapshot: EcosystemSnapshot, options: PlanningOptions) {
						return candidates(snapshot, options).flatMap(selected => {
							const plan = build(snapshot, options, selected)
							return plan === undefined ? [] : [plan]
						})
					},
					enumerateLifecycleObstructingPresence(snapshot: EcosystemSnapshot, options: PlanningOptions) {
						return settlementPresence(snapshot, options)
					},
					enumerateLifecyclePresence(snapshot: EcosystemSnapshot, options: PlanningOptions) {
						return settlementPresence(snapshot, options)
					},
				}
			: {}
	return {
		buildPlan(snapshot, options) {
			const selected = choose(candidates(snapshot, options), mixSeed(options.seed, id))
			return selected === undefined ? undefined : build(snapshot, options, selected)
		},
		classification: mode === 'settle' ? 'lifecycle-obligation' : 'selectable',
		contract: 'OpenOracle',
		description: `${mode === 'settle' ? 'Settles a due indexed report as a lifecycle obligation' : 'Randomly selects a permissionless dispute during its bounded window without creating a recursive lifecycle obligation'} using its exact stored preimage.`,
		discoveryInputs: ['indexed report preimages', 'anchor time', 'token balances and approvals'],
		ecosystem: 'open-oracle',
		evaluate(snapshot, options) {
			const trustedReport = trustedReportPredicate(snapshot)
			const found = snapshot.reports.some(candidate => {
				if (!trustedReport(candidate)) return false
				if (candidate.settlementTimestamp !== '0') return false
				if (mode === 'dispute') return disputableReport(snapshot, candidate, options)
				const window = reportWindow(snapshot, candidate, options)
				return window.current >= window.closes
			})
			return eligible(mode === 'dispute' && options.allowHighRisk !== true ? 'High-risk operations are disabled' : undefined, found ? undefined : `No report is ready to ${mode}`)
		},
		id,
		label: `${mode} report`,
		method: mode,
		risk: mode === 'settle' ? 'low' : 'high',
		...disputeContinuationMethods,
		...lifecycleMethods,
	}
}

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

const approveInternal: OperationDefinition = {
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

const approveWeth: OperationDefinition = {
	buildPlan: () => undefined,
	classification: 'prerequisite',
	contract: 'WETH9',
	description: 'A bounded exact WETH allowance is automatically composed into OpenOracle and coordinator workflows.',
	discoveryInputs: ['WETH allowances', 'selected workflow WETH requirement'],
	ecosystem: 'open-oracle',
	evaluate: () => disabled('Prerequisites are composed into selectable plans'),
	id: 'token.weth.approve',
	label: 'Approve WETH',
	method: 'approve',
	risk: 'medium',
}

export const OPEN_ORACLE_OPERATIONS: readonly OperationDefinition[] = [
	wethDefinition('wrap'),
	wethDefinition('unwrap'),
	deposit,
	creditDefinition('withdraw'),
	creditDefinition('withdraw-to'),
	creditDefinition('push-or-credit'),
	dust,
	report,
	reportOperation('dispute'),
	reportOperation('settle'),
	approveInternal,
	approveWeth,
]
