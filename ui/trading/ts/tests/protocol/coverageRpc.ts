import { encodeAbiParameters, parseAbiItem, toFunctionSelector, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'

/** A willing, liquid underwriter for transaction-routing RPC fixtures. */
export function coverageReadResult(data: Hex, vault: Address): Hex | undefined {
	const selector = data.slice(0, 10)
	const uint = (value: bigint) => encodeAbiParameters([{ type: 'uint256' }], [value])
	for (const signature of ['settlementCollateralAttoEth()', 'totalObligationUnits()', 'getVaultObligationUnits(address)']) if (selector === toFunctionSelector(parseAbiItem(`function ${signature}`))) return uint(0n)
	if (selector === toFunctionSelector(parseAbiItem('function statoblastSecurityMultiplierBps()'))) return uint(20_000n)
	if (selector === toFunctionSelector(parseAbiItem('function lastPrice()'))) return uint(10n ** 18n)
	if (selector === toFunctionSelector(parseAbiItem('function getVaultCount()'))) return uint(1n)
	if (selector === toFunctionSelector(parseAbiItem('function backingUnitsToAttoRep(uint256)'))) return uint(10n ** 30n)
	if (selector === toFunctionSelector(parseAbiItem('function priceOracleManagerAndOperatorQueuer()'))) return encodeAbiParameters([{ type: 'address' }], [vault])
	if (selector === toFunctionSelector(parseAbiItem('function getVaults(uint256,uint256)'))) return encodeAbiParameters([{ type: 'address[]' }], [[vault]])
	if (selector === toFunctionSelector(parseAbiItem('function coverageOffers(address)'))) return encodeAbiParameters([{ type: 'bool' }, { type: 'uint256' }, { type: 'uint256' }], [true, 10n ** 30n, 10_000n])
	if (selector === toFunctionSelector(parseAbiItem('function securityVaults(address)'))) return encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [10n ** 30n, 0n, 0n, 0n])
	return undefined
}
