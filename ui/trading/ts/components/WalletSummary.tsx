import { formatUnits, shortAddress } from '../lib/format.js'
import type { WalletSummaryState } from '../lib/walletSummaryState.js'
import * as copy from '../copy/app.js'

export type UniverseOption = Readonly<{ id: string; label: string; accessibleLabel?: string }>

export function UniverseSelector({ options, selectedId, disabled, onChange }: { options: readonly UniverseOption[]; selectedId: string | undefined; disabled: boolean; onChange(selectedId: string): void }) {
	const selected = options.find(option => option.id === selectedId)
	return (
		<label class='universe-selector'>
			<select aria-label={copy.selectUniverse} title={selected?.accessibleLabel ?? selected?.label} value={selectedId ?? ''} disabled={disabled || options.length === 0} onChange={event => onChange(event.currentTarget.value)}>
				{options.length === 0 ? (
					<option value=''>{copy.unavailable}</option>
				) : (
					options.map(option => (
						<option key={option.id} value={option.id} aria-label={option.accessibleLabel ?? option.label} title={option.accessibleLabel ?? option.label}>
							{option.label}
						</option>
					))
				)}
			</select>
		</label>
	)
}

export function WalletSummary({ summary, onRetry }: { summary: WalletSummaryState; onRetry?(): void }) {
	if (summary.account === undefined) return null
	let ethDisplay = '…'
	let repBalance = '…'
	if (summary.status === 'error') {
		ethDisplay = '—'
		repBalance = '—'
	} else if (summary.status === 'ready') {
		if (summary.ethAttoEth !== undefined) ethDisplay = formatUnits(summary.ethAttoEth, 18, 18)
		if (summary.repAttoRep !== undefined) repBalance = formatUnits(summary.repAttoRep, 18, 18)
	}
	return (
		<details class={`wallet-summary wallet-summary--${summary.status}`} aria-label={copy.connectedWalletBalances} aria-busy={summary.status === 'loading'} open={summary.status === 'error'}>
			<summary class='wallet-summary__trigger'>
				<code class='wallet-summary__address wallet-summary__address--full'>{summary.account}</code>
				<code class='wallet-summary__address wallet-summary__address--compact'>{shortAddress(summary.account)}</code>
				<span class='wallet-summary__compact-loading'>{copy.loadingBalances}</span>
				<div class='wallet-summary__balances'>
					<span data-wallet-asset='ETH'>
						<small>{copy.eth}</small>
						<strong>{ethDisplay}</strong>
					</span>
					<span data-wallet-asset='REP'>
						<small>{copy.rep}</small>
						<strong>{repBalance}</strong>
					</span>
				</div>
			</summary>
			<div class='wallet-summary__details'>
				<div class='wallet-summary__identity'>
					<span>{copy.connectedAccount}</span>
					<code>{summary.account}</code>
				</div>
				<div class='wallet-summary__detail-balances' aria-label={copy.walletBalances}>
					<span>
						<small>{copy.eth}</small>
						<strong>{ethDisplay}</strong>
					</span>
					<span>
						<small>{copy.rep}</small>
						<strong>{repBalance}</strong>
					</span>
				</div>
				{summary.status === 'error' ? (
					<span class='wallet-summary__failure'>
						<span class='wallet-summary__error' role='alert' title={summary.error} aria-label={copy.walletBalanceError(summary.errorLabel, summary.error)}>
							{summary.errorLabel ?? copy.balancesUnavailable}
						</span>
						{onRetry === undefined ? null : (
							<button class='wallet-summary__retry' type='button' onClick={onRetry}>
								{copy.retry}
							</button>
						)}
					</span>
				) : null}
			</div>
			{summary.status === 'loading' ? (
				<span class='visually-hidden' role='status'>
					{copy.loadingWalletBalances}
				</span>
			) : null}
		</details>
	)
}

export function walletSummaryForUniverse(summary: WalletSummaryState, selectedUniverseId: string | undefined): WalletSummaryState {
	if (summary.universeId === selectedUniverseId) return summary
	return { account: summary.account, ethAttoEth: undefined, repAttoRep: undefined, status: summary.account === undefined ? 'disconnected' : 'loading', error: undefined, errorLabel: undefined, universeId: selectedUniverseId }
}

export function routeOwnsLiveWallet(route: string) {
	return route !== 'deploy' && route !== 'help' && route !== 'not-found'
}

export function walletSummaryAfterRouteChange(summary: WalletSummaryState, previousRoute: string, nextRoute: string, selectedUniverseId: string | undefined): WalletSummaryState {
	if (routeOwnsLiveWallet(previousRoute) === routeOwnsLiveWallet(nextRoute)) return summary
	return { account: undefined, ethAttoEth: undefined, repAttoRep: undefined, status: 'disconnected', error: undefined, errorLabel: undefined, universeId: selectedUniverseId }
}

export function compactUniqueUniverseIds(universeIds: readonly string[]) {
	if (new Set(universeIds).size !== universeIds.length) throw new Error('Universe IDs must be unique')
	let edgeLength = 3
	while (true) {
		const labels = universeIds.map(universeId => (universeId.length <= edgeLength * 2 + 1 ? universeId : `${universeId.slice(0, edgeLength)}…${universeId.slice(-edgeLength)}`))
		if (new Set(labels).size === labels.length) return labels
		edgeLength++
	}
}

export function buildLiveUniverseOptions(universeIds: readonly bigint[]): readonly UniverseOption[] {
	const ids = universeIds.map(universeId => universeId.toString())
	const compactIds = compactUniqueUniverseIds(ids)
	return universeIds.map((universeId, index) => {
		const id = ids[index]
		const compactId = compactIds[index]
		if (id === undefined || compactId === undefined) throw new Error('Universe label generation failed')
		return universeId === 0n ? { id, label: copy.genesisUniverse, accessibleLabel: copy.genesisUniverse } : { id, label: copy.universeLabel(compactId), accessibleLabel: copy.universeLabel(id) }
	})
}
