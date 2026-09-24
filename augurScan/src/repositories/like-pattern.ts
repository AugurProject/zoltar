export const literalContainsPattern = (value: string): string => `%${value.replace(/[\\%_]/g, character => `\\${character}`)}%`
