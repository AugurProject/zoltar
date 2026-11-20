import type { RichListRecord } from './browser-types.ts'
import { type CsvColumn, renderDataTable } from './data-table.ts'
import { exactDecimal, exactNumber, exactUnit } from './format.ts'
import { nativeSymbolFor as nativeSymbol } from './network-freshness.ts'
import { richListLargestRep } from './rich-list-rep.ts'

type WalletSampling = Pick<RichListRecord, 'native_balance' | 'weth_balance' | 'sampled_native_count' | 'sampled_weth_token_count' | 'weth_token_count'>

/** Whether the native balance has been sampled; the API reports an unsampled balance as zero. */
const nativeSampled = (item: WalletSampling): boolean => Number(item.sampled_native_count ?? 0) > 0

/** Whether every known WETH token has a balance sample in the summed WETH balance. */
const wethComplete = (item: WalletSampling): boolean => Number(item.sampled_weth_token_count ?? 0) >= Number(item.weth_token_count ?? 0)

/** The wallet balances as the card, table and CSV show them: unsampled native balances are pending, partial WETH sums are marked. */
export const richListWalletBalances = (item: WalletSampling, symbol: string): { readonly native: string; readonly weth: string } => {
	const weth = exactUnit(item.weth_balance ?? '0', 18, 'WETH')
	return {
		native: nativeSampled(item) ? exactUnit(item.native_balance ?? '0', 18, symbol) : `${symbol} pending`,
		weth: wethComplete(item) ? weth : `${weth} · partial`,
	}
}

/**
 * Export columns: raw addresses with labels apart, and plain decimal amounts whose unit is in the header.
 * Unsampled native balances export as empty cells, and the WETH sampling column says when the sum is partial.
 * @internal Exported for export-format unit tests.
 */
export const richListCsvColumns = (chainId: string): readonly CsvColumn<RichListRecord>[] => [
	{ label: 'Address', value: item => item.address },
	{ label: 'Label', value: item => item.label ?? '' },
	{ label: 'Largest REP holding', value: item => exactDecimal(item.largest_rep_balance, item.largest_rep_decimals ?? 18) ?? '' },
	{ label: 'Largest REP token symbol', value: item => (item.largest_rep_token_address === null ? '' : (item.largest_rep_symbol ?? 'REP')) },
	{ label: 'Largest REP token address', value: item => item.largest_rep_token_address ?? '' },
	{ label: `${nativeSymbol(chainId)} balance`, value: item => (nativeSampled(item) ? (exactDecimal(item.native_balance) ?? '') : '') },
	{ label: 'WETH balance', value: item => exactDecimal(item.weth_balance) ?? '' },
	{ label: 'WETH tokens sampled', value: item => `${Number(item.sampled_weth_token_count ?? 0)} of ${Number(item.weth_token_count ?? 0)}` },
	{ label: 'Transactions', value: item => String(item.transaction_count) },
]

export const renderRichListTable = (container: HTMLElement, items: readonly RichListRecord[], options: { readonly chainId: string; readonly sort: string; readonly demo: boolean; readonly onSort: (sort: string) => void }): void => {
	renderDataTable(container, {
		caption: 'Known addresses',
		captionVisuallyHidden: true,
		rows: items,
		currentSort: options.sort,
		onSort: options.onSort,
		columns: [
			{ label: 'Address', value: item => item.label ?? item.address, href: item => `/address/${item.address}?chainId=${item.chain_id}${options.demo ? '&demo=1' : ''}` },
			{
				label: 'Largest REP holding',
				sort: 'rep',
				value: richListLargestRep,
			},
			{ label: nativeSymbol(options.chainId), sort: 'eth', value: item => richListWalletBalances(item, nativeSymbol(item.chain_id)).native },
			{ label: 'WETH', sort: 'weth', value: item => richListWalletBalances(item, nativeSymbol(item.chain_id)).weth },
			{ label: 'Transactions', sort: 'transactions', value: item => exactNumber(item.transaction_count) },
		],
		csvColumns: richListCsvColumns(options.chainId),
	})
}
