import Inv39MarkerPrefixLocals
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Init.Marker.Prefix
theorem bodyEntry (s post : State) (sender self uid cap rep : Nat) (out : List Source.Value)
    (run : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "initialize")
      (Child.callContext sender self) s [.word uid,.word cap,.word rep]=some (.returned post out)) :
    let c := Child.callContext sender self
    let r := (CheckedWordCall.initial c s).withFrame [("universeId_",.word uid),("totalTheoreticalSupplyAttoRep_",.word cap),("repNumber_",.word rep)]
    ∃ f a b d e suffix res, model.core.findFunctionByName? "initialize"=some f ∧
      f.body=Repeat.body (a::repGuard::b::d::e::repStore::suffix) ∧
      (Source.Stmt.eval 50000 model.core.table c r (Repeat.body (a::repGuard::b::d::e::repStore::suffix))).runWith []=.ok res ∧
      f.callBodyResult s res=.returned post out := by
  intro c r
  obtain ⟨f,a,b,d,e,suffix,found,ps,rs,body⟩ := sites
  have frame : f.initialFrame? [.word uid,.word cap,.word rep]=some [("universeId_",.word uid),("totalTheoreticalSupplyAttoRep_",.word cap),("repNumber_",.word rep)] := by
    unfold FunctionDef.initialFrame? FunctionDef.returnDefaultBindings
    rw [ps,rs];simp [params,BindingDecl.bindArgs?,BindingDecl.bindArg?,Ty.coerceValue?]
  have accepts : f.acceptsValue c.value := by simp [c,Child.callContext,FunctionDef.acceptsValue,Contract.context,wordEq]
  have start : f.evalBodyEntry 50000 model.core.table c s [.word uid,.word cap,.word rep]=some (Source.Stmt.eval 50000 model.core.table c r f.body) := by
    unfold FunctionDef.evalBodyEntry;rw [if_pos accepts,frame];rfl
  unfold TypeCheck.CheckedContract.callTargetWithContext? at run
  rw [Child.resolve _ _ _ _ _ found frame] at run
  change f.call? 50000 model.core.table c s [.word uid,.word cap,.word rep]=_ at run
  unfold FunctionDef.call? FunctionDef.call at run
  rw [start] at run
  have evalMap : (Functor.map (f.callBodyResult s) (Source.Stmt.eval 50000 model.core.table c r f.body)).runWith [] =
      ((Source.Stmt.eval 50000 model.core.table c r f.body).runWith [] >>= fun v => .ok (f.callBodyResult s v)) :=
    Fold.bindRun [] _ (fun v => pure (f.callBodyResult s v))
  cases step : SolI.runWith [] (Source.Stmt.eval 50000 model.core.table c r f.body) with
  | error err =>
    simp [evalMap,step,Bind.bind,Except.bind,Option.bind] at run
  | ok res =>
    refine ⟨f,a,b,d,e,suffix,res,found,body,body ▸ step,?_⟩
    simpa [evalMap,step,Bind.bind,Except.bind,Option.bind] using run

end Inv39.Init.Marker.Prefix
