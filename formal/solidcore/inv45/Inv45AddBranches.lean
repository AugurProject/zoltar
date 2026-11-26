import Inv45AddHoist
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Add
def afterSign := [first,decl temp Option_none,hoist,fromVar "absoluteValue" (wvar temp)]
def whenNeg := [fromVar "negativeValue" (MulDiv.sub (wvar "absoluteValue") (wvar "addend")),negCheck,minCheck,ret negRet]
theorem layout : actions.map Pattern.value=afterSign.map Pattern.value ++ cross.value::whenNeg.map Pattern.value := rfl
theorem skipPositive (n : Nat) (c : Context) (r : Runtime) (v : Int) (V : Signed.inRange v) (neg : v<0)
    (localV : r.lookupLocal? "value"=some (.int (Signed.word v))) :
    Stmt.eval (n+2) model.core.table c r first.value=pure (.normal r) := by
  have cond := Shapes.conditionReads c r v V localV
  rw [if_neg (by omega : ¬0≤v)] at cond
  let y := block [fromVar "valueU" Shapes.positive,posGuard,ret posSum]
  have branch := Inv32Blocks.branch (n+1) model.core.table c r Shapes.nonnegative.value y.value .skip false (cond _ (by omega))
  exact branch.trans (by rw [if_neg (by decide),Stmt.eval])
theorem prepare (n : Nat) (c : Context) (r : Runtime) (v : Int) (V : Signed.inRange v) (neg : v<0)
    (localV : r.lookupLocal? "value"=some (.int (Signed.word v))) (remaining : List Source.Stmt) :
    Stmt.evalList (n+9) model.core.table c r.pushScope (afterSign.map Pattern.value ++ remaining)=
      Stmt.evalList (n+9) model.core.table c (magState r v.natAbs) remaining := by
  let t := model.core.table
  have N := Int.ofNat_natAbs_of_nonpos (Int.le_of_lt neg)
  have lo := V.1
  have fit : v.natAbs<R := by norm_num [R,Signed.H] at *;omega
  have f := skipPositive (n+7) c r.pushScope v V neg localV
  have z := Inv32FloorStart.zero (n+8) t c r.pushScope temp
  have h := fetchMagnitude n c r v V localV
  have m := declareWord (n+8) t "absoluteValue" (MulDiv.wordVar c (temporary r v.natAbs) temp _ fit rfl)
  refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ f).trans ?_;refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ z).trans ?_
  refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ h).trans ?_;exact Inv32FloorStart.seqStep _ _ _ _ _ _ _ m
theorem negTail (n : Nat) (c : Context) (r : Runtime) (mag addend : Nat) (bound : mag≤Signed.H) (lt : addend<mag)
    (M : r.lookupLocal? "absoluteValue"=some (.word mag)) (A : r.lookupLocal? "addend"=some (.word addend)) :
    let g := mag-addend
    Stmt.evalList (n+3) model.core.table c r (whenNeg.map Pattern.value)=
      pure (.returned (r.declareLocal "negativeValue" (.word g)) [.int (Signed.word (-(g:Int)))]) := by
  let t := model.core.table
  let g := mag-addend
  let s := r.declareLocal "negativeValue" (.word g)
  have fit : mag<R := lt_of_le_of_lt bound (by decide)
  have afit := lt_trans lt fit
  have cap : g≤Signed.H := le_trans (Nat.sub_le ..) bound
  have val := subRead (MulDiv.wordVar c r "absoluteValue" mag fit M) (MulDiv.wordVar c r "addend" addend afit A) fit afit lt.le
  have declG := declareWord (n+2) t "negativeValue" val
  have G : s.lookupLocal? "negativeValue"=some (.word g) := by
    cases e : r.locals <;> simp [s,Runtime.lookupLocal?,Runtime.declareLocal,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,e]
  have guardG := belowCap (n+1) t c s g cap G
  have boundaryG := boundary n t c s g cap G
  refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ declG).trans ?_
  refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ guardG).trans ?_
  by_cases eq : g=Signed.H
  · simp only [boundaryResult,if_pos eq] at boundaryG
    have w : Signed.word (-(g:Int))=Signed.H := by rw [eq];decide
    rw [←w] at boundaryG
    exact Inv32FloorFastPath.stop _ _ _ _ _ _ _ _ boundaryG
  · simp only [boundaryResult,if_neg eq] at boundaryG
    refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ boundaryG).trans ?_
    exact Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ (negativeOut (n+2) t c s g G (by dsimp [g];omega) (by omega))
theorem inner (n : Nat) (c : Context) (r : Runtime) (v : Int) (a : Nat) (V : Signed.inRange v) (A : a<R)
    (enough : Signed.inRange (v+(a:Int))) (loc : r.lookupLocal? "value"=some (.int (Signed.word v)))
    (add : r.lookupLocal? "addend"=some (.word a)) :
    Stmt.eval (n+10) model.core.table c r (block actions).value=pure (.returned r [.int (Signed.word (v+↑a))]) := by
  let t := model.core.table
  by_cases pos : 0≤v
  · obtain ⟨u,rfl⟩ := Int.eq_ofNat_of_zero_le pos
    rw [wordNonneg] at loc
    have P : u+a<Signed.H := by have := enough.2;omega
    have H := positiveExec (n+5) t c r.pushScope u a loc add P
    have result : Signed.word (↑u+↑a)=u+a := by simpa only [←Nat.cast_add] using wordNonneg (u+a)
    rw [result]
    apply Inv32FloorFastPath.blockReturned (n+9) t c r r.pushScope _
    exact Inv32FloorFastPath.stop _ _ _ _ _ _ _ _ H
  · have neg : v<0 := by omega
    let mag := v.natAbs
    let s := magState r mag
    have eq : (mag:Int) = -v := Int.ofNat_natAbs_of_nonpos neg.le
    have bound : mag≤Signed.H := by have := V.1;omega
    have fit := lt_of_le_of_lt bound (show Signed.H<R by decide)
    have p := prepare n c r v V neg loc (cross.value::whenNeg.map Pattern.value)
    have hpos : a-mag<Signed.H := by have := enough.2; omega
    have choose := crossExec (n+6) t c s mag a add rfl A fit hpos
    by_cases yes : mag≤a
    · rw [if_pos yes] at choose
      have w : Signed.word (v+↑a)=a-mag := by
        have e : v+↑a=((a-mag:Nat):Int) := by rw [Int.natCast_sub yes];omega
        rw [e,wordNonneg]
      rw [w]
      apply Inv32FloorFastPath.blockReturned (n+9) t c r s _
      rw [show (Inv32Shapes.seq actions).value=actions.map Pattern.value from rfl,layout]
      exact p.trans (Inv32FloorFastPath.stop _ _ _ _ _ _ _ _ choose)
    · rw [if_neg yes] at choose
      have lt : a<mag := by omega
      have vEq : v+↑a= -((mag-a:Nat):Int) := by rw [Int.natCast_sub lt.le];omega
      rw [vEq]
      let dst := s.declareLocal "negativeValue" (.word (mag-a))
      apply Inv32FloorFastPath.blockReturned (n+9) t c r dst _
      rw [show (Inv32Shapes.seq actions).value=actions.map Pattern.value from rfl,layout]
      exact p.trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ choose).trans (negTail (n+6) c s mag a bound lt rfl add))
end Inv45.Add
