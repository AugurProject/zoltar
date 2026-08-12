import { submitSignedBundle, type SubmissionSettings } from '@zoltar/bot-shared/execution/transaction-submission'

export * from '@zoltar/bot-shared/execution/transaction-submission'

type ConfiguredBundleSubmission = Omit<Parameters<typeof submitSignedBundle>[0], 'minimumSuccessfulRelays'>

export function submitConfiguredSignedBundle(settings: SubmissionSettings, parameters: ConfiguredBundleSubmission) {
	return submitSignedBundle({ ...parameters, minimumSuccessfulRelays: settings.minimumBundleRelaySuccesses })
}
