import Inv32MathParts
open SolidCore.Solidity.Source Inv32Division Inv32Actions Inv32NewtonBody Inv32FloorStart Inv32WideFinish Inv32FactorRun
namespace Inv32WideAdapters
theorem toNat (v : Nat) (h : v < R) : (bv v).toNat = v := Nat.mod_eq_of_lt h
theorem mergeN (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (x y d hi lo rem h l tw : Nat)
    (hh : h<R) (hl : l<R) (ht : tw<R) (u : c.checked = false) :
    Stmt.eval (n+1) t c (stateT r x y d h l hi lo rem tw) merge =
      pure (.normal (stateT r x y d h (bv l ||| bv h*bv tw).toNat hi lo rem tw)) := by
  have z := mergeExec n t c r x y d hi lo rem (bv h) (bv l) (bv tw) u
  rwa [toNat _ hh,toNat _ hl,toNat _ ht] at z

theorem initBit (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (d : Nat)
    (dr : d<R) (u : c.checked = false) (hd : locals r "denominator" = some d) :
    Stmt.eval (n+1) t c r (.varDecl .uint256 "twos" (some Inv32WideWords.lowBit.core)) =
    pure (.normal (r.declareLocal "twos" (.word (bv d &&& -(bv d)).toNat))) :=
  Inv32WideWords.declaration _ _ _ _ _ u ((toNat _ dr).symm ▸ hd)
theorem seeded (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (d : Nat)
    (ss : List Stmt) (dr : d<R) (u : c.checked = false) (hd : locals r "denominator" = some d) :
    Stmt.evalList (n+1) t c r ((Inv32NewtonSeed.declaration :: List.replicate 6 step) ++ ss) =
    Stmt.evalList (n+1) t c (put r (Inv32Newton.iterate (bv d) 6)) ss :=
  Inv32NewtonSeed.seedAndSix _ _ _ _ _ _ u ((toNat _ dr).symm ▸ hd)
end Inv32WideAdapters
