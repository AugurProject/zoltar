import { FormField } from '../../components/FormField.js'
import { FormInput } from '../../components/FormInput.js'
import { InlineHint } from '../../components/InlineHint.js'
import { NoticeStack } from '../../components/NoticeStack.js'
import { RetryableNotice } from '../../components/RetryableNotice.js'
import { StateHint } from '../../components/StateHint.js'
import { UserMessage } from '../../components/UserMessage.js'

/** Browser-review fixture, never mounted by a production route. */
export function UserMessageShowcase() {
	return (
		<main className='app-chrome'>
			<header>
				<h1>Message contexts</h1>
			</header>
			<NoticeStack
				items={[
					{ id: 'saved', tone: 'success', title: 'Settings saved', detail: 'The read RPC is ready.' },
					{ id: 'rpc', tone: 'warning', title: 'Custom read RPC', detail: 'Only use an RPC provider you trust.', technicalDetails: 'The RPC was configured in application settings.' },
				]}
			/>
			<section className='section'>
				<h2>Field help and validation</h2>
				<div className='form-grid'>
					<FormField id='showcase-amount' label='Amount'>
						<FormInput id='showcase-amount' hint='Leave enough ETH for gas.' value='0.5' readOnly />
					</FormField>
					<FormField id='showcase-invalid' label='Recipient'>
						<FormInput id='showcase-invalid' error='Enter a valid Ethereum address.' value='0x123' readOnly />
					</FormField>
				</div>
			</section>
			<section className='section'>
				<h2>Action guidance</h2>
				<div className='actions'>
					<button type='button' disabled aria-describedby='showcase-action-help'>
						Submit trade
					</button>
				</div>
				<InlineHint id='showcase-action-help' message='Connect your wallet to trade.' />
				<UserMessage tone='warning' detail='High price impact. Reduce the amount before submitting.' />
			</section>
			<section className='section'>
				<h2>Workflow states</h2>
				<StateHint announcement='polite' presentation={{ key: 'loading', detail: 'Refreshing pool balances…', detailIsLoading: true }} />
				<UserMessage placement='section' title='No positions yet' detail='Your positions appear here after your first trade.' actionHint='Choose a market to get started.' />
				<RetryableNotice message='Pool refresh failed. Your previous balances remain visible.' retryLabel='Retry' onRetry={() => {}} />
			</section>
		</main>
	)
}
