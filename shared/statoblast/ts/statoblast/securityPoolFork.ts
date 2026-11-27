import { encodeFunctionData, getAddress, isAddress, parseAbi, zeroAddress, type Address, type AbiValue } from '@zoltar/core-shared/evm/ethereum'
import type { SecurityPoolReadClient } from './securityPoolRead.js'
import { decodeBool, decodeFields, decodeUint } from './securityPoolDecoding.js'

const abi = parseAbi([
	'function forkController() view returns (address)',
	'function securityPool() view returns (address)',
	'function zoltar() view returns (address)',
	'function getForkTime(uint248 universeId) view returns (uint256)',
	'function getForkChoiceDeadline(uint248 universeId) view returns (uint256)',
	'function getForkRecapitalizationDeadline(uint248 universeId) view returns (uint256)',
	'function getChildUniverseId(uint248 universeId,uint256 outcome) pure returns (uint248)',
	'function getRepToken(uint248 universeId) view returns (address)',
	'function capitalLedger(uint248 universeId) view returns (address)',
	'function forks(uint248 universeId) view returns (uint256 backing,uint256 commitment,uint256 cash,uint256 units,uint256 recoveryAttoRep,uint256 assignedCash,uint256 neutralCash,uint256 recoveredUnits,bool frozen,bool recoveryFunded,bool migrationPrepared)',
	'function branches(uint248 child) view returns (uint248 parent,uint256 outcome,uint256 chosenBacking,uint256 chosenCommitment,uint256 parentCash,uint256 recoveryAttoRep,bool prepared,bool started,bool ready,address repairAuction,uint64 fixedRoot)',
	'function choices(uint248 source,address owner) view returns (uint256 outcome,bool recorded)',
	'function freeze(uint248 source)',
	'function choose(uint248 source,uint256 outcome)',
	'function prepareBranch(uint248 source,uint256 outcome) returns (uint248)',
	'function startBranch(uint248 source,uint256 outcome) returns (uint248)',
	'function finalizeBranch(uint248 child)',
	'function recoverUnchosenCash(uint248 source,uint256 questionId,uint256 shares) returns (uint256)',
	'function transferSecurityPoolRecoveryRights(uint248 sourceUniverse,address recipient,uint256[3] amountsAttoShares)',
])
function address(value: unknown, allowZero = false): Address {
	if (typeof value !== 'string' || !isAddress(value) || (!allowZero && getAddress(value) === zeroAddress)) throw new Error('Choose a nonzero contract address.')
	return getAddress(value)
}
type ForkRequest = { owner: Address; controller: Address; universeId: bigint }
function request(parameters: ForkRequest, functionName: string, args: readonly AbiValue[] = [], value = 0n) {
	return { account: address(parameters.owner), to: address(parameters.controller), value: decodeUint(value, 'Transaction value'), data: encodeFunctionData({ abi, functionName, args: [decodeUint(parameters.universeId, 'Universe', 248), ...args] }) }
}
/** One irrevocable choice moves the owner's committed principal; idle REP and old fees stay in the source. */
export function buildSecurityPoolForkChoiceRequest(parameters: ForkRequest & { outcomeIndex: bigint }) {
	return request(parameters, 'choose', [decodeUint(parameters.outcomeIndex, 'Fork outcome')])
}
/** Prepare one branch's capital modules in a separate, bounded deployment transaction. */
export function buildSecurityPoolForkPreparationRequest(parameters: ForkRequest & { outcomeIndex: bigint }) {
	return request(parameters, 'prepareBranch', [decodeUint(parameters.outcomeIndex, 'Fork outcome')])
}
/** Permissionless shared preparation touches one branch, independently of question count. */
export function buildSecurityPoolForkStartRequest(parameters: ForkRequest & { outcomeIndex: bigint }) {
	return request(parameters, 'startBranch', [decodeUint(parameters.outcomeIndex, 'Fork outcome')])
}
export function buildSecurityPoolForkFinalizeRequest(parameters: ForkRequest) {
	return request(parameters, 'finalizeBranch')
}
export function buildSecurityPoolForkRecoveryRequest(parameters: ForkRequest & { questionId: bigint; shares: bigint }) {
	const shares = decodeUint(parameters.shares, 'Complete sets')
	if (shares === 0n) throw new Error('Recovery shares must be positive.')
	return request(parameters, 'recoverUnchosenCash', [decodeUint(parameters.questionId, 'Question'), shares])
}
/** Transfer only source cash-recovery rights, in Invalid/Yes/No order, without moving branch shares. */
export function buildSecurityPoolRecoveryRightsTransferRequest(parameters: { owner: Address; shareToken: Address; universeId: bigint; recipient: Address; amountsAttoShares: readonly [bigint, bigint, bigint] }) {
	const owner = address(parameters.owner)
	const recipient = address(parameters.recipient)
	if (owner === recipient) throw new Error('Enter a different recipient address.')
	const amounts = parameters.amountsAttoShares.map(amount => decodeUint(amount, 'Recovery rights amount'))
	if (amounts.length !== 3 || amounts.every(amount => amount === 0n)) throw new Error('Choose positive recovery rights for at least one of three outcomes.')
	return { account: owner, to: address(parameters.shareToken), value: 0n, data: encodeFunctionData({ abi, functionName: 'transferSecurityPoolRecoveryRights', args: [decodeUint(parameters.universeId, 'Universe', 248), recipient, amounts] }) }
}
export type SecurityPoolForkSnapshot = Awaited<ReturnType<typeof loadSecurityPoolForkSnapshot>>
/** Bounded reads at one block; no owner, question, bid or ancestor enumeration. */
export async function loadSecurityPoolForkSnapshot(parameters: { client: SecurityPoolReadClient; securityPool: Address; owner: Address; universeId: bigint; outcomeIndex?: bigint }) {
	const { client } = parameters
	const securityPool = address(parameters.securityPool)
	const owner = address(parameters.owner)
	const universeId = decodeUint(parameters.universeId, 'Universe', 248)
	const [block, chainId] = await Promise.all([client.getBlock(), client.getChainId()])
	if (block.number === undefined || block.hash === undefined) throw new Error('Fork snapshot requires a mined block.')
	const blockNumber = block.number
	const blockHash = block.hash
	const read = (target: Address, functionName: string, args: readonly AbiValue[] = []) => client.readContract({ address: target, abi, functionName, args, blockNumber })
	const [controllerValue, zoltarValue] = await Promise.all([read(securityPool, 'forkController'), read(securityPool, 'zoltar')])
	const controller = address(controllerValue)
	const zoltar = address(zoltarValue)
	const [authority, protocol, forkTimeValue, choiceDeadlineValue, activationDeadlineValue, forkValue, choiceValue] = await Promise.all([
		read(controller, 'securityPool'),
		read(controller, 'zoltar'),
		read(zoltar, 'getForkTime', [universeId]),
		read(zoltar, 'getForkChoiceDeadline', [universeId]),
		read(zoltar, 'getForkRecapitalizationDeadline', [universeId]),
		read(controller, 'forks', [universeId]),
		read(controller, 'choices', [universeId, owner]),
	])
	if (address(authority) !== securityPool || address(protocol) !== zoltar) throw new Error('The fork contract belongs to a different security pool.')
	const f = decodeFields(forkValue, ['backing', 'commitment', 'cash', 'units', 'recoveryAttoRep', 'assignedCash', 'neutralCash', 'recoveredUnits', 'frozen', 'recoveryFunded', 'migrationPrepared'], 'Invalid security pool fork response.')
	const c = decodeFields(choiceValue, ['outcome', 'recorded'], 'Invalid security pool fork response.')
	const fork = {
		backing: decodeUint(f[0], 'Fork backing'),
		commitment: decodeUint(f[1], 'Fork commitment'),
		cash: decodeUint(f[2], 'Fork cash'),
		units: decodeUint(f[3], 'Fork units'),
		recoveryAttoRep: decodeUint(f[4], 'Fork recovery REP'),
		assignedCash: decodeUint(f[5], 'Assigned cash'),
		neutralCash: decodeUint(f[6], 'Neutral cash'),
		recoveredUnits: decodeUint(f[7], 'Recovered units'),
		frozen: decodeBool(f[8], 'Invalid security pool fork state.'),
		recoveryFunded: decodeBool(f[9], 'Invalid security pool fork state.'),
		migrationPrepared: decodeBool(f[10], 'Invalid security pool fork state.'),
	}
	if (fork.assignedCash > fork.cash || fork.recoveredUnits > fork.units) throw new Error('Invalid fork accounting.')
	const choice = { outcomeIndex: decodeUint(c[0], 'Chosen outcome'), recorded: decodeBool(c[1], 'Invalid security pool fork state.') }
	const chosenOutcome = choice.recorded ? choice.outcomeIndex : undefined
	const outcomeIndex = parameters.outcomeIndex === undefined ? chosenOutcome : decodeUint(parameters.outcomeIndex, 'Fork outcome')
	let branch: { universeId: bigint; parent: bigint; outcomeIndex: bigint; chosenBacking: bigint; chosenCommitment: bigint; parentCash: bigint; recoveryAttoRep: bigint; prepared: boolean; started: boolean; ready: boolean; repToken: Address; capitalLedger: Address } | undefined
	if (outcomeIndex !== undefined) {
		const child = decodeUint(await read(zoltar, 'getChildUniverseId', [universeId, outcomeIndex]), 'Child universe', 248)
		const b = decodeFields(await read(controller, 'branches', [child]), ['parent', 'outcome', 'chosenBacking', 'chosenCommitment', 'parentCash', 'recoveryAttoRep', 'prepared', 'started', 'ready', 'repairAuction', 'fixedRoot'], 'Invalid security pool fork response.')
		const prepared = decodeBool(b[6], 'Invalid security pool fork state.')
		const parent = decodeUint(b[0], 'Parent universe', 248)
		const branchOutcome = decodeUint(b[1], 'Branch outcome')
		if (prepared && (parent !== universeId || branchOutcome !== outcomeIndex)) throw new Error('Selected branch belongs to a different fork.')
		const [token, capital] = prepared ? await Promise.all([read(zoltar, 'getRepToken', [child]), read(securityPool, 'capitalLedger', [child])]) : [zeroAddress, zeroAddress]
		branch = {
			universeId: child,
			parent,
			outcomeIndex,
			chosenBacking: decodeUint(b[2], 'Chosen backing'),
			chosenCommitment: decodeUint(b[3], 'Chosen commitment'),
			parentCash: decodeUint(b[4], 'Child cash'),
			recoveryAttoRep: decodeUint(b[5], 'Claim recovery REP'),
			prepared,
			started: decodeBool(b[7], 'Invalid security pool fork state.'),
			ready: decodeBool(b[8], 'Invalid security pool fork state.'),
			repToken: address(token, true),
			capitalLedger: address(capital, !prepared),
		}
	}
	const forkTime = decodeUint(forkTimeValue, 'Fork time')
	const choiceDeadline = decodeUint(choiceDeadlineValue, 'Choice deadline')
	const activationDeadline = decodeUint(activationDeadlineValue, 'Activation deadline')
	if (forkTime !== 0n && (choiceDeadline <= forkTime || activationDeadline <= choiceDeadline)) throw new Error('Invalid native fork deadlines.')
	const [finalBlock, finalChain] = await Promise.all([client.getBlock({ blockNumber }), client.getChainId()])
	if (finalChain !== chainId || finalBlock.hash !== blockHash) throw new Error('Fork snapshot changed. Refresh and retry.')
	return { chainId, blockNumber, blockHash, timestamp: block.timestamp, securityPool, owner, controller, zoltar, universeId, forkTime, choiceDeadline, activationDeadline, fork, choice, branch }
}
