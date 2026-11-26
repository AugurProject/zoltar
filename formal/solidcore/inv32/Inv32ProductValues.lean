import Inv32Product
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Scalar Inv32Division Inv32Product
namespace Inv32ProductValues

theorem cleanup (e : Formula) (b : Bool) (env : Env) (v : Nat) (hv : v < R)
    (h : e.run b env = some v) : (clean e).run b env = some v := by
  simp [clean,Inv32Scalar.cast,h,Inv32Guards.cleanupWord b v hv,projectWord]

private theorem prim (op : Source.BinaryOp) (a b w : Nat)
    (neq : op ≠ .eq) (nne : op ≠ .ne)
    (h : op.applyWord false a b = .ok w) :
    op.apply false (.word a) (.word b) = .ok (.word w) := by
  cases op <;> simp_all [Source.BinaryOp.apply, Value.forceAbiLazy, Source.BinaryOp.preservesFixedBytesWidth,
      Bind.bind, Except.bind]

theorem lowResult (a b : Nat) (ha : a < R) (hb : b < R) (env : Env)
    (xa : env "a" = some a) (yb : env "b" = some b) :
    lowExpr.run false env = some ((a*b)%R) := by
  have x := cleanup (localWord "a") false env _ ha xa
  have y := cleanup (localWord "b") false env _ hb yb
  have prod := Inv32Execution.mul (bv a) (bv b)
  simp only [BitVec.toNat_mul, BitVec.toNat_ofNat, Nat.mod_eq_of_lt ha, Nat.mod_eq_of_lt hb] at prod
  apply cleanup _ _ _ _ (Nat.mod_lt _ (Nat.two_pow_pos 256))
  simp [mulF,binary,x,y,prim .mul a b _ (by intro h; cases h) (by intro h; cases h) prod, projectWord,R]

theorem biggest : ∀ checked : Bool, largest.run checked (fun _ => none) = some (R-1) := by native_decide

theorem maxRun (env : Env) (checked : Bool) : largest.run checked env = some (R-1) :=
  biggest checked

theorem modResult (a b : Nat) (ha : a < R) (hb : b < R) (env : Env)
    (xa : env "a" = some a) (yb : env "b" = some b) :
    modExpr.run false env = some ((a*b)%(R-1)) := by
  have x := cleanup (localWord "a") false env _ ha xa
  have y := cleanup (localWord "b") false env _ hb yb
  have na : normWord a = a := Nat.mod_eq_of_lt ha
  have nb : normWord b = b := Nat.mod_eq_of_lt hb
  have nh : normWord (R-1) = R-1 := by decide
  simp [modExpr, modularProduct, x, y, maxRun, na, nb, nh,
    Inv32Rounding.remainder _ _ (R-1) ha hb (by decide) (by decide), Except.toOption]

theorem subWord (a b : Nat) (ha : a < R) (hb : b < R) :
    Source.BinaryOp.apply false .sub (.word a) (.word b) = .ok (.word ((a+R-b)%R)) := by
  apply prim _ _ _ _ (by intro h; cases h) (by intro h; cases h)
  have h := Inv32Execution.sub (bv a) (bv b)
  simp only [BitVec.toNat_sub, BitVec.toNat_ofNat, Nat.mod_eq_of_lt ha, Nat.mod_eq_of_lt hb] at h
  rw [Nat.add_sub_assoc (Nat.le_of_lt hb)]
  simpa only [Nat.add_comm a (R-b)] using h

theorem ltWord (a b : Nat) (ha : a < R) (hb : b < R) :
    Source.BinaryOp.apply false .lt (.word a) (.word b) = .ok (.word (if a < b then 1 else 0)) := by
  apply prim _ _ _ _ (by intro h; cases h) (by intro h; cases h)
  have val (v : Nat) (h : v < R) : (Shared.toEvmWord v).val.val = v := by
    change (v%R)%R = v
    simp [Nat.mod_eq_of_lt h]
  have truth : (Shared.toEvmWord a < Shared.toEvmWord b) ↔ a < b := by
    change (Shared.toEvmWord a).val.val < (Shared.toEvmWord b).val.val ↔ _
    rw [val a ha,val b hb]
  by_cases h : a < b <;>
    simp_all [Source.BinaryOp.applyWord,Shared.ltWord,Shared.liftEvmBinary,
      EvmYul.UInt256.lt,Bool.toUInt256, h] <;> try rfl
  rw [if_neg (by omega)]; rfl

end Inv32ProductValues
