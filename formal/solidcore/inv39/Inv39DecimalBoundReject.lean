import Inv39DecimalBoundExec
import Inv45FuelMonotonicity
import Inv39MarkerTail
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv39.DecimalBound
open Inv45 Inv45.Decimal
 theorem positiveRejected (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (v : Nat)
    (V : v<R) (nonzero : 0<v) (err : RevertData)
    (cap : c.checkMemoryAllocation (reversed v).length=.error err) :
    ∃ dst, Stmt.evalList (fuel+82) t c (prepared r v).pushScope.pushScope (data.map Pattern.value)=
      pure (.reverted dst err) := by
  let a := Bytes.allocate r []
  let d := (reversed v).length
  let root := (prepared r v).pushScope
  let s := root.pushScope
  let countStart := countState root 0 v
  let countEnd := countState root d 0
  let buf := Bytes.allocate a (List.replicate d 0)
  have length : d≤78 := lengthBound v (lt_trans V (by decide : R<10^78))
  have size : d<R := lt_of_le_of_lt length (by decide)
  have test := MulDiv.eqZero (MulDiv.wordVar c s number v V rfl) V
  rw [if_neg (Nat.ne_of_gt nonzero)] at test
  let initial := Stmt_ifElse (MulDiv.equalZero (wvar number)) (ret (bytesLiteral [48])) Stmt_skip
  have sk : Stmt.eval (fuel+82) t c s initial.value=pure (.normal s) := by
    have no := MulDiv.branchFalse (fuel+81) t c s (ret (bytesLiteral [48])) Stmt_skip _ test
    exact no.trans (by rw [show Stmt_skip.value=Stmt.skip from rfl,Stmt.eval])
  have tmp := Add.declareWord (fuel+81) t "tempValue" (MulDiv.wordVar c s number v V rfl)
  have init := Inv32FloorStart.zero (fuel+81) t c (s.declareLocal "tempValue" (.word v)) "digits"
  have countR := count (fuel+(78-d)) t c root v 0 V (by simpa only [Nat.zero_add] using size)
  simp only [Nat.zero_add] at countR
  change Stmt.evalWhile (fuel+(78-d)+3+d) t c countStart _ _=pure (.normal countEnd) at countR
  rw [show fuel+(78-d)+3+d=fuel+81 by omega] at countR
  have countLoopR : Stmt.eval (fuel+82) t c countStart countLoop.value=pure (.normal countEnd) := by
    change Stmt.eval _ _ _ _ (.whileLoop _ _)=_;rw [Stmt.eval];exact countR
  have expr : Expr.eval c countEnd (allocBytes "digits").value=throw (SolidityFailure.revert err) := by
    have norm : Shared.norm d=d := Nat.mod_eq_of_lt size
    have expect : (Value.word d).expectWord=.ok d := congrArg (Except.ok (ε:=RevertData)) norm
    change Expr.evalFuel 3 c countEnd (.newBytes (.var "digits"))=_
    rw [Expr.evalFuel,Inv32Guards.readWord _ _ _ _ _ (show countEnd.lookupLocal? "digits"=some (.word d) from rfl)]
    simp only [Inv08.Authority.bindPure,Inv08.Authority.liftPure,expect]
    rw [show c.checkMemoryAllocation d=.error err from cap]
    rfl
  have ref : Expr.memoryRefOrValue c countEnd (allocBytes "digits").value=throw (SolidityFailure.revert err) := by
    change Expr.memoryRefOrValueFuel 4 c countEnd (.newBytes (.var "digits"))=_
    rw [Expr.memoryRefOrValueFuel.eq_def];dsimp only
    change Expr.evalFuel 3 c countEnd (.newBytes (.var "digits"))=_ at expr
    rw [expr];rfl
  have alloc : Stmt.eval (fuel+82) t c countEnd (mem "buffer" (Option_some (allocBytes "digits"))).value=
      pure (.reverted countEnd err) := by
    change Stmt.eval _ _ _ _ (.memoryVarDecl .bytesCalldata "buffer" (some (allocBytes "digits").value))=_
    rw [Stmt.eval];dsimp only;rw [ref];rfl
  refine ⟨countEnd,?_⟩
  refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ sk).trans ?_
  refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ tmp).trans ?_
  refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ init).trans ?_
  refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ countLoopR).trans ?_
  change Stmt.evalList _ _ _ _ (_::_)=_
  rw [Stmt.evalList,alloc];rfl
theorem executionRejected (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (v : Nat)
    (V : v<R) (nonzero : 0<v) (err : RevertData)
    (cap : c.checkMemoryAllocation (reversed v).length=.error err) :
    ∃ dst, Stmt.eval (fuel+84) t c (entry r v) fn.body=pure (.reverted dst err) := by
  obtain ⟨dst,run⟩ := positiveRejected fuel t c r v V nonzero err cap
  let s := entry r v
  have set := Inv32FloorFastPath.cleanParamExec (fuel+82) t c s.pushScope number v V rfl
    (by simp [s,entry,number,Runtime.assignLocal?,Runtime.assignLocalRaw?,Runtime.lookupLocal?,Runtime.withFrame,Runtime.pushScope,
      LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?])
  have loc := localize (fuel+82) t c r v
  have inner : Stmt.eval (fuel+83) t c (prepared r v).pushScope (block data).value=
      pure (.reverted dst.popScope err) := by
    change Stmt.eval _ _ _ _ (.block (data.map Pattern.value))=_
    rw [Stmt.eval];dsimp only;rw [run];rfl
  refine ⟨dst.popScope.popScope,?_⟩
  rw [source]
  change Stmt.eval _ _ _ _ (.block _)=_
  rw [Stmt.eval];dsimp only
  have rest : Stmt.evalList (fuel+83) t c s.pushScope [param number |>.value,initRet.value,(block data).value]=
      pure (.reverted dst.popScope err) := by
    refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ set).trans ?_
    refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ loc).trans ?_
    rw [Stmt.evalList,inner];rfl
  change Stmt.evalList (fuel+83) t c s.pushScope (seq [param number,initRet,block data]).value=_ at rest
  rw [rest];rfl
end Inv39.DecimalBound
