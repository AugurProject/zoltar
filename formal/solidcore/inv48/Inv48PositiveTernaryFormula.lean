import Inv32TernaryCall
open SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32Product Inv32Actions
open Inv32NewtonBody Inv32NewtonSeed
namespace Inv48.PositiveTernary
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000


def frame (flag : Bool) (a b : Nat) : Frame :=
  [("condition",.word (boolWord flag)),("a",.word a),("b",.word b),("_ret0",.word 0)]
def env (flag : Bool) (a b : Nat) : Env
  | "a" => some a
  | "b" => some b
  | "_sol_hoist_0" => some (boolWord flag)
  | _ => none

theorem computes (flag : Bool) (a b : W) :
    Inv32PanicChoice.answer.run false (env flag a.toNat b.toNat) =
      some (if flag then a.toNat else b.toNat) := by
  let e := env flag a.toNat b.toNat
  have A := Inv32ProductValues.cleanup (localWord "a") false e a.toNat a.isLt (by rfl)
  have B := Inv32ProductValues.cleanup (localWord "b") false e b.toNat b.isLt (by rfl)
  have X : (clean (xorF (Inv32PanicChoice.w "a") (Inv32PanicChoice.w "b"))).run false e =
      some (a ^^^ b).toNat := by
    apply Inv32ProductValues.cleanup _ _ _ _ (a ^^^ b).isLt
    exact binaryValue _ _ _ _ _ _ a b _ A B (xorWord _ _)
  have F : (clean (cast .uint 256 (localWord "_sol_hoist_0"))).run false e =
      some (if flag then (1 : W) else 0).toNat := by
    cases flag <;> rfl
  have P : (twice (mulF (clean (xorF (Inv32PanicChoice.w "a") (Inv32PanicChoice.w "b")))
      (clean (cast .uint 256 (localWord "_sol_hoist_0"))))).run false e =
      some ((a ^^^ b) * (if flag then (1 : W) else 0)).toNat := by
    apply double
    exact binaryValue _ _ _ _ _ _ _ _ _ X F (mulWord _ _)
  have out : Inv32PanicChoice.answer.run false e =
      some (b ^^^ ((a ^^^ b) * (if flag then (1 : W) else 0))).toNat :=
    Inv32ProductValues.cleanup _ false e _
    (b ^^^ ((a ^^^ b) * (if flag then (1 : W) else 0))).isLt
    (binaryValue _ _ _ _ _ _ _ _ _ B P (xorWord _ _))
  have select : b ^^^ ((a ^^^ b) * (if flag then (1 : W) else 0)) =
      (if flag then a else b) := by
    cases flag <;> simp [BitVec.xor_comm a b, ← BitVec.xor_assoc]
  rw [select] at out
  cases flag <;> exact out

private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

theorem leaf (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (flag : Bool) (a b : W)
    (u : c.checked = false) (m : Models r (env flag a.toNat b.toNat)) :
    Stmt.eval (n+1) t c r (.returnValues [Inv32PanicChoice.answer.core]) =
      pure (.returned r [.word (if flag then a.toNat else b.toNat)]) := by
  have val : Expr.eval c r Inv32PanicChoice.answer.core =
      pure (.word (if flag then a.toNat else b.toNat),r) :=
    Inv32PanicChoice.answer.sound _ _ _ _ _ (by decide) m (u ▸ computes flag a b)
  have single : Expr.evalReturnValue c r Inv32PanicChoice.answer.core =
      pure (.word (if flag then a.toNat else b.toNat),r) := val
  have vs : Expr.evalReturnList c r [Inv32PanicChoice.answer.core] =
      pure ([.word (if flag then a.toNat else b.toNat)],r) := by
    change Expr.evalReturnListFuel (_+1+1) c r [Inv32PanicChoice.answer.core] = _
    simp only [Expr.evalReturnListFuel,single,pb]
  rw [Stmt.eval]; dsimp only; rw [vs]; rfl

end Inv48.PositiveTernary
