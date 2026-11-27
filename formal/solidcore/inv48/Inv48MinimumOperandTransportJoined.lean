import Inv48MinimumOperandTransportCollateral
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumOperandTransport
open Inv48.Positive Inv48.RequestGuards Inv48.RequestDispatch Inv48.WrapperTraversal
open Inv48.MinimumCollateralTrace Inv48.MinimumSuccessWords Inv48.CollateralReturnedMinimum
open Inv48.CollateralCloneStage
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

theorem joinedAt
    (s : Inv48.RequestClassify.Site (Stmt.eval fuel Inv48.Source.model.core.table c r Inv48.Public.body)
      Inv48.Source.model.core.table (.internalCall [ret1] key1 []) trace out)
    (final : Runtime) (during rest : Interaction.Transcript)
    (split : s.after = during ++ rest)
    (entered : Entered s.fuel Inv48.Source.model.core.table s.context s.runtime [ret1] key1 during final)
    (last : Interaction.Executes (s.continuation (.normal final)) rest (.ok out)) :
    ∃ joined : Joined trace out, joined.publicFinal = final ∧ joined.collateralSaved = s.runtime.locals := by
  obtain ⟨n,fn,inner,saved,value,bt,ft,fuelEq,lookup,entry,bodySplit,body,finish,ordinary⟩ := entered
  obtain ⟨expected,found,params,returns,shape⟩ := Inv48.Minima.TableCheck.generatedLinks.1
  have same : fn = expected := Option.some.inj (lookup.symm.trans found)
  have bodyShape : fn.body = Inv48.Minima.collateralBody := by rw [same,shape]; rfl
  rw [bodyShape] at body
  obtain ⟨k,v,nEq,valueEq,ordinary,listRun⟩ := bodyList n _ inner bt value ordinary body
  obtain ⟨tailStart,pt,tt,mid,a,b,q,callFinal,ct,copyRest,callFuel,sourceSplit,prefixSplit,
    decl,hoistSplit,entered,popEq,copyFuel,copyRun,tailRun⟩ := Inv48.CollateralReturnedMinimum.aggregateEntered k _ _ bt v ordinary listRun
  obtain ⟨an,ai,asaved,av,abt,aft,ak,al,start,readFinal,ob,od,oa,afuel,aggregateSplit,anEq,
    aentry,avEq,oracleSplit,prefixRun,readRun,returnRun,afinish⟩ := Inv48.CollateralCloneStage.enteredOracle callFuel _ _ callFinal ct entered
  refine ⟨{
    n := ak, context := _, checked := rfl, caller := mid.pushScope.declareLocal Inv48.CollateralMinimum.aggregateRet (.word 0), inner := ai, entry := ?_,
    start := start, prefixTrace := ob, prefixRun := prefixRun, final := readFinal,
    before := s.before++(a++ob), during := od, oracleTail := oa, aggregateFinish := aft,
    copyTail := copyRest, sourceTail := tt, collateralFinish := ft, publicTail := rest,
    split := ?_, read := readRun, listValue := al, returnRun := returnRun,
    saved := asaved, callFinal := callFinal, finishRun := ?_, sourceN := k,
    sourceContext := _, tailStart := tailStart, sourceValue := v, tailRun := tailRun,
    fn := fn, collateralSaved := saved, publicFinal := final, collateralRun := ?_,
    continuation := s.continuation, publicRun := last,
    fnReturns := ?_, baseStart := _, mid := mid, copied := q, sourceChecked := rfl, contextEq := rfl,
    savedEq := ?_, callerEq := rfl, baseTrace := a, baseRun := decl, copyFuel := by omega,
    copyRun := by simpa only [copyFuel, Nat.add_sub_cancel] using copyRun, popEq := popEq }, rfl, ?_⟩
  · have E : asaved = (mid.pushScope.declareLocal Inv48.CollateralMinimum.aggregateRet (.word 0)).locals := by
      simp [internalCallEnter?,InternalFunction.initialFrame?,Inv48.CollateralMinimum.aggregateFn,
        InternalFunction.returnDefaultBindings,BindingDecl.bindArgsRef?,BindingDecl.defaultBinding,Ty.defaultValue] at aentry
      exact aentry.2.symm
    rwa [E] at aentry
  · calc
      trace = s.before ++ s.after := s.split
      _ = _ := by
        rw [split,bodySplit,sourceSplit,prefixSplit,hoistSplit,aggregateSplit,oracleSplit]
        simp only [List.append_assoc]
  · rwa [avEq] at afinish
  · rwa [valueEq] at finish

  · obtain ⟨expected,found,_,returns,_⟩ := Inv48.Minima.TableCheck.generatedLinks.1
    have eq : fn = expected := Option.some.inj (lookup.symm.trans found)
    rw [eq,returns]
    rfl
  · simp [internalCallEnter?,InternalFunction.initialFrame?,Inv48.CollateralMinimum.aggregateFn,
      InternalFunction.returnDefaultBindings,BindingDecl.bindArgsRef?,BindingDecl.defaultBinding,Ty.defaultValue] at aentry
    exact aentry.2.symm
  · unfold internalCallEnter? at entry
    split at entry
    · contradiction
    · cases entry; rfl

#print axioms joinedAt
end Inv48.MinimumOperandTransport
