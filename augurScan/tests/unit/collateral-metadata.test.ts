import { expect, test } from 'bun:test'
import { readContractCollateral, withCollateralIdentityCache } from '../../src/collateral-metadata.ts'
import { getAddress } from '../../src/ethereum.ts'
import type { StateRead } from '../../src/snapshots.ts'

const pool = getAddress('0x1111111111111111111111111111111111111111')
const portfolio = getAddress('0x2222222222222222222222222222222222222222')
const factory = getAddress('0x3333333333333333333333333333333333333333')
const token = getAddress('0x4444444444444444444444444444444444444444')

for (const kind of ['securityPool', 'securityPoolPortfolio', 'sharedPoolPriceFeed', 'priceCoordinator', 'twoWayConstantProductPair', 'securityPoolPortfolioServices'])
	test(`${kind} resolves pool collateral through its authenticated dependencies`, async () => {
		const calls: string[] = []
		const read: StateRead = async (_address, _abi, name) => {
			calls.push(name)
			switch (name) {
				case 'securityPool':
					return pool
				case 'securityPoolFactory':
					return factory
				case 'portfolio':
				case 'getSecurityPoolPortfolio':
					return portfolio
				case 'collateralToken':
					return token
				case 'symbol':
					return 'USDC'
				case 'decimals':
					return 6n
				default:
					throw new Error(`Unexpected ${name}`)
			}
		}
		const cachedRead = withCollateralIdentityCache(read, new Map())
		expect(await readContractCollateral(pool, kind, cachedRead)).toMatchObject({ unit: { symbol: 'USDC', decimals: 6 } })
		const identities = calls.filter(name => !['symbol', 'decimals'].includes(name))
		expect(await readContractCollateral(pool, kind, cachedRead)).toMatchObject({ unit: { symbol: 'USDC', decimals: 6 } })
		expect(calls.filter(name => !['symbol', 'decimals'].includes(name))).toEqual(identities)
		expect(calls.filter(name => name === 'decimals')).toHaveLength(2)
	})

test('unavailable or malformed metadata leaves amounts in raw units', async () => {
	const read: StateRead = async (_address, _abi, name) => {
		if (name === 'collateralToken') return token
		if (name === 'symbol') return 'USDC'
		return 256n
	}
	expect(await readContractCollateral(portfolio, 'securityPoolPortfolio', read)).toHaveProperty('readError')
	expect(
		await readContractCollateral(portfolio, 'securityPoolPortfolio', async () => {
			throw new Error('Historical state unavailable')
		}),
	).toHaveProperty('readError')
})
