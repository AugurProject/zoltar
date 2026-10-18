import { encodeFunctionData, getAddress, isAddress, isHex, parseAbi, zeroAddress, zeroHash, type Address, type AbiValue } from '@zoltar/core-shared/evm/ethereum'
import type { PortfolioReadClient } from './securityPoolPortfolioRead.js'

const abi = parseAbi([
	'function forkController() view returns (address)',
	'function contextCount() view returns (uint256)',
	'function getContext(uint256 contextId) view returns ((uint248 universeId,uint256 parentContextId,uint256 outcomeIndex,uint256 incomingActivationFloor,address ledger,address repToken,uint256 pointCount))',
	'function choiceWindow(uint256 contextId) view returns (uint256 opensAt,uint256 closesAt)',
	'function choices(uint256 contextId,address owner,uint256 intervalId) view returns (bool selected,uint256 outcomeIndex,uint256 childIntervalId)',
	'function childContextIds(uint256 contextId,uint256 outcomeIndex) view returns (uint256)',
	'function getOwnerIntervalCount(address owner) view returns (uint256)',
	'function getOwnerInterval(address owner,uint256 intervalId) view returns ((uint256 generation,uint256 startPosition,uint256 endPosition,uint256 shares,uint256 repIndex,uint256 feeIndex,bool open,bool active))',
	'function previewClaim(address owner,uint256[] intervalIds) view returns (uint256 rep,uint256 eth)',
	'function readPosition(uint256 contextId,uint256 positionId) view returns ((address custody,uint256 remainingShares,uint256 unmigratedShares,bool recoveryComplete))',
	'function processedPositions(uint256 contextId,uint256 positionId) view returns (bool)',
	'function getBranchWeight(uint256 contextId,uint256 positionId,uint256 outcomeIndex) view returns (uint256)',
	'function positions(uint256 positionId) view returns (uint256 questionId,uint256 totalShares,uint256 remainingShares,address custody)',
	'function factory() view returns (address)',
	'function questionOriginIds(uint256 questionId) view returns (bytes32)',
	'function getSecurityPool(bytes32 originId,uint248 universeId) view returns (address)',
	'function chooseSharedFork(uint256 contextId,uint256[] intervalIds,uint256 outcomeIndex)',
	'function revokeSharedFork(uint256 contextId,uint256[] intervalIds)',
	'function processForkPosition(uint256 contextId,uint256 positionId,uint256 outcomeIndex) returns (bool)',
	'function claimForkRecovered(uint256 contextId,uint256[] intervalIds,uint256[] positionIds)',
	'function claimPosition(uint256 contextId,uint256 positionId,uint256 intervalId)',
	'function claimPositionAndMigrate(uint256 contextId,uint256 positionId,uint256 intervalId,uint256 outcomeIndex)',
])

function uint(value: unknown, label: string): bigint {
	if (typeof value !== 'bigint' || value < 0n || value >= 1n << 256n) throw new Error(`${label} must fit uint256.`)
	return value
}

function address(value: unknown, allowZero = false): Address {
	if (typeof value !== 'string' || !isAddress(value) || (!allowZero && getAddress(value) === zeroAddress)) throw new Error('Choose a nonzero contract address.')
	return getAddress(value)
}

function fields(value: unknown, names: string[]): unknown[] {
	if (Array.isArray(value) && value.length === names.length) return value
	if (value !== null && typeof value === 'object') return names.map(name => Reflect.get(value, name))
	throw new Error('Invalid shared fork response.')
}

function bool(value: unknown): boolean {
	if (typeof value !== 'boolean') throw new Error('Invalid shared fork state.')
	return value
}

function ids(values: readonly bigint[], label: string) {
	return [...new Set(values.map(value => uint(value, label)))].sort((left, right) => {
		if (left === right) return 0
		return left < right ? -1 : 1
	})
}

type OwnerRequest = { owner: Address; controller: Address; contextId: bigint }

function request(parameters: OwnerRequest, functionName: string, args: readonly AbiValue[]) {
	return { account: address(parameters.owner), to: address(parameters.controller), value: 0n, data: encodeFunctionData({ abi, functionName, args: [uint(parameters.contextId, 'Fork context'), ...args] }) }
}

/** Selects or replaces a branch for caller-owned intervals before their shared cutoff. */
export function buildPortfolioSharedForkChoiceRequest(parameters: OwnerRequest & { intervalIds: readonly bigint[]; outcomeIndex: bigint }) {
	const intervalIds = ids(parameters.intervalIds, 'Owner interval')
	if (intervalIds.length === 0) throw new Error('Choose at least one ownership interval.')
	return request(parameters, 'chooseSharedFork', [intervalIds, uint(parameters.outcomeIndex, 'Fork outcome')])
}

export function buildPortfolioSharedForkRevokeRequest(parameters: OwnerRequest & { intervalIds: readonly bigint[] }) {
	const intervalIds = ids(parameters.intervalIds, 'Owner interval')
	if (intervalIds.length === 0) throw new Error('Choose at least one ownership interval.')
	return request(parameters, 'revokeSharedFork', [intervalIds])
}

/** Permissionless work names exactly one allocation and branch, independent of its owner count. */
export function buildPortfolioSharedForkProcessRequest(parameters: OwnerRequest & { positionId: bigint; outcomeIndex: bigint }) {
	if (uint(parameters.positionId, 'Position id') === 0n) throw new Error('Choose an allocation position.')
	return request(parameters, 'processForkPosition', [parameters.positionId, uint(parameters.outcomeIndex, 'Fork outcome')])
}

/** Processing may make progress without immediately releasing any child REP. */
export function buildPortfolioSharedForkRecoveryRequest(parameters: OwnerRequest & { intervalIds: readonly bigint[]; positionIds?: readonly bigint[] }) {
	const positionIds = ids(parameters.positionIds ?? [], 'Position id')
	if (positionIds.includes(0n)) throw new Error('Choose an allocation position.')
	return request(parameters, 'claimForkRecovered', [ids(parameters.intervalIds, 'Owner interval'), positionIds])
}

export function buildPortfolioContextPositionClaimRequest(parameters: OwnerRequest & { positionId: bigint; intervalId: bigint; outcomeIndex?: bigint }) {
	if (uint(parameters.positionId, 'Position id') === 0n) throw new Error('Choose an allocation position.')
	const args = [parameters.positionId, uint(parameters.intervalId, 'Owner interval')]
	if (parameters.outcomeIndex === undefined) return request(parameters, 'claimPosition', args)
	return request(parameters, 'claimPositionAndMigrate', [...args, uint(parameters.outcomeIndex, 'Fork outcome')])
}

export type PortfolioSharedForkSnapshot = Awaited<ReturnType<typeof loadPortfolioSharedForkSnapshot>>

/** Reads only one context and one personal history page, all anchored to a single mined block. */
export async function loadPortfolioSharedForkSnapshot(parameters: { client: PortfolioReadClient; portfolio: Address; owner: Address; contextId: bigint; intervalStart?: bigint; outcomeIndex?: bigint }) {
	const { client } = parameters
	const portfolio = address(parameters.portfolio)
	const owner = address(parameters.owner)
	const contextId = uint(parameters.contextId, 'Fork context')
	const intervalStart = uint(parameters.intervalStart ?? 0n, 'Owner interval page')
	const outcomeIndex = parameters.outcomeIndex === undefined ? undefined : uint(parameters.outcomeIndex, 'Fork outcome')
	const [block, chainId] = await Promise.all([client.getBlock(), client.getChainId()])
	if (block.number === undefined || block.hash === undefined) throw new Error('Shared fork snapshot requires a mined block.')
	const blockNumber = block.number
	const blockHash = block.hash
	const read = (target: Address, functionName: string, args: readonly AbiValue[] = []) => client.readContract({ address: target, abi, functionName, args, blockNumber })
	const controller = address(await read(portfolio, 'forkController'))
	const contextCount = uint(await read(controller, 'contextCount'), 'Fork context count')
	if (contextId >= contextCount) throw new Error('Choose an existing fork context.')
	const [contextValue, windowValue] = await Promise.all([read(controller, 'getContext', [contextId]), read(controller, 'choiceWindow', [contextId])])
	const context = fields(contextValue, ['universeId', 'parentContextId', 'outcomeIndex', 'incomingActivationFloor', 'ledger', 'repToken', 'pointCount'])
	const window = fields(windowValue, ['opensAt', 'closesAt'])
	const ledger = address(context[4])
	const intervalCount = uint(await read(ledger, 'getOwnerIntervalCount', [owner]), 'Owner interval count')
	if (intervalStart > intervalCount) throw new Error('Owner interval page is out of bounds.')
	const count = intervalCount - intervalStart < 64n ? intervalCount - intervalStart : 64n
	const intervals = await Promise.all(
		Array.from({ length: Number(count) }, async (_, offset) => {
			const intervalId = intervalStart + BigInt(offset)
			const [intervalValue, choiceValue] = await Promise.all([read(ledger, 'getOwnerInterval', [owner, intervalId]), read(controller, 'choices', [contextId, owner, intervalId])])
			const interval = fields(intervalValue, ['generation', 'startPosition', 'endPosition', 'shares', 'repIndex', 'feeIndex', 'open', 'active'])
			const choice = fields(choiceValue, ['selected', 'outcomeIndex', 'childIntervalId'])
			return {
				intervalId,
				startPosition: uint(interval[1], 'First position'),
				endPosition: uint(interval[2], 'Last position'),
				shares: uint(interval[3], 'Owner shares'),
				open: bool(interval[6]),
				active: bool(interval[7]),
				selected: bool(choice[0]),
				outcomeIndex: uint(choice[1], 'Selected outcome'),
				childIntervalId: uint(choice[2], 'Child interval'),
			}
		}),
	)
	const activeIds = intervals.filter(interval => interval.active).map(interval => interval.intervalId)
	const [recoveryValue, childContextValue] = await Promise.all([read(ledger, 'previewClaim', [owner, activeIds]), outcomeIndex === undefined ? Promise.resolve(0n) : read(controller, 'childContextIds', [contextId, outcomeIndex])])
	const recovery = fields(recoveryValue, ['rep', 'eth'])
	const branchOutcomes = [...new Set(intervals.filter(interval => interval.active && interval.selected).map(interval => interval.outcomeIndex))]
	const branches = await Promise.all(branchOutcomes.map(async outcomeIndex => ({ outcomeIndex, contextId: uint(await read(controller, 'childContextIds', [contextId, outcomeIndex]), 'Child context') })))
	const parentContext = contextId === 0n ? context : fields(await read(controller, 'getContext', [uint(context[1], 'Parent context')]), ['universeId', 'parentContextId', 'outcomeIndex', 'incomingActivationFloor', 'ledger', 'repToken', 'pointCount'])
	const [anchor, latestChainId] = await Promise.all([client.getBlock({ blockNumber }), client.getChainId()])
	if (anchor.hash !== blockHash || latestChainId !== chainId) throw new Error('Chain changed while reading shared fork choices. Refresh and try again.')
	return {
		portfolio,
		owner,
		controller,
		contextId,
		contextCount,
		chainId,
		blockNumber,
		blockHash,
		timestamp: block.timestamp,
		universeId: uint(context[0], 'Universe id'),
		parentContextId: uint(context[1], 'Parent context'),
		incomingOutcomeIndex: uint(context[2], 'Incoming outcome'),
		incomingActivationFloor: uint(context[3], 'Incoming fork floor'),
		ledger,
		repToken: address(context[5]),
		positionCount: uint(context[6], 'Allocation count'),
		parentUniverseId: uint(parentContext[0], 'Parent universe'),
		branches,
		opensAt: uint(window[0], 'Choice opening'),
		closesAt: uint(window[1], 'Choice cutoff'),
		intervalCount,
		intervalStart,
		intervals,
		recoverableRepAttoRep: uint(recovery[0], 'Recovered REP'),
		recoverableFeesAttoEth: uint(recovery[1], 'Recovered fees'),
		childContextId: uint(childContextValue, 'Child context'),
		selectedOutcomeIndex: outcomeIndex,
	}
}

/** One selected position only; child custody may remain unmaterialized while ownership already exists. */
export async function loadPortfolioSharedForkPosition(parameters: { client: PortfolioReadClient; snapshot: PortfolioSharedForkSnapshot; positionId: bigint; outcomeIndex?: bigint }) {
	const { client, snapshot } = parameters
	const positionId = uint(parameters.positionId, 'Position id')
	if (parameters.outcomeIndex !== undefined && parameters.outcomeIndex !== snapshot.selectedOutcomeIndex) throw new Error('Refresh the shared fork snapshot for this outcome.')
	if (positionId === 0n || positionId > snapshot.positionCount) throw new Error('Choose an allocation in this fork context.')
	const read = (target: Address, functionName: string, args: readonly AbiValue[]) => client.readContract({ address: target, abi, functionName, args, blockNumber: snapshot.blockNumber })
	const [positionValue, allocationValue, weightValue, processedValue] = await Promise.all([
		read(snapshot.controller, 'readPosition', [snapshot.contextId, positionId]),
		read(snapshot.portfolio, 'positions', [positionId]),
		parameters.outcomeIndex === undefined ? Promise.resolve(0n) : read(snapshot.controller, 'getBranchWeight', [snapshot.contextId, positionId, uint(parameters.outcomeIndex, 'Fork outcome')]),
		snapshot.childContextId === 0n ? Promise.resolve(false) : read(snapshot.controller, 'processedPositions', [snapshot.childContextId, positionId]),
	])
	const position = fields(positionValue, ['custody', 'remainingShares', 'unmigratedShares', 'recoveryComplete'])
	const allocation = fields(allocationValue, ['questionId', 'totalShares', 'remainingShares', 'custody'])
	const questionId = uint(allocation[0], 'Question id')
	const [factoryValue, originId] = await Promise.all([read(snapshot.portfolio, 'factory', []), read(snapshot.portfolio, 'questionOriginIds', [questionId])])
	if (typeof originId !== 'string' || !isHex(originId) || originId.length !== 66) throw new Error('Invalid registered question origin.')
	if (originId === zeroHash) throw new Error('Question not registered in this portfolio.')
	// Enrollment creates ownership before its pool exists; the canonical factory preserves that absence.
	const pool = address(await read(address(factoryValue), 'getSecurityPool', [originId, snapshot.universeId]), true)
	const [anchor, chainId] = await Promise.all([client.getBlock({ blockNumber: snapshot.blockNumber }), client.getChainId()])
	if (anchor.hash !== snapshot.blockHash || chainId !== snapshot.chainId) throw new Error('Chain changed while reading shared fork requirements. Refresh and try again.')
	return { positionId, questionId, pool, custody: address(position[0], true), remainingShares: uint(position[1], 'Remaining shares'), unmigratedShares: uint(position[2], 'Unmigrated shares'), recoveryComplete: bool(position[3]), branchWeight: uint(weightValue, 'Branch shares'), branchProcessed: bool(processedValue) }
}
