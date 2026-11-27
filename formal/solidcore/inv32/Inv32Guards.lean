import Inv32Eval
import Inv32Dispatch
open SolidCore.Solidity.Source Inv32Division
namespace Inv32Guards
private theorem bindOk {α β : Type} (v : α) (k : α → SolI β) : (pure v >>= k) = k v := rfl

theorem readWord (fu : Nat) (c : Context) (r : Runtime) (name : String) (v : Nat)
    (localValue : r.lookupLocal? name = some (.word v)) :
    Expr.evalFuel (fu+1) c r (.var name) = pure (.word v,r) := by
  have noStorage : r.lookupStorageBase? name = none := by simp [Runtime.lookupStorageBase?,localValue]
  rw [Expr.evalFuel, noStorage, localValue]
  rfl

theorem cleanupWord (checked : Bool) (v : Nat) (hv : v < R) :
    uintCleanup? checked 256 (.word v) = .ok (.word v) := by
  have hnorm : SolidCore.Solidity.Shared.norm v = v := Nat.mod_eq_of_lt hv
  norm_num [R] at hv
  simp [uintCleanup?,uintCast?,Value.forceAbiLazy,Value.asStorageWord?,hnorm,
    Nat.not_le_of_gt hv, Nat.mod_eq_of_lt hv, Bind.bind, Except.bind]

theorem clean (fu : Nat) (c : Context) (r : Runtime) (e : Expr) (v : Nat) (hv : v < R)
    (read : Expr.evalFuel fu c r e = pure (.word v,r)) :
    Expr.evalFuel (fu+1) c r (.castOp .uintCleanup 256 e) = pure (.word v,r) := by
  rw [Expr.evalFuel,read]
  simp only [bindOk,cleanupWord _ _ hv]
  rfl

private theorem gtValue (checked : Bool) (a b : Nat) (ha : a < R) (hb : b < R) :
    BinaryOp.apply checked .gt (.word a) (.word b) = .ok (.word (if b < a then 1 else 0)) := by
  have val (v : Nat) (h : v < R) : (SolidCore.Solidity.Shared.toEvmWord v).val.val = v := by
    change (v%R)%R = v
    simp [Nat.mod_eq_of_lt h]
  have truth : (SolidCore.Solidity.Shared.toEvmWord a > SolidCore.Solidity.Shared.toEvmWord b) ↔ b < a := by
    change (SolidCore.Solidity.Shared.toEvmWord b).val.val < (SolidCore.Solidity.Shared.toEvmWord a).val.val ↔ _
    rw [val a ha,val b hb]
  simp [BinaryOp.apply, BinaryOp.applyWord, Value.forceAbiLazy, BinaryOp.preservesFixedBytesWidth,
    SolidCore.Solidity.Shared.gtWord, SolidCore.Solidity.Shared.liftEvmBinary,
    EvmYul.UInt256.gt, truth, Bind.bind, Except.bind]
  split <;> rename_i cmp
  · simp_all [Bool.toUInt256]; rfl
  · simp_all [Bool.toUInt256, show ¬ b < a by omega]; rfl
def positiveLocal (name : String) : Expr := .binary .gt (.castOp .uintCleanup 256 (.var name)) (.word 0)

theorem positiveRead (n : Nat) (c : Context) (r : Runtime) (name : String) (v : Nat)
    (hv : v < R) (read : r.lookupLocal? name = some (.word v)) :
    Expr.evalFuel (n+3) c r (positiveLocal name) = pure (.word (if 0<v then 1 else 0),r) := by
  apply Inv32Eval.binary _ _ _ _ (by intro h; cases h) (by intro h; cases h) _ _ (.word v) (.word 0)
  · exact clean _ _ _ _ _ hv (readWord _ _ _ _ _ read)
  · rw [Expr.evalFuel]; rfl
  · exact gtValue _ _ _ hv (by decide)

def reservesGuard : Stmt :=
  .requireStmt (.binary .boolAnd (positiveLocal "reserveIn") (positiveLocal "reserveOut")) (some "Empty reserves")

theorem guardResult (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (x y : Nat)
    (hx : x < R) (hy : y < R) (rx : r.lookupLocal? "reserveIn" = some (.word x))
    (ry : r.lookupLocal? "reserveOut" = some (.word y)) :
    reservesGuard.eval (n+1) t c r =
      pure (if 0<x ∧ 0<y then .normal r else .reverted r (.error "Empty reserves")) := by
  let e := Expr.binary .boolAnd (positiveLocal "reserveIn") (positiveLocal "reserveOut")
  let m := e.orderFuel - 3
  have fuelEq : e.orderFuel = m+3 := by decide
  have rhs := positiveRead m c r "reserveOut" y hy ry
  have eval : Expr.eval c r e = pure (.word (if 0<x ∧ 0<y then 1 else 0),r) := by
    unfold Expr.eval
    rw [fuelEq]
    change Expr.evalFuel (m+3+1) c r (.binary .boolAnd _ _) = _
    rw [Expr.evalFuel, positiveRead _ _ _ _ _ hx rx]
    by_cases yes : 0<x
    · rw [if_pos yes]
      change (do let (v, r') ← Expr.evalFuel (m+3) c r (positiveLocal "reserveOut")
                 let w ← liftM v.expectWord
                 pure (Value.word (boolWord (wordTruthy w)), r')) = _
      rw [rhs]
      by_cases good : 0<y <;> simp only [yes, good, true_and, if_true, if_false] <;> rfl
    · rw [if_neg yes]
      simp only [yes, false_and, if_false]
      rfl
  change Stmt.eval (n+1) t c r (.requireStmt e (some "Empty reserves")) = _
  rw [Stmt.eval]
  dsimp only
  rw [eval]
  split <;> rfl
def quoteLibraryKey : Inv32Dispatch.Direction → String
  | .forward => "__internal___library_TwoWayConstantProductMath_quoteExactInput(uint256,uint256,uint256,uint256)#[SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256]"
  | .inverse => "__internal___library_TwoWayConstantProductMath_quoteExactOutput(uint256,uint256,uint256,uint256)#[SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256]"

def firstGuard? (dir : Inv32Dispatch.Direction) : Option Stmt := do
  let fn ← Inv32Dispatch.model.core.table.lookup? (quoteLibraryKey dir)
  let .block top := fn.body | none
  let .block statements ← top[6]? | none
  statements.head?

private def matchesGuard : Option Stmt → Bool
  | some (.requireStmt (.binary .boolAnd
      (.binary .gt (.castOp .uintCleanup 256 (.var "reserveIn")) (.word 0))
      (.binary .gt (.castOp .uintCleanup 256 (.var "reserveOut")) (.word 0)))
      (some "Empty reserves")) => true
  | _ => false

theorem generatedGuard (d : Inv32Dispatch.Direction) : firstGuard? d = some reservesGuard := by
  have h : matchesGuard (firstGuard? d) = true := by cases d <;> native_decide
  generalize firstGuard? d = s at *
  unfold matchesGuard at h
  split at h
  · rfl
  · contradiction
end Inv32Guards
