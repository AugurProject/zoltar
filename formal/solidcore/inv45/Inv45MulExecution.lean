import Inv45Wide
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.MulDiv
theorem narrowPath (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (x y d : Nat)
    (X : x<R) (Y : y<R) (D : d<R) (positive : 0<d) (small : x*y/R=0) (un : c.checked=false) :
    Stmt.eval (n+4) t c (outer r x y d 0) (.block stageList) =
      pure (.returned (outer r x y d 0) [.word (x*y/d)]) := by
  let start := outer r x y d 0
  let l := x*y
  let p := registers start 0 l
  have lf : l<R := (Nat.div_eq_zero_iff.mp small).resolve_left (by decide)
  have product := evalProductBlock n t c start x y rfl rfl X Y un
  rw [small,Nat.mod_eq_of_lt lf] at product
  have cond := eqZero (wordVar c p "prod1" 0 (by decide) rfl) (by decide)
  rw [if_pos rfl] at cond
  let e := div (v "prod0") (v "denominator")
  have Rq := divRead (wordVar c p.pushScope "prod0" l lf rfl) (wordVar c p.pushScope "denominator" d D rfl) lf D positive
  have returned := Inv32CompareValues.retOne n t c p.pushScope e.value _ (Rq _ (by decide))
  have exec : Stmt.eval (n+2) t c p (block [ret e]).value=pure (.returned p [.word (l/d)]) :=
    Inv32FloorFastPath.blockReturned (n+1) t c p p.pushScope [(.returnValues [e.value])] [.word (l/d)]
      (Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ returned)
  have branch := Inv32Blocks.branch (n+2) t c p (equalZero (v "prod1")).value (block [ret e]).value Stmt.skip true (cond _ (by omega))
  have done : Stmt.eval (n+3) t c p narrow.value = pure (.returned p [.word (l/d)]) := branch.trans exec
  have steps : Stmt.evalList (n+3) t c start.pushScope stageList = pure (.returned p [.word (l/d)]) := by
    rw [stagesForm]
    refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ (Inv32FloorStart.zero (n+2) t c start.pushScope "prod0")).trans ?_
    refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ (Inv32FloorStart.zero (n+2) t c _ "prod1")).trans ?_
    refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ product).trans ?_
    exact Inv32FloorFastPath.stop _ _ _ _ _ _ _ _ done
  exact Inv32FloorFastPath.blockReturned _ _ _ _ _ _ _ steps
def bodyResult (r : Runtime) (x y d : Nat) : Result :=
  if x*y/R=0 then .returned (arguments r x y d 0) [.word (x*y/d)]
  else .normal (arguments r x y (reducedDen d) (x*y/d))
theorem bodyExecution (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (x y d : Nat)
    (X : x<R) (Y : y<R) (D : d<R) (positive : 0<d) (fit : x*y/d<R) :
    Stmt.eval (fuel+7) t c (arguments r x y d 0) body.value=pure (bodyResult r x y d) := by
  let start := arguments r x y d 0
  let ctx := {c with checked:=false}
  have cleanup (k v) (f : v<R) (here : start.pushScope.lookupLocal? k=some (.word v))
      (store : start.pushScope.assignLocal? k (.word v)=some start.pushScope) :=
    Inv32FloorFastPath.cleanParamExec (fuel+5) t c start.pushScope k v f here store
  have xClean := cleanup "x" x X rfl (by dsimp [start];store_div)
  have yClean := cleanup "y" y Y rfl (by dsimp [start];store_div)
  have dClean := cleanup "denominator" d D rfl (by dsimp [start];store_div)
  have sk : Stmt.eval (fuel+6) t c start.pushScope .skip=pure (.normal start.pushScope) := by rw [Stmt.eval]
  have valid := guardYes (msg:="mulDiv denominator must be greater than zero") (fuel+4) t
    (gtRead (y:=zero) (wordVar c (outer r x y d 0) "denominator" d D rfl) (Inv08.Authority.literal c _ 0 (by decide)) D (by decide) positive)
  have outerShape : body.value=.block [Inv32FloorFastPath.cleanParam "x", Inv32FloorFastPath.cleanParam "y",
      Inv32FloorFastPath.cleanParam "denominator",.skip,.block [guardD.value,.unchecked (.block stageList)]] := rfl
  have fits : x*y/R<d := by
    apply (Nat.div_lt_iff_lt_mul (show 0<R by decide)).mpr
    simpa only [Nat.mul_comm R d] using (Nat.div_lt_iff_lt_mul positive).mp fit
  change Stmt.eval (fuel+7) t c start body.value=_
  rw [outerShape,Stmt.eval];dsimp only
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ xClean,Inv32FloorStart.seqStep _ _ _ _ _ _ _ yClean,
    Inv32FloorStart.seqStep _ _ _ _ _ _ _ dClean,Inv32FloorStart.seqStep _ _ _ _ _ _ _ sk]
  by_cases small : x*y/R=0
  · have p := narrowPath fuel t ctx r x y d X Y D positive small rfl
    have u : Stmt.eval (fuel+5) t c (outer r x y d 0) (.unchecked (.block stageList))=pure (.returned (outer r x y d 0) [.word (x*y/d)]) := by rw [Stmt.eval];exact p
    have inside := Inv32FloorFastPath.blockReturned (fuel+5) t c start.pushScope (outer r x y d 0)
      [guardD.value,.unchecked (.block stageList)] [.word (x*y/d)]
      ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ valid).trans (Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ u))
    rw [Stmt.evalList,inside];simp [bodyResult,small];rfl
  · have p := widePath fuel t ctx r x y d X Y D (Nat.pos_of_ne_zero small) fits rfl
    let dst := outer r x y (reducedDen d) (x*y/d)
    have u : Stmt.eval (fuel+5) t c (outer r x y d 0) (.unchecked (.block stageList))=pure (.normal dst) := by rw [Stmt.eval];exact p
    have b : Stmt.eval (fuel+6) t c start.pushScope (.block [guardD.value,.unchecked (.block stageList)])=
        pure (.normal dst.popScope) := by
      have whole : Stmt.evalList (fuel+5) t c start.pushScope.pushScope [guardD.value,.unchecked (.block stageList)] = pure (.normal dst) :=
        (Inv32FloorStart.seqStep _ _ _ _ _ _ _ valid).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ u).trans (by rw [Stmt.evalList]))
      rw [Stmt.eval];dsimp only;rw [whole];rfl
    rw [Stmt.evalList,b];simp only [Inv08.Authority.bindPure,Stmt.evalList]
    rw [bodyResult,if_neg small];rfl
end Inv45.MulDiv
