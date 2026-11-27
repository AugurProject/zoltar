import Inv08Model
import Inv03Bodies
import Inv40Evaluation
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies Inv32Division
namespace Inv08.ReleaseQuote
private def storageP (field : String) : Pattern Source.Expr :=
  ⟨.storageRead .ref field [], fun | .storageRead .ref name [] => name==field | _ => false,
   by intro e h; dsimp only at h; split at h <;> simp_all⟩
def pending (localName cursor : String) :=
  clean (clean (Expr_binary BinaryOp_div
    (clean (clean (Expr_binary BinaryOp_sub (wvar localName) (clean (storageP cursor)))))
    (clean (storageP "rewardDuration"))))
def values : Option (List Source.Expr) := do
  let f ← model.core.table.lookup? "__internal__preview(uint48)#[SolidCore.Solidity.Ty.uint 48]"
  let .block steps := f.body | none
  let some (.block body) := steps.getLast? | none
  let some (.returnValues vs) := body.getLast? | none
  return vs
def expected := seq [pending "ethIntegralNumerator" "lastEthIntegralNumerator",
  pending "repIntegralNumerator" "lastRepIntegralNumerator",Expr_castOp CastKind_uintCleanup (lit 48) (varP "expiredId")]
theorem checkedReturn : values = some expected.value := (Option_some expected).sound _ (by native_decide)

theorem readClean (h : Inv40.Reads c r e a) (ha : a<R) :
    Inv40.Reads c r (.castOp .uintCleanup 256 e) a := by
  intro fuel enough
  change e.orderFuel+1≤fuel at enough
  cases fuel with
  | zero => omega
  | succ f => exact Inv32Guards.clean f c r e a ha (h _ (by omega))

theorem binary (x : Inv40.Reads c r e a) (y : Inv40.Reads c r g b)
    (op : Source.BinaryOp) (na : op≠.boolAnd) (no : op≠.boolOr)
    (res : op.apply c.checked (.word a) (.word b) = .ok (.word v)) :
    Inv40.Reads c r (.binary op e g) v := by
  intro fuel enough
  change e.orderFuel+g.orderFuel+1≤fuel at enough
  cases fuel with
  | zero => omega
  | succ f => exact Inv32Eval.binary f c r op na no _ _ _ _ _ (x f (by omega)) (y f (by omega)) res

theorem amount (c : Context) (r : Runtime) (name cursor : String) (now old duration : Nat)
    (word : now<R) (ordered : old≤now) (dWord : duration<R) (dp : 0<duration)
    (here : r.lookupLocal? name = some (.word now))
    (last : Inv40.Reads c r (.storageRead .ref cursor []) old)
    (dur : Inv40.Reads c r (.storageRead .ref "rewardDuration" []) duration) :
    Inv40.Reads c r (pending name cursor).value ((now-old)/duration) := by
  have rd : Inv40.Reads c r (.var name) now := by
    intro fuel enough
    change 1≤fuel at enough
    cases fuel with
    | zero => omega
    | succ f => exact Inv32Guards.readWord f _ _ _ _ here
  have sub := binary (readClean rd word) (readClean last (lt_of_le_of_lt ordered word)) .sub (by intro h; cases h) (by intro h; cases h)
    (Inv32QuoteExpr.subWord c.checked _ _ word (lt_of_le_of_lt ordered word) ordered)
  have fits := lt_of_le_of_lt (Nat.sub_le now old) word
  have div := binary (readClean (readClean sub fits) fits) (readClean dur dWord) .div (by intro h; cases h) (by intro h; cases h)
    (Inv32Eval.divideWords c.checked _ _ fits dWord dp)
  have small := lt_of_le_of_lt (Nat.div_le_self (now-old) duration) fits
  exact readClean (readClean div small) small
end Inv08.ReleaseQuote
