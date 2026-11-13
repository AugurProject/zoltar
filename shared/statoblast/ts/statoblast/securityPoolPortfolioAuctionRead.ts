import { parseAbi, zeroAddress, type AbiValue, type Address } from '@zoltar/core-shared/evm/ethereum'
import type { PortfolioReadClient } from './securityPoolPortfolioRead.js'
import { predictAuctionVaultAddress } from './securityPoolAuctionVaultClones.js'
import { decodeAddress, decodeBool, decodeFields, decodeUint } from './securityPoolPortfolioDecoding.js'

const abi = parseAbi([
	'function collateralToken() view returns (address)',
	'function balanceOf(address owner) view returns (uint256)',
	'function allowance(address owner,address spender) view returns (uint256)',
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
	'function vaultImplementation() view returns (address)',
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
	'function earlyRefundAttoEth(uint256 bidId) view returns (uint256)',
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
export type PortfolioAuctionBid = {
	id: bigint
	bidder: Address
	vault: Address
	targetHealthFactorBps: bigint
	lots: bigint
	minimumAttoRepPerLot: bigint
	refundSettled: boolean
	earlyRefundAttoEth: bigint
	materialized: boolean
	position: { positionId: bigint; principalAttoRep: bigint; commitmentAttoEth: bigint; targetHealthFactorBps: bigint; liquidationStarted: bigint; materialized: boolean; earnedAttoEth: bigint; earnedAttoRep: bigint } | undefined
	fill: { filledLots: bigint; usedAttoEth: bigint; refundAttoEth: bigint; principalAttoRep: bigint } | undefined
}

/** One confirmed block, one explicit bidder page. No historical log or bidder scan. */
export async function loadPortfolioAuctionSnapshot(parameters: { client: AuctionReadClient; portfolio: Address; bidder: Address; universeId: bigint; bidStart?: bigint; bidCount?: number }) {
	const { client } = parameters
	const portfolio = decodeAddress(parameters.portfolio, 'Portfolio')
	const bidder = decodeAddress(parameters.bidder, 'Bidder')
	const universeId = decodeUint(parameters.universeId, 'Universe', 248)
	const bidStart = decodeUint(parameters.bidStart ?? 0n, 'Bid page start')
	const pageSize = parameters.bidCount ?? 16
	if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 64) throw new Error('Choose between 1 and 64 bids per page.')
	const [block, chainId] = await Promise.all([client.getBlock(), client.getChainId()])
	if (block.number === undefined || block.hash === undefined || !Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('Auction snapshot requires a confirmed block and chain.')
	const blockNumber = block.number
	const read = (target: Address, functionName: string, args: readonly AbiValue[] = []) => client.readContract({ address: target, abi, functionName, args, blockNumber })
	const [controllerValue, protocolValue, factoryValue, capitalValue, feedValue, collateralValue] = await Promise.all([
		read(portfolio, 'forkController'),
		read(portfolio, 'zoltar'),
		read(portfolio, 'factory'),
		read(portfolio, 'capitalLedger', [universeId]),
		read(portfolio, 'priceFeed', [universeId]),
		read(portfolio, 'collateralToken'),
	])
	const controller = decodeAddress(controllerValue, 'Fork controller')
	const zoltar = decodeAddress(protocolValue, 'Protocol')
	const factory = decodeAddress(factoryValue, 'Factory')
	const capitalLedger = decodeAddress(capitalValue, 'Capital ledger', true)
	const priceFeed = decodeAddress(feedValue, 'Price feed', true)
	const [authorityValue, controllerProtocol, auctionValue, tokenValue, forkTimeValue] = await Promise.all([read(controller, 'portfolio'), read(controller, 'zoltar'), read(controller, 'auctions', [universeId]), read(zoltar, 'getRepToken', [universeId]), read(zoltar, 'getForkTime', [universeId])])
	if (decodeAddress(authorityValue, 'Fork authority') !== portfolio || decodeAddress(controllerProtocol, 'Fork protocol') !== zoltar) throw new Error('Auction fork controller belongs to another portfolio.')
	const auctionAddress = decodeAddress(auctionValue, 'Auction', true)
	const repToken = decodeAddress(tokenValue, 'Branch REP', true)
	const collateralToken = decodeAddress(collateralValue, 'Collateral token')
	const [balanceValue, allowanceValue] = await Promise.all([read(collateralToken, 'balanceOf', [bidder]), auctionAddress === zeroAddress ? 0n : read(collateralToken, 'allowance', [bidder, auctionAddress])])
	const base = {
		collateralToken,
		walletCollateral: decodeUint(balanceValue, 'Wallet collateral'),
		collateralAllowance: decodeUint(allowanceValue, 'Collateral allowance'),
		chainId,
		blockNumber,
		blockHash: block.hash,
		timestamp: block.timestamp,
		portfolio,
		bidder,
		universeId,
		controller,
		zoltar,
		factory,
		capitalLedger,
		priceFeed,
		repToken,
		forkTime: decodeUint(forkTimeValue, 'Fork time'),
	}
	let auction: Awaited<ReturnType<typeof readAuction>> | undefined
	if (auctionAddress !== zeroAddress) {
		if (capitalLedger === zeroAddress || repToken === zeroAddress) throw new Error('Auction capital or REP is unavailable.')
		auction = await readAuction(auctionAddress)
	}
	const [finalBlock, finalChain] = await Promise.all([client.getBlock({ blockNumber }), client.getChainId()])
	if (finalBlock.hash !== block.hash || finalChain !== chainId) throw new Error('Auction state changed. Refresh and retry.')
	return { ...base, auction }

	async function readAuction(auctionAddress: Address) {
		const [fork, root, capital, engineValue, token, child, closes, inventory, shortfall, lot, target, grid, openingPrice, minimumCollateral, openedValue, finalizedValue, multiplier, capitalRoot, capitalProtocol, capitalChild, capitalToken, capitalFork, implementationValue] = await Promise.all([
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
			read(auctionAddress, 'vaultImplementation'),
		])
		if (
			decodeAddress(fork, 'Auction fork authority') !== controller ||
			decodeAddress(root, 'Auction portfolio') !== portfolio ||
			decodeAddress(capital, 'Auction capital') !== capitalLedger ||
			decodeAddress(token, 'Auction REP') !== repToken ||
			decodeUint(child, 'Auction universe', 248) !== universeId ||
			decodeAddress(capitalRoot, 'Capital portfolio') !== portfolio ||
			decodeAddress(capitalProtocol, 'Capital protocol') !== zoltar ||
			decodeUint(capitalChild, 'Capital universe', 248) !== universeId ||
			decodeAddress(capitalToken, 'Capital REP') !== repToken ||
			decodeAddress(capitalFork, 'Capital fork authority') !== controller
		)
			throw new Error('Auction identities do not match the selected branch.')
		const engine = decodeAddress(engineValue, 'Auction engine')
		const vaultImplementation = decodeAddress(implementationValue, 'Vault implementation')
		const opened = decodeBool(openedValue, 'Invalid auction state.')
		const finalized = decodeBool(finalizedValue, 'Invalid auction state.')
		const [engineController, initialized, engineFinalized, maximum, deposited, count, bidCredit] = await Promise.all([
			read(engine, 'controller'),
			read(engine, 'initialized'),
			read(engine, 'finalized'),
			read(engine, 'maximumBidAttoRepPerLot'),
			read(engine, 'depositedAttoEth'),
			read(engine, 'bidderBidCount', [bidder]),
			read(engine, 'refundCreditAttoEth', [bidder]),
		])
		if (decodeAddress(engineController, 'Engine controller') !== auctionAddress || decodeBool(initialized, 'Invalid auction state.') !== opened || decodeBool(engineFinalized, 'Invalid auction state.') !== (opened && finalized)) throw new Error('Auction engine identity or state is inconsistent.')
		const terms = {
			address: auctionAddress,
			engine,
			vaultImplementation,
			opened,
			finalized,
			closesAt: decodeUint(closes, 'Auction close'),
			inventoryAttoRep: decodeUint(inventory, 'REP inventory'),
			shortfallAttoEth: decodeUint(shortfall, 'ETH shortfall'),
			lotAttoEth: decodeUint(lot, 'ETH lot'),
			targetLots: decodeUint(target, 'Target lots'),
			repGrid: decodeUint(grid, 'REP grid'),
			openingConservativePrice: decodeUint(openingPrice, 'Opening price'),
			minimumCollateralAttoRepPerLot: decodeUint(minimumCollateral, 'Minimum collateral per lot'),
			securityMultiplierBps: decodeUint(multiplier, 'Security multiplier'),
			maximumBidAttoRepPerLot: decodeUint(maximum, 'Maximum bid REP per lot'),
			depositedAttoEth: decodeUint(deposited, 'Bid escrow'),
			refundAttoEth: decodeUint(bidCredit, 'Bid refund'),
		}
		if (terms.lotAttoEth === 0n || terms.repGrid === 0n || terms.targetLots !== terms.shortfallAttoEth / terms.lotAttoEth) throw new Error('Invalid auction lot configuration.')
		let price: { conservativePrice: bigint; validUntil: bigint; lastSettlementTimestamp: bigint; exposureLimitAttoEth: bigint; exposureLimitAttoRep: bigint; requiredExposureAttoEth: bigint } | undefined
		if (priceFeed !== zeroAddress) {
			const [values, exposureValue] = await Promise.all([Promise.all(['conservativePrice', 'priceValidUntil', 'lastSettlementTimestamp', 'acceptedExposureLimitAttoEth', 'acceptedRepExposureLimitAttoRep'].map(name => read(priceFeed, name))), read(portfolio, 'oracleExposure', [universeId])])
			price = {
				conservativePrice: decodeUint(values[0], 'Conservative price'),
				validUntil: decodeUint(values[1], 'Price validity'),
				lastSettlementTimestamp: decodeUint(values[2], 'Price settlement'),
				exposureLimitAttoEth: decodeUint(values[3], 'Funded ETH exposure'),
				exposureLimitAttoRep: decodeUint(values[4], 'Funded REP exposure'),
				requiredExposureAttoEth: decodeUint(exposureValue, 'Required report exposure'),
			}
		}
		const totalBidCount = decodeUint(count, 'Bid count')
		const start = bidStart > totalBidCount ? totalBidCount : bidStart
		const remaining = totalBidCount - start
		const size = Number(remaining < BigInt(pageSize) ? remaining : BigInt(pageSize))
		const bids = await Promise.all(Array.from({ length: size }, (_, offset) => readBid(decodeUint(start + BigInt(offset), 'Bid index'))))
		let clearing: { attoRepPerLot: bigint; filledLots: bigint; raisedAttoEth: bigint; soldAttoRep: bigint; roundingAttoRep: bigint; raiseLimitReached: boolean } | undefined
		if (opened && finalized) {
			const result = decodeFields(await read(engine, 'clearing'), ['attoRepPerLot', 'filledLots', 'raisedAttoEth', 'soldAttoRep', 'roundingAttoRep', 'marginalMinimumAttoRepPerLot', 'marginalFillLots', 'marginalDemandLots', 'fullBeforeLots', 'raiseLimitReached'], 'Invalid auction response.')
			clearing = {
				attoRepPerLot: decodeUint(result[0], 'Clearing REP per lot'),
				filledLots: decodeUint(result[1], 'Filled lots'),
				raisedAttoEth: decodeUint(result[2], 'Raised ETH'),
				soldAttoRep: decodeUint(result[3], 'Sold REP'),
				roundingAttoRep: decodeUint(result[4], 'REP rounding fees'),
				raiseLimitReached: decodeBool(result[9], 'Invalid auction state.'),
			}
		}
		return { ...terms, price, clearing, totalBidCount, bidStart: start, bids }

		async function readBid(index: bigint): Promise<PortfolioAuctionBid> {
			const id = decodeUint(await read(engine, 'bidderBidId', [bidder, index]), 'Bid ID')
			if (id === 0n) throw new Error('Auction bid ID is missing.')
			const values = decodeFields(await read(engine, 'bids', [id]), ['bidder', 'vault', 'targetHealthBps', 'lots', 'minimumAttoRepPerLot', 'settled', 'feesRemoved'], 'Invalid auction response.')
			const vault = decodeAddress(values[1], 'Auction vault')
			const [vaultOwner, vaultCapital, vaultAuction, vaultId, registeredId] = await Promise.all([read(vault, 'owner'), read(vault, 'initialCapital'), read(vault, 'auction'), read(vault, 'bidId'), read(auctionAddress, 'bidIdForVault', [vault])])
			if (
				decodeAddress(values[0], 'Bid owner') !== bidder ||
				decodeAddress(vaultOwner, 'Vault owner') !== bidder ||
				decodeAddress(vaultCapital, 'Vault initial capital') !== capitalLedger ||
				decodeAddress(vaultAuction, 'Vault auction') !== auctionAddress ||
				decodeUint(vaultId, 'Vault bid ID') !== id ||
				decodeUint(registeredId, 'Registered vault bid') !== id ||
				predictAuctionVaultAddress({ implementation: vaultImplementation, owner: bidder, capital: capitalLedger, auction: auctionAddress, bidId: id }) !== vault
			)
				throw new Error('Auction bid or vault belongs to another account.')
			const bid = {
				id,
				bidder,
				vault,
				targetHealthFactorBps: decodeUint(values[2], 'Bid health target'),
				lots: decodeUint(values[3], 'Bid lots'),
				minimumAttoRepPerLot: decodeUint(values[4], 'Bid REP limit'),
				refundSettled: decodeBool(values[5], 'Invalid auction state.'),
				materialized: decodeBool(values[6], 'Invalid auction state.'),
			}
			let fill: PortfolioAuctionBid['fill']
			let position: PortfolioAuctionBid['position']
			if (finalized) {
				const result = decodeFields(await read(engine, 'previewBid', [id]), ['bidder', 'vault', 'targetHealthBps', 'filledLots', 'usedAttoEth', 'principalAttoRep', 'refundAttoEth'], 'Invalid auction response.')
				if (decodeAddress(result[0], 'Fill bidder') !== bidder || decodeAddress(result[1], 'Fill vault') !== vault || decodeUint(result[2], 'Fill health') !== bid.targetHealthFactorBps) throw new Error('Auction fill identity mismatch.')
				const filledLots = decodeUint(result[3], 'Filled bid lots')
				fill = { filledLots, usedAttoEth: decodeUint(result[4], 'Used ETH'), refundAttoEth: decodeUint(result[6], 'Unused bid ETH'), principalAttoRep: decodeUint(result[5], 'Purchased collateral REP') }
				if (filledLots > bid.lots || fill.usedAttoEth !== filledLots * terms.lotAttoEth || fill.refundAttoEth !== (bid.lots - filledLots) * terms.lotAttoEth) throw new Error('Invalid auction fill accounting.')
				if (filledLots !== 0n) {
					const current = decodeFields(await read(capitalLedger, 'auctionPosition', [id]), ['vault', 'positionId', 'principal', 'commitment', 'targetHealthFactorBps', 'liquidationStarted', 'materialized', 'earnedAttoEth', 'earnedAttoRep'], 'Invalid auction response.')
					if (decodeAddress(current[0], 'Capital auction vault') !== vault || decodeBool(current[6], 'Invalid auction state.') !== bid.materialized) throw new Error('Auction capital position identity mismatch.')
					position = {
						positionId: decodeUint(current[1], 'Auction position ID', 96),
						principalAttoRep: decodeUint(current[2], 'Current principal REP'),
						commitmentAttoEth: decodeUint(current[3], 'Current commitment ETH'),
						targetHealthFactorBps: decodeUint(current[4], 'Current health target'),
						liquidationStarted: decodeUint(current[5], 'Liquidation start', 48),
						materialized: decodeBool(current[6], 'Invalid auction state.'),
						earnedAttoEth: decodeUint(current[7], 'Earned ETH'),
						earnedAttoRep: decodeUint(current[8], 'Earned REP'),
					}
				}
			}
			const earlyRefundAttoEth = !finalized && !bid.refundSettled ? decodeUint(await read(engine, 'earlyRefundAttoEth', [id]), 'Early refund ETH') : 0n
			if (earlyRefundAttoEth !== 0n && earlyRefundAttoEth !== bid.lots * terms.lotAttoEth) throw new Error('Invalid early auction refund accounting.')
			return { ...bid, earlyRefundAttoEth, fill, position }
		}
	}
}
export type PortfolioAuctionSnapshot = Awaited<ReturnType<typeof loadPortfolioAuctionSnapshot>>
