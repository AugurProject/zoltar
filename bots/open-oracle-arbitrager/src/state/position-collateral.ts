import { formatUnits, getAddress, parseUnits, type Address } from '@zoltar/bot-shared/ethereum'
import { record } from '@zoltar/bot-shared/infrastructure/json-validation'
import { WETH_VALUATION, type CollateralValuation } from '#core/collateral-valuation'

/**
 * A position whose report collateral (`token1`) is not WETH. Its `lockedWeth`, `withdrawnWeth`, and `hedgeWeth` are then
 * amounts of `token` in its `decimals`; `capitalAtRiskWeth` and the profit fields stay in WETH, valued at entry with
 * `valuationAttoWeth` WETH base units per `valuationUnits` collateral base units.
 */
export type PositionCollateral = {
	decimals: number
	symbol: string
	token: Address
	valuationAttoWeth: string
	valuationUnits: string
}

type CollateralPosition = { collateral?: PositionCollateral | undefined }

/** The position's report `token1`: its recorded non-WETH collateral, or WETH. */
export function positionCollateralToken(position: CollateralPosition, weth: Address) {
	return position.collateral?.token ?? weth
}

/** Parses a `lockedWeth`/`withdrawnWeth`/`hedgeWeth` amount in the position's collateral base units. */
export function parsePositionCollateralAmount(position: CollateralPosition, value: string) {
	return parseUnits(value, position.collateral?.decimals ?? 18)
}

export function formatPositionCollateralAmount(position: CollateralPosition, amount: bigint) {
	return formatUnits(amount, position.collateral?.decimals ?? 18)
}

export function positionCollateralValuation(position: CollateralPosition): CollateralValuation {
	return position.collateral === undefined ? WETH_VALUATION : { attoWeth: BigInt(position.collateral.valuationAttoWeth), units: BigInt(position.collateral.valuationUnits) }
}

export function parsePositionCollateral(value: unknown): PositionCollateral | undefined {
	if (value === undefined) return undefined
	const fields = record(value, 'Position journal value', 'Position journal collateral is invalid')
	const exactKeys = ['decimals', 'symbol', 'token', 'valuationAttoWeth', 'valuationUnits']
	if (Object.keys(fields).length !== exactKeys.length || exactKeys.some(key => !(key in fields))) throw new Error('Position journal collateral fields are invalid')
	const decimals = fields['decimals']
	if (typeof decimals !== 'number' || !Number.isSafeInteger(decimals) || decimals < 0 || decimals > 18) throw new Error('Position journal collateral decimals are invalid')
	if (typeof fields['symbol'] !== 'string' || fields['symbol'].trim() === '') throw new Error('Position journal collateral symbol is invalid')
	if (typeof fields['token'] !== 'string') throw new Error('Position journal collateral token is invalid')
	for (const key of ['valuationAttoWeth', 'valuationUnits']) {
		const amount = fields[key]
		if (typeof amount !== 'string' || !/^[1-9]\d*$/.test(amount)) throw new Error(`Position journal collateral ${key} is invalid`)
	}
	return { decimals, symbol: fields['symbol'], token: getAddress(fields['token']), valuationAttoWeth: String(fields['valuationAttoWeth']), valuationUnits: String(fields['valuationUnits']) }
}
