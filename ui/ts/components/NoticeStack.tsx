import * as commonCopy from '../copy/common.js'
import type { NoticeItem } from '../types/components.js'
import { orderNoticeItems } from '../lib/noticeStack.js'
import { ReadOnlyDetailAccordion } from './ReadOnlyDetailAccordion.js'
import { WarningSurface } from './WarningSurface.js'

type NoticeStackProps = {
	items: NoticeItem[]
}

export function NoticeStack({ items }: NoticeStackProps) {
	if (items.length === 0) return undefined

	return (
		<div className='page-notices'>
			{orderNoticeItems(items).map(item => {
				const liveRegion = item.tone === 'blocking' ? { ariaLive: 'assertive' as const, role: 'alert' as const } : { ariaLive: 'polite' as const, role: 'status' as const }
				const content = (
					<>
						{item.title === undefined ? undefined : <strong className='notice-title'>{item.title}</strong>}
						<div>{item.detail}</div>
						{item.technicalDetails === undefined ? undefined : <ReadOnlyDetailAccordion title={commonCopy.technicalDetails}>{item.technicalDetails}</ReadOnlyDetailAccordion>}
					</>
				)
				return item.tone === 'warning' ? (
					<WarningSurface key={item.id} ariaLive={liveRegion.ariaLive} role={liveRegion.role} as='div' className='notice notice-stack-item'>
						{content}
					</WarningSurface>
				) : (
					<div key={item.id} className={`notice notice-stack-item ${item.tone}`} role={liveRegion.role} aria-live={liveRegion.ariaLive}>
						{content}
					</div>
				)
			})}
		</div>
	)
}
