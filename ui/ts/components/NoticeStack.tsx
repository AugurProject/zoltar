import type { NoticeItem } from '../types/components.js'
import { orderNoticeItems } from '../lib/noticeStack.js'

type NoticeStackProps = {
	items: NoticeItem[]
}

export function NoticeStack({ items }: NoticeStackProps) {
	if (items.length === 0) return undefined

	return (
		<div className='page-notices'>
			{orderNoticeItems(items).map(item => (
				<div key={item.id} className={`notice notice-stack-item ${item.tone}`}>
					{item.title === undefined ? undefined : <strong className='notice-title'>{item.title}</strong>}
					<div>{item.detail}</div>
				</div>
			))}
		</div>
	)
}
