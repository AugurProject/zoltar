import Inv48QuoteWideBoundsRounded
import Inv48QuoteMemoryArgs
import Inv48QuoteEntryTailCore
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division Inv32FloorHoist Inv32CeilFlags
open Inv32Hoist Inv32FloorStart Inv32OneArg
namespace Inv48.QuoteWideBounds
open Inv48.QuoteMemory Inv48.WholeQuote Inv48.FundingMathTail Inv48.QuoteEntryTail
set_option maxRecDepth 65536
set_option maxHeartbeats 16000000

theorem ceilHoistOverflow (n : Nat) (c : Context) (r : Runtime) (ex ey ed : Expr) (x y d : Nat)
    (hx : x<R) (hy : y<R) (hd : d<R) (pos : 0<d)
    (over : R≤Inv48.QuoteExecMath.rounded x y d true)
    (h : Inputs c r h0 ex ey ed x y d) :
    ∃ next err, Stmt.eval (n+36) table c (Inv32OneArg.store r h0 0)
      (Inv32CeilHoist.code ex ey ed) = pure (.reverted next err) := by
  let st := Inv32CeilHoist.stateC r 0 x y d 0
  obtain ⟨next,err,ev⟩ := roundedCallOverflow (n+1) c st a0 a1 a2 Inv32CeilHoist.a3
    [Inv32CeilHoist.dest] x y d true hx hy hd pos over rfl rfl rfl rfl
  have captured := Inv32Revert.capture _ _ _ _ _ _ [Inv32CeilHoist.dest] _ ev
  have prefix' := Inv32CeilHoist.args (n+34) table c r ex ey ed x y d
    [Inv32CeilHoist.cap,.assign (.var h0) (.var Inv32CeilHoist.dest)] h
  exact ⟨next.popScope,err,Inv32Revert.blockRevert _ _ _ _ _ _ _
    (prefix'.trans (Inv32Revert.stop _ _ _ _ _ _ _ _ captured))⟩

theorem fundingOverflow (n : Nat) (c : Context) (r : Runtime)
    (id oldA oldB h e s a p : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple oldA oldB h e s))
    (A : r.lookupLocal? "requestedInitialAttoWeth" = some (.word a))
    (P : r.lookupLocal? "proposedRepPerEthPrice" = some (.word p))
    (ha : a<R) (hp : p<R) (over : R≤Inv48.QuoteExec.repAmount a p) :
    ∃ next err, Stmt.evalList (n+36) table c r (collateralWrite :: fundingCode) =
      pure (.reverted next err) := by
  let r0 := put r id a oldB h e s
  have first := collateral (n+35) table c r id oldA oldB h e s a ref mem ha A
  have inputs := ceilInputs c r0 id a oldB h e s p ref (put_load _ _ _ _ _ _ _) P ha hp
  have big : R≤Inv48.QuoteExecMath.rounded a p (10^18) true := by
    rw [Inv48.QuoteExecMath.roundedCeil _ _ _ (by decide)]
    exact over
  obtain ⟨next,err,ev⟩ := ceilHoistOverflow n c r0 collateralArg priceArg precisionArg a p (10^18)
    ha hp (by decide) (by decide) big inputs
  refine ⟨next,err,?_⟩
  unfold fundingCode
  exact (seqStep _ _ _ _ _ _ _ first).trans
    ((seqStep _ _ _ _ _ _ _ (zero (n+35) table c r0 h0)).trans
      (Inv32Revert.stop _ _ _ _ _ _ _ _ ev))

#print axioms fundingOverflow
end Inv48.QuoteWideBounds
