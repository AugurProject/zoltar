import Inv32WideAdapters
open Inv32WideMath Inv32WideAdapters
open SolidCore.Solidity.Source Inv32Division Inv32Actions Inv32FloorStart Inv32FloorNarrow
open Inv32FactorRun Inv32WideFinish Inv32WideEntry Inv32NewtonBody
namespace Inv32WideExecution
set_option maxRecDepth 65536
def suffix := [Inv32NewtonSeed.declaration] ++ List.replicate 6 step ++ [resultAssign,ret]
theorem statements : instructions = start ++ (firstBranch :: overflow ::
    .varDecl .uint256 "remainder" none :: Inv32Borrow.update.core ::
    .varDecl .uint256 "twos" (some Inv32WideWords.lowBit.core) :: Inv32Factor.update.core :: merge :: suffix) := by rfl
def sameEffects (a b : Runtime) := ∀ locals : LocalEnv, {a with locals} = {b with locals}
theorem steps (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (x y d : Nat)
    (hx : x<R) (hy : y<R) (hd : d<R) (wide : 0<x*y/R) (fits : x*y/R<d) :
    ∃ next, sameEffects next r ∧
      Stmt.evalList (n+8) t {c with checked := false}
        (state (base r x y d) x y (x*y/R) (x*y%R) (x*y/R) (x*y%R)) (instructions.drop 9) =
        pure (.returned next [.word (productQuotient x y d)]) := by
  let ctx := {c with checked := false}
  let p := x*y
  let h := p/R
  let l := p%R
  let rem := p%d
  let carry : Nat := if l<rem then 1 else 0
  let h' := h-carry
  let l' := (l+R-rem)%R
  let m := (bv d &&& -(bv d)).toNat
  let flip := ((R-m)/m+1)%R
  let qd := d/m
  let ql := l'/m
  let merged := (bv ql ||| (bv h')*(bv flip))
  let inv := Inv32Newton.iterate (bv qd) 6
  let pre := base r x y d
  let after := state pre x y h l h l
  let final := finished r x y qd h' merged.toNat h l rem flip (merged*inv).toNat inv
  have hp : 0<d := lt_trans wide fits
  have hr : h<R := lt_trans fits hd
  have lr : l<R := Nat.mod_lt _ (Nat.two_pow_pos 256)
  have hr' : h'<R := lt_of_le_of_lt (Nat.sub_le _ _) hr
  have lr' : l'<R := Nat.mod_lt _ (Nat.two_pow_pos 256)
  have dr : (bv d).toNat = d := Nat.mod_eq_of_lt hd
  have positive : 0<m := lowBitPos (bv d) (by rw [dr]; exact hp)
  have mr : m<R := (bv d &&& -(bv d)).isLt
  have flipR : flip<R := Nat.mod_lt _ (Nat.two_pow_pos 256)
  have B1 := narrowMiss (n+6) t ctx after h hr wide rfl
  have B2 := overflowMiss (n+6) t ctx after h d hr hd fits rfl rfl rfl
  have B3 := zero (n+7) t ctx after "remainder"
  have B4 := Inv32BorrowRun.exec (n+5) t ctx pre x y d h l h l hx hy hd hp hr lr wide rfl rfl rfl rfl
  let afterBorrow := Inv32BorrowRun.atRemainder pre x y h' l' h l rem
  have B5 := initBit (n+7) t ctx afterBorrow d hd rfl rfl
  have B6 := Inv32FactorRun.execute (n+5) t ctx r x y d h' l' h l rem m hd lr' mr positive rfl
  have B7 := mergeN (n+7) t ctx r x y qd h l rem h' ql flip hr' (lt_of_le_of_lt (Nat.div_le_self _ _) lr') flipR rfl
  let beforeSeed := stateT r x y qd h' merged.toNat h l rem flip
  have B8 := seeded (n+7) t ctx beforeSeed qd [resultAssign,ret] (lt_of_le_of_lt (Nat.div_le_self _ _) hd) rfl rfl
  have B9 := finish (n+7) t ctx r x y qd h' h l rem flip merged inv rfl
  have prog : Stmt.evalList (n+8) t ctx after (instructions.drop 9) = pure (.returned final [.word (merged*inv).toNat]) := by
    change Stmt.evalList _ _ _ _ (firstBranch :: overflow :: .varDecl .uint256 "remainder" none ::
      Inv32Borrow.update.core :: .varDecl .uint256 "twos" (some Inv32WideWords.lowBit.core) ::
      Inv32Factor.update.core :: merge :: suffix) = _
    refine (seqStep _ _ _ _ _ _ _ B1).trans ?_
    refine (seqStep _ _ _ _ _ _ _ B2).trans ?_
    refine (seqStep _ _ _ _ _ _ _ B3).trans ?_
    refine (seqStep _ _ _ _ _ _ _ B4).trans ?_
    refine (seqStep _ _ _ _ _ _ _ B5).trans ?_
    refine (seqStep _ _ _ _ _ _ _ B6).trans ?_
    refine (seqStep _ _ _ _ _ _ _ B7).trans ?_
    exact B8.trans B9
  exact ⟨final, fun _ => rfl, prog⟩
theorem tail (n : Nat) (c : Context) (r : Runtime) (x y d : Nat)
    (hx : x<R) (hy : y<R) (hd : d<R) (wide : 0<x*y/R) (fits : x*y/R<d) :
    ∃ next, sameEffects next r ∧
      Stmt.evalList (n+8) Inv32Dispatch.model.core.table {c with checked := false}
        (base r x y d).pushScope instructions = pure (.returned next [.word (productQuotient x y d)]) := by
  obtain ⟨next,same,rest⟩ := steps n Inv32Dispatch.model.core.table c r x y d hx hy hd wide fits
  refine ⟨next,same,?_⟩
  change Stmt.evalList _ _ _ _ (start ++ instructions.drop 9) = _
  exact (runPrefix (n+6) _ _ _ _ hx hy rfl rfl _ (by omega)).trans rest
end Inv32WideExecution
