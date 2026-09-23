import { type Address, toHex, zeroAddress } from '@zoltar/bot-shared/ethereum'
import type { OperationPreflightCall, OperationStep } from '../operations/types.ts'
import { unsignedQuantity } from './safety.ts'
import { type ExecutionEnvironment, type CanonicalCallAnchor, OperationRediscoveryRequired } from './execution-context.ts'
import { exactAttestedSecurityPoolVaultRep, exactAttestedTokenBalance, exactAttestedOpenOracleCredit, exactAttestedErc1155Balance, agreedExactCall, agreedMaximumGasEstimate } from './execution-quorum.ts'

export async function assertFreshWalletAssetDebits(environment: ExecutionEnvironment, step: Pick<OperationStep, 'label' | 'walletAssetDebits'>, anchor: CanonicalCallAnchor) {
	const erc20Debits = new Map<string, { address: Address; amount: bigint; categories: Set<string> }>()
	const erc1155Debits = new Map<string, { address: Address; amount: bigint; tokenId: bigint }>()
	const securityPoolVaultDebits = new Map<string, { amount: bigint; pool: Address; vault: Address }>()
	const openOracleDebits = new Map<
		string,
		{
			amount: bigint
			asset: Address
			categories: Set<string>
			openOracle: Address
		}
	>()
	for (const debit of step.walletAssetDebits) {
		if (debit.kind === 'native') continue
		const amount = unsignedQuantity(debit.amount, `${step.label} wallet debit`)
		if (debit.kind === 'open-oracle-credit') {
			const asset = debit.asset === 'ETH' ? zeroAddress : debit.asset
			const key = `${debit.openOracle.toLowerCase()}:${asset.toLowerCase()}`
			const existing = openOracleDebits.get(key)
			if (existing === undefined) {
				openOracleDebits.set(key, {
					amount,
					asset,
					categories: new Set([debit.category]),
					openOracle: debit.openOracle,
				})
			} else {
				existing.amount += amount
				existing.categories.add(debit.category)
			}
			continue
		}
		if (debit.kind === 'security-pool-vault-rep') {
			const key = `${debit.pool.toLowerCase()}:${debit.vault.toLowerCase()}`
			const existing = securityPoolVaultDebits.get(key)
			if (existing === undefined) securityPoolVaultDebits.set(key, { amount, pool: debit.pool, vault: debit.vault })
			else existing.amount += amount
			continue
		}
		if (debit.kind === 'erc20') {
			const key = debit.asset.toLowerCase()
			const existing = erc20Debits.get(key)
			if (existing === undefined) {
				erc20Debits.set(key, {
					address: debit.asset,
					amount,
					categories: new Set([debit.category]),
				})
			} else {
				existing.amount += amount
				existing.categories.add(debit.category)
			}
			continue
		}
		const tokenId = unsignedQuantity(debit.tokenId, `${step.label} ERC-1155 token id`)
		const key = `${debit.asset.toLowerCase()}:${tokenId.toString()}`
		const existing = erc1155Debits.get(key)
		if (existing === undefined) {
			erc1155Debits.set(key, { address: debit.asset, amount, tokenId })
		} else {
			existing.amount += amount
		}
	}
	for (const debit of erc20Debits.values()) {
		if (debit.categories.size !== 1) {
			throw new Error(`${step.label} assigns conflicting categories to token ${debit.address}`)
		}
	}
	for (const debit of openOracleDebits.values()) {
		if (debit.categories.size !== 1) {
			throw new Error(`${step.label} assigns conflicting categories to OpenOracle credit ${debit.openOracle}/${debit.asset}`)
		}
		if (debit.categories.has('rep') && debit.asset === zeroAddress) {
			throw new Error(`${step.label} cannot classify native OpenOracle credit as REP`)
		}
	}
	for (const debit of securityPoolVaultDebits.values()) {
		const backing = await exactAttestedSecurityPoolVaultRep(environment, debit.pool, debit.vault, anchor)
		if (backing < debit.amount) {
			throw new OperationRediscoveryRequired(`${step.label} no longer has the declared SecurityPool vault REP backing for ${debit.pool}/${debit.vault}`)
		}
	}
	const repCreditAssets = new Set([...openOracleDebits.values()].flatMap(debit => (debit.categories.has('rep') ? [debit.asset.toLowerCase()] : [])))
	const tokenBalances = new Map<string, bigint>()
	for (const debit of erc20Debits.values()) {
		const balance = await exactAttestedTokenBalance(environment, debit.address, environment.sender, anchor)
		tokenBalances.set(debit.address.toLowerCase(), balance)
		const reserve = debit.categories.has('rep') && !repCreditAssets.has(debit.address.toLowerCase()) ? environment.settings.strategy.minimumRepReserveAttoRep : 0n
		if (balance < debit.amount + reserve) {
			throw new OperationRediscoveryRequired(`${step.label} would breach the fresh ${debit.categories.has('rep') ? 'REP reserve' : 'ERC-20 balance'} for ${debit.address}`)
		}
	}
	const creditBalances = new Map<string, bigint>()
	for (const debit of openOracleDebits.values()) {
		const credit = await exactAttestedOpenOracleCredit(environment, debit.openOracle, debit.asset, environment.sender, anchor)
		creditBalances.set(`${debit.openOracle.toLowerCase()}:${debit.asset.toLowerCase()}`, credit)
		if (credit <= debit.amount) {
			throw new OperationRediscoveryRequired(`${step.label} no longer has the declared OpenOracle credit plus its retained one-atto buffer`)
		}
	}
	for (const assetKey of repCreditAssets) {
		const creditDebits = [...openOracleDebits.values()].filter(debit => debit.categories.has('rep') && debit.asset.toLowerCase() === assetKey)
		const asset = creditDebits[0]?.asset
		if (asset === undefined) throw new Error(`${step.label} is missing its declared OpenOracle REP asset`)
		const walletDebit = erc20Debits.get(assetKey)?.amount ?? 0n
		let walletBalance = tokenBalances.get(assetKey)
		if (walletBalance === undefined) {
			walletBalance = await exactAttestedTokenBalance(environment, asset, environment.sender, anchor)
			tokenBalances.set(assetKey, walletBalance)
		}
		let internalBalance = 0n
		let internalDebit = 0n
		for (const debit of creditDebits) {
			const credit = creditBalances.get(`${debit.openOracle.toLowerCase()}:${assetKey}`)
			if (credit === undefined) throw new Error(`${step.label} is missing its fresh OpenOracle REP credit`)
			internalBalance += credit <= 1n ? 0n : credit - 1n
			internalDebit += debit.amount
		}
		const reserve = environment.settings.strategy.minimumRepReserveAttoRep
		if (walletBalance + internalBalance < walletDebit + internalDebit + reserve) {
			throw new OperationRediscoveryRequired(`${step.label} would breach the fresh combined wallet and OpenOracle REP reserve for ${asset}`)
		}
	}
	for (const debit of erc1155Debits.values()) {
		const balance = await exactAttestedErc1155Balance(environment, debit.address, environment.sender, debit.tokenId, anchor)
		if (balance < debit.amount) {
			throw new OperationRediscoveryRequired(`${step.label} no longer has the declared outcome-share balance`)
		}
	}
}

function preflightTransaction(call: OperationPreflightCall) {
	return {
		data: call.data,
		from: call.caller,
		to: call.to,
		value: toHex(unsignedQuantity(call.value, `${call.label} value`)),
	}
}

export async function assertStepPreflightCalls(environment: ExecutionEnvironment, step: Pick<OperationStep, 'label' | 'preflightCalls'>, anchor: CanonicalCallAnchor) {
	for (const call of step.preflightCalls) {
		try {
			const result = await agreedExactCall(environment, `${step.label} downstream preflight: ${call.label}`, preflightTransaction(call), anchor)
			if (result.toLowerCase() !== call.expectedResult.toLowerCase()) {
				throw new OperationRediscoveryRequired(`${step.label} downstream call returned a different semantic result at the canonical pre-signing block: ${call.label}`)
			}
		} catch (error) {
			if (error instanceof OperationRediscoveryRequired) throw error
			if (executionRevert(error)) {
				throw new OperationRediscoveryRequired(`${step.label} downstream call no longer succeeds at the canonical pre-signing block: ${call.label}`, error)
			}
			throw error
		}
	}
}

async function agreedSimulationAndGas(environment: ExecutionEnvironment, step: OperationStep, anchor: CanonicalCallAnchor) {
	const account = environment.sender
	const value = unsignedQuantity(step.value, `${step.label} value`)
	const gasLimit = unsignedQuantity(step.gasLimit, `${step.label} gas limit`)
	const rpcTransaction = {
		from: account,
		data: step.data,
		gas: toHex(gasLimit),
		to: step.to,
		value: toHex(value),
	}
	await agreedExactCall(environment, `${step.label} exact simulation`, rpcTransaction, anchor)
	return await agreedMaximumGasEstimate(environment, `${step.label} gas estimate`, rpcTransaction, anchor)
}

function executionRevert(error: unknown) {
	return error instanceof Error && /(?:execution reverted|\brevert(?:ed|ing)?\b|always failing transaction)/i.test(error.message)
}

export async function rediscoverableSimulationAndGas(environment: ExecutionEnvironment, step: OperationStep, anchor: CanonicalCallAnchor) {
	try {
		return await agreedSimulationAndGas(environment, step, anchor)
	} catch (error) {
		if (executionRevert(error)) {
			throw new OperationRediscoveryRequired(`${step.label} no longer succeeds at the canonical pre-signing block`, error)
		}
		throw error
	}
}
