import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'

export function Status({ tone, children }: { tone: 'good' | 'warn' | 'bad' | 'neutral'; children: preact.ComponentChildren }) {
	const badgeTones = { bad: 'blocked', good: 'ok', neutral: 'muted', warn: 'warning' } as const
	const badgeTone = badgeTones[tone]
	return (
		<Badge className={`status status--${tone}`} tone={badgeTone}>
			{children}
		</Badge>
	)
}
