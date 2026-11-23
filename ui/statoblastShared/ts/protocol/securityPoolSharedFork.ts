import { encodeFunctionData, parseAbi, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import type { SecurityPoolForkSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPool'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { requireAddressValue, requireBigintValue, requireBigintArray, requireBooleanValue } from './decoders.js'
import { loadSecurityPoolForkOutcome } from './securityPoolFork.js'
import { getInfraContractAddresses } from './deploymentHelpers.js'

const abi = parseAbi([
	'function factory() view returns (address)',
	'function questionOriginIds(uint256 questionId) view returns (bytes32)',
	'function getQuestionLedger(bytes32 originId,uint248 universeId) view returns (address)',
	'function originUniverseId() view returns (uint248)',
	'function getQuestionLedger(uint256 questionId,uint248 universeId) view returns (address)',
	'function sourceGame(uint248 universeId,uint256 questionId) view returns (address)',
	'function questionLedger() view returns (address)',
	'function shareToken() view returns (address)',
	'function balanceOfSecurityPoolRecoveryRights(uint248 universeId,address owner) view returns (uint256[3])',
	'function isSecurityPoolRecoveryEligible(uint248 universeId) view returns (bool)',
	'function prepareSecurityPoolQuestion(address source,uint248 targetUniverse) returns (address)',
])
export async function loadSharedForkOutcome(client: ReadClient, snapshot: SecurityPoolForkSnapshot, outcomeIndex: bigint) {
	const result = await loadSecurityPoolForkOutcome(client, { zoltar: snapshot.zoltar, universeId: snapshot.universeId, outcomeIndex, blockNumber: snapshot.blockNumber })
	if ((await client.getBlock({ blockNumber: snapshot.blockNumber })).hash !== snapshot.blockHash) throw new Error('Fork snapshot changed. Refresh and retry.')
	return result
}
export async function loadSecurityPoolSourceRecovery(client: ReadClient, snapshot: Pick<SecurityPoolForkSnapshot, 'securityPool' | 'owner' | 'universeId' | 'blockNumber' | 'blockHash'>, questionId: bigint) {
	const blockNumber = snapshot.blockNumber
	const [factoryValue, originId, originValue, gameValue] = await Promise.all([
		client.readContract({ address: snapshot.securityPool, abi, functionName: 'factory', blockNumber }),
		client.readContract({ address: snapshot.securityPool, abi, functionName: 'questionOriginIds', args: [questionId], blockNumber }),
		client.readContract({ address: snapshot.securityPool, abi, functionName: 'originUniverseId', blockNumber }),
		client.readContract({ address: snapshot.securityPool, abi, functionName: 'sourceGame', args: [snapshot.universeId, questionId], blockNumber }),
	])
	const factory = requireAddressValue(factoryValue, 'security pool factory')
	if (typeof originId !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(originId) || BigInt(originId) === 0n) throw new Error('Question is not registered in this security pool.')
	const pool = requireAddressValue(await client.readContract({ address: factory, abi, functionName: 'getQuestionLedger', args: [originId, snapshot.universeId], blockNumber }), 'source pool')
	const origin = requireBigintValue(originValue, 'origin universe')
	const game = requireAddressValue(gameValue, 'source game')
	const sourceValue = game === zeroAddress ? await client.readContract({ address: snapshot.securityPool, abi, functionName: 'getQuestionLedger', args: [questionId, origin], blockNumber }) : await client.readContract({ address: game, abi, functionName: 'questionLedger', blockNumber })
	const source = requireAddressValue(sourceValue, 'reporter source pool')
	if (source === zeroAddress) throw new Error('Question is not registered in this security pool.')
	const shareTokenValue = await client.readContract({ address: source, abi, functionName: 'shareToken', blockNumber })
	const shareToken = requireAddressValue(shareTokenValue, 'source shares')
	const [rightsValue, eligibleValue] = await Promise.all([
		client.readContract({ address: shareToken, abi, functionName: 'balanceOfSecurityPoolRecoveryRights', args: [snapshot.universeId, snapshot.owner], blockNumber }),
		client.readContract({ address: shareToken, abi, functionName: 'isSecurityPoolRecoveryEligible', args: [snapshot.universeId], blockNumber }),
	])
	const eligible = requireBooleanValue(eligibleValue, 'source recovery eligibility')
	const rights = requireBigintArray(rightsValue, 'source recovery rights')
	if (rights.length !== 3 || rights.some(value => value < 0n || value >= 1n << 256n)) throw new Error('Invalid source recovery rights.')
	const availableShares = rights.reduce((minimum, value) => (value < minimum ? value : minimum), rights[0] ?? 0n)
	if ((await client.getBlock({ blockNumber })).hash !== snapshot.blockHash) throw new Error('Fork snapshot changed. Refresh and retry.')
	return { pool, source, shareToken, eligible, rights, availableShares }
}
export function buildSecurityPoolRecoveryPreparation(snapshot: SecurityPoolForkSnapshot, source: Awaited<ReturnType<typeof loadSecurityPoolSourceRecovery>>) {
	return { account: snapshot.owner, to: getInfraContractAddresses().questionForker, value: 0n, data: encodeFunctionData({ abi, functionName: 'prepareSecurityPoolQuestion', args: [source.source, snapshot.universeId] }) }
}
