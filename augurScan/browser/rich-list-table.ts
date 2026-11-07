import type { RichListRecord } from './browser-types.ts'
import { type CsvColumn, renderDataTable } from './data-table.ts'
import { exactDecimal, exactNumber, exactUnit } from './format.ts'
import { nativeSymbolFor as nativeSymbol } from './network-freshness.ts'
import { richListLargestRep } from './rich-list-rep.ts'

/**
 * Export columns: raw addresses with labels apart, and plain decimal amounts whose unit is in the header.
 * @internal Exported for export-format unit tests.
 */
export const richListCsvColumns = (chainId: string): readonly CsvColumn<RichListRecord>[] => [
	{ label: 'Address', value: item => item.address },
	{ label: 'Label', value: item => item.label ?? '' },
	{ label: 'Largest REP holding', value: item => exactDecimal(item.largest_rep_balance, item.largest_rep_decimals ?? 18) ?? '' },
	{ label: 'Largest REP token symbol', value: item => (item.largest_rep_token_address === null ? '' : (item.largest_rep_symbol ?? 'REP')) },
	{ label: 'Largest REP token address', value: item => item.largest_rep_token_address ?? '' },
	{ label: `${nativeSymbol(chainId)} balance`, value: item => exactDecimal(item.native_balance) ?? '' },
	{ label: 'WETH balance', value: item => exactDecimal(item.weth_balance) ?? '' },
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
			{ label: nativeSymbol(options.chainId), sort: 'eth', value: item => exactUnit(item.native_balance ?? '0', 18, nativeSymbol(item.chain_id)) },
			{ label: 'WETH', sort: 'weth', value: item => exactUnit(item.weth_balance ?? '0', 18, 'WETH') },
			{ label: 'Transactions', sort: 'transactions', value: item => exactNumber(item.transaction_count) },
		],
		csvColumns: richListCsvColumns(options.chainId),
	})
}
