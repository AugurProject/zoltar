import Inv39Frame
open SolidCore.Solidity.Source
namespace Inv39.Frame
/-- A successful evaluation can inspect storage and interpreter values, and returns exactly the incoming runtime. -/
def ReadOnly (e : Expr) := ∀ n c r, Ensures (e.evalFuel n c r) (fun v => v.2=r)
theorem liftExcept (answer : Except RevertData α) (k : α → SolI β) (P : β → Prop) (ok : ∀ x, Ensures (k x) P) :
    Ensures ((liftM answer : SolI α) >>= k) P := by
  cases answer with
  | ok v => exact ok v
  | error err => exact failure (.revert err)
theorem localRead (name : String) : ReadOnly (.var name) := by
  intro n c r
  cases n with
  | zero => rw [Expr.evalFuel]; exact failure _
  | succ n =>
    rw [Expr.evalFuel]; split
    · apply liftExcept; intro _; exact pureValue _ rfl
    · split
      · apply liftExcept; intro _; exact pureValue _ rfl
      · exact failure _
theorem word (v : Nat) : ReadOnly (.word v) := by
  intro n c r; cases n <;> rw [Expr.evalFuel] <;> first | exact failure _ | exact pureValue _ rfl
theorem bytes (bs : List Byte) : ReadOnly (.byteArray bs) := by
  intro n c r; cases n <;> rw [Expr.evalFuel] <;> first | exact failure _ | exact pureValue _ rfl
theorem cast (k : CastKind) (size : Nat) (e : Expr) (operand : ReadOnly e) : ReadOnly (.castOp k size e) := by
  intro n c r
  cases n with
  | zero => rw [Expr.evalFuel]; exact failure _
  | succ n =>
    rw [Expr.evalFuel]
    apply bind (operand n c r)
    rintro ⟨v,mid⟩ same
    change mid=r at same; subst mid
    cases k <;> dsimp only
    all_goals first
      | apply liftExcept; intro _; exact pureValue _ rfl
      | apply liftExcept; intro _; apply liftExcept; intro _; exact pureValue _ rfl
      | split <;> first | apply liftExcept; intro _; exact pureValue _ rfl | exact failure _
theorem numeric (op : BinaryOp) (x y : Expr) (strictAnd : op≠.boolAnd) (strictOr : op≠.boolOr)
    (left : ReadOnly x) (right : ReadOnly y) : ReadOnly (.binary op x y) := by
  intro n c r
  cases n with
  | zero => rw [Expr.evalFuel]; exact failure _
  | succ n =>
    rw [Expr.evalFuel]
    apply bind (right n c r)
    rintro ⟨yv,mid⟩ same
    change mid=r at same; subst mid
    apply bind (left n c r)
    rintro ⟨xv,post⟩ same
    dsimp only
    apply liftExcept; intro _; exact pureValue _ same
    all_goals simp_all
theorem newBytes (e : Expr) (size : ReadOnly e) : ReadOnly (.newBytes e) := by
  intro n c r
  cases n with
  | zero => rw [Expr.evalFuel]; exact failure _
  | succ n =>
    rw [Expr.evalFuel]; apply bind (size n c r)
    rintro ⟨v,post⟩ same
    apply liftExcept; intro _
    apply liftExcept; intro _
    exact pureValue _ same
end Inv39.Frame
