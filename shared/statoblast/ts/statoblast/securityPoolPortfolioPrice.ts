import { encodeFunctionData, getAddress, isAddress, isHex, parseAbi, zeroAddress, type AbiValue, type Address } from '@zoltar/core-shared/evm/ethereum'
import type { PortfolioReadClient } from './securityPoolPortfolioRead.js'

const abi = parseAbi([
	'function factory() view returns (address)',
	'function seedPool() view returns (address)',
	'function getQuestions(uint256 start,uint256 count) view returns (uint256[])',
	'function getPool(uint256 questionId,uint248 universeId) view returns (address)',
	'function zoltar() view returns (address)',
	'function universeId() view returns (uint248)',
	'function getRepToken(uint248 universeId) view returns (address)',
	'function getSecurityPoolPortfolio(address pool) view returns (address)',
	'function getSecurityPoolOriginId(address pool) view returns (bytes32)',
	'function getSecurityPool(bytes32 origin,uint248 universeId) view returns (address)',
	'function sharedPriceFeeds(address portfolio,uint248 universeId) view returns (address)',
	'function priceFeed(uint248 universeId) view returns (address)',
	'function isPriceReportingOpen(uint248 universeId) view returns (bool)',
	'function portfolio() view returns (address)',
	'function securityPoolFactory() view returns (address)',
	'function reputationToken() view returns (address)',
	'function weth() view returns (address)',
	'function openOracle() view returns (address)',
	'function minimumToken1ReportAttoEth() view returns (uint256)',
	'function minimumToken2ReportAttoRep() view returns (uint256)',
	'function getRequestPriceCostAttoEth() view returns (uint256)',
	'function lastPrice() view returns (uint256)',
	'function lastSettlementTimestamp() view returns (uint256)',
	'function priceValidityWindowSeconds() view returns (uint256)',
	'function pendingReportId() view returns (uint256)',
	'function settlementTime() view returns (uint48)',
	'function balanceOf(address owner) view returns (uint256)',
	'function allowance(address owner,address spender) view returns (uint256)',
	'function preparePortfolioPriceFeed(address source,uint248 universeId) returns (address)',
	'function requestPortfolioPrice(uint256 proposedRepPerEthPrice,uint256 requestedInitialAttoWeth,uint256 bountyAttoEth) payable returns (uint256)',
	'function approve(address spender,uint256 amount) returns (bool)',
	'function deposit() payable',
])
type PriceReadClient = PortfolioReadClient & { getBalance(parameters: { address: Address; blockNumber: bigint }): Promise<bigint> }
function address(value: unknown, label: string, allowZero = false): Address {
	if (typeof value !== 'string' || !isAddress(value) || (!allowZero && getAddress(value) === zeroAddress)) throw new Error(`${label} must be a nonzero address.`)
	return getAddress(value)
}
function uint(value: unknown, label: string, bits = 256): bigint {
	const integer = typeof value === 'number' && Number.isSafeInteger(value) ? BigInt(value) : value
	if (typeof integer !== 'bigint' || integer < 0n || integer >= 1n << BigInt(bits)) throw new Error(`${label} must fit uint${bits}.`)
	return integer
}
function bool(value: unknown, label: string) {
	if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`)
	return value
}

/** Read one branch feed directly, without a question coordinator or history scan. */
export async function loadPortfolioPriceSnapshot(parameters: { client: PriceReadClient; portfolio: Address; owner: Address; universeId: bigint }) {
	const { client } = parameters
	const portfolio = address(parameters.portfolio, 'Portfolio')
	const owner = address(parameters.owner, 'Report sponsor')
	const universeId = uint(parameters.universeId, 'Universe', 248)
	const [block, chainId] = await Promise.all([client.getBlock(), client.getChainId()])
	if (block.number === undefined || block.hash === undefined) throw new Error('Price preparation requires a mined block.')
	const blockNumber = block.number
	const read = (target: Address, functionName: string, args: readonly AbiValue[] = []) => client.readContract({ address: target, abi, functionName, args, blockNumber })
	const [factoryValue, seedValue, protocolValue, feedValue, openValue, eth] = await Promise.all([
		read(portfolio, 'factory'),
		read(portfolio, 'seedPool'),
		read(portfolio, 'zoltar'),
		read(portfolio, 'priceFeed', [universeId]),
		read(portfolio, 'isPriceReportingOpen', [universeId]),
		client.getBalance({ address: owner, blockNumber }),
	])
	const factory = address(factoryValue, 'Portfolio factory')
	const seedPool = address(seedValue, 'Portfolio seed')
	const zoltar = address(protocolValue, 'Portfolio protocol')
	const feed = address(feedValue, 'Portfolio price feed', true)
	const reportingOpen = bool(openValue, 'Reporting window')
	const [questionPage, seedOrigin, seedUniverse, seedProtocol, registeredFeed, repValue] = await Promise.all([
		read(portfolio, 'getQuestions', [0n, 1n]),
		read(factory, 'getSecurityPoolOriginId', [seedPool]),
		read(seedPool, 'universeId'),
		read(seedPool, 'zoltar'),
		read(factory, 'sharedPriceFeeds', [portfolio, universeId]),
		read(zoltar, 'getRepToken', [universeId]),
	])
	if (address(seedProtocol, 'Seed protocol') !== zoltar || address(registeredFeed, 'Canonical price feed', true) !== feed) throw new Error('Portfolio price identities do not match.')
	if (typeof seedOrigin !== 'string' || !isHex(seedOrigin) || seedOrigin.length !== 66) throw new Error('Invalid seed pool origin.')
	if (address(await read(factory, 'getSecurityPool', [seedOrigin, uint(seedUniverse, 'Seed universe', 248)]), 'Canonical seed') !== seedPool) throw new Error('Portfolio seed is not canonical.')
	if (!Array.isArray(questionPage) || questionPage.length > 1) throw new Error('Invalid portfolio preparation source page.')
	let sourcePool: Address | undefined
	if (questionPage.length === 1) {
		sourcePool = address(await read(portfolio, 'getPool', [uint(questionPage[0], 'Source question'), uint(seedUniverse, 'Origin universe', 248)]), 'Preparation source')
		const [sourcePortfolio, sourceOrigin] = await Promise.all([read(factory, 'getSecurityPoolPortfolio', [sourcePool]), read(factory, 'getSecurityPoolOriginId', [sourcePool])])
		if (typeof sourceOrigin !== 'string' || !isHex(sourceOrigin) || sourceOrigin.length !== 66) throw new Error('Invalid preparation source origin.')
		if (address(sourcePortfolio, 'Source portfolio') !== portfolio || address(await read(factory, 'getSecurityPool', [sourceOrigin, uint(seedUniverse, 'Origin universe', 248)]), 'Canonical source') !== sourcePool) throw new Error('Portfolio preparation source is not canonical.')
	}
	const repToken = address(repValue, 'Branch REP', true)
	let observation:
		| {
				weth: Address
				openOracle: Address
				minimumWethAttoEth: bigint | undefined
				minimumRepAttoRep: bigint | undefined
				bounty: bigint
				lastPrice: bigint
				lastSettlementTimestamp: bigint
				validitySeconds: bigint
				settlementSeconds: bigint
				pendingReportId: bigint
				wethBalanceAttoEth: bigint
				repBalanceAttoRep: bigint
				wethAllowanceAttoEth: bigint
				repAllowanceAttoRep: bigint
		  }
		| undefined
	if (feed !== zeroAddress) {
		const [authority, feedFactory, feedUniverse, feedRep, wethValue, oracleValue] = await Promise.all([read(feed, 'portfolio'), read(feed, 'securityPoolFactory'), read(feed, 'universeId'), read(feed, 'reputationToken'), read(feed, 'weth'), read(feed, 'openOracle')])
		if (address(authority, 'Feed portfolio') !== portfolio || address(feedFactory, 'Feed factory') !== factory || uint(feedUniverse, 'Feed universe', 248) !== universeId || address(feedRep, 'Feed REP') !== repToken) throw new Error('Price feed belongs to another portfolio or branch.')
		const weth = address(wethValue, 'WETH')
		const openOracle = address(oracleValue, 'OpenOracle')
		const [minimum, minimumRep, bounty, price, settled, validity, settlement, pending, wethBalanceAttoEth, repBalanceAttoRep, wethAllowanceAttoEth, repAllowanceAttoRep] = await Promise.all([
			reportingOpen ? read(feed, 'minimumToken1ReportAttoEth') : undefined,
			reportingOpen ? read(feed, 'minimumToken2ReportAttoRep') : undefined,
			read(feed, 'getRequestPriceCostAttoEth'),
			read(feed, 'lastPrice'),
			read(feed, 'lastSettlementTimestamp'),
			read(feed, 'priceValidityWindowSeconds'),
			read(feed, 'settlementTime'),
			read(feed, 'pendingReportId'),
			read(weth, 'balanceOf', [owner]),
			read(repToken, 'balanceOf', [owner]),
			read(weth, 'allowance', [owner, feed]),
			read(repToken, 'allowance', [owner, feed]),
		])
		observation = {
			weth,
			openOracle,
			minimumWethAttoEth: minimum === undefined ? undefined : uint(minimum, 'Minimum WETH', 128),
			minimumRepAttoRep: minimumRep === undefined ? undefined : uint(minimumRep, 'Minimum REP', 128),
			bounty: uint(bounty, 'Report bounty', 96),
			lastPrice: uint(price, 'Last price'),
			lastSettlementTimestamp: uint(settled, 'Last settlement'),
			validitySeconds: uint(validity, 'Price validity'),
			settlementSeconds: uint(settlement, 'Report challenge period', 48),
			pendingReportId: uint(pending, 'Pending report'),
			wethBalanceAttoEth: uint(wethBalanceAttoEth, 'WETH balance'),
			repBalanceAttoRep: uint(repBalanceAttoRep, 'REP balance'),
			wethAllowanceAttoEth: uint(wethAllowanceAttoEth, 'WETH allowance'),
			repAllowanceAttoRep: uint(repAllowanceAttoRep, 'REP allowance'),
		}
	}
	const [finalBlock, finalChain] = await Promise.all([client.getBlock({ blockNumber }), client.getChainId()])
	if (finalChain !== chainId || finalBlock.hash !== block.hash) throw new Error('Price preparation changed. Refresh and retry.')
	return { chainId, blockNumber, blockHash: block.hash, timestamp: block.timestamp, portfolio, owner, universeId, factory, seedPool, sourcePool, zoltar, feed, repToken, reportingOpen, ethBalanceAttoEth: uint(eth, 'ETH balance'), observation }
}
export type PortfolioPriceSnapshot = Awaited<ReturnType<typeof loadPortfolioPriceSnapshot>>

export function quotePortfolioPriceFunding(snapshot: PortfolioPriceSnapshot, proposedRepPerEth: bigint, requestedWeth = 0n) {
	const observation = snapshot.observation
	if (observation === undefined) throw new Error('Prepare the branch price feed first.')
	if (observation.minimumWethAttoEth === undefined || observation.minimumRepAttoRep === undefined) throw new Error('The branch price reporting window is closed.')
	const price = uint(proposedRepPerEth, 'REP per ETH price')
	if (price === 0n) throw new Error('Enter a positive REP per ETH price.')
	uint(requestedWeth, 'Requested WETH', 128)
	const inventoryWeth = (observation.minimumRepAttoRep * 10n ** 18n + price - 1n) / price
	const minimum = inventoryWeth > observation.minimumWethAttoEth ? inventoryWeth : observation.minimumWethAttoEth
	const weth = uint(requestedWeth > minimum ? requestedWeth : minimum, 'Initial WETH report', 128)
	const rep = uint((weth * price + 10n ** 18n - 1n) / 10n ** 18n, 'Initial REP report', 128)
	const wrap = weth > observation.wethBalanceAttoEth ? weth - observation.wethBalanceAttoEth : 0n
	return { price, weth, rep, wrap, bounty: observation.bounty, requiredEth: wrap + observation.bounty }
}
export function buildPortfolioPricePreparationRequest(snapshot: PortfolioPriceSnapshot) {
	if (snapshot.sourcePool === undefined) throw new Error('No registered origin question is available to prepare this feed.')
	return { account: snapshot.owner, to: snapshot.factory, value: 0n, data: encodeFunctionData({ abi, functionName: 'preparePortfolioPriceFeed', args: [snapshot.sourcePool, snapshot.universeId] }) }
}
export function buildPortfolioPriceRequest(snapshot: PortfolioPriceSnapshot, proposedRepPerEth: bigint, requestedWeth = 0n) {
	const funding = quotePortfolioPriceFunding(snapshot, proposedRepPerEth, requestedWeth)
	if (!snapshot.reportingOpen) throw new Error('The branch price reporting window is closed.')
	return { account: snapshot.owner, to: snapshot.feed, value: funding.bounty, data: encodeFunctionData({ abi, functionName: 'requestPortfolioPrice', args: [funding.price, funding.weth, funding.bounty] }) }
}
export function buildPortfolioPriceApprovalRequest(snapshot: PortfolioPriceSnapshot, token: 'weth' | 'rep', amount: bigint) {
	if (snapshot.observation === undefined) throw new Error('Prepare the branch price feed first.')
	return { account: snapshot.owner, to: token === 'weth' ? snapshot.observation.weth : snapshot.repToken, value: 0n, data: encodeFunctionData({ abi, functionName: 'approve', args: [snapshot.feed, uint(amount, 'Approval amount')] }) }
}
export function buildPortfolioPriceWrapRequest(snapshot: PortfolioPriceSnapshot, amount: bigint) {
	if (snapshot.observation === undefined || uint(amount, 'ETH to wrap') === 0n) throw new Error('No WETH wrapping is required.')
	return { account: snapshot.owner, to: snapshot.observation.weth, value: amount, data: encodeFunctionData({ abi, functionName: 'deposit' }) }
}
