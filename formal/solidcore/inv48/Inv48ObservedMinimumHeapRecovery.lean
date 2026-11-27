import Inv48ObservedMinimumHeapRead
import Inv48MinimumOperandTransportCollateral
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.ObservedMinimumHeap
open Inv48.MinimumOperandTransport Inv48.Positive Inv48.RequestGuards Inv48.RequestDispatch Inv48.WrapperTraversal
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
    ∃ joined : Joined trace out, joined.publicFinal = final ∧ joined.collateralSaved = s.runtime.locals ∧
      joined.baseStart.memory = s.runtime.memory ∧
      joined.baseStart.nextMemory = s.runtime.nextMemory := by
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
    copyRun := by simpa only [copyFuel, Nat.add_sub_cancel] using copyRun, popEq := popEq }, rfl, ?_, ?_⟩
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

  · unfold internalCallEnter? at entry
    split at entry
    · contradiction
    · cases entry; exact ⟨rfl,rfl⟩

#print axioms joinedAt
end Inv48.ObservedMinimumHeap

open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.ObservedMinimumHeap
open Inv48.MinimumCollateralTrace Inv48.RequestDispatch Inv48.WrapperTraversal Inv48.MinimumSuccessWords
open Inv48.CollateralMinimum Inv48.CloneRead Inv48.CloneGetters Inv48.RepReturnedMinimum
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false

theorem repJoinedAt
    (s : Inv48.RequestClassify.Site (Stmt.eval fuel Inv48.Source.model.core.table c r Inv48.Public.body)
      Inv48.Source.model.core.table (.internalCall [Inv48.Positive.ret2] Inv48.Positive.key2 []) trace out)
    (pf : Runtime) (during rest : Interaction.Transcript)
    (split : s.after = during ++ rest)
    (entered : Entered s.fuel Inv48.Source.model.core.table s.context s.runtime
      [Inv48.Positive.ret2] Inv48.Positive.key2 during pf)
    (last : Interaction.Executes (s.continuation (.normal pf)) rest (.ok out)) :
    ∃ joined : Joined trace out, joined.publicFinal = pf ∧ joined.saved = s.runtime.locals ∧ joined.caller = s.runtime := by
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
    continuation := s.continuation, publicRun := last }, rfl, ?_, rfl⟩
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

#print axioms repJoinedAt
end Inv48.ObservedMinimumHeap
