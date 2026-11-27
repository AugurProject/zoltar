import Inv48MinimumRepOperandCuts
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumRepOperand
open Inv48.MinimumCollateralTrace Inv48.RequestDispatch Inv48.WrapperTraversal Inv48.MinimumSuccessWords
open Inv48.CollateralMinimum Inv48.CloneRead Inv48.CloneGetters Inv48.RepReturnedMinimum
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false

theorem joinedAt
    (s : Inv48.RequestClassify.Site (Stmt.eval fuel Inv48.Source.model.core.table c r Inv48.Public.body)
      Inv48.Source.model.core.table (.internalCall [Inv48.Positive.ret2] Inv48.Positive.key2 []) trace out)
    (pf : Runtime) (during rest : Interaction.Transcript)
    (split : s.after = during ++ rest)
    (entered : Entered s.fuel Inv48.Source.model.core.table s.context s.runtime
      [Inv48.Positive.ret2] Inv48.Positive.key2 during pf)
    (last : Interaction.Executes (s.continuation (.normal pf)) rest (.ok out)) :
    ∃ joined : Joined trace out, joined.publicFinal = pf ∧ joined.saved = s.runtime.locals := by
  obtain ⟨n,fn,inner,saved,value,bt,ft,fuelEq,found,entry,traceEq,body,finish,ordinary⟩ := entered
  obtain ⟨expected,lookup,params,returns,shape⟩ := Inv48.Minima.TableCheck.generatedLinks.2.1
  have same : fn = expected := Option.some.inj (found.symm.trans lookup)
  subst fn
  have innerEq : inner = Inv48.RepMinimum.callee s.runtime := by
    simpa [internalCallEnter?,InternalFunction.initialFrame?,params,returns,Inv32Library.decl,
      InternalFunction.returnDefaultBindings,BindingDecl.bindArgsRef?,BindingDecl.defaultBinding,
      Ty.defaultValue,Inv48.RepMinimum.callee] using (congrArg (Option.map Prod.fst) entry).symm
  rw [shape] at body
  obtain ⟨k,v,nEq,valueEq,ord,list⟩ := bodyList n _ inner bt value ordinary body
  have listShape : sourceList = sourceList.take 4 ++
      ([Inv48.Minima.readWord (Inv48.Minima.oracleData 2328446634 view)] ++ Inv48.Minima.repTail) := rfl
  rw [listShape] at list
  obtain ⟨start,a,b,sp,pre,after⟩ := listPrefix k _ _ _ _ _ _ _ (by decide) ord list
  obtain ⟨readFinal,d,e,sp2,read,tail⟩ := listPrefix k _ _ start
    [Inv48.Minima.readWord (Inv48.Minima.oracleData 2328446634 view)] _ b v (by decide) ord after
  refine ⟨{
    n := k, context := _, caller := s.runtime, start := start, final := readFinal,
    value := v, fn := expected, returns := ?_, saved := saved, publicFinal := pf,
    before := s.before++a, during := d, tail := e, finishTrace := ft, rest := rest,
    split := ?_, prefixTrace := a, prefixRun := ?_,
    read := singleton _ _ _ _ _ _ _ read, tailRun := tail, finishRun := ?_,
    continuation := s.continuation, publicRun := last }, rfl, ?_⟩
  · rw [returns]; rfl
  · calc
      trace = s.before ++ s.after := s.split
      _ = _ := by rw [split,traceEq,sp,sp2]; simp only [List.append_assoc]
  · rwa [innerEq] at pre
  · rwa [valueEq] at finish
  · unfold internalCallEnter? at entry
    split at entry
    · contradiction
    · cases entry; rfl

#print axioms joinedAt
end Inv48.MinimumRepOperand
