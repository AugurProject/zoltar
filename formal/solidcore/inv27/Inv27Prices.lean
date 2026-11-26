import Inv27Execution
open SolidCore.Solidity.Source Inv32Division Inv32FloorFastPath Inv32FloorStart Inv32Actions Inv32QuoteExpr Inv03.Bodies
namespace Inv27
private theorem returnValue (f : Nat) (c : Context) (r : Runtime) (v : Nat) (fit : v<R) (look : locals r tmp=some v) :
    Stmt.eval (f+1) table c r output = pure (.returned r [.word v]) :=
  Inv32CompareValues.retOne f table c r (castCopy tmp).core v (evalFormula (castCopy tmp) _ _ _ (by decide)
    (castValue _ _ _ _ fit look))
theorem liquidation (f : Nat) (c : Context) (r : Runtime) (p e : Nat) (hp : p<R) (good : e<D) (checked : c.checked=true) :
    let src := r.withFrame (frame p e)
    Stmt.eval (f+22) table c src (body false).value = pure (.returned src [.word (lower p e)]) := by
  let inner := (r.withFrame (frame p e)).pushScope.pushScope
  let final := Inv32OneArg.store inner tmp (lower p e)
  have fit := lt_of_le_of_lt (lowerLe p e) hp
  have ed : e<R := lt_trans good (by decide)
  have sum : D+e<R := lt_of_lt_of_le (Nat.add_lt_add_left good D) (by decide)
  have ok := guardExec (f+19) c inner e ed rfl
  rw [if_pos good] at ok
  have args : Inv32FloorHoist.Inputs c inner tmp (w "price").core prec.core
      (Inv32Midpoint.plus prec (w "uncertainty")).core p D (D+e) :=
    ⟨checkedValue _ _ _ p hp rfl,precisionValue _ _,denomPlus _ _ _ good checked rfl⟩
  have paid := Inv32FloorHoist.successAt table Inv03.productLinked Inv03.floorLinked (f+5) c inner tmp _ _ _ p D (D+e)
    hp (by decide) sum (by omega) fit args (by decide) (by decide) (by decide) (by decide)
  have endStep := returnValue (f+19) c final _ fit rfl
  apply runBody _ _ _ _ _ hp ed false (.value _)
  exact ⟨final,rfl,(seqStep _ _ _ _ _ _ _ ok).trans
    ((seqStep _ _ _ _ _ _ _ (Inv32FloorStart.zero (f+19) table c inner tmp)).trans
    ((seqStep _ _ _ _ _ _ _ paid).trans (stop _ _ _ _ _ _ [] _ endStep)))⟩

private def innerState (r : Runtime) (p e : Nat) := (r.withFrame (frame p e)).pushScope.pushScope
private def capped (r : Runtime) (p e : Nat) :=
  (Inv32OneArg.store (innerState r p e) tmp (maximum e)).declareLocal "maximumPrice" (.word (maximum e))

private theorem capPrefix (f : Nat) (c : Context) (r : Runtime) (p e : Nat) (good : e<D) (tail : List Stmt) :
    Stmt.evalList (f+20) table c (innerState r p e) ([guard.value,init,maximumCall,setMax] ++ tail) =
      Stmt.evalList (f+20) table c (capped r p e) tail := by
  let inner := innerState r p e
  let got := Inv32OneArg.store inner tmp (maximum e)
  have me : maximum e<R := lt_of_le_of_lt (maximumFits e) (by decide)
  have ed : e<R := lt_trans good (by decide)
  have dd : D-e<R := lt_of_le_of_lt (Nat.sub_le _ _) (by decide)
  have ok := guardExec (f+19) c inner e ed rfl
  rw [if_pos good] at ok
  have args : Inv32FloorHoist.Inputs c inner tmp (Inv32Product.clean (Inv32Scalar.literal M)).core
      (nonnegativeSub prec (w "uncertainty")).core prec.core M (D-e) D :=
    ⟨maximumLiteral _ _,denomMinus _ _ e good rfl,precisionValue _ _⟩
  have computed := Inv32FloorHoist.successAt table Inv03.productLinked Inv03.floorLinked (f+5) c inner tmp _ _ _
    M (D-e) D (by decide) dd (by decide) (by decide) me args (by decide) (by decide) (by decide) (by decide)
  have storeMax := Inv32Hoist.declEval (f+19) table c got "maximumPrice" .uint256 (castCopy tmp).core (maximum e)
    (evalFormula (castCopy tmp) c got _ (by decide) (castValue _ _ _ _ me rfl)) (by rw [Ty.coerceValue?])
  exact (seqStep _ _ _ _ _ _ _ ok).trans ((seqStep _ _ _ _ _ _ _ (Inv32FloorStart.zero (f+19) table c inner tmp)).trans
    ((seqStep _ _ _ _ _ _ _ computed).trans (seqStep _ _ _ _ _ _ _ storeMax)))

theorem tooLarge (f : Nat) (c : Context) (r : Runtime) (p e : Nat) (hp : p<R) (good : e<D) (bad : maximum e<p) :
    let src := r.withFrame (frame p e)
    Stmt.eval (f+22) table c src (body true).value = pure (.reverted src (.error "Conservative oracle price exceeds uint256")) := by
  let saved := capped r p e
  have ok := priceGuardExec (f+19) c saved p (maximum e) hp (lt_of_le_of_lt (maximumFits e) (by decide)) rfl rfl
  rw [if_neg (Nat.not_le_of_gt bad)] at ok
  apply runBody _ _ _ _ _ hp (lt_trans good (by decide)) true (.error _)
  exact ⟨saved,rfl,(capPrefix _ _ _ _ _ good _).trans (Inv32Revert.stop _ _ _ _ _ _ _ _ ok)⟩

theorem conservative (f : Nat) (c : Context) (r : Runtime) (p e : Nat) (hp : p<R) (good : e<D) (bound : p≤maximum e) :
    let src := r.withFrame (frame p e)
    Stmt.eval (f+22) table c src (body true).value = pure (.returned src [.word (upper p e)]) := by
  let saved := capped r p e
  let final := Inv32OneArg.store saved tmp (upper p e)
  have out := lt_of_le_of_lt ((fits_iff p e good).mpr bound) (by decide : M<R)
  have dd : D-e<R := lt_of_le_of_lt (Nat.sub_le _ _) (by decide)
  have ok := priceGuardExec (f+19) c saved p (maximum e) hp (lt_of_le_of_lt (maximumFits e) (by decide)) rfl rfl
  rw [if_pos bound] at ok
  have args : Inv32FloorHoist.Inputs c saved tmp (w "price").core prec.core
      (nonnegativeSub prec (w "uncertainty")).core p D (D-e) :=
    ⟨checkedValue _ _ _ p hp rfl,precisionValue _ _,denomMinus _ _ _ good rfl⟩
  have result := Inv03.ceilHoist f c saved _ _ _ p D (D-e) hp (by decide) dd (by omega) out args
  have endStep := returnValue (f+19) c final _ out rfl
  apply runBody _ _ _ _ _ hp (lt_trans good (by decide)) true (.value _)
  exact ⟨final,rfl,(capPrefix _ _ _ _ _ good _).trans ((seqStep _ _ _ _ _ _ _ ok).trans
    ((seqStep _ _ _ _ _ _ _ (Inv32FloorStart.zero (f+19) table c saved tmp)).trans
    ((seqStep _ _ _ _ _ _ _ result).trans (stop _ _ _ _ _ _ [] _ endStep))))⟩
end Inv27
