// An unanchored literal LIKE pattern needs an internal word trigram for indexed search.
// Unicode letters and numbers cover multilingual searches without ASCII-only admission.
export const hasTimelineSearchTrigram = (query: string): boolean => /[\p{L}\p{N}]{3}/u.test(query)
