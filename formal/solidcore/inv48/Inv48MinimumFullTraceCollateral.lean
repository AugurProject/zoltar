import Inv48MinimumFullTraceRep
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumFullTrace
open Inv48.CollateralReturnedMinimum Inv48.CollateralCloneStage Inv48.MinimumCollateralTrace
open Inv48.RequestDispatch Inv48.WrapperTraversal Inv48.MinimumSuccessWords
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false

theorem recoverCollateral (fuel : Nat) (c : Context) (r final : Runtime) (tr : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval fuel Inv48.Source.model.core.table c r
      (.internalCall [Inv48.Positive.ret1] Inv48.Positive.key1 [])) tr (.ok (.normal final))) :
    ∃ s : Inv48.CollateralReturnedMinimum.Joined tr (.normal final),
      tr = Inv48.QuoteMinimumEvents.collateralTrace s := by
  have entered := Inv48.MinimumSuccessWords.enter _ _ _ _ _ _ _ _ run
  obtain ⟨n,fn,inner,saved,value,bt,ft,fuelEq,lookup,entry,bodySplit,body,finish,ordinary⟩ := entered
  obtain ⟨expected,found,_,returns,shape⟩ := Inv48.Minima.TableCheck.generatedLinks.1
  have same : fn = expected := Option.some.inj (lookup.symm.trans found)
  subst fn
  rw [shape] at body
  obtain ⟨k,v,nEq,valueEq,ordinary,listRun⟩ := Inv48.MinimumCollateralTrace.bodyList n _ inner bt value ordinary body
  obtain ⟨tailStart,pt,tt,mid,a,b,q,callFinal,ct,copyRest,callFuel,sourceSplit,prefixSplit,
    decl,hoistSplit,entered,popEq,copyFuel,copyRun,tailRun⟩ := Inv48.CollateralReturnedMinimum.aggregateEntered k _ _ bt v ordinary listRun
  obtain ⟨an,ai,asaved,av,abt,aft,ak,al,start,readFinal,ob,od,oa,afuel,aggregateSplit,anEq,
    aentry,avEq,oracleSplit,prefixRun,readRun,returnRun,afinish⟩ := Inv48.CollateralCloneStage.enteredOracle callFuel _ _ callFinal ct entered
  let joined : Inv48.CollateralReturnedMinimum.Joined tr (.normal final) := by
    refine {
      n := ak, context := _, checked := rfl, caller := mid.pushScope.declareLocal Inv48.CollateralMinimum.aggregateRet (.word 0), inner := ai, entry := ?_,
      start := start, prefixTrace := ob, prefixRun := prefixRun, final := readFinal,
      before := a++ob, during := od, oracleTail := oa, aggregateFinish := aft,
      copyTail := copyRest, sourceTail := tt, collateralFinish := ft, publicTail := [],
      split := ?_, read := readRun, listValue := al, returnRun := returnRun,
      saved := asaved, callFinal := callFinal, finishRun := ?_, sourceN := k,
      sourceContext := _, tailStart := tailStart, sourceValue := v, tailRun := tailRun,
      fn := expected, collateralSaved := saved, publicFinal := final, collateralRun := ?_,
      continuation := pure, publicRun := .done _,
      fnReturns := ?_, baseStart := _, mid := mid, copied := q, sourceChecked := rfl, contextEq := rfl,
      savedEq := ?_, callerEq := rfl, baseTrace := a, baseRun := decl, copyFuel := by omega,
      copyRun := by simpa only [copyFuel, Nat.add_sub_cancel] using copyRun, popEq := popEq }
    · have E : asaved = (mid.pushScope.declareLocal Inv48.CollateralMinimum.aggregateRet (.word 0)).locals := by
        simp [internalCallEnter?,InternalFunction.initialFrame?,Inv48.CollateralMinimum.aggregateFn,
          InternalFunction.returnDefaultBindings,BindingDecl.bindArgsRef?,BindingDecl.defaultBinding,Ty.defaultValue] at aentry
        exact aentry.2.symm
      rwa [E] at aentry
    · rw [bodySplit,sourceSplit,prefixSplit,hoistSplit,aggregateSplit,oracleSplit]
      simp only [List.append_assoc,List.append_nil]
    · rwa [avEq] at afinish
    · rwa [valueEq] at finish

    · rw [returns]; rfl
    · simp [internalCallEnter?,InternalFunction.initialFrame?,Inv48.CollateralMinimum.aggregateFn,
        InternalFunction.returnDefaultBindings,BindingDecl.bindArgsRef?,BindingDecl.defaultBinding,Ty.defaultValue] at aentry
      exact aentry.2.symm
  exact ⟨joined, by
    change tr = a ++ (ob ++ (od ++ (oa ++ (aft ++ (copyRest ++ (tt ++ ft))))))
    rw [bodySplit,sourceSplit,prefixSplit,hoistSplit,aggregateSplit,oracleSplit]
    simp only [List.append_assoc]⟩
end Inv48.MinimumFullTrace
