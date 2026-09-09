import { inputSpend } from './input-values.ts'
import { amount, cappedSpend, mixSeed, ONE_TOKEN, optionAmount, tokenInventory } from './planning.ts'
import type { EcosystemSnapshot, PlanningOptions, PoolSnapshot } from './types.ts'

export function ethSpend(snapshot: EcosystemSnapshot, options: PlanningOptions, salt: string, minimum = 1n) {
	return inputSpend(
		options,
		cappedSpend(amount(snapshot.wallet.ethBalanceAttoEth), optionAmount(options, 'minimumEthReserveAttoEth', 10n ** 16n), optionAmount(options, 'maxEthSpendAttoEth', 10n ** 16n), mixSeed(options.seed, salt), minimum),
		amount(snapshot.wallet.ethBalanceAttoEth),
		optionAmount(options, 'minimumEthReserveAttoEth', 10n ** 16n),
		optionAmount(options, 'maxEthSpendAttoEth', 10n ** 16n),
		minimum,
	)
}

export function repSpend(snapshot: EcosystemSnapshot, pool: Pick<PoolSnapshot, 'repToken'>, options: PlanningOptions, salt: string, minimum = 1n) {
	const token = tokenInventory(snapshot, pool.repToken)
	return inputSpend(
		options,
		cappedSpend(token === undefined ? 0n : amount(token.balance), optionAmount(options, 'minimumRepReserveAttoRep', ONE_TOKEN), optionAmount(options, 'maxRepSpendAttoRep', ONE_TOKEN), mixSeed(options.seed, salt), minimum),
		token === undefined ? 0n : amount(token.balance),
		optionAmount(options, 'minimumRepReserveAttoRep', ONE_TOKEN),
		optionAmount(options, 'maxRepSpendAttoRep', ONE_TOKEN),
		minimum,
	)
}

export function tokenSpend(snapshot: EcosystemSnapshot, tokenAddress: `0x${string}`, options: PlanningOptions, salt: string, key = 'amount') {
	const token = tokenInventory(snapshot, tokenAddress)
	const isRep = snapshot.universes.some(universe => universe.repToken.toLowerCase() === tokenAddress.toLowerCase())
	const reserve = isRep ? optionAmount(options, 'minimumRepReserveAttoRep', ONE_TOKEN) : 1n
	const maximum = isRep ? optionAmount(options, 'maxRepSpendAttoRep', ONE_TOKEN) : optionAmount(options, 'maxEthSpendAttoEth', 10n ** 16n)
	return inputSpend(options, cappedSpend(token === undefined ? 0n : amount(token.balance), reserve, maximum, mixSeed(options.seed, salt)), token === undefined ? 0n : amount(token.balance), reserve, maximum, 1n, key)
}
