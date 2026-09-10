import { noSuggest } from "./errors.js";
/** You can avoid suggesting completions by prefixing a string key with whitespace.
 *  Isn't that keyNominal?
 */
export const keyNonimal = " keyNonimal";
export const narrow = (t) => t;
/** primitive key used to represent an inferred type at compile-time */
export const inferred = noSuggest("arkInferred");
