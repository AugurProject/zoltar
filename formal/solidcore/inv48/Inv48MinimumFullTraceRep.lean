import Inv48MinimumFullTraceCore
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumFullTrace
open Inv48.RepReturnedMinimum Inv48.MinimumCollateralTrace Inv48.RequestDispatch Inv48.WrapperTraversal Inv48.MinimumSuccessWords
open Inv48.CollateralMinimum Inv48.CloneRead Inv48.CloneGetters
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false

theorem recoverRep (fuel : Nat) (c : Context) (r final : Runtime) (tr : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval fuel Inv48.Source.model.core.table c r
      (.internalCall [Inv48.Positive.ret2] Inv48.Positive.key2 [])) tr (.ok (.normal final))) :
    ∃ s : Inv48.RepReturnedMinimum.Joined tr (.normal final),
      tr = Inv48.QuoteMinimumEvents.repTrace s := by
  have entered := Inv48.MinimumSuccessWords.enter _ _ _ _ _ _ _ _ run
  obtain ⟨n,fn,inner,saved,value,bt,ft,fuelEq,found,entry,traceEq,body,finish,ordinary⟩ := entered
  obtain ⟨expected,lookup,params,returns,shape⟩ := Inv48.Minima.TableCheck.generatedLinks.2.1
  have same : fn = expected := Option.some.inj (found.symm.trans lookup)
  subst fn
  have innerEq : inner = Inv48.RepMinimum.callee r := by
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
  let joined : Inv48.RepReturnedMinimum.Joined tr (.normal final) := by
    refine {
      n := k, context := _, caller := r, start := start, final := readFinal,
      value := v, fn := expected, returns := ?_, saved := saved, publicFinal := final,
      before := a, during := d, tail := e, finishTrace := ft, rest := [],
      split := ?_, prefixTrace := a, prefixRun := ?_,
      read := singleton _ _ _ _ _ _ _ read, tailRun := tail, finishRun := ?_,
      continuation := pure, publicRun := .done _ }
    · rw [returns]; rfl
    · rw [traceEq,sp,sp2]
      simp only [List.append_assoc,List.append_nil]
    · rwa [innerEq] at pre
    · rwa [valueEq] at finish
  exact ⟨joined, by
    change tr = a ++ (d ++ (e ++ ft))
    rw [traceEq,sp,sp2]
    simp only [List.append_assoc]⟩
end Inv48.MinimumFullTrace
