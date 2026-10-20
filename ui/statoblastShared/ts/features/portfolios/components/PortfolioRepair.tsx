import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { parseAbi, formatEther } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioVoluntaryRepairRequest } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { requireAddressValue, requireBigintValue } from '../../../protocol/decoders.js'
import { loadPortfolioAccount, type PortfolioAccountSnapshot } from '../../../protocol/securityPoolPortfolio.js'
import { portfolioAmountOrUndefined } from '../lib/draft.js'
import { PortfolioButton, PortfolioInput, type PortfolioActions } from './PortfolioControls.js'
import * as copy from '../../../copy/portfolioCapital.js'

const abi = parseAbi([
	'function eligibleActiveCommitment(uint256 price) view returns(uint256)',
	'function settlement() view returns(address)',
	'function ledger() view returns(address)',
	'function bookIds(uint248 universeId) view returns(uint64)',
	'function totals(uint64 bookId) view returns(uint256 cash,uint256 units,uint256 fees,uint48 timestamp,bool isSealed)',
])
async function repairCapacity(snapshot: PortfolioAccountSnapshot) {
	const client = createConnectedReadClient()
	const blockNumber = snapshot.blockNumber
	const engine = requireAddressValue(await client.readContract({ address: snapshot.portfolio, abi, functionName: 'settlement', blockNumber }), 'settlement engine')
	const book = requireAddressValue(await client.readContract({ address: engine, abi, functionName: 'ledger', blockNumber }), 'settlement book')
	const bookId = requireBigintValue(await client.readContract({ address: engine, abi, functionName: 'bookIds', args: [snapshot.universeId], blockNumber }), 'book ID')
	const totals = await client.readContract({ address: book, abi, functionName: 'totals', args: [bookId], blockNumber })
	if (!Array.isArray(totals) || totals.length !== 5) throw new Error('Invalid settlement totals.')
	const cash = requireBigintValue(totals[0], 'settlement cash')
	const units = requireBigintValue(totals[1], 'settlement units')
	if (cash > units) throw new Error('Invalid settlement funding.')
	const active = requireBigintValue(await client.readContract({ address: snapshot.commitmentIndex, abi, functionName: 'eligibleActiveCommitment', args: [snapshot.acceptedPrice], blockNumber }), 'active commitment')
	if ((await client.getBlock({ blockNumber })).hash !== snapshot.blockHash) throw new Error('Settlement changed. Refresh and retry.')
	return { shortfall: units - cash, available: active > cash ? active - cash : 0n }
}

export function PortfolioRepair({ snapshot, actions }: { snapshot: PortfolioAccountSnapshot | undefined; actions: Pick<PortfolioActions, 'scope' | 'busy' | 'ownerReason' | 'runPortfolioAction'> }) {
	const amountInput = useSignal('')
	const loaded = useSignal<{ key: string; amount?: bigint; available?: bigint; error?: string } | undefined>(undefined)
	const key = `${snapshot?.portfolio}:${snapshot?.owner}:${snapshot?.universeId}:${snapshot?.blockHash}`
	useEffect(() => {
		let current = true
		loaded.value = undefined
		if (snapshot !== undefined && snapshot.forkTime === 0n && !snapshot.importing && !snapshot.frozen)
			void repairCapacity(snapshot)
				.then(capacity => {
					if (current) loaded.value = { key, amount: capacity.shortfall, available: capacity.available }
				})
				.catch(error => {
					if (current) loaded.value = { key, error: getErrorMessage(error, 'Unable to load settlement funding.') }
				})
		return () => {
			current = false
		}
	}, [key])
	useEffect(() => {
		amountInput.value = ''
	}, [snapshot?.portfolio, snapshot?.owner, snapshot?.universeId])
	const current = loaded.value?.key === key ? loaded.value : undefined
	const amount = portfolioAmountOrUndefined(amountInput.value)
	const reason =
		actions.ownerReason ??
		(snapshot?.forkTime !== 0n || snapshot?.importing || snapshot?.frozen ? copy.repairInactive : undefined) ??
		(snapshot?.priceValid ? undefined : copy.repairPrice) ??
		current?.error ??
		(current?.amount === undefined ? copy.repairLoading : undefined) ??
		(current?.amount === 0n ? copy.repairFunded : undefined) ??
		(amount === undefined || amount === 0n ? copy.repairAmountRequired : undefined) ??
		(amount !== undefined && current?.amount !== undefined && amount > current.amount ? copy.repairExceeds : undefined) ??
		(amount !== undefined && current?.available !== undefined && amount > current.available ? copy.repairCapacity : undefined) ??
		(amount !== undefined && snapshot !== undefined && amount > snapshot.walletAttoEth ? copy.repairWallet : undefined)
	const repair = () =>
		actions.runPortfolioAction('repairPortfolioCash', copy.repair, () => {
			if (reason !== undefined || snapshot === undefined || amount === undefined) throw new Error(reason ?? copy.repairAmountRequired)
			const selected = snapshot
			return {
				...buildPortfolioVoluntaryRepairRequest({ owner: selected.owner, portfolio: selected.portfolio, universeId: selected.universeId, amountAttoEth: amount }),
				reviewDescription: copy.repairReview(formatEther(amount)),
				validateBeforeSubmit: async () => {
					const fresh = await loadPortfolioAccount(createConnectedReadClient(), selected.portfolio, selected.owner, selected.universeId)
					const capacity = await repairCapacity(fresh)
					if (!fresh.priceValid || fresh.forkTime !== 0n || fresh.importing || fresh.frozen || fresh.chainId !== selected.chainId || amount > capacity.shortfall || amount > capacity.available || amount > fresh.walletAttoEth) throw new Error(copy.repairChanged)
				},
			}
		})
	return (
		<SectionBlock title={copy.repairTitle} description={copy.repairHint}>
			<UserMessage detail={current?.amount === undefined ? copy.repairLoading : copy.repairShortfall(formatEther(current.amount))} />
			<PortfolioInput
				label={copy.repairAmount}
				value={amountInput.value}
				onChange={value => {
					amountInput.value = value
				}}
				disabled={actions.busy !== undefined}
				numeric
			/>
			<PortfolioButton model={actions} action='repairPortfolioCash' label={copy.repair} pendingLabel={copy.repairing} reason={reason} onClick={repair} />
		</SectionBlock>
	)
}
