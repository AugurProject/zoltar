import { getAddress, isAddress, parseAbi, zeroAddress, type AbiValue, type Address } from '@zoltar/core-shared/evm/ethereum'
import type { PortfolioReadClient } from './securityPoolPortfolioRead.js'

const abi = parseAbi([
	'function factory() view returns (address)',
	'function forkController() view returns (address)',
	'function portfolio() view returns (address)',
	'function zoltar() view returns (address)',
	'function auctions(uint248 universeId) view returns (address)',
	'function capitalLedger(uint248 universeId) view returns (address)',
	'function priceFeed(uint248 universeId) view returns (address)',
	'function oracleExposure(uint248 universeId) view returns (uint256)',
	'function getRepToken(uint248 universeId) view returns (address)',
	'function getForkTime(uint248 universeId) view returns (uint256)',
	'function forkAuthority() view returns (address)',
	'function capital() view returns (address)',
	'function engine() view returns (address)',
	'function controller() view returns (address)',
	'function repToken() view returns (address)',
	'function universeId() view returns (uint248)',
	'function closesAt() view returns (uint256)',
	'function inventoryAttoRep() view returns (uint256)',
	'function shortfallAttoEth() view returns (uint256)',
	'function lotAttoEth() view returns (uint256)',
	'function targetLots() view returns (uint256)',
	'function repGrid() view returns (uint256)',
	'function openingConservativePrice() view returns (uint256)',
	'function minimumCollateralAttoRepPerLot() view returns (uint256)',
	'function opened() view returns (bool)',
	'function finalized() view returns (bool)',
	'function initialized() view returns (bool)',
	'function maximumBidAttoRepPerLot() view returns (uint256)',
	'function depositedAttoEth() view returns (uint256)',
	'function securityMultiplierBps() view returns (uint256)',
	'function conservativePrice() view returns (uint256)',
	'function priceValidUntil() view returns (uint256)',
	'function lastSettlementTimestamp() view returns (uint256)',
	'function acceptedExposureLimitAttoEth() view returns (uint256)',
	'function acceptedRepExposureLimitAttoRep() view returns (uint256)',
	'function refundCreditAttoEth(address bidder) view returns (uint256)',
	'function bidderBidCount(address bidder) view returns (uint256)',
	'function bidderBidId(address bidder,uint256 index) view returns (uint256)',
	'function bids(uint256 id) view returns (address bidder,address vault,uint256 targetHealthBps,uint256 lots,uint256 minimumAttoRepPerLot,bool settled,bool feesRemoved)',
	'function previewBid(uint256 id) view returns ((address bidder,address vault,uint256 targetHealthBps,uint256 filledLots,uint256 usedAttoEth,uint256 principalAttoRep,uint256 refundAttoEth) fill)',
	'function auctionPosition(uint256 bidId) view returns ((address vault,uint96 positionId,uint256 principal,uint256 commitment,uint256 targetHealthFactorBps,uint48 liquidationStarted,bool materialized,uint256 earnedAttoEth,uint256 earnedAttoRep) result)',
	'function clearing() view returns (uint256 attoRepPerLot,uint256 filledLots,uint256 raisedAttoEth,uint256 soldAttoRep,uint256 roundingAttoRep,uint256 marginalMinimumAttoRepPerLot,uint256 marginalFillLots,uint256 marginalDemandLots,uint256 fullBeforeLots,bool raiseLimitReached)',
	'function bidIdForVault(address vault) view returns (uint256)',
	'function owner() view returns (address)',
	'function initialCapital() view returns (address)',
	'function auction() view returns (address)',
	'function bidId() view returns (uint256)',
])
type AuctionReadClient = PortfolioReadClient & { getBalance(parameters: { address: Address; blockNumber: bigint }): Promise<bigint> }
function address(value: unknown, label: string, allowZero = false): Address {
	if (typeof value !== 'string' || !isAddress(value) || (!allowZero && getAddress(value) === zeroAddress)) throw new Error(`${label} must be a nonzero address.`)
	return getAddress(value)
}
function uint(value: unknown, label: string, bits = 256): bigint {
	const integer = typeof value === 'number' && Number.isSafeInteger(value) ? BigInt(value) : value
	if (typeof integer !== 'bigint' || integer < 0n || integer >= 1n << BigInt(bits)) throw new Error(`${label} must fit uint${bits}.`)
	return integer
}
function bool(value: unknown): boolean {
	if (typeof value !== 'boolean') throw new Error('Invalid auction state.')
	return value
}
function fields(value: unknown, names: readonly string[]): unknown[] {
	if (Array.isArray(value) && value.length === names.length) return value
	if (value !== null && typeof value === 'object' && !Array.isArray(value)) return names.map(name => Reflect.get(value, name))
	throw new Error('Invalid auction response.')
}
export type PortfolioAuctionBid = {
	id: bigint
	bidder: Address
	vault: Address
	targetHealthFactorBps: bigint
	lots: bigint
	minimumAttoRepPerLot: bigint
	refundSettled: boolean
	materialized: boolean
	position: { positionId: bigint; principalAttoRep: bigint; commitmentAttoEth: bigint; targetHealthFactorBps: bigint; liquidationStarted: bigint; materialized: boolean; earnedAttoEth: bigint; earnedAttoRep: bigint } | undefined
	fill: { filledLots: bigint; usedAttoEth: bigint; refundAttoEth: bigint; principalAttoRep: bigint } | undefined
}

/** One confirmed block, one explicit bidder page. No historical log or bidder scan. */
export async function loadPortfolioAuctionSnapshot(parameters: { client: AuctionReadClient; portfolio: Address; bidder: Address; universeId: bigint; bidStart?: bigint; bidCount?: number }) {
	const { client } = parameters
	const portfolio = address(parameters.portfolio, 'Portfolio')
	const bidder = address(parameters.bidder, 'Bidder')
	const universeId = uint(parameters.universeId, 'Universe', 248)
	const bidStart = uint(parameters.bidStart ?? 0n, 'Bid page start')
	const pageSize = parameters.bidCount ?? 16
	if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 64) throw new Error('Choose between 1 and 64 bids per page.')
	const [block, chainId] = await Promise.all([client.getBlock(), client.getChainId()])
	if (block.number === undefined || block.hash === undefined || !Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('Auction snapshot requires a confirmed block and chain.')
	const blockNumber = block.number
	const read = (target: Address, functionName: string, args: readonly AbiValue[] = []) => client.readContract({ address: target, abi, functionName, args, blockNumber })
	const [controllerValue, protocolValue, factoryValue, capitalValue, feedValue, walletEth] = await Promise.all([
		read(portfolio, 'forkController'),
		read(portfolio, 'zoltar'),
		read(portfolio, 'factory'),
		read(portfolio, 'capitalLedger', [universeId]),
		read(portfolio, 'priceFeed', [universeId]),
		client.getBalance({ address: bidder, blockNumber }),
	])
	const controller = address(controllerValue, 'Fork controller')
	const zoltar = address(protocolValue, 'Protocol')
	const factory = address(factoryValue, 'Factory')
	const capitalLedger = address(capitalValue, 'Capital ledger', true)
	const priceFeed = address(feedValue, 'Price feed', true)
	const [authorityValue, controllerProtocol, auctionValue, tokenValue, forkTimeValue] = await Promise.all([read(controller, 'portfolio'), read(controller, 'zoltar'), read(controller, 'auctions', [universeId]), read(zoltar, 'getRepToken', [universeId]), read(zoltar, 'getForkTime', [universeId])])
	if (address(authorityValue, 'Fork authority') !== portfolio || address(controllerProtocol, 'Fork protocol') !== zoltar) throw new Error('Auction fork controller belongs to another portfolio.')
	const auctionAddress = address(auctionValue, 'Auction', true)
	const repToken = address(tokenValue, 'Branch REP', true)
	const base = { chainId, blockNumber, blockHash: block.hash, timestamp: block.timestamp, portfolio, bidder, universeId, controller, zoltar, factory, capitalLedger, priceFeed, repToken, walletAttoEth: uint(walletEth, 'Wallet ETH'), forkTime: uint(forkTimeValue, 'Fork time') }
	let auction: Awaited<ReturnType<typeof readAuction>> | undefined
	if (auctionAddress !== zeroAddress) {
		if (capitalLedger === zeroAddress || repToken === zeroAddress) throw new Error('Auction capital or REP is unavailable.')
		auction = await readAuction(auctionAddress)
	}
	const [finalBlock, finalChain] = await Promise.all([client.getBlock({ blockNumber }), client.getChainId()])
	if (finalBlock.hash !== block.hash || finalChain !== chainId) throw new Error('Auction state changed. Refresh and retry.')
	return { ...base, auction }

	async function readAuction(auctionAddress: Address) {
		const [fork, root, capital, engineValue, token, child, closes, inventory, shortfall, lot, target, grid, openingPrice, minimumCollateral, openedValue, finalizedValue, multiplier, capitalRoot, capitalProtocol, capitalChild, capitalToken, capitalFork] = await Promise.all([
			read(auctionAddress, 'forkAuthority'),
			read(auctionAddress, 'portfolio'),
			read(auctionAddress, 'capital'),
			read(auctionAddress, 'engine'),
			read(auctionAddress, 'repToken'),
			read(auctionAddress, 'universeId'),
			read(auctionAddress, 'closesAt'),
			read(auctionAddress, 'inventoryAttoRep'),
			read(auctionAddress, 'shortfallAttoEth'),
			read(auctionAddress, 'lotAttoEth'),
			read(auctionAddress, 'targetLots'),
			read(auctionAddress, 'repGrid'),
			read(auctionAddress, 'openingConservativePrice'),
			read(auctionAddress, 'minimumCollateralAttoRepPerLot'),
			read(auctionAddress, 'opened'),
			read(auctionAddress, 'finalized'),
			read(capitalLedger, 'securityMultiplierBps'),
			read(capitalLedger, 'portfolio'),
			read(capitalLedger, 'zoltar'),
			read(capitalLedger, 'universeId'),
			read(capitalLedger, 'repToken'),
			read(capitalLedger, 'forkAuthority'),
		])
		if (
			address(fork, 'Auction fork authority') !== controller ||
			address(root, 'Auction portfolio') !== portfolio ||
			address(capital, 'Auction capital') !== capitalLedger ||
			address(token, 'Auction REP') !== repToken ||
			uint(child, 'Auction universe', 248) !== universeId ||
			address(capitalRoot, 'Capital portfolio') !== portfolio ||
			address(capitalProtocol, 'Capital protocol') !== zoltar ||
			uint(capitalChild, 'Capital universe', 248) !== universeId ||
			address(capitalToken, 'Capital REP') !== repToken ||
			address(capitalFork, 'Capital fork authority') !== controller
		)
			throw new Error('Auction identities do not match the selected branch.')
		const engine = address(engineValue, 'Auction engine')
		const opened = bool(openedValue)
		const finalized = bool(finalizedValue)
		const [engineController, initialized, engineFinalized, maximum, deposited, count, bidCredit] = await Promise.all([
			read(engine, 'controller'),
			read(engine, 'initialized'),
			read(engine, 'finalized'),
			read(engine, 'maximumBidAttoRepPerLot'),
			read(engine, 'depositedAttoEth'),
			read(engine, 'bidderBidCount', [bidder]),
			read(engine, 'refundCreditAttoEth', [bidder]),
		])
		if (address(engineController, 'Engine controller') !== auctionAddress || bool(initialized) !== opened || bool(engineFinalized) !== (opened && finalized)) throw new Error('Auction engine identity or state is inconsistent.')
		const terms = {
			address: auctionAddress,
			engine,
			opened,
			finalized,
			closesAt: uint(closes, 'Auction close'),
			inventoryAttoRep: uint(inventory, 'REP inventory'),
			shortfallAttoEth: uint(shortfall, 'ETH shortfall'),
			lotAttoEth: uint(lot, 'ETH lot'),
			targetLots: uint(target, 'Target lots'),
			repGrid: uint(grid, 'REP grid'),
			openingConservativePrice: uint(openingPrice, 'Opening price'),
			minimumCollateralAttoRepPerLot: uint(minimumCollateral, 'Minimum collateral per lot'),
			securityMultiplierBps: uint(multiplier, 'Security multiplier'),
			maximumBidAttoRepPerLot: uint(maximum, 'Maximum bid REP per lot'),
			depositedAttoEth: uint(deposited, 'Bid escrow'),
			refundAttoEth: uint(bidCredit, 'Bid refund'),
		}
		if (terms.lotAttoEth === 0n || terms.repGrid === 0n || terms.targetLots !== terms.shortfallAttoEth / terms.lotAttoEth) throw new Error('Invalid auction lot configuration.')
		let price: { conservativePrice: bigint; validUntil: bigint; lastSettlementTimestamp: bigint; exposureLimitAttoEth: bigint; exposureLimitAttoRep: bigint; requiredExposureAttoEth: bigint } | undefined
		if (priceFeed !== zeroAddress) {
			const [values, exposureValue] = await Promise.all([Promise.all(['conservativePrice', 'priceValidUntil', 'lastSettlementTimestamp', 'acceptedExposureLimitAttoEth', 'acceptedRepExposureLimitAttoRep'].map(name => read(priceFeed, name))), read(portfolio, 'oracleExposure', [universeId])])
			price = {
				conservativePrice: uint(values[0], 'Conservative price'),
				validUntil: uint(values[1], 'Price validity'),
				lastSettlementTimestamp: uint(values[2], 'Price settlement'),
				exposureLimitAttoEth: uint(values[3], 'Funded ETH exposure'),
				exposureLimitAttoRep: uint(values[4], 'Funded REP exposure'),
				requiredExposureAttoEth: uint(exposureValue, 'Required report exposure'),
			}
		}
		const totalBidCount = uint(count, 'Bid count')
		const start = bidStart > totalBidCount ? totalBidCount : bidStart
		const remaining = totalBidCount - start
		const size = Number(remaining < BigInt(pageSize) ? remaining : BigInt(pageSize))
		const bids = await Promise.all(Array.from({ length: size }, (_, offset) => readBid(uint(start + BigInt(offset), 'Bid index'))))
		let clearing: { attoRepPerLot: bigint; filledLots: bigint; raisedAttoEth: bigint; soldAttoRep: bigint; roundingAttoRep: bigint; raiseLimitReached: boolean } | undefined
		if (opened && finalized) {
			const result = fields(await read(engine, 'clearing'), ['attoRepPerLot', 'filledLots', 'raisedAttoEth', 'soldAttoRep', 'roundingAttoRep', 'marginalMinimumAttoRepPerLot', 'marginalFillLots', 'marginalDemandLots', 'fullBeforeLots', 'raiseLimitReached'])
			clearing = { attoRepPerLot: uint(result[0], 'Clearing REP per lot'), filledLots: uint(result[1], 'Filled lots'), raisedAttoEth: uint(result[2], 'Raised ETH'), soldAttoRep: uint(result[3], 'Sold REP'), roundingAttoRep: uint(result[4], 'REP rounding fees'), raiseLimitReached: bool(result[9]) }
		}
		return { ...terms, price, clearing, totalBidCount, bidStart: start, bids }

		async function readBid(index: bigint): Promise<PortfolioAuctionBid> {
			const id = uint(await read(engine, 'bidderBidId', [bidder, index]), 'Bid ID')
			if (id === 0n) throw new Error('Auction bid ID is missing.')
			const values = fields(await read(engine, 'bids', [id]), ['bidder', 'vault', 'targetHealthBps', 'lots', 'minimumAttoRepPerLot', 'settled', 'feesRemoved'])
			const vault = address(values[1], 'Auction vault')
			const [vaultOwner, vaultCapital, vaultAuction, vaultId, registeredId] = await Promise.all([read(vault, 'owner'), read(vault, 'initialCapital'), read(vault, 'auction'), read(vault, 'bidId'), read(auctionAddress, 'bidIdForVault', [vault])])
			if (
				address(values[0], 'Bid owner') !== bidder ||
				address(vaultOwner, 'Vault owner') !== bidder ||
				address(vaultCapital, 'Vault initial capital') !== capitalLedger ||
				address(vaultAuction, 'Vault auction') !== auctionAddress ||
				uint(vaultId, 'Vault bid ID') !== id ||
				uint(registeredId, 'Registered vault bid') !== id
			)
				throw new Error('Auction bid or vault belongs to another account.')
			const bid = {
				id,
				bidder,
				vault,
				targetHealthFactorBps: uint(values[2], 'Bid health target'),
				lots: uint(values[3], 'Bid lots'),
				minimumAttoRepPerLot: uint(values[4], 'Bid REP limit'),
				refundSettled: bool(values[5]),
				materialized: bool(values[6]),
			}
			let fill: PortfolioAuctionBid['fill']
			let position: PortfolioAuctionBid['position']
			if (finalized) {
				const result = fields(await read(engine, 'previewBid', [id]), ['bidder', 'vault', 'targetHealthBps', 'filledLots', 'usedAttoEth', 'principalAttoRep', 'refundAttoEth'])
				if (address(result[0], 'Fill bidder') !== bidder || address(result[1], 'Fill vault') !== vault || uint(result[2], 'Fill health') !== bid.targetHealthFactorBps) throw new Error('Auction fill identity mismatch.')
				const filledLots = uint(result[3], 'Filled bid lots')
				fill = { filledLots, usedAttoEth: uint(result[4], 'Used ETH'), refundAttoEth: uint(result[6], 'Unused bid ETH'), principalAttoRep: uint(result[5], 'Purchased collateral REP') }
				if (filledLots > bid.lots || fill.usedAttoEth !== filledLots * terms.lotAttoEth || fill.refundAttoEth !== (bid.lots - filledLots) * terms.lotAttoEth) throw new Error('Invalid auction fill accounting.')
				if (filledLots !== 0n) {
					const current = fields(await read(capitalLedger, 'auctionPosition', [id]), ['vault', 'positionId', 'principal', 'commitment', 'targetHealthFactorBps', 'liquidationStarted', 'materialized', 'earnedAttoEth', 'earnedAttoRep'])
					if (address(current[0], 'Capital auction vault') !== vault || bool(current[6]) !== bid.materialized) throw new Error('Auction capital position identity mismatch.')
					position = {
						positionId: uint(current[1], 'Auction position ID', 96),
						principalAttoRep: uint(current[2], 'Current principal REP'),
						commitmentAttoEth: uint(current[3], 'Current commitment ETH'),
						targetHealthFactorBps: uint(current[4], 'Current health target'),
						liquidationStarted: uint(current[5], 'Liquidation start', 48),
						materialized: bool(current[6]),
						earnedAttoEth: uint(current[7], 'Earned ETH'),
						earnedAttoRep: uint(current[8], 'Earned REP'),
					}
				}
			}
			return { ...bid, fill, position }
		}
	}
}
export type PortfolioAuctionSnapshot = Awaited<ReturnType<typeof loadPortfolioAuctionSnapshot>>
