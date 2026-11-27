import { toFunctionSelector } from '@zoltar/core-shared/evm/ethereum'
import { calculateOracleSettlementBountyAttoEth } from '../initialReport/oracleInitialReport.js'
import { encodeFunctionData, isHex, parseAbi, zeroAddress, type AbiValue, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import type { SecurityPoolReadClient } from './securityPoolRead.js'
import { decodeAddress, decodeBool, decodeUint } from './securityPoolDecoding.js'

const abi = parseAbi([
	'function factory() view returns (address)',
	'function originUniverseId() view returns (uint248)',
	'function getQuestions(uint256 start,uint256 count) view returns (uint256[])',
	'function getQuestionLedger(uint256 questionId,uint248 universeId) view returns (address)',
	'function zoltar() view returns (address)',
	'function universeId() view returns (uint248)',
	'function getRepToken(uint248 universeId) view returns (address)',
	'function securityPoolOf(address pool) view returns (address)',
	'function getQuestionLedgerOriginId(address pool) view returns (bytes32)',
	'function getQuestionLedger(bytes32 origin,uint248 universeId) view returns (address)',
	'function sharedPriceFeeds(address securityPool,uint248 universeId) view returns (address)',
	'function priceFeed(uint248 universeId) view returns (address)',
	'function isPriceReportingOpen(uint248 universeId) view returns (bool)',
	'function securityPool() view returns (address)',
	'function securityPoolFactory() view returns (address)',
	'function reputationToken() view returns (address)',
	'function weth() view returns (address)',
	'function collateralToken() view returns (address)',
	'function openOracle() view returns (address)',
	'function oracleExposure(uint248 universeId) view returns (uint256)',
	'function minimumReportCollateral() view returns (uint256)',
	'function minimumToken1ReportAttoEth() view returns (uint256)',
	'function minimumToken2ReportAttoRep() view returns (uint256)',
	'function initialReportPriorityFeeAttoEthPerGas() view returns (uint256)',
	'function getSettlementCallbackGasLimit() view returns (uint32)',
	'function maxSettlementBaseFeeMultiplierBps() view returns (uint256)',
	'function lastPrice() view returns (uint256)',
	'function lastSettlementTimestamp() view returns (uint256)',
	'function priceValidityWindowSeconds() view returns (uint256)',
	'function pendingReportId() view returns (uint256)',
	'function escalationHaltMultiplierBps() view returns (uint256)',
	'function settlementTime() view returns (uint48)',
	'function balanceOf(address owner) view returns (uint256)',
	'function allowance(address owner,address spender) view returns (uint256)',
	'function prepareSecurityPoolPriceFeed(address source,uint248 universeId) returns (address)',
	'function requestSecurityPoolPrice(uint256 proposedRepPerEthPrice,uint256 requestedInitialAttoWeth,uint256 bountyAttoEth) payable returns (uint256)',
	'function requestSecurityPoolPriceWithOperations(uint256 price,uint256 weth,uint256 bounty,(uint32 gasLimit,uint256 minimumPrice,uint256 maximumPrice,uint48 deadline,(uint32 gasLimit,bytes data)[] operations) batch) payable returns(uint256)',
	'function approve(address spender,uint256 amount) returns (bool)',
	'function deposit() payable',
])
type PriceReadClient = SecurityPoolReadClient & { getBalance(parameters: { address: Address; blockNumber: bigint }): Promise<bigint> }

/** Read one branch feed directly, without a question coordinator or history scan. */
export async function loadSecurityPoolPriceSnapshot(parameters: { client: PriceReadClient; securityPool: Address; owner: Address; universeId: bigint; blockNumber?: bigint }) {
	const { client } = parameters
	const securityPool = decodeAddress(parameters.securityPool, 'Security pool')
	const owner = decodeAddress(parameters.owner, 'Report funder')
	const universeId = decodeUint(parameters.universeId, 'Universe', 248)
	const [block, chainId] = await Promise.all([client.getBlock(parameters.blockNumber === undefined ? undefined : { blockNumber: parameters.blockNumber }), client.getChainId()])
	if (block.number === undefined || block.hash === undefined) throw new Error('Price preparation requires a mined block.')
	if (parameters.blockNumber !== undefined && block.number !== parameters.blockNumber) throw new Error('Price preparation returned another block.')
	const blockNumber = block.number
	const read = (target: Address, functionName: string, args: readonly AbiValue[] = []) => client.readContract({ address: target, abi, functionName, args, blockNumber })
	const [factoryValue, originUniverseValue, protocolValue, feedValue, openValue, eth] = await Promise.all([
		read(securityPool, 'factory'),
		read(securityPool, 'originUniverseId'),
		read(securityPool, 'zoltar'),
		read(securityPool, 'priceFeed', [universeId]),
		read(securityPool, 'isPriceReportingOpen', [universeId]),
		client.getBalance({ address: owner, blockNumber }),
	])
	const factory = decodeAddress(factoryValue, 'Security pool deployment contract')
	const originUniverseId = decodeUint(originUniverseValue, 'Origin universe', 248)
	const zoltar = decodeAddress(protocolValue, 'universe contract for the security pool')
	const feed = decodeAddress(feedValue, 'Security pool price feed', true)
	const reportingOpen = decodeBool(openValue, 'Reporting window must be a boolean.')
	const [questionPage, factoryProtocol, registeredFeed, repValue] = await Promise.all([read(securityPool, 'getQuestions', [0n, 1n]), read(factory, 'zoltar'), read(factory, 'sharedPriceFeeds', [securityPool, universeId]), read(zoltar, 'getRepToken', [universeId])])
	if (decodeAddress(factoryProtocol, 'universe contract for pool deployment') !== zoltar || decodeAddress(registeredFeed, 'Registered price feed', true) !== feed) throw new Error('Security pool price identities do not match.')
	if (!Array.isArray(questionPage) || questionPage.length > 1) throw new Error('Invalid security pool preparation source page.')
	let sourcePool: Address | undefined
	if (questionPage.length === 1) {
		sourcePool = decodeAddress(await read(securityPool, 'getQuestionLedger', [decodeUint(questionPage[0], 'Source question'), originUniverseId]), 'Preparation source')
		const [sourceSecurityPool, sourceOrigin] = await Promise.all([read(factory, 'securityPoolOf', [sourcePool]), read(factory, 'getQuestionLedgerOriginId', [sourcePool])])
		if (typeof sourceOrigin !== 'string' || !isHex(sourceOrigin) || sourceOrigin.length !== 66) throw new Error('Invalid preparation source origin.')
		if (decodeAddress(sourceSecurityPool, 'Source security pool') !== securityPool || decodeAddress(await read(factory, 'getQuestionLedger', [sourceOrigin, originUniverseId]), 'Registered source question') !== sourcePool)
			throw new Error('The source question does not match the question registered for this security pool.')
	}
	const repToken = decodeAddress(repValue, 'Branch REP', true)
	let observation:
		| {
				weth: Address
				wrappedNative: Address
				escalationHaltMultiplierBps: bigint
				openOracle: Address
				minimumWethAttoEth: bigint | undefined
				minimumRepAttoRep: bigint | undefined
				currentExposureAttoEth: bigint
				minimumReportCollateral: bigint
				bounty: bigint
				nextBlockBounty: bigint
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
		const [authority, feedFactory, feedUniverse, feedRep, wethValue, oracleValue] = await Promise.all([read(feed, 'securityPool'), read(feed, 'securityPoolFactory'), read(feed, 'universeId'), read(feed, 'reputationToken'), read(feed, 'collateralToken'), read(feed, 'openOracle')])
		if (decodeAddress(authority, 'Feed security pool') !== securityPool || decodeAddress(feedFactory, 'pool deployment contract for the price feed') !== factory || decodeUint(feedUniverse, 'Feed universe', 248) !== universeId || decodeAddress(feedRep, 'Feed REP') !== repToken)
			throw new Error('Price feed belongs to another security pool or branch.')
		const weth = decodeAddress(wethValue, 'Collateral')
		const wrappedNative = decodeAddress(await read(feed, 'weth'), 'Wrapped native token')
		const openOracle = decodeAddress(oracleValue, 'OpenOracle')
		const [exposure, reportCollateral, minimum, minimumRep, priority, callbackGas, multiplier, price, settled, validity, settlement, pending, wethBalanceAttoEth, repBalanceAttoRep, wethAllowanceAttoEth, repAllowanceAttoRep, haltMultiplier] = await Promise.all([
			read(securityPool, 'oracleExposure', [universeId]),
			read(feed, 'minimumReportCollateral'),
			reportingOpen ? read(feed, 'minimumToken1ReportAttoEth') : undefined,
			reportingOpen ? read(feed, 'minimumToken2ReportAttoRep') : undefined,
			read(feed, 'initialReportPriorityFeeAttoEthPerGas'),
			read(feed, 'getSettlementCallbackGasLimit'),
			read(feed, 'maxSettlementBaseFeeMultiplierBps'),
			read(feed, 'lastPrice'),
			read(feed, 'lastSettlementTimestamp'),
			read(feed, 'priceValidityWindowSeconds'),
			read(feed, 'settlementTime'),
			read(feed, 'pendingReportId'),
			read(weth, 'balanceOf', [owner]),
			read(repToken, 'balanceOf', [owner]),
			read(weth, 'allowance', [owner, feed]),
			read(repToken, 'allowance', [owner, feed]),
			read(feed, 'escalationHaltMultiplierBps'),
		])
		// Fee-priced eth_call can fail for an unfunded caller. Derive the exact
		// contract quote from immutable settings and the pinned block instead.
		const settlementSettings = {
			maxSettlementBaseFeeMultiplierBps: decodeUint(multiplier, 'Settlement fee multiplier'),
			settlementCallbackGasLimit: decodeUint(callbackGas, 'Settlement gas limit', 32),
			initialReportPriorityFeeAttoEthPerGas: decodeUint(priority, 'Report priority fee'),
		}
		const baseFeePerGas = decodeUint(block.baseFeePerGas ?? 0n, 'Block base fee')
		const increase = baseFeePerGas / 8n
		const nextBlockBaseFee = block.baseFeePerGas === undefined ? baseFeePerGas : baseFeePerGas + (increase > 0n ? increase : 1n)
		const bountyAt = (baseFeePerGas: bigint) => decodeUint(calculateOracleSettlementBountyAttoEth({ ...settlementSettings, baseFeePerGas }), 'Settlement bounty', 96)
		observation = {
			wrappedNative,
			escalationHaltMultiplierBps: decodeUint(haltMultiplier, 'Dispute limit multiplier'),
			currentExposureAttoEth: decodeUint(exposure, 'Current exposure'),
			minimumReportCollateral: decodeUint(reportCollateral, 'Report collateral offset'),
			weth,
			openOracle,
			minimumWethAttoEth: minimum === undefined ? undefined : decodeUint(minimum, 'Minimum WETH', 128),
			minimumRepAttoRep: minimumRep === undefined ? undefined : decodeUint(minimumRep, 'Minimum REP', 128),
			bounty: bountyAt(baseFeePerGas),
			nextBlockBounty: bountyAt(nextBlockBaseFee),
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
	return { chainId, blockNumber, blockHash: block.hash, timestamp: block.timestamp, securityPool, owner, universeId, factory, originUniverseId, sourcePool, zoltar, feed, repToken, reportingOpen, ethBalanceAttoEth: decodeUint(eth, 'ETH balance'), observation }
}
export type SecurityPoolPriceSnapshot = Awaited<ReturnType<typeof loadSecurityPoolPriceSnapshot>>

/** Reports without a requested size carry 5% more than the current minimum, a margin for exposure growth the minimum does not cover. */
const SECURITY_POOL_REPORT_FUNDING_HEADROOM_DIVISOR = 20n
export function quoteSecurityPoolPriceFunding(snapshot: SecurityPoolPriceSnapshot, proposedRepPerEth: bigint, requestedWeth = 0n, operationsGas = 0n) {
	const observation = snapshot.observation
	if (observation === undefined) throw new Error('Prepare the branch price feed first.')
	if (observation.minimumWethAttoEth === undefined || observation.minimumRepAttoRep === undefined) throw new Error('The branch price reporting window is closed.')
	const price = decodeUint(proposedRepPerEth, 'REP per ETH price')
	if (price === 0n) throw new Error('Enter a positive REP per ETH price.')
	decodeUint(requestedWeth, 'WETH for the report', 128)
	const inventoryWeth = (observation.minimumRepAttoRep * 10n ** 18n + price - 1n) / price
	const required = inventoryWeth > observation.minimumWethAttoEth ? inventoryWeth : observation.minimumWethAttoEth
	// The feed judges the report against exposure at settlement. Its minimum covers
	// current exposure; the margin tolerates small growth while independently accepted reports can secure later operations.
	if (requestedWeth > 0n && requestedWeth < required) throw new Error(`Requested report funding is below the required minimum ${required.toString()}.`)
	const suggested = requestedWeth === 0n ? required + required / SECURITY_POOL_REPORT_FUNDING_HEADROOM_DIVISOR : requestedWeth
	const weth = decodeUint(suggested > required ? suggested : required, 'Initial WETH report', 128)
	const rep = decodeUint((weth * price + 10n ** 18n - 1n) / 10n ** 18n, 'Initial REP report', 128)
	decodeUint((weth * observation.escalationHaltMultiplierBps) / 10_000n, 'Dispute limit', 128)
	const wrap = observation.weth === observation.wrappedNative && weth > observation.wethBalanceAttoEth ? weth - observation.wethBalanceAttoEth : 0n
	const coveredExposureAttoEth = weth > observation.minimumReportCollateral ? (weth - observation.minimumReportCollateral) * 100n : 0n
	const growthHeadroomAttoEth = coveredExposureAttoEth > observation.currentExposureAttoEth ? coveredExposureAttoEth - observation.currentExposureAttoEth : 0n
	const callbackGas = SECURITY_POOL_REPORT_SETTLEMENT_CALLBACK_GAS + decodeUint(operationsGas, 'Operations gas', 32)
	if (callbackGas > MAXIMUM_SECURITY_POOL_REPORT_CALLBACK_GAS) throw new Error('Report settlement gas exceeds the limit.')
	const paddedGas = (callback: bigint) => ((callback + callback / 63n + 310_000n) * 12_000n + 9_999n) / 10_000n + 20_000n
	const baseGas = paddedGas(SECURITY_POOL_REPORT_SETTLEMENT_CALLBACK_GAS)
	const bounty = operationsGas === 0n ? observation.nextBlockBounty : ((observation.nextBlockBounty - 101n) * paddedGas(callbackGas) + baseGas - 1n) / baseGas + 101n
	decodeUint(bounty, 'Settlement bounty', 96)
	return { price, weth, minimumWeth: required, rep, wrap, bounty, requiredEth: wrap + bounty, coveredExposureAttoEth, growthHeadroomAttoEth }
}
export function buildSecurityPoolPricePreparationRequest(snapshot: SecurityPoolPriceSnapshot) {
	if (snapshot.sourcePool === undefined) throw new Error('No registered origin question is available to prepare this feed.')
	return { account: snapshot.owner, to: snapshot.factory, value: 0n, data: encodeFunctionData({ abi, functionName: 'prepareSecurityPoolPriceFeed', args: [snapshot.sourcePool, snapshot.universeId] }) }
}
export function buildSecurityPoolPriceRequest(snapshot: SecurityPoolPriceSnapshot, proposedRepPerEth: bigint, requestedWeth = 0n) {
	const funding = quoteSecurityPoolPriceFunding(snapshot, proposedRepPerEth, requestedWeth)
	if (!snapshot.reportingOpen) throw new Error('The branch price reporting window is closed.')
	return { account: snapshot.owner, to: snapshot.feed, value: funding.bounty, data: encodeFunctionData({ abi, functionName: 'requestSecurityPoolPrice', args: [funding.price, funding.weth, funding.bounty] }) }
}
export function buildSecurityPoolPriceApprovalRequest(snapshot: SecurityPoolPriceSnapshot, token: 'weth' | 'rep', amount: bigint) {
	if (snapshot.observation === undefined) throw new Error('Prepare the branch price feed first.')
	return { account: snapshot.owner, to: token === 'weth' ? snapshot.observation.weth : snapshot.repToken, value: 0n, data: encodeFunctionData({ abi, functionName: 'approve', args: [snapshot.feed, decodeUint(amount, 'Approval amount')] }) }
}
export function buildSecurityPoolPriceWrapRequest(snapshot: SecurityPoolPriceSnapshot, amount: bigint) {
	if (snapshot.observation === undefined || snapshot.observation.weth !== snapshot.observation.wrappedNative || decodeUint(amount, 'ETH to wrap') === 0n) throw new Error('No WETH wrapping is required.')
	return { account: snapshot.owner, to: snapshot.observation.weth, value: amount, data: encodeFunctionData({ abi, functionName: 'deposit' }) }
}

/** Gas the feed's own settlement callback needs; the sponsor's operation gas is added to it. */
const SECURITY_POOL_REPORT_SETTLEMENT_CALLBACK_GAS = 4_000_000n
/** The feed caps a report's whole callback gas so every report settles in one transaction. */
const MAXIMUM_SECURITY_POOL_REPORT_CALLBACK_GAS = 10_000_000n

/** @public Calldata and gas allowance for an external sponsor operation. */
export type SecurityPoolReportOperation = { gasLimit: bigint; data: Hex }
export type SecurityPoolReportOperations = { gasLimit: bigint; minimumPrice: bigint; maximumPrice: bigint; deadline: bigint; operations: readonly SecurityPoolReportOperation[] }

/** @public Existing ledger entrypoints encoded in sponsor order, with no fixed count cap. */
export function buildSecurityPoolPriceOperationsRequest(snapshot: SecurityPoolPriceSnapshot, proposedRepPerEth: bigint, requestedWethAttoEth: bigint, batch: SecurityPoolReportOperations) {
	const request = buildSecurityPoolPriceRequest(snapshot, proposedRepPerEth, requestedWethAttoEth)
	const funding = quoteSecurityPoolPriceFunding(snapshot, proposedRepPerEth, requestedWethAttoEth, batch.gasLimit)
	if (decodeUint(batch.gasLimit, 'Operations gas') + SECURITY_POOL_REPORT_SETTLEMENT_CALLBACK_GAS > MAXIMUM_SECURITY_POOL_REPORT_CALLBACK_GAS) throw new Error('Report settlement gas exceeds the limit.')
	decodeUint(batch.minimumPrice, 'Minimum operation price')
	decodeUint(batch.maximumPrice, 'Maximum operation price')
	decodeUint(batch.deadline, 'Operations deadline', 48)
	if (batch.deadline <= snapshot.timestamp || batch.minimumPrice > batch.maximumPrice || batch.maximumPrice === 0n || batch.operations.length === 0) throw new Error('Invalid report operation batch.')
	const supportedSelectors = new Set<string>(
		parseAbi([
			'function depositFor(address owner,uint256 amount)',
			'function depositAndSetHealthTarget(uint256 amount,uint256 targetHealthFactorBps)',
			'function withdrawPrincipal(uint256 amount,address recipient)',
			'function setHealthTarget(uint256 targetHealthFactorBps)',
			'function setCommitment(uint256 commitment) returns (uint96)',
			'function setCommitmentWithReport(uint256 reportId,uint256 commitment) returns (uint96)',
			'function serveRetirement(uint96 id)',
			'function claimEarnings(address recipient)',
			'function takeOver(uint96 id,uint256 commitment,uint256 minimumTakeoverReward,uint256 maximumOwnRep) returns (uint96)',
			'function takeOverWithBounds(uint96 id,uint256 commitment,uint256 minimumTakeoverReward,uint256 maximumOwnRep,(uint256 maximumOwnerPrincipal,uint256 maximumOwnerCommitment,uint256 expectedTargetHealthFactorBps,uint256 expectedAcceptedPriceEpoch,uint96 expectedSourceBatch) bounds) returns (uint96)',
			'function materializeRepairAuctionBids(uint256[] bidIds)',
			'function takeOverRepairAuctionBid(uint256 bidId,uint256 commitment,uint256 minimumTakeoverReward,uint256 maximumOwnRep,(uint256 maximumOwnerPrincipal,uint256 maximumOwnerCommitment,uint256 expectedTargetHealthFactorBps,uint256 expectedAcceptedPriceEpoch,uint96 expectedSourceBatch) bounds)',
		]).map(item => toFunctionSelector(item)),
	)
	let requiredGas = 0n
	for (const operation of batch.operations) {
		if (decodeUint(operation.gasLimit, 'Operation gas', 32) === 0n || !isHex(operation.data) || operation.data.length < 10 || operation.data.length % 2 !== 0) throw new Error('Invalid report operation.')
		if (!supportedSelectors.has(operation.data.slice(0, 10).toLowerCase())) throw new Error('Unsupported report operation.')
		if ((operation.data.length - 2) / 2 > 512) throw new Error('Operation data cannot exceed 512 bytes.')
		requiredGas += operation.gasLimit + 100_000n
	}
	if (requiredGas > batch.gasLimit) throw new Error('Operation gas budget insufficient.')
	if (snapshot.ethBalanceAttoEth < funding.bounty) throw new Error('Insufficient ETH for operation settlement bounty.')
	return { ...request, value: funding.bounty, data: encodeFunctionData({ abi, functionName: 'requestSecurityPoolPriceWithOperations', args: [funding.price, funding.weth, funding.bounty, batch] }) }
}
