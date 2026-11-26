import Inv32Factor
open SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32Product Inv32NewtonBody Inv32Actions
open Inv32FloorStart Inv32Factor Inv32BorrowRun
namespace Inv32FactorRun
def base (r : Runtime) (x y d : Nat) := (Inv32FloorFastPath.scope r x y d).pushScope.pushScope
def stateT (r : Runtime) (x y d h l hi lo rem t : Nat) :=
  (atRemainder (base r x y d) x y h l hi lo rem).declareLocal "twos" (.word t)
set_option maxRecDepth 16000
macro "scalar_write" : tactic => `(tactic|
  simp [stateT,base,Inv32FloorFastPath.scope,atRemainder,state,Inv32FloorStart.hi,Inv32FloorStart.lo,av,bv',
    Runtime.pushScope,Runtime.declareLocal,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.withFrame,
    LocalEnv.declare,LocalEnv.lookup?,LocalEnv.assign?,Frame.lookup?,Frame.assign?,Value.coerceLike?])
theorem divStore (r next : Runtime) (s : String) (a t : Nat) (ha : a<R) (ht : t<R) (pos : 0<t)
    (X : locals r s = some a) (T : locals r "twos" = some t)
    (write : r.assignLocal? s (.word (a/t)) = some next) :
    (divTo s).run false r = some next := by
  have z := Inv32WideGuards.zeroValue false (locals r) _ t ht T
  rw [if_neg (Nat.ne_of_gt pos)] at z
  have divEq := divValue (locals r) (read s) (read "twos") _ _ ha ht pos
    (Inv32ProductValues.cleanup (localWord s) false (locals r) _ ha X)
    (Inv32ProductValues.cleanup (localWord "twos") false (locals r) _ ht T)
  have out := Inv32BorrowRun.write r next s (clean (divF (read s) (read "twos"))) (by change 5 ≤ 8; decide) a (a/t) X divEq write
  simp only [divTo,conditional,z]
  exact out
theorem execute (n : Nat) (table : FunctionTable) (c : Context) (r : Runtime)
    (x y d h l hi lo rem t : Nat) (hd : d<R) (hl : l<R) (ht : t<R) (pos : 0<t) (u : c.checked = false) :
    Stmt.eval (n+3) table c (stateT r x y d h l hi lo rem t) update.core =
      pure (.normal (stateT r x y (d/t) h (l/t) hi lo rem (((R-t)/t+1)%R))) := by
  let st := fun d' l' t' => (stateT r x y d' h l' hi lo rem t').pushScope
  let flipT := ((R-t)/t+1)%R
  have D := divStore (st d l t) (st (d/t) l t) "denominator" d t hd ht pos rfl rfl (by dsimp [st]; scalar_write)
  have L := divStore (st (d/t) l t) (st (d/t) (l/t) t) "low" l t hl ht pos rfl rfl (by dsimp [st]; scalar_write)
  have F := Inv32BorrowRun.write (st (d/t) (l/t) t) (st (d/t) (l/t) flipT) "twos" flip (by decide) t flipT rfl
    (flipValue _ t ht pos rfl) (by dsimp [st,flipT]; scalar_write)
  apply update.sound _ _ _ _ _ (le_trans (by decide : update.depth ≤ 3) (by omega))
  rw [u]
  simp only [update,block,runList]
  rw [D]; simp only [Option.bind]
  rw [L]; simp only [Option.bind]
  rw [F]; rfl
end Inv32FactorRun
