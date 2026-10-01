import { openOracleAbi } from '@zoltar/bot-shared/contracts/abi'
import { tokenSpend } from '../input-funding.ts'
import { inputMatches } from '../input-values.ts'
import { amount, choose, eligible, encodeStep, mixSeed, ONE_TOKEN, optionAmount, planBase, tokenInventory } from '../planning.ts'
import type { OperationDefinition } from '../types.ts'
import { approveToken, maximumCleanupCount, openOracleCleanupPlan, preparedApprovalState, remainingApprovalSteps, requiredMetadataAddress, requiredMetadataAmount } from './approvals.ts'
import { MAX_UINT128, minAmount, tokenDebit, tokenHolderEvidence } from './planning.ts'

export const deposit: OperationDefinition = {
	buildPlan(snapshot, options) {
		const knownRep = new Set(snapshot.universes.map(universe => universe.repToken.toLowerCase()))
		const candidates = snapshot.wallet.tokens
			.filter(token => inputMatches(options, 'token', token.address))
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

export const dust: OperationDefinition = {
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
