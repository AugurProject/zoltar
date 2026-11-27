import Inv48ObservedFundingSuffixCore
import Inv48QuoteWideBoundsHoist
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division
namespace Inv48.ObservedSuffixBounds
open Inv48.WholeQuote Inv48.QuoteMemory
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Failure propagates through the retained continuation at its original fuel. -/
theorem appendFailure (fuel : Nat) (c : Context) (r mid : Runtime)
    (code tail : List Stmt) (err : RevertData)
    (failure : Stmt.evalList fuel Inv48.Source.model.core.table c r code = pure (.reverted mid err)) :
    Stmt.evalList fuel Inv48.Source.model.core.table c r (code ++ tail) = pure (.reverted mid err) := by
  rw [listAppend,failure]
  rfl

/-- Successful retained funding forces REP fit; no minimum getter replay is used. -/
theorem repFits (n : Nat) (c : Context) (r last : Runtime)
    (id oldA oldB h e s a p : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple oldA oldB h e s))
    (A : r.lookupLocal? "requestedInitialAttoWeth" = some (.word a))
    (P : r.lookupLocal? "proposedRepPerEthPrice" = some (.word p))
    (ha : a<R) (hp : p<R) (tail : List Stmt) (trace : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.evalList (n+36) Inv48.Source.model.core.table c r
      ((collateralWrite :: fundingCode) ++ tail)) trace (.ok (.normal last))) :
    Inv48.QuoteExec.repAmount a p<R := by
  by_contra bad
  obtain ⟨mid,err,failure⟩ := Inv48.QuoteWideBounds.fundingOverflow n c r
    id oldA oldB h e s a p ref mem A P ha hp (Nat.le_of_not_gt bad)
  rw [appendFailure _ _ _ _ _ tail _ failure] at run
  cases run

/-- Derive fit and retain the actual tail after the exact funding writes. -/
theorem fundedTail (n : Nat) (c : Context) (r last : Runtime)
    (id oldA oldB h e s a p : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple oldA oldB h e s))
    (A : r.lookupLocal? "requestedInitialAttoWeth" = some (.word a))
    (P : r.lookupLocal? "proposedRepPerEthPrice" = some (.word p))
    (ha : a<R) (hp : p<R) (tail : List Stmt) (trace : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.evalList (n+36) Inv48.Source.model.core.table c r
      ((collateralWrite :: fundingCode) ++ tail)) trace (.ok (.normal last))) :
    let funded := put (Inv32OneArg.store (put r id a oldB h e s)
      Inv32CeilFlags.h0 (Inv48.QuoteExec.repAmount a p)) id a (Inv48.QuoteExec.repAmount a p) h e s
    Inv48.QuoteExec.repAmount a p<R ∧
    Interaction.Executes (Stmt.evalList (n+36) Inv48.Source.model.core.table c funded tail)
      trace (.ok (.normal last)) := by
  have fits := repFits n c r last id oldA oldB h e s a p ref mem A P ha hp tail trace run
  have step := fundedQuote Inv48.FeedMath.productLinked Inv48.FeedMath.floorLinked
    Inv48.FeedMath.roundsLinked Inv48.FeedMath.uintLinked Inv48.FeedMath.roundedLinked
    (n+16) c r id oldA oldB h e s a p ref mem A P ha hp fits
  change Stmt.evalList ((n+16)+20) _ _ _ (collateralWrite :: fundingCode) = _ at step
  have eq : (n+16)+20=n+36 := by omega
  rw [eq] at step
  rw [listAppend,step] at run
  exact ⟨fits,run⟩

#print axioms appendFailure
#print axioms repFits
#print axioms fundedTail
end Inv48.ObservedSuffixBounds
