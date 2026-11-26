import Inv32Borrow
open SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32Product Inv32Actions Inv32Borrow Inv32FloorStart
namespace Inv32BorrowRun
def atRemainder (r : Runtime) (x y hi lo topHi topLo rem : Nat) :=
  (state r x y hi lo topHi topLo).declareLocal "remainder" (.word rem)
theorem write (r next : Runtime) (k : String) (e : Formula) (sz) (old v : Nat)
    (bound : locals r k = some old) (rhs : (clean e).run false (locals r) = some v)
    (updated : r.assignLocal? k (.word v) = some next) :
    (writeCast k .cleanup 256 e sz).run false r = some next := by
  change (cast .cleanup 256 e).run false (locals r) = some v at rhs
  simp [writeCast,bound,rhs,updated]

set_option maxRecDepth 12000
macro "store_limb" : tactic => `(tactic|
  simp [atRemainder,state,Inv32FloorStart.hi,Inv32FloorStart.lo,av,bv',Runtime.pushScope,
    Runtime.declareLocal,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.withFrame,
    LocalEnv.declare,LocalEnv.lookup?,LocalEnv.assign?,Frame.lookup?,Frame.assign?,Value.coerceLike?])
theorem exec (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (x y d high low topHi topLo : Nat) (hx : x<R) (hy : y<R) (hd : d<R) (hp : 0<d)
    (hh : high<R) (hl : low<R) (Hpos : 0<high) (u : c.checked = false)
    (X : locals r "x" = some x) (Y : locals r "y" = some y) (D : locals r "denominator" = some d) :
    let rem := x*y%d
    let carry := if low<rem then 1 else 0
    Stmt.eval (n+3) t c (atRemainder r x y high low topHi topLo 0) update.core =
    pure (.normal (atRemainder r x y (high-carry) ((low+R-rem)%R) topHi topLo rem)) := by
  dsimp only
  let rem := x*y%d
  let carry : Nat := if low<rem then 1 else 0
  let st := fun h l m => (atRemainder r x y h l topHi topLo m).pushScope
  let newLow := (low+R-rem)%R
  have mr : rem < R := lt_trans (Nat.mod_lt _ hp) hd
  have cr : carry < R := by dsimp [carry]; split <;> decide
  have no : (Inv32WideGuards.zeroTest "denominator").run false (locals (st high low 0)) = some 0 := by
    rw [Inv32WideGuards.zeroValue false (locals (st high low 0)) "denominator" d hd D,if_neg (Nat.ne_of_gt hp)]
  have A := write (st high low 0) (st high low rem) "remainder" productMod (by decide) 0 rem rfl
    (Inv32ProductValues.cleanup _ _ _ _ mr (modValue _ x y d hx hy hd hp X Y D))
    (by dsimp [st]; store_limb)
  have eqv : (high+R-carry)%R = high-carry := by
    have le' : carry ≤ high := by dsimp [carry]; split <;> omega
    rw [show high+R-carry = (high-carry)+R by omega,Nat.add_mod_right,Nat.mod_eq_of_lt (lt_of_le_of_lt (Nat.sub_le _ _) hh)]
  have B := write (st high low rem) (st (high-carry) low rem) "high" (clean (subF h borrow)) (by decide)
    high (high-carry) rfl (eqv ▸ subValue _ _ _ _ _ hh cr
      (Inv32ProductValues.cleanup (localWord "high") false _ _ hh rfl)
      (borrowValue _ _ _ mr hl rfl rfl)) (by dsimp [st]; store_limb)
  have C := write (st (high-carry) low rem) (st (high-carry) newLow rem) "low" (clean (subF l m))
    (by decide) low newLow rfl (subValue _ _ _ _ _ hl mr
      (Inv32ProductValues.cleanup (localWord "low") false _ _ hl rfl)
      (Inv32ProductValues.cleanup (localWord "remainder") false _ _ mr rfl))
    (by dsimp [st]; store_limb)
  apply update.sound _ _ _ _ _ (le_trans (by decide : update.depth ≤ 3) (by omega))
  rw [u]
  simp only [update,block,runList,conditional]
  rw [no]
  simp only [bind,Option.bind,show wordTruthy (normWord 0) = false by decide,Bool.false_eq_true,if_false]
  rw [A]; simp only [Option.bind]
  rw [B]; simp only [Option.bind]
  rw [C]; rfl
end Inv32BorrowRun
