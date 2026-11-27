import Inv48ObservedSuffixBoundsFee
import Inv48QuoteOperandReadsFee
import Inv48QuoteFeeBoundsArithmetic
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division Inv32FloorHoist Inv32CeilFlags
namespace Inv48.ObservedTailBounds
open Inv48.QuoteMemory Inv48.WholeQuote Inv48.FundingMathTail Inv48.QuoteEntryTail Inv48.QuoteOperandReads
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

theorem haltFits (n : Nat) (c : Context) (physical r last : Runtime)
    (id a b h e s multiplier : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple a b h e s)) (ha : a<R)
    (word : PhysicalWord c physical "escalationHaltMultiplierBps" multiplier)
    (same : r.state.immutable? "escalationHaltMultiplierBps" = physical.state.immutable? "escalationHaltMultiplierBps")
    (trace : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.evalList (n+25) table c r (actualStatements.drop 5)) trace (.ok (.normal last))) :
    a*multiplier/10000<R := by
  have args := haltInputs c r id a b h e s multiplier ref mem ha (physicalRead word same) word.fits
  by_contra bad
  obtain ⟨mid,err,ev⟩ := Inv48.QuoteWideBounds.floorHoistOverflow table
    Inv48.QuoteWideBounds.rejectionLinks n c r h0 Inv48.FundingMathTail.haltX Inv48.FundingMathTail.haltY Inv48.FundingMathTail.denom a multiplier 10000
    ha word.fits (by decide) (by decide) (Nat.le_of_not_gt bad) args
  have failure : Stmt.evalList (n+25) table c r (floorCode 2 Inv48.FundingMathTail.haltX Inv48.FundingMathTail.haltY Inv48.FundingMathTail.denom) = pure (.reverted mid err) := by
    unfold floorCode
    exact (Inv32FloorStart.seqStep _ _ _ _ _ _ _ (Inv32FloorStart.zero (n+24) table c r h0)).trans
      (Inv32Revert.stop _ _ _ _ _ _ _ _ ev)
  rw [actualSuffix] at run
  change Interaction.Executes (Stmt.evalList (n+25) table c r
    (floorCode 2 Inv48.FundingMathTail.haltX Inv48.FundingMathTail.haltY Inv48.FundingMathTail.denom ++ _)) trace _ at run
  rw [Inv48.ObservedSuffixBounds.appendFailure _ _ _ _ _ _ _ failure] at run
  cases run
#print axioms haltFits
end Inv48.ObservedTailBounds
