import Inv48CollateralReturnedMinimumRecover
import Inv48CollateralCloneFuelClose
import Inv48MinimumSuccessWordsTails
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.CollateralReturnedMinimum
open Inv48.CollateralCloneStage Inv48.MinimumCollateralTrace
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
structure Joined (trace : Interaction.Transcript) (out : Result) extends Slice trace out where
  fnReturns : fn.returns = [⟨"_ret0",.uint256,false⟩]
  baseStart : Runtime
  mid : Runtime
  copied : Runtime
  sourceChecked : sourceContext.checked = true
  contextEq : context = sourceContext
  savedEq : saved = caller.locals
  callerEq : caller = mid.pushScope.declareLocal Inv48.CollateralMinimum.aggregateRet (.word 0)
  baseTrace : Interaction.Transcript
  baseRun : Interaction.Executes (Stmt.evalList sourceN Inv48.CollateralMinimum.table sourceContext baseStart
    [.varDecl .uint256 Inv48.Minima.operand (some (.castOp .uintCleanup 256 (.immutable "minimumReportCollateral"))),
     .varDecl .uint256 Inv03.Bodies.tmp none]) baseTrace (.ok (.normal mid))
  copyFuel : 2 ≤ sourceN
  copyRun : Interaction.Executes (Stmt.evalList (sourceN-1) Inv48.CollateralMinimum.table sourceContext callFinal
    [.assign (.var Inv03.Bodies.tmp) (.var Inv48.CollateralMinimum.aggregateRet)]) copyTail (.ok (.normal copied))
  popEq : tailStart = copied.popScope
/-- Same descent as recoveredRead, retaining its actual return and tail runs. -/
theorem recover (fuel : Nat) (c : Context) (r : Runtime)
    (trace : Interaction.Transcript) (out : Result) (h : Recovered fuel c r trace out) :
    Nonempty (Joined trace out) := by
  obtain ⟨s,final,during,rest,n,fn,inner,saved,value,bt,ft,k,v,split,fuelEq,lookup,shape,entry,
    bodySplit,nEq,valueEq,ordinary,listRun,finish,last⟩ := h
  obtain ⟨tailStart,pt,tt,mid,a,b,q,callFinal,ct,copyRest,callFuel,sourceSplit,prefixSplit,
    decl,hoistSplit,entered,popEq,copyFuel,copyRun,tailRun⟩ := aggregateEntered k _ _ bt v ordinary listRun
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
    copyRun := by simpa only [copyFuel, Nat.add_sub_cancel] using copyRun, popEq := popEq }⟩
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
end Inv48.CollateralReturnedMinimum
