import Inv48ObservedSuffixBoundsCut
import Inv48QuoteRangeFromSuccessTail
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division Inv32FloorHoist Inv32CeilFlags
namespace Inv48.ObservedSuffixBounds
open Inv48.QuoteMemory Inv48.WholeQuote Inv48.FundingMathTail Inv48.QuoteEntryTail
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
theorem rangeFits (n helperFuel : Nat) (c : Context) (r : Runtime) (rows : ScriptedResponder)
    (id a rep bounty multiplier : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple a rep 0 0 0))
    (ha : a<R) (hb : bounty<R) (repFits : rep<R) (haltFits : a*multiplier/10000<R)
    (hmul : multiplier<R)
    (args : Inputs c r h0 Inv48.FundingMathTail.haltX Inv48.FundingMathTail.haltY Inv48.FundingMathTail.denom a multiplier 10000)
    (oracle : OracleInputs c (halted r id a rep multiplier 0 0) rows)
    (earlier : id<(halted r id a rep multiplier 0 0).nextMemory)
    (bountyRead : (oracleOut oracle).lookupLocal? "bountyAttoEth" = some (.word bounty))
    (last : Runtime) (trace : Interaction.Transcript)
    (aligned : Inv48.ChildExtraction.Matches rows trace)
    (run : Interaction.Executes (Stmt.evalList (n+helperFuel+65) table c r
      (actualStatements.drop 5)) trace (.ok (.normal last))) :
    a≤2^128-1 ∧ rep≤2^128-1 ∧
      max (a*multiplier/10000) (Inv03.ceilQuot oracle.exposure 100)≤2^128-1 ∧ bounty≤2^96-1 := by
  by_contra bad
  obtain ⟨mid,message,failure⟩ := Inv48.QuoteRangeFromSuccess.tailFailure n helperFuel c r rows
    id a rep bounty multiplier ref mem ha hb repFits haltFits hmul args oracle earlier bountyRead bad
  have folded := Inv48.ChildExtraction.foldTrace rows _ _ _ aligned run
  rw [failure] at folded
  cases folded
#print axioms rangeFits
end Inv48.ObservedSuffixBounds
