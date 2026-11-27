import Inv48CollateralCloneStageTrace
import Inv48CollateralCloneStagePrefix
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.CollateralCloneStage
open Inv48.MinimumCollateralTrace
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- The real continuations accompanying a recovered contiguous read slice.
The aggregate return, internal finish, collateral tail, collateral finish and
public continuation remain separately indexed by their original transcripts. -/
structure Slice (trace : Interaction.Transcript) (out : Result) where
  n : Nat
  context : Context
  checked : context.checked = true
  caller : Runtime
  inner : Runtime
  entry : internalCallEnter? Inv48.CollateralMinimum.aggregateFn [] caller = some (inner,caller.locals)
  start : Runtime
  prefixTrace : Interaction.Transcript
  prefixRun : Interaction.Executes (Stmt.evalList n Inv48.CollateralMinimum.table context
    inner.pushScope.pushScope.pushScope (Inv48.CollateralMinimum.aggregateList.take 4))
    prefixTrace (.ok (.normal start))
  final : Runtime
  before : Interaction.Transcript
  during : Interaction.Transcript
  oracleTail : Interaction.Transcript
  aggregateFinish : Interaction.Transcript
  copyTail : Interaction.Transcript
  sourceTail : Interaction.Transcript
  collateralFinish : Interaction.Transcript
  publicTail : Interaction.Transcript
  split : trace = before ++ (during ++ (oracleTail ++ (aggregateFinish ++
    (copyTail ++ (sourceTail ++ (collateralFinish ++ publicTail))))))
  read : Interaction.Executes (Stmt.eval n Inv48.CollateralMinimum.table context start
    (Inv48.Minima.readWord (Inv48.Minima.oracleData 2603245787 Inv48.CollateralMinimum.universeView)))
    during (.ok (.normal final))
  listValue : Result
  returnRun : Interaction.Executes (Stmt.evalList n Inv48.CollateralMinimum.table context final
    [.returnValues [.castOp .uintCleanup 256 (.var Inv03.Bodies.tmp)]]) oracleTail (.ok listValue)
  saved : LocalEnv
  callFinal : Runtime
  finishRun : Interaction.Executes (internalCallFinish Inv48.CollateralMinimum.aggregateFn
    [Inv48.CollateralMinimum.aggregateRet] saved
    (((listValue.mapRuntime Runtime.popScope).mapRuntime Runtime.popScope).mapRuntime Runtime.popScope))
    aggregateFinish (.ok (.normal callFinal))
  sourceN : Nat
  sourceContext : Context
  tailStart : Runtime
  sourceValue : Result
  tailRun : Interaction.Executes (Stmt.evalList sourceN Inv48.CollateralMinimum.table sourceContext tailStart
    Inv48.Minima.collateralTail) sourceTail (.ok sourceValue)
  fn : InternalFunction
  collateralSaved : LocalEnv
  publicFinal : Runtime
  collateralRun : Interaction.Executes (internalCallFinish fn [Inv48.Positive.ret1] collateralSaved
    (((sourceValue.mapRuntime Runtime.popScope).mapRuntime Runtime.popScope).mapRuntime Runtime.popScope))
    collateralFinish (.ok (.normal publicFinal))
  continuation : Result → SolI Result
  publicRun : Interaction.Executes (continuation (.normal publicFinal)) publicTail (.ok out)

/-- Same descent as recoveredRead, retaining its actual return and tail runs. -/
theorem recover (fuel : Nat) (c : Context) (r : Runtime)
    (trace : Interaction.Transcript) (out : Result) (h : Recovered fuel c r trace out) :
    Nonempty (Slice trace out) := by
  obtain ⟨s,final,during,rest,n,fn,inner,saved,value,bt,ft,k,v,split,fuelEq,lookup,shape,entry,
    bodySplit,nEq,valueEq,ordinary,listRun,finish,last⟩ := h
  obtain ⟨tailStart,pt,tt,mid,a,b,q,callFinal,ct,copyRest,callFuel,sourceSplit,prefixSplit,
    decl,hoistSplit,entered,popEq,tailRun⟩ := aggregateEntered k _ _ bt v ordinary listRun
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
    continuation := s.continuation, publicRun := last}⟩
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

end Inv48.CollateralCloneStage
