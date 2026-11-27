import Inv48MinimumCollateralTraceAggregate
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.CollateralCloneStage
open Inv48.MinimumCollateralTrace Inv48.RequestDispatch Inv48.WrapperTraversal
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

theorem aggregateBodyList (fuel : Nat) (c : Context) (r : Runtime)
    (tr : Interaction.Transcript) (out : Result) (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.eval fuel Inv48.CollateralMinimum.table c r
      Inv48.CollateralMinimum.aggregateBody) tr (.ok out)) :
    ∃ n value, fuel = n+3 ∧
      out = ((value.mapRuntime Runtime.popScope).mapRuntime Runtime.popScope).mapRuntime Runtime.popScope ∧
      ¬ Escapes value ∧
      Interaction.Executes (Stmt.evalList n Inv48.CollateralMinimum.table c
        r.pushScope.pushScope.pushScope Inv48.CollateralMinimum.aggregateList) tr (.ok value) := by
  change Interaction.Executes (Stmt.eval fuel Inv48.CollateralMinimum.table c r
    (.block [.skip,.block [.block Inv48.CollateralMinimum.aggregateList]])) tr (.ok out) at run
  obtain ⟨n,a,eq,oa,first⟩ := block _ _ _ _ _ _ _ run
  have ordinaryA : ¬ Escapes a := popOrdinary a (by rwa [oa] at ordinary)
  have second := singleton _ _ _ _ _ _ _ (skipCons _ _ _ _ _ _ _ ordinaryA first)
  obtain ⟨m,b,eq2,ab,second⟩ := block _ _ _ _ _ _ _ second
  have ordinaryB : ¬ Escapes b := popOrdinary b (by rwa [ab] at ordinaryA)
  have third := singleton _ _ _ _ _ _ _ second
  obtain ⟨k,v,eq3,bv,last⟩ := block _ _ _ _ _ _ _ third
  refine ⟨k,v,by omega,?_,?_,last⟩
  · rw [oa,ab,bv]
  · exact popOrdinary v (by rwa [bv] at ordinaryB)

/-- Recover the oracle read's own runtime, transcript, and real return tail.
The source and root evaluation equations are deliberately not assumed. -/
theorem aggregateRead (n : Nat) (c : Context) (r : Runtime)
    (tr : Interaction.Transcript) (out : Result) (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.evalList n Inv48.CollateralMinimum.table c r
      Inv48.CollateralMinimum.aggregateList) tr (.ok out)) :
    ∃ oracleStart readFinal before during after,
      tr = before++(during++after) ∧
      Interaction.Executes (Stmt.evalList n Inv48.CollateralMinimum.table c r
        (Inv48.CollateralMinimum.aggregateList.take 4)) before (.ok (.normal oracleStart)) ∧
      Interaction.Executes (Stmt.eval n Inv48.CollateralMinimum.table c oracleStart
        (Inv48.Minima.readWord (Inv48.Minima.oracleData 2603245787 Inv48.CollateralMinimum.universeView)))
        during (.ok (.normal readFinal)) ∧
      Interaction.Executes (Stmt.evalList n Inv48.CollateralMinimum.table c readFinal
        [.returnValues [.castOp .uintCleanup 256 (.var Inv03.Bodies.tmp)]]) after (.ok out) := by
  have shape : Inv48.CollateralMinimum.aggregateList =
      Inv48.CollateralMinimum.aggregateList.take 4 ++
      [Inv48.Minima.readWord (Inv48.Minima.oracleData 2603245787 Inv48.CollateralMinimum.universeView),
       .returnValues [.castOp .uintCleanup 256 (.var Inv03.Bodies.tmp)]] := rfl
  rw [shape] at run
  obtain ⟨start,a,b,split,first,last⟩ := listPrefix n _ c r _ _ tr out (by decide) ordinary run
  obtain ⟨final,d,e,split2,read,ret⟩ := listPrefix n _ c start
    [Inv48.Minima.readWord (Inv48.Minima.oracleData 2603245787 Inv48.CollateralMinimum.universeView)]
    _ b out (by decide) ordinary last
  exact ⟨start,final,a,d,e,split.trans (congrArg (fun x => a++x) split2),first,
    singleton _ _ _ _ _ _ _ read,ret⟩
/-- The read is recovered inside the aggregate callee of an entered hoist.
Both callee finishing and its checked context remain explicit. -/
theorem enteredOracle (fuel : Nat) (c : Context) (r final : Runtime)
    (tr : Interaction.Transcript)
    (entered : Inv48.MinimumSuccessWords.Entered fuel Inv48.CollateralMinimum.table c r
      [Inv48.CollateralMinimum.aggregateRet] Inv48.CollateralMinimum.aggregateKey tr final) :
    ∃ n inner saved value bt ft k listValue oracleStart readFinal before during after,
      fuel = n+1 ∧ tr = bt++ft ∧ n = k+3 ∧
      internalCallEnter? Inv48.CollateralMinimum.aggregateFn [] r = some (inner,saved) ∧
      value = ((listValue.mapRuntime Runtime.popScope).mapRuntime Runtime.popScope).mapRuntime Runtime.popScope ∧
      bt = before++(during++after) ∧
      Interaction.Executes (Stmt.evalList k Inv48.CollateralMinimum.table
        {c with checked := true} inner.pushScope.pushScope.pushScope
        (Inv48.CollateralMinimum.aggregateList.take 4)) before (.ok (.normal oracleStart)) ∧
      Interaction.Executes (Stmt.eval k Inv48.CollateralMinimum.table
        {c with checked := true} oracleStart
        (Inv48.Minima.readWord (Inv48.Minima.oracleData 2603245787 Inv48.CollateralMinimum.universeView)))
        during (.ok (.normal readFinal)) ∧
      Interaction.Executes (Stmt.evalList k Inv48.CollateralMinimum.table
        {c with checked := true} readFinal
        [.returnValues [.castOp .uintCleanup 256 (.var Inv03.Bodies.tmp)]]) after (.ok listValue) ∧
      Interaction.Executes (internalCallFinish Inv48.CollateralMinimum.aggregateFn
        [Inv48.CollateralMinimum.aggregateRet] saved value) ft (.ok (.normal final)) := by
  obtain ⟨n,fn,inner,saved,value,bt,ft,eq,found,entry,split,body,finish,ordinary⟩ := entered
  have same : fn = Inv48.CollateralMinimum.aggregateFn :=
    Option.some.inj (found.symm.trans Inv48.CollateralMinimum.aggregateLookup)
  subst fn
  change Interaction.Executes (Stmt.eval n Inv48.CollateralMinimum.table
    {c with checked := true} inner Inv48.CollateralMinimum.aggregateBody) bt (.ok value) at body
  obtain ⟨k,v,nEq,valueEq,ord,list⟩ := aggregateBodyList n _ inner bt value ordinary body
  obtain ⟨start,next,a,d,e,readSplit,prefixRun,readRun,ret⟩ := aggregateRead k _ _ bt v ord list
  exact ⟨n,inner,saved,value,bt,ft,k,v,start,next,a,d,e,eq,split,nEq,entry,valueEq,readSplit,prefixRun,readRun,ret,finish⟩
end Inv48.CollateralCloneStage
