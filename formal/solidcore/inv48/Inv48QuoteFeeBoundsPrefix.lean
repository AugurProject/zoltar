import Inv48QuoteOperandReadsFee
import Inv48QuoteMemoryExposure
import Inv48QuoteTailPreserveSource
import Inv48QuoteEntryTailCore
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division Inv32FloorHoist Inv32CeilFlags
namespace Inv48.QuoteFeeBounds
open Inv48.QuoteMemory Inv48.WholeQuote Inv48.FundingMathTail Inv48.QuoteEntryTail Inv48.QuoteOperandReads
set_option maxRecDepth 65536
set_option maxHeartbeats 16000000

theorem finishFailure (n : Nat) (c : Context) (r : Runtime)
    (id a b h e s v minimum bounty : Nat)
    (before : Inv48.QuoteTailPreserve.Keeps r id a b)
    (mem : r.loadMemory? id = some (tuple a b h e s))
    (ha : a<R) (hh : max h v≤2^128-1)
    (hc : a≤2^128-1) (hr : b≤2^128-1) (hb : bounty≤2^96-1)
    (hmin : minimum<R) (minle : minimum≤a) (exposureFits : (a-minimum)*100<R)
    (exposureRead : r.lookupLocal? "exposureEscalationHaltAttoEth" = some (.word v))
    (bountyRead : r.lookupLocal? "bountyAttoEth" = some (.word bounty))
    (minimumRead : (maximum r id a b h e s v).loadImmutableField c
      "minimumReportCollateral" = .ok (.word minimum))
    (mid : Runtime) (err : RevertData)
    (failure : Stmt.evalList (n+52) table c (exposed r id a b h e s v minimum)
      (floorCode 4 Inv48.FundingMathTail.feeX Inv48.FundingMathTail.feeY Inv48.FundingMathTail.denom) = pure (.reverted mid err)) :
    Stmt.evalList (n+52) table c r (finishCode Inv48.FundingMathTail.feeX Inv48.FundingMathTail.feeY Inv48.FundingMathTail.denom) = pure (.reverted mid err) := by
  let mx := maximum r id a b h e s v
  have hfit : h<R := lt_of_le_of_lt (le_trans (le_max_left h v) hh) (by decide)
  have vfit : v<R := lt_of_le_of_lt (le_trans (le_max_right h v) hh) (by decide)
  have maximumRun := haltMaximum (n+50) table c r id a b h e s v before.1 mem hfit vfit exposureRead
  have mxref : mx.lookupLocal? "quote" = some (.memoryRef id) := by
    dsimp [mx,maximum]; split <;> exact before.1
  have mxmem : mx.loadMemory? id = some (tuple a b (max h v) e s) := by
    dsimp [mx,maximum]
    split
    next yes => rw [put_load,max_eq_right (Nat.le_of_lt yes)]
    next no => rw [max_eq_left (Nat.le_of_not_gt no)]; exact mem
  have mxBounty : mx.lookupLocal? "bountyAttoEth" = some (.word bounty) := by
    dsimp [mx,maximum]; split <;> exact bountyRead
  have guards := allUpperPreserve (n+51) table c mx id a b (max h v) e s bounty
    mxref mxmem mxBounty hc hr hh hb
  have exp := exposureComputed (n+51) table c mx id a b (max h v) e s minimum
    mxref mxmem minimumRead ha hmin minle exposureFits
  have eref : (exposed r id a b h e s v minimum).lookupLocal? "quote" = some (.memoryRef id) := mxref
  have emem := put_load mx id a b (max h v) ((a-minimum)*100) s
  simp only [Nat.add_assoc] at maximumRun guards exp
  dsimp only [finishCode]
  simp only [List.append_assoc]
  rw [appendNormal _ _ _ _ mx _ _ (by
      exact (Inv32FloorStart.seqStep _ _ _ _ _ _ [] maximumRun).trans (by rw [Stmt.evalList]; rfl)),
    appendNormal _ _ _ _ mx _ _ guards,
    appendNormal _ _ _ _ (exposed r id a b h e s v minimum) _ _ (by
      exact (Inv32FloorStart.seqStep _ _ _ _ _ _ [] exp).trans (by rw [Stmt.evalList]; rfl))]
  exact failure
end Inv48.QuoteFeeBounds
