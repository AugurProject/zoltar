import { type WhiteSpaceToken } from "@ark/util";
import type { DynamicState } from "../../reduce/dynamic.ts";
import type { StaticState, state } from "../../reduce/static.ts";
import type { BaseCompletions } from "../../string.ts";
import type { Scanner } from "../scanner.ts";
import { parseEnclosed, type EnclosingQuote, type EnclosingStartToken } from "./enclosed.ts";
import { parseUnenclosed } from "./unenclosed.ts";
export declare const parseOperand: (s: DynamicState) => void;
export type parseOperand<s extends StaticState, $, args> = s["unscanned"] extends Scanner.shift<infer lookahead, infer unscanned> ? lookahead extends "(" ? state.reduceGroupOpen<s, unscanned> : lookahead extends EnclosingStartToken ? parseEnclosed<s, lookahead, unscanned> : lookahead extends WhiteSpaceToken ? parseOperand<state.scanTo<s, unscanned>, $, args> : lookahead extends "d" ? unscanned extends (Scanner.shift<infer enclosing extends EnclosingQuote, infer nextUnscanned>) ? parseEnclosed<s, `d${enclosing}`, nextUnscanned> : parseUnenclosed<s, $, args> : parseUnenclosed<s, $, args> : state.completion<`${s["scanned"]}${BaseCompletions<$, args>}`>;
