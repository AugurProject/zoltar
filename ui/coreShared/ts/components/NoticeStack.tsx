import * as commonCopy from '../copy/common.js'
import type { NoticeItem } from '../types/components.js'
import { orderNoticeItems } from '../lib/noticeStack.js'
import { ReadOnlyDetailAccordion } from './ReadOnlyDetailAccordion.js'

type NoticeStackProps = {
	items: NoticeItem[]
}

export function NoticeStack({ items }: NoticeStackProps) {
	if (items.length === 0) return undefined

	return (
		<div className='page-notices'>
			{orderNoticeItems(items).map(item => {
				const isBlocking = item.tone === 'blocking'
				return (
					<div key={item.id} className={`notice notice-stack-item ${item.tone}`} role={isBlocking ? 'alert' : 'status'} aria-live={isBlocking ? 'assertive' : 'polite'}>
						{item.title === undefined ? undefined : <strong className='notice-title'>{item.title}</strong>}
						<div>{item.detail}</div>
						{item.technicalDetails === undefined ? undefined : <ReadOnlyDetailAccordion title={commonCopy.technicalDetails}>{item.technicalDetails}</ReadOnlyDetailAccordion>}
					</div>
				)
			})}
		</div>
	)
}
