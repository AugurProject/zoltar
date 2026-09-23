import type { RichListRecord } from './browser-types.ts'
import { renderDataTable } from './data-table.ts'
import { exactNumber, exactUnit } from './format.ts'
import { richListRepTotal } from './rich-list-rep.ts'

const nativeSymbol = (chainId: string | number): string => (String(chainId) === '1' ? 'ETH' : 'SepoliaETH')

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
				label: 'Sampled REP',
				sort: 'rep',
				value: richListRepTotal,
			},
			{ label: nativeSymbol(options.chainId), sort: 'eth', value: item => exactUnit(item.native_balance ?? '0', 18, nativeSymbol(item.chain_id)) },
			{ label: 'WETH', sort: 'weth', value: item => exactUnit(item.weth_balance ?? '0', 18, 'WETH') },
			{ label: 'Transactions', sort: 'transactions', value: item => exactNumber(item.transaction_count) },
		],
	})
}
