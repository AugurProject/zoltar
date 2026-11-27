import Inv08Compound
import Inv03Expressions
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv08.ReleaseWrites
namespace Inv08

def amountLocal (eth : Bool) := if eth then "ethAmount" else "repAmount"
def cursorField (eth : Bool) : Field := if eth then .ethCursor else .repCursor
def outstandingField (eth : Bool) : Field := if eth then .ethOut else .repOut

theorem localReads (c : Context) (r : Runtime) (name : String) (a : Nat)
    (found : r.lookupLocal? name = some (.word a)) : Inv40.Reads c r (.var name) a := by
  intro fuel enough
  cases fuel with
  | zero => simp [Expr.orderFuel] at enough
  | succ n => exact Inv32Guards.readWord _ _ _ _ _ found

theorem incrementReads (c : Context) (r : Runtime) (eth : Bool) (a : Nat)
    (fields : c.storageFields = model.core.context.storageFields)
    (found : r.lookupLocal? (amountLocal eth) = some (.word a)) (fit : a<R)
    (product : a * stored r.state .duration < R) :
    Inv40.Reads c r (increment (amountLocal eth)).value (a * stored r.state .duration) := by
  have dur := durationFits r.state
  have left := ReleaseQuote.readClean (localReads c r _ a found) fit
  have right := ReleaseQuote.readClean (reads c r .duration fields) dur
  have mul := ReleaseQuote.binary left right .mul (by intro h; cases h) (by intro h; cases h)
    (Inv03.Expressions.mulWord c.checked _ _ fit dur product)
  exact ReleaseQuote.readClean (ReleaseQuote.readClean mul product) product

/-- The generated compound cursor assignment advances by exactly the whole payout times the duration. -/
theorem advance (c : Context) (r : Runtime) (eth : Bool) (a fuel : Nat)
    (fields : c.storageFields = model.core.context.storageFields)
    (found : r.lookupLocal? (amountLocal eth) = some (.word a)) (fit : a<R)
    (bound : stored r.state (cursorField eth) + a * stored r.state .duration < R)
    (enough : (increment (amountLocal eth)).value.orderFuel ≤ fuel+1) :
    let k := cursorField eth
    let next := stored r.state k + a * stored r.state .duration
    (Expr.assignment (some .add) (some (.uint 256)) (.storage k.name) (increment (amountLocal eth)).value).evalFuel
      (fuel+2) c r = pure (.word next,{r with state := r.state.storeFieldWord k.field next}) := by
  exact compound _ _ _ _ _ _ _ .add fields bound
    (incrementReads _ _ _ _ fields found fit (lt_of_le_of_lt (Nat.le_add_left _ _) bound) _ enough) (Inv40.addWords _ _ _ bound)

theorem debit (c : Context) (r : Runtime) (eth : Bool) (a fuel : Nat)
    (fields : c.storageFields = model.core.context.storageFields)
    (found : r.lookupLocal? (amountLocal eth) = some (.word a))
    (funded : a ≤ stored r.state (outstandingField eth)) (fit : stored r.state (outstandingField eth) < R) :
    let k := outstandingField eth
    let next := stored r.state k - a
    (Expr.assignment (some .sub) (some (.uint 256)) (.storage k.name) (.var (amountLocal eth))).evalFuel
      (fuel+2) c r = pure (.word next,{r with state := r.state.storeFieldWord k.field next}) := by
  exact compound _ _ _ _ _ _ _ .sub fields (lt_of_le_of_lt (Nat.sub_le _ _) fit) (Inv32Guards.readWord _ _ _ _ _ found)
    (Inv32QuoteExpr.subWord _ _ _ fit (lt_of_le_of_lt funded fit) funded)

end Inv08
