import Inv04CeilCall
import Inv03FeeSteps
open SolidCore.Solidity.Source Inv32Division Inv32Actions Inv32QuoteExpr Inv32FloorFastPath Inv32FloorStart
namespace Inv04.Cash

def frame (u n d rem : Nat) : Frame :=
  [("units",.word u),("numerator",.word n),("denominator",.word d),("remainder",.word rem),("_ret0",.word 0)]
def assignScale := Stmt.assign (.var Shapes.scale) (.word (10^9))
def code : List Stmt := [
  .varDecl .uint256 Inv03.Bodies.tmp none,
  Inv03.Hoist.code Inv32Bodies.Ceil.key Inv32CeilHoist.dest (w "units").core (w "numerator").core
    (w "denominator").core (Inv03.Bodies.enumWord 1).value,
  .varDecl .uint256 Shapes.viewName (some (castCopy Inv03.Bodies.tmp).core),
  temp Shapes.carry "remainder",.varDecl .uint256 Shapes.sum (some (Inv32Midpoint.plus (w Shapes.viewName) (w Shapes.carry)).core),
  .varDecl .uint256 Shapes.scale none,.ifElse (.word 1) assignScale assignScale,.varDecl .uint256 Inv03.Bodies.tmp none,
  Ceil.code.value,.returnValues [(castCopy Inv03.Bodies.tmp).core]]
theorem shape : Shapes.requiredShape.value = .block [cleanParam "units",cleanParam "numerator",cleanParam "denominator",
    cleanParam "remainder",.skip,.block [.block code]] := rfl

theorem run (f : Nat) (c : Context) (r : Runtime) (u n d rem : Nat) (hu : u<R) (hn : n<R) (hd : d<R)
    (hr : rem<R) (hp : 0<d) (fits : Inv03.ceilQuot (u*n) d+rem<R) (checked : c.checked=true) :
    let src := r.withFrame (frame u n d rem)
    Stmt.eval (f+23) Inv03.model.core.table c src Shapes.requiredShape.value =
      pure (.returned src [.word (Inv03.ceilQuot (Inv03.ceilQuot (u*n) d+rem) (10^9))]) := by
  let t := Inv03.model.core.table
  let src := r.withFrame (frame u n d rem)
  let outer := src.pushScope
  let inner := outer.pushScope
  let work := inner.pushScope
  let q := Inv03.ceilQuot (u*n) d
  let x := q+rem
  let v := Inv03.ceilQuot x (10^9)
  let got := Inv32OneArg.store work Inv03.Bodies.tmp q
  let saved := got.declareLocal Shapes.viewName (.word q)
  let withCarry := saved.declareLocal Shapes.carry (.word rem)
  let withSum := withCarry.declareLocal Shapes.sum (.word x)
  let scaled := fun z => withSum.declareLocal Shapes.scale (.word z)
  let final := Inv32OneArg.store (scaled (10^9)) Inv03.Bodies.tmp v
  have hq : q<R := lt_of_le_of_lt (Nat.le_add_right q rem) fits
  have hv : v<R := lt_of_le_of_lt ((Inv03.ceil_le x (10^9) x (by decide)).mpr (Nat.le_mul_of_pos_right _ (by decide))) fits
  have args : Inv32FloorHoist.Inputs c work Inv03.Bodies.tmp (w "units").core (w "numerator").core (w "denominator").core u n d :=
    ⟨Inv32Guards.clean _ _ _ _ _ hu (Inv32Guards.readWord _ _ _ _ _ rfl),
     Inv32Guards.clean _ _ _ _ _ hn (Inv32Guards.readWord _ _ _ _ _ rfl),
     Inv32Guards.clean _ _ _ _ _ hd (Inv32Guards.readWord _ _ _ _ _ rfl)⟩
  have first := Inv03.ceilHoist f c work _ _ _ u n d hu hn hd hp hq args
  have dec := Inv32Hoist.declEval (f+19) t c got Shapes.viewName .uint256 (castCopy Inv03.Bodies.tmp).core q
    (evalFormula (castCopy Inv03.Bodies.tmp) c got q (by decide) (castValue _ _ _ _ hq rfl)) (by rw [Ty.coerceValue?])
  let sum := Inv32Midpoint.plus (w Shapes.viewName) (w Shapes.carry)
  have Q := Inv32ProductValues.cleanup (Inv32Scalar.localWord Shapes.viewName) true (locals withCarry) _ hq rfl
  have S := Inv32ProductValues.cleanup (Inv32Scalar.localWord Shapes.carry) true (locals withCarry) _ hr rfl
  have add := Inv32Hoist.declEval (f+19) t c withCarry Shapes.sum .uint256 sum.core x
    (evalFormula sum _ _ _ (by decide) (checked ▸ Inv32Midpoint.plusValue _ _ _ q rem hq hr fits Q S)) (by rw [Ty.coerceValue?])
  have write := Inv32Writes.constant (f+18) t c (scaled 0) (scaled (10^9)) Shapes.scale 0 (10^9) rfl
    (by dsimp [scaled,withSum,withCarry,saved,got,work,inner,outer,src,frame,Inv32OneArg.store,Shapes.scale]; write_temps; decide)
  have guard := Inv32Blocks.branch (f+19) t c (scaled 0) (.word 1) assignScale assignScale true (by rfl)
  have second := Ceil.hoist (f+4) c (scaled (10^9)) x fits rfl rfl
  have exit := Inv32CompareValues.retOne (f+19) t c final (castCopy Inv03.Bodies.tmp).core v
    (evalFormula (castCopy Inv03.Bodies.tmp) c final v (by decide) (castValue _ _ _ _ hv rfl))
  have steps : Stmt.evalList (f+20) t c work code = pure (.returned final [.word v]) := by
    unfold code
    refine (seqStep _ _ _ _ _ _ _ (zero (f+19) t c work Inv03.Bodies.tmp)).trans ?_
    refine (seqStep _ _ _ _ _ _ _ first).trans ?_
    refine (seqStep _ _ _ _ _ _ _ dec).trans ?_
    refine (seqStep _ _ _ _ _ _ _ (Inv32Temps.temp (f+19) t c saved Shapes.carry "remainder" rem hr rfl)).trans ?_
    refine (seqStep _ _ _ _ _ _ _ add).trans ?_
    refine (seqStep _ _ _ _ _ _ _ (zero (f+19) t c withSum Shapes.scale)).trans ?_
    refine (seqStep _ _ _ _ _ _ _ (guard.trans write)).trans ?_
    refine (seqStep _ _ _ _ _ _ _ (zero (f+19) t c (scaled (10^9)) Inv03.Bodies.tmp)).trans ?_
    exact (seqStep _ _ _ _ _ _ _ second).trans (stop _ _ _ _ _ _ [] _ exit)
  have body := blockReturned _ t c inner final code _ steps
  have mid := blockReturned _ t c outer inner _ _ (stop _ _ _ _ _ _ [] _ body)
  have a := cleanParamExec (f+21) t c outer "units" u hu rfl (by dsimp [outer,src,frame]; write_param)
  have b := cleanParamExec (f+21) t c outer "numerator" n hn rfl (by dsimp [outer,src,frame]; write_param)
  have e := cleanParamExec (f+21) t c outer "denominator" d hd rfl (by dsimp [outer,src,frame]; write_param)
  have g := cleanParamExec (f+21) t c outer "remainder" rem hr rfl (by dsimp [outer,src,frame]; write_param)
  have sk : Stmt.eval (f+22) t c outer .skip = pure (.normal outer) := by rw [Stmt.eval]
  dsimp only
  rw [shape]
  apply blockReturned _ _ _ _ outer
  exact (seqStep _ _ _ _ _ _ _ a).trans ((seqStep _ _ _ _ _ _ _ b).trans ((seqStep _ _ _ _ _ _ _ e).trans
    ((seqStep _ _ _ _ _ _ _ g).trans ((seqStep _ _ _ _ _ _ _ sk).trans (stop _ _ _ _ _ _ [] _ mid)))))
end Inv04.Cash
