import { decodeEventLog, parseAbi, toEventSelector, type Hash } from '@zoltar/core-shared/evm/ethereum'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import type { ReadClient } from '../../testSupport/simulator/utils/clients'
import { BURN_ADDRESS } from '../../testSupport/simulator/utils/constants'
import { statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact, statoblast_SecurityPoolPortfolioServices_SecurityPoolPortfolioServices as servicesArtifact } from '../../types/contractArtifact'

const burnAddress = addressString(BURN_ADDRESS)

const burnEvents = parseAbi(['event UnusedServiceCashBurned(uint248 indexed universeId, uint256 amountAttoEth)', 'event UnassignedFeesBurned(uint256 ethAmount, uint256 repAmount)'])
const [serviceBurnEvent, unassignedBurnEvent] = burnEvents
if (serviceBurnEvent === undefined || unassignedBurnEvent === undefined) throw new Error('Burn event ABI missing')
const serviceBurnSelector = toEventSelector(serviceBurnEvent).toLowerCase()
const unassignedBurnSelector = toEventSelector(unassignedBurnEvent).toLowerCase()

export const burnedEthBalance = (client: ReadClient) => client.getBalance({ address: burnAddress })

/** Sum every ownerless-cash burn a transaction reports, by emitter kind. */
export const receiptBurns = async (client: ReadClient, hash: Hash) => {
	const receipt = await client.getTransactionReceipt({ hash })
	const service: { universeId: bigint; amount: bigint }[] = []
	let unassignedEth = 0n
	let unassignedRep = 0n
	for (const log of receipt.logs) {
		const selector = log.topics[0]?.toLowerCase()
		if (selector === serviceBurnSelector) {
			const decoded = decodeEventLog({ abi: servicesArtifact.abi, data: log.data, topics: log.topics })
			if (decoded.eventName !== 'UnusedServiceCashBurned') throw new Error('Unexpected service burn event')
			service.push({ universeId: decoded.args.universeId, amount: decoded.args.amountAttoEth })
		} else if (selector === unassignedBurnSelector) {
			const decoded = decodeEventLog({ abi: capitalArtifact.abi, data: log.data, topics: log.topics })
			if (decoded.eventName !== 'UnassignedFeesBurned') throw new Error('Unexpected capital burn event')
			unassignedEth += decoded.args.ethAmount
			unassignedRep += decoded.args.repAmount
		}
	}
	const serviceEth = service.reduce((total, entry) => total + entry.amount, 0n)
	return { service, serviceEth, unassignedEth, unassignedRep, totalEth: serviceEth + unassignedEth }
}
