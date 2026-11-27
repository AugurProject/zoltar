import Inv48ObservedSuffixBoundsRange
import Inv48QuoteFeeBoundsSuffix
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division Inv32FloorHoist Inv32CeilFlags
namespace Inv48.ObservedSuffixBounds
open Inv48.QuoteMemory Inv48.WholeQuote Inv48.FundingMathTail Inv48.QuoteEntryTail
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
theorem feeFits (n : Nat) (c : Context) (r : Runtime) (rows : ScriptedResponder)
    (id a b h e s multiplier minimum bounty : Nat)
    (before : Inv48.QuoteTailPreserve.Keeps r id a b)
    (mem : r.loadMemory? id = some (tuple a b h e s))
    (ha : a<R) (hmul : multiplier<R) (haltFits : a*multiplier/10000<R)
    (hc : a≤2^128-1) (hr : b≤2^128-1) (hb : bounty≤2^96-1)
    (hmin : minimum<R) (minle : minimum≤a) (exposureFits : (a-minimum)*100<R)
    (haltArgs : Inputs c r h0 Inv48.FundingMathTail.haltX Inv48.FundingMathTail.haltY Inv48.FundingMathTail.denom a multiplier 10000)
    (oracle : OracleInputs c (halted r id a b multiplier e s) rows)
    (earlier : id<(halted r id a b multiplier e s).nextMemory)
    (hh : max (a*multiplier/10000) (Inv03.ceilQuot oracle.exposure 100)≤2^128-1)
    (bountyRead : (oracleOut oracle).lookupLocal? "bountyAttoEth" = some (.word bounty))
    (minimumRead : (maximum (oracleOut oracle) id a b (a*multiplier/10000) e s
      (Inv03.ceilQuot oracle.exposure 100)).loadImmutableField c "minimumReportCollateral" = .ok (.word minimum))
    (base feeMul : Nat) (baseFits : base<R) (feeMulFits : feeMul<R)
    (feeArgs : Inputs c (exposed (oracleOut oracle) id a b
      (a*multiplier/10000) e s (Inv03.ceilQuot oracle.exposure 100) minimum) h0
      Inv48.FundingMathTail.feeX Inv48.FundingMathTail.feeY Inv48.FundingMathTail.denom base feeMul 10000)
    (last : Runtime) (trace : Interaction.Transcript)
    (aligned : Inv48.ChildExtraction.Matches rows trace)
    (run : Interaction.Executes (Stmt.evalList (n+52) table c r
      (actualStatements.drop 5)) trace (.ok (.normal last))) :
    base*feeMul/10000<R := by
  by_contra bad
  let feeRuntime := exposed (oracleOut oracle) id a b
    (a*multiplier/10000) e s (Inv03.ceilQuot oracle.exposure 100) minimum
  obtain ⟨mid,err,ev⟩ := Inv48.QuoteWideBounds.floorHoistOverflow table
    Inv48.QuoteWideBounds.rejectionLinks (n+27) c feeRuntime h0
    Inv48.FundingMathTail.feeX Inv48.FundingMathTail.feeY Inv48.FundingMathTail.denom
    base feeMul 10000 baseFits feeMulFits (by decide) (by decide) (Nat.le_of_not_gt bad) feeArgs
  have failure : Stmt.evalList (n+52) table c feeRuntime
      (floorCode 4 Inv48.FundingMathTail.feeX Inv48.FundingMathTail.feeY Inv48.FundingMathTail.denom) = pure (.reverted mid err) := by
    unfold floorCode
    exact (Inv32FloorStart.seqStep _ _ _ _ _ _ _ (Inv32FloorStart.zero (n+51) table c feeRuntime h0)).trans
      (Inv32Revert.stop _ _ _ _ _ _ _ _ (by simpa only [Nat.add_assoc] using ev))
  have failed := Inv48.QuoteFeeBounds.suffixFailure n c r rows id a b h e s multiplier minimum bounty
    before mem ha hmul haltFits hc hr hb hmin minle exposureFits haltArgs oracle earlier hh bountyRead minimumRead mid err failure
  have folded := Inv48.ChildExtraction.foldTrace rows _ _ _ aligned run
  rw [failed] at folded
  cases folded
#print axioms feeFits
end Inv48.ObservedSuffixBounds
