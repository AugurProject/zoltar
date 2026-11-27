import Inv48QuoteTailPreserveCore
import Inv48WholeQuoteJoin
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.QuoteTailPreserve
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000
open Inv48.QuoteFundingFields

def suffix : List Stmt := Inv48.QuoteMemory.actualStatements.drop 5

theorem suffixSource : suffix = Inv48.WholeQuote.interiorP.value.drop 5 := by
  rw [suffix,actualInterior]

theorem suffixDirectWrites : directQuoteWrites 100 (.block suffix) = [2,2,3,4] := by
  rw [suffixSource]
  exact generatedTailWrites

/-- Funding's checked successful-run theorem is re-exported without expanding
its proof term against the generated table. It establishes fields, not a
standalone pointer-preservation result. -/
abbrev fundingFields := @Inv48.QuoteFundingFields.fundingSlice

/-- Conditional suffix composition: its remaining premise is structural
adequacy, not a collection of assumed per-call heap equalities. -/
theorem suffixKeeps (c : Context) (post final : Runtime) (id a b : Nat)
    (before : Keeps post id a b) (updates : Frame c id post final) :
    final.lookupLocal? "quote" = post.lookupLocal? "quote" ∧
    Fields final id a b := by
  have after := frameKeeps updates before
  exact ⟨after.1.trans before.1.symm,after.2⟩
end Inv48.QuoteTailPreserve
