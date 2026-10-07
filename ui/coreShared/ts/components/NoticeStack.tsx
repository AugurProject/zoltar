import * as commonCopy from '../copy/common.js'
import type { NoticeItem } from '../types/components.js'
import { orderNoticeItems } from '../lib/noticeStack.js'
import { UserMessage } from './UserMessage.js'

type NoticeStackProps = {
	items: NoticeItem[]
}

export function NoticeStack({ items }: NoticeStackProps) {
	if (items.length === 0) return undefined

	return (
		<div className='page-notices'>
			{orderNoticeItems(items).map(item => {
				const isBlocking = item.tone === 'blocking'
				let tone: 'neutral' | 'warning' | 'error' | 'success' = 'neutral'
				if (isBlocking) tone = 'error'
				if (item.tone === 'warning' || item.tone === 'success') tone = item.tone
				return (
					<UserMessage
						key={item.id}
						placement='page'
						tone={tone}
						className={item.tone}
						announcement={isBlocking ? 'assertive' : 'polite'}
						title={item.title}
						detail={item.detail}
						dismiss={item.dismiss}
						expandableDetail={item.technicalDetails === undefined ? undefined : { label: commonCopy.technicalDetails, content: item.technicalDetails }}
					/>
				)
			})}
		</div>
	)
}
