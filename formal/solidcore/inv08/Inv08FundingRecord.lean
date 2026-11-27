import Inv08IntegralState
import Inv08SearchBinding
import Inv08MemoryMember
open SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies Inv32Division
namespace Inv08.FundingRecord

def amountName (eth : Bool) := if eth then "ethRateNumerator" else "repRateNumerator"
def cleanN : Nat → Pattern Expr → Pattern Expr
  | 0,e => e
  | n+1,e => clean (cleanN n e)
def old (i : Nat) := clean (Integral.member "previous" i)
def rate (eth : Bool) := cleanN 6 (Expr_binary BinaryOp_add (old (Integral.rateIndex eth)) (wvar (amountName eth)))
def multiplication (eth : Bool) := Expr_binary BinaryOp_mul (wvar (amountName eth)) (wvar "end")
def scale (eth : Bool) := cleanN 2 (multiplication eth)
def weight (eth : Bool) := cleanN 6 (Expr_binary BinaryOp_add (old (Integral.endIndex eth)) (scale eth))
def endTime := Expiry.uint48 (Expiry.uint48 (Expiry.w48 "end"))
def values : Option (List Expr) := do
  let f ← model.core.table.lookup? "__internal__addStream(uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]"
  let .block [_,_,.block body] := f.body | none
  let some (.assign (.storageIndex "expiries" (.castOp .uintCleanup 48 (.storageRead .ref "lastExpiryId" [])))
      (.tuple members)) := body[body.length-3]? | none
  return members
def expected := seq [endTime,rate true,rate false,weight true,weight false]
theorem fromGenerated : values = some expected.value := (Option_some expected).sound _ (by native_decide)

theorem cleanReads (n : Nat) (e : Pattern Expr) (h : Inv40.Reads c r e.value v) (fits : v<R) :
    Inv40.Reads c r (cleanN n e).value v := by
  induction n with
  | zero => exact h
  | succ n ih => exact ReleaseQuote.readClean ih fits

theorem accumulates (c : Context) (r : Runtime) (eth : Bool) (budget endAt previousRate previousWeight : Nat)
    (budgetHere : r.lookupLocal? (amountName eth) = some (.word budget))
    (endHere : r.lookupLocal? "end" = some (.word endAt))
    (lastRate : MemoryMember.Reads c r (Integral.member "previous" (Integral.rateIndex eth)).value previousRate)
    (lastWeight : MemoryMember.Reads c r (Integral.member "previous" (Integral.endIndex eth)).value previousWeight)
    (endWord : endAt < R) (rateFit : previousRate+budget < R) (weightFit : previousWeight+budget*endAt < R) :
    Inv40.Reads c r (rate eth).value (previousRate+budget) ∧
    Inv40.Reads c r (weight eth).value (previousWeight+budget*endAt) := by
  have budgetFit := lt_of_le_of_lt (Nat.le_add_left _ _) rateFit
  have readBudget := ReleaseQuote.readClean (localReads c r _ _ budgetHere) budgetFit
  have readEnd := ReleaseQuote.readClean (localReads c r _ _ endHere) endWord
  have rp := MemoryMember.clean lastRate (lt_of_le_of_lt (Nat.le_add_right _ _) rateFit)
  have wp := MemoryMember.clean lastWeight (lt_of_le_of_lt (Nat.le_add_right _ _) weightFit)
  have prodFit := lt_of_le_of_lt (Nat.le_add_left _ _) weightFit
  have mul := ReleaseQuote.binary readBudget readEnd .mul (by intro h; cases h) (by intro h; cases h)
    (Inv03.Expressions.mulWord _ _ _ budgetFit endWord prodFit)
  have scaled := cleanReads 2 (multiplication eth) mul prodFit
  exact ⟨cleanReads 6 _ (MemoryMember.add rp readBudget (by change 0 < 2; decide) rateFit) rateFit,
    cleanReads 6 _ (MemoryMember.add wp scaled (by change 0 < 7; decide) weightFit) weightFit⟩

end Inv08.FundingRecord
