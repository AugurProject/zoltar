import Inv45AddPositive
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Add
def bucket (isMin : Bool) := if isMin then "#operand354" else "#operand339"
def limit (isMin : Bool) := if isMin then "#operand362" else "#operand347"
def filled (isMin : Bool) := if isMin then "#operand364" else "#operand349"
def comparisonScope (r : Runtime) (isMin : Bool) (mag : Nat) :=
  r.withFrame [(filled isMin,.word Signed.H),(limit isMin,.word (Signed.H-1)),(bucket isMin,.word mag)]
theorem boundPrefix (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (isMin : Bool) (mag : Nat)
    (word : mag<R) (localV : r.lookupLocal? "negativeValue" = some (.word mag)) (tail : List Source.Stmt) :
    Stmt.evalList (n+1) t c r.pushScope
      ([(fromVar (bucket isMin) (wvar "negativeValue")).value,(fromVar (limit isMin) max).value,
        (fromVar (filled isMin) (extra (wvar (limit isMin)) (num 1))).value] ++ tail) =
      Stmt.evalList (n+1) t c (comparisonScope r isMin mag) tail := by
  let s1 := r.pushScope.declareLocal (bucket isMin) (.word mag)
  let s2 := s1.declareLocal (limit isMin) (.word (Signed.H-1))
  have a := declareWord n t (bucket isMin) (MulDiv.wordVar c r.pushScope "negativeValue" mag word localV)
  have b := declareWord n t (limit isMin) (maxRead c s1)
  have l : s2.lookupLocal? (limit isMin)=some (.word (Signed.H-1)) := by cases isMin <;> rfl
  have cap : Signed.H-1+1<R := by decide
  have plus := addRead (m:=num 1) (MulDiv.wordVar c s2 (limit isMin) _ (by decide) l)
    (Inv08.Authority.literal c s2 1 (by decide)) cap
  have declare := declareWord n t (filled isMin) plus
  refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ a).trans ?_
  refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ b).trans ?_
  exact Inv32FloorStart.seqStep _ _ _ _ _ _ _ declare
theorem belowCap (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (mag : Nat)
    (bound : mag≤Signed.H) (localV : r.lookupLocal? "negativeValue" = some (.word mag)) :
    Stmt.eval (n+2) t c r negCheck.value=pure (.normal r) := by
  have fit : mag<R := lt_of_le_of_lt bound (by decide)
  let st := comparisonScope r false mag
  let last := limited (wvar "#operand339") (wvar "#operand349") "Scalar value negative result exceeds int256 minimum"
  have lim := limitedOK n t "Scalar value negative result exceeds int256 minimum"
    (MulDiv.wordVar c st "#operand339" mag fit rfl) (MulDiv.wordVar c st "#operand349" Signed.H (by decide) rfl)
    fit (by decide) bound
  have whole : Stmt.evalList (n+1) t c r.pushScope _=pure (.normal st) :=
    (boundPrefix n t c r false mag fit localV [last.value]).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ lim).trans (by rw [Stmt.evalList]))
  change Stmt.eval (n+2) t c r (.block _)=_
  rw [Stmt.eval];dsimp only
  exact congrArg (fun p => do let res ← p;pure (Result.mapRuntime Runtime.popScope res)) whole
def boundaryResult (r : Runtime) (mag : Nat) : Result :=
  if mag=Signed.H then .returned r [.int Signed.H] else .normal r
theorem boundary (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (mag : Nat)
    (bound : mag≤Signed.H) (localV : r.lookupLocal? "negativeValue"=some (.word mag)) :
    Stmt.eval (n+3) t c r minCheck.value=pure (boundaryResult r mag) := by
  have fit : mag<R := lt_of_le_of_lt bound (by decide)
  let st := comparisonScope r true mag
  let cond := Expr_binary BinaryOp_eq (wvar "#operand354") (wvar "#operand364")
  let val := Shapes.signedCast (Shapes.signedLiteral Signed.H)
  let last := Stmt_ifElse cond (ret val) Stmt_skip
  have compare : Inv40.Reads c st cond.value (if mag=Signed.H then 1 else 0) := by
    apply Inv08.ReleaseQuote.binary (MulDiv.wordVar c st "#operand354" mag fit rfl) (MulDiv.wordVar c st "#operand364" Signed.H (by decide) rfl)
      .eq (by intro h;cases h) (by intro h;cases h) (Inv32WideGuards.eqWord _ _ _ fit (by decide))
  have pfx := boundPrefix (n+1) t c r true mag fit localV [last.value]
  by_cases eq : mag=Signed.H
  · rw [if_pos eq] at compare
    have V : Signed.inRange (-(Signed.H:Int)) := by constructor <;> decide
    have H : Signed.word (-(Signed.H:Int))=Signed.H := by decide
    have start : Reads c st (Shapes.signedLiteral Signed.H).value (.int (Signed.word (-(Signed.H:Int)))) := by
      rw [H];exact readSignedLiteral c st Signed.H (by decide)
    have a := returnCast n t (e:=Shapes.signedLiteral Signed.H) (intClean start V)
    rw [H] at a
    have yes := Inv32Blocks.branch (n+1) t c st cond.value (ret val).value .skip true (compare _ (by omega))
    have end' : Stmt.eval (n+2) t c st last.value=pure (.returned st [.int Signed.H]) := yes.trans a
    rw [boundaryResult,if_pos eq]
    exact Inv32FloorFastPath.blockReturned (n+2) t c r st _ _ (pfx.trans (Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ end'))
  · rw [if_neg eq] at compare
    have no := Inv32Blocks.branch (n+1) t c st cond.value (ret val).value .skip false (compare _ (by omega))
    have end' : Stmt.eval (n+2) t c st last.value=pure (.normal st) := no.trans (by rw [if_neg (by decide),Stmt.eval])
    have whole := pfx.trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ [] end').trans (by rw [Stmt.evalList]))
    rw [boundaryResult,if_neg eq]
    change Stmt.eval (n+3) t c r (.block _)=_
    rw [Stmt.eval];dsimp only
    exact congrArg (fun p => do let res ← p;pure (Result.mapRuntime Runtime.popScope res)) whole
end Inv45.Add
