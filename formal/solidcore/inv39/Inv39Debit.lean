import Inv39BalanceExecution
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39
def clean (e : Source.Expr) := Source.Expr.castOp .uintCleanup 256 e
def wordVar (name : String) := clean (.var name)
def difference := clean (clean (.binary .sub (wordVar "fromBalance") (wordVar "value")))
def shortage := Source.Expr.binary .lt (wordVar "fromBalance") (wordVar "value")
private theorem localReads (h : r.lookupLocal? n=some (.word v)) : Inv40.Reads c r (.var n) v := by
  intro fuel enough
  cases fuel with
  | zero => simp [Expr.orderFuel] at enough
  | succ n => exact Inv32Guards.readWord _ _ _ _ _ h
private theorem cleaned (h : Inv40.Reads c r e v) (fit : v<R) : Inv40.Reads c r (clean e) v := by
  intro fuel enough
  change e.orderFuel+1 ≤ fuel at enough
  cases fuel with
  | zero => omega
  | succ n => exact Inv32Guards.clean _ _ _ _ _ fit (h _ (by omega))
private theorem binary (a : Inv40.Reads c r x u) (b : Inv40.Reads c r y v)
    (op : Source.BinaryOp) (ha : op ≠ .boolAnd) (ho : op ≠ .boolOr)
    (word : op.apply c.checked (.word u) (.word v) = .ok (.word w)) :
    Inv40.Reads c r (.binary op x y) w := by
  intro fuel enough
  change x.orderFuel+y.orderFuel+1 ≤ fuel at enough
  cases fuel with
  | zero => omega
  | succ n => exact Inv32Eval.binary _ _ _ _ ha ho _ _ _ _ _ (a _ (by omega)) (b _ (by omega)) word
theorem differenceValue (c : Context) (r : Runtime) (old a : Nat)
    (balance : r.lookupLocal? "fromBalance"=some (.word old)) (amount : r.lookupLocal? "value"=some (.word a))
    (funded : a≤old) (fits : old<R) : difference.eval c r = pure (.word (old-a),r) := by
  have small := lt_of_le_of_lt funded fits
  have op := Inv32QuoteExpr.subWord c.checked old a fits small funded
  have left := cleaned (c:=c) (localReads balance) fits
  have right := cleaned (c:=c) (localReads amount) small
  have res := binary left right .sub (by intro h; cases h) (by intro h; cases h) op
  have fit := lt_of_le_of_lt (Nat.sub_le old a) fits
  exact cleaned (cleaned res fit) fit _ (by decide)
theorem noShortage (c : Context) (r : Runtime) (old a : Nat)
    (balance : r.lookupLocal? "fromBalance"=some (.word old)) (amount : r.lookupLocal? "value"=some (.word a))
    (funded : a≤old) (fits : old<R) : shortage.eval c r = pure (.word 0,r) := by
  have small := lt_of_le_of_lt funded fits
  have op := Inv32ProductValues.ltWord old a fits small
  rw [if_neg (Nat.not_lt_of_ge funded)] at op
  have checked : Source.BinaryOp.apply c.checked .lt (.word old) (.word a) =
      Source.BinaryOp.apply false .lt (.word old) (.word a) := by rfl
  exact binary (cleaned (localReads balance) fits) (cleaned (localReads amount) small)
    .lt (by intro h; cases h) (by intro h; cases h) (checked.trans op) _ (by decide)
end Inv39
