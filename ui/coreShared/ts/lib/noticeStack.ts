import type { NoticeItem } from '../types/components.js'

const TONE_ORDER: Record<NoticeItem['tone'], number> = {
	blocking: 0,
	warning: 1,
	pending: 2,
	success: 3,
}

export function orderNoticeItems(items: NoticeItem[]) {
	return [...items].sort((left, right) => TONE_ORDER[left.tone] - TONE_ORDER[right.tone])
}
