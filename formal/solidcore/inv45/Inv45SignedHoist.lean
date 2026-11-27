import Inv45NumericHoists
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Scalar
theorem addHoist (fuel : Nat) (c : Context) (r : Runtime) (lo : Int) (q : Nat) (L : Signed.inRange lo) (Q : q<R)
    (out : Signed.inRange (lo+↑q)) (low : r.lookupLocal? "minValue"=some (.int (Signed.word lo)))
    (num : r.lookupLocal? "scalarValueU"=some (.word q)) :
    Stmt.eval (fuel+15) model.core.table c (r.declareLocal Format.temp0 (.int 0)) add.value=
      pure (.normal (r.declareLocal Format.temp0 (.int (Signed.word (lo+↑q))))) := by
  let t := model.core.table
  let value := Signed.word (lo+↑q)
  let s := r.declareLocal Format.temp0 (.int 0)
  let a := s.pushScope.declareLocal "_ic_arg_0" (.int (Signed.word lo))
  let b := a.declareLocal "_ic_arg_1" (.word q)
  let mid (base : Runtime) (result : Nat) := base.withFrame [(addSlot,.int result),("_ic_arg_1",.word q),("_ic_arg_0",.int (Signed.word lo))]
  let dst := r.declareLocal Format.temp0 (.int value)
  have arg0 := Add.declareSigned (fuel+13) t "_ic_arg_0" (e:=sVar "minValue") (intClean (readSignedLocal c s.pushScope "minValue" _
    (by simpa [s,pushLookup,declLookup,Format.temp0] using low)) L)
  have arg1 := Add.declareWord (fuel+13) t "_ic_arg_1" (MulDiv.wordVar c a "scalarValueU" q Q
    (by simpa [a,s,pushLookup,declLookup,Format.temp0] using num))
  have init : Stmt.eval (fuel+14) t c b (sint addSlot Option_none).value=pure (.normal (mid s 0)) := by
    change Stmt.eval _ _ _ _ (.varDecl .int256 addSlot none)=_;rw [Stmt.eval];simp [Ty.defaultValue];rfl
  have res := Add.call (fuel+1) c (mid s 0) lo q "_ic_arg_0" "_ic_arg_1" [addSlot] L Q out rfl rfl
  have norm : Shared.norm value=value := Nat.mod_eq_of_lt (Signed.wordFit _ out)
  have assigned : internalCallAssign (mid s 0) [addSlot] [.int value]=pure (.normal (mid s value)) := by
    dsimp [internalCallAssign,mid];simp [Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,Runtime.assignLocal?,
      Runtime.lookupLocal?,Runtime.withFrame,LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?,norm]
  have read := Inv32Internal.capture (fuel+13) t c (mid s 0) (mid s value) [addSlot] _ (res.trans assigned)
  have temp : (mid s value).lookupLocal? Format.temp0=some (.int 0) := by
    cases H : r.locals <;> simp [mid,s,Runtime.lookupLocal?,Runtime.withFrame,Runtime.declareLocal,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,Format.temp0,addSlot,H]
  have write : (mid s value).assignLocal? Format.temp0 (.int value)=some (mid dst value) := by
    cases H : r.locals <;> simp [mid,s,dst,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.withFrame,Runtime.declareLocal,
      LocalEnv.declare,LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?,Format.temp0,addSlot,H,norm]
  have copy := copySigned (fuel+13) t c _ _ Format.temp0 addSlot 0 value temp rfl write
  apply Inv32Hoist.block (fuel+14) t c s (mid dst value) _
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ arg0).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ arg1).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ init).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ read).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ copy).trans
  change Stmt.evalList (fuel+14) _ _ _ []=_;rw [Stmt.evalList]
end Inv45.Scalar
