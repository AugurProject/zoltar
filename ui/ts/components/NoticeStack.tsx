import type { NoticeItem } from '../types/components.js'
import { orderNoticeItems } from '../lib/noticeStack.js'
import { WarningSurface } from './WarningSurface.js'

type NoticeStackProps = {
	items: NoticeItem[]
}

export function NoticeStack({ items }: NoticeStackProps) {
	if (items.length === 0) return undefined

	return (
		<div className='page-notices'>
			{orderNoticeItems(items).map(item =>
				item.tone === 'warning' ? (
					<WarningSurface key={item.id} as='div' className='notice notice-stack-item'>
						{item.title === undefined ? undefined : <strong className='notice-title'>{item.title}</strong>}
						<div>{item.detail}</div>
					</WarningSurface>
				) : (
					<div key={item.id} className={`notice notice-stack-item ${item.tone}`}>
						{item.title === undefined ? undefined : <strong className='notice-title'>{item.title}</strong>}
						<div>{item.detail}</div>
					</div>
				),
			)}
		</div>
	)
}
