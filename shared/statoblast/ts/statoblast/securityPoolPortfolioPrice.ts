import { encodeFunctionData, isHex, parseAbi, zeroAddress, type AbiValue, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import type { PortfolioReadClient } from './securityPoolPortfolioRead.js'
import { decodeAddress, decodeBool, decodeUint } from './securityPoolPortfolioDecoding.js'

const abi = parseAbi([
	'function factory() view returns (address)',
	'function originUniverseId() view returns (uint248)',
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
	'function collateralToken() view returns (address)',
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
	'function requestPortfolioPriceWithOperations(uint256 price,uint256 weth,uint256 bounty,(uint32 gasLimit,uint256 minimumPrice,uint256 maximumPrice,uint48 deadline,(uint32 gasLimit,bytes data)[] operations) batch) payable returns(uint256)',
	'function approve(address spender,uint256 amount) returns (bool)',
	'function deposit() payable',
])
type PriceReadClient = PortfolioReadClient & { getBalance(parameters: { address: Address; blockNumber: bigint }): Promise<bigint> }

/** Read one branch feed directly, without a question coordinator or history scan. */
export async function loadPortfolioPriceSnapshot(parameters: { client: PriceReadClient; portfolio: Address; owner: Address; universeId: bigint; blockNumber?: bigint }) {
	const { client } = parameters
	const portfolio = decodeAddress(parameters.portfolio, 'Portfolio')
	const owner = decodeAddress(parameters.owner, 'Report sponsor')
	const universeId = decodeUint(parameters.universeId, 'Universe', 248)
	const [block, chainId] = await Promise.all([client.getBlock(parameters.blockNumber === undefined ? undefined : { blockNumber: parameters.blockNumber }), client.getChainId()])
	if (block.number === undefined || block.hash === undefined) throw new Error('Price preparation requires a mined block.')
	if (parameters.blockNumber !== undefined && block.number !== parameters.blockNumber) throw new Error('Price preparation returned another block.')
	const blockNumber = block.number
	const read = (target: Address, functionName: string, args: readonly AbiValue[] = []) => client.readContract({ address: target, abi, functionName, args, blockNumber })
	const [factoryValue, originUniverseValue, protocolValue, feedValue, openValue, eth] = await Promise.all([
		read(portfolio, 'factory'),
		read(portfolio, 'originUniverseId'),
		read(portfolio, 'zoltar'),
		read(portfolio, 'priceFeed', [universeId]),
		read(portfolio, 'isPriceReportingOpen', [universeId]),
		client.getBalance({ address: owner, blockNumber }),
	])
	const factory = decodeAddress(factoryValue, 'Portfolio factory')
	const originUniverseId = decodeUint(originUniverseValue, 'Origin universe', 248)
	const zoltar = decodeAddress(protocolValue, 'Portfolio protocol')
	const feed = decodeAddress(feedValue, 'Portfolio price feed', true)
	const reportingOpen = decodeBool(openValue, 'Reporting window must be a boolean.')
	const [questionPage, factoryProtocol, registeredFeed, repValue] = await Promise.all([read(portfolio, 'getQuestions', [0n, 1n]), read(factory, 'zoltar'), read(factory, 'sharedPriceFeeds', [portfolio, universeId]), read(zoltar, 'getRepToken', [universeId])])
	if (decodeAddress(factoryProtocol, 'Factory protocol') !== zoltar || decodeAddress(registeredFeed, 'Canonical price feed', true) !== feed) throw new Error('Portfolio price identities do not match.')
	if (!Array.isArray(questionPage) || questionPage.length > 1) throw new Error('Invalid portfolio preparation source page.')
	let sourcePool: Address | undefined
	if (questionPage.length === 1) {
		sourcePool = decodeAddress(await read(portfolio, 'getPool', [decodeUint(questionPage[0], 'Source question'), originUniverseId]), 'Preparation source')
		const [sourcePortfolio, sourceOrigin] = await Promise.all([read(factory, 'getSecurityPoolPortfolio', [sourcePool]), read(factory, 'getSecurityPoolOriginId', [sourcePool])])
		if (typeof sourceOrigin !== 'string' || !isHex(sourceOrigin) || sourceOrigin.length !== 66) throw new Error('Invalid preparation source origin.')
		if (decodeAddress(sourcePortfolio, 'Source portfolio') !== portfolio || decodeAddress(await read(factory, 'getSecurityPool', [sourceOrigin, originUniverseId]), 'Canonical source') !== sourcePool) throw new Error('Portfolio preparation source is not canonical.')
	}
	const repToken = decodeAddress(repValue, 'Branch REP', true)
	let observation:
		| {
				weth: Address
				wrappedNative: Address
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
		const [authority, feedFactory, feedUniverse, feedRep, wethValue, oracleValue] = await Promise.all([read(feed, 'portfolio'), read(feed, 'securityPoolFactory'), read(feed, 'universeId'), read(feed, 'reputationToken'), read(feed, 'collateralToken'), read(feed, 'openOracle')])
		if (decodeAddress(authority, 'Feed portfolio') !== portfolio || decodeAddress(feedFactory, 'Feed factory') !== factory || decodeUint(feedUniverse, 'Feed universe', 248) !== universeId || decodeAddress(feedRep, 'Feed REP') !== repToken) throw new Error('Price feed belongs to another portfolio or branch.')
		const weth = decodeAddress(wethValue, 'Collateral')
		const wrappedNative = decodeAddress(await read(feed, 'weth'), 'Wrapped native token')
		const openOracle = decodeAddress(oracleValue, 'OpenOracle')
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
			wrappedNative,
			weth,
			openOracle,
			minimumWethAttoEth: minimum === undefined ? undefined : decodeUint(minimum, 'Minimum WETH', 128),
			minimumRepAttoRep: minimumRep === undefined ? undefined : decodeUint(minimumRep, 'Minimum REP', 128),
			bounty: decodeUint(bounty, 'Report bounty', 96),
			lastPrice: decodeUint(price, 'Last price'),
			lastSettlementTimestamp: decodeUint(settled, 'Last settlement'),
			validitySeconds: decodeUint(validity, 'Price validity'),
			settlementSeconds: decodeUint(settlement, 'Report challenge period', 48),
			pendingReportId: decodeUint(pending, 'Pending report'),
			wethBalanceAttoEth: decodeUint(wethBalanceAttoEth, 'WETH balance'),
			repBalanceAttoRep: decodeUint(repBalanceAttoRep, 'REP balance'),
			wethAllowanceAttoEth: decodeUint(wethAllowanceAttoEth, 'WETH allowance'),
			repAllowanceAttoRep: decodeUint(repAllowanceAttoRep, 'REP allowance'),
		}
	}
	const [finalBlock, finalChain] = await Promise.all([client.getBlock({ blockNumber }), client.getChainId()])
	if (finalChain !== chainId || finalBlock.hash !== block.hash) throw new Error('Price preparation changed. Refresh and retry.')
	return { chainId, blockNumber, blockHash: block.hash, timestamp: block.timestamp, portfolio, owner, universeId, factory, originUniverseId, sourcePool, zoltar, feed, repToken, reportingOpen, ethBalanceAttoEth: decodeUint(eth, 'ETH balance'), observation }
}
export type PortfolioPriceSnapshot = Awaited<ReturnType<typeof loadPortfolioPriceSnapshot>>

export function quotePortfolioPriceFunding(snapshot: PortfolioPriceSnapshot, proposedRepPerEth: bigint, requestedWeth = 0n) {
	const observation = snapshot.observation
	if (observation === undefined) throw new Error('Prepare the branch price feed first.')
	if (observation.minimumWethAttoEth === undefined || observation.minimumRepAttoRep === undefined) throw new Error('The branch price reporting window is closed.')
	const price = decodeUint(proposedRepPerEth, 'REP per ETH price')
	if (price === 0n) throw new Error('Enter a positive REP per ETH price.')
	decodeUint(requestedWeth, 'Requested WETH', 128)
	const inventoryWeth = (observation.minimumRepAttoRep * 10n ** 18n + price - 1n) / price
	const minimum = inventoryWeth > observation.minimumWethAttoEth ? inventoryWeth : observation.minimumWethAttoEth
	const weth = decodeUint(requestedWeth > minimum ? requestedWeth : minimum, 'Initial WETH report', 128)
	const rep = decodeUint((weth * price + 10n ** 18n - 1n) / 10n ** 18n, 'Initial REP report', 128)
	const wrap = observation.weth === observation.wrappedNative && weth > observation.wethBalanceAttoEth ? weth - observation.wethBalanceAttoEth : 0n
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
	return { account: snapshot.owner, to: token === 'weth' ? snapshot.observation.weth : snapshot.repToken, value: 0n, data: encodeFunctionData({ abi, functionName: 'approve', args: [snapshot.feed, decodeUint(amount, 'Approval amount')] }) }
}
export function buildPortfolioPriceWrapRequest(snapshot: PortfolioPriceSnapshot, amount: bigint) {
	if (snapshot.observation === undefined || snapshot.observation.weth !== snapshot.observation.wrappedNative || decodeUint(amount, 'ETH to wrap') === 0n) throw new Error('No WETH wrapping is required.')
	return { account: snapshot.owner, to: snapshot.observation.weth, value: amount, data: encodeFunctionData({ abi, functionName: 'deposit' }) }
}

/** @public Calldata and gas allowance for an external sponsor operation. */
export type PortfolioReportOperation = { gasLimit: bigint; data: Hex }
export type PortfolioReportOperations = { gasLimit: bigint; minimumPrice: bigint; maximumPrice: bigint; deadline: bigint; operations: readonly PortfolioReportOperation[] }

/** Existing ledger entrypoints encoded in sponsor order, with no fixed count cap. */
export function buildPortfolioPriceOperationsRequest(snapshot: PortfolioPriceSnapshot, proposedRepPerEth: bigint, requestedWethAttoEth: bigint, batch: PortfolioReportOperations) {
	const request = buildPortfolioPriceRequest(snapshot, proposedRepPerEth, requestedWethAttoEth)
	const funding = quotePortfolioPriceFunding(snapshot, proposedRepPerEth, requestedWethAttoEth)
	decodeUint(batch.gasLimit + 4_000_000n, 'Callback gas', 32)
	decodeUint(batch.minimumPrice, 'Minimum operation price')
	decodeUint(batch.maximumPrice, 'Maximum operation price')
	decodeUint(batch.deadline, 'Operations deadline', 48)
	if (batch.deadline <= snapshot.timestamp || batch.minimumPrice > batch.maximumPrice || batch.maximumPrice === 0n || batch.operations.length === 0) throw new Error('Invalid report operation batch.')
	let requiredGas = 0n
	for (const operation of batch.operations) {
		if (decodeUint(operation.gasLimit, 'Operation gas', 32) === 0n || !isHex(operation.data) || operation.data.length < 10 || operation.data.length % 2 !== 0) throw new Error('Invalid report operation.')
		requiredGas += operation.gasLimit + 100_000n
	}
	if (requiredGas > batch.gasLimit) throw new Error('Operation gas budget insufficient.')
	return { ...request, data: encodeFunctionData({ abi, functionName: 'requestPortfolioPriceWithOperations', args: [funding.price, funding.weth, funding.bounty, batch] }) }
}
