import Inv48MinimumCollateralTraceOracle
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumCollateralTrace
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- The read transcript is a contiguous slice of the original raw-success
transcript recovered by rawCollateralList. No read execution is a premise. -/
theorem recoveredRead (fuel : Nat) (c : Context) (r : Runtime)
    (trace : Interaction.Transcript) (out : Result)
    (h : Recovered fuel c r trace out) :
    ∃ n context runtime final before during after,
      trace = before++(during++after) ∧ context.checked = true ∧
      Interaction.Executes (Stmt.eval n Inv48.CollateralMinimum.table context runtime
        (Inv48.Minima.readWord (Inv48.Minima.oracleData 2603245787 Inv48.CollateralMinimum.universeView)))
        during (.ok (.normal final)) := by
  obtain ⟨s,final,during,rest,n,fn,inner,saved,value,bt,ft,k,v,split,fuelEq,lookup,shape,entry,
    bodySplit,nEq,valueEq,ordinary,listRun,finish,last⟩ := h
  obtain ⟨tailStart,pt,tt,mid,a,b,q,callFinal,ct,copyRest,callFuel,sourceSplit,prefixSplit,
    decl,hoistSplit,entered,popEq,tailRun⟩ := aggregateEntered k _ _ bt v ordinary listRun
  obtain ⟨an,ai,asaved,av,abt,aft,ak,al,start,next,ob,od,oa,afuel,aggregateSplit,anEq,
    aentry,avEq,oracleSplit,readRun,returnRun,afinish⟩ := enteredOracle callFuel _ _ callFinal ct entered
  refine ⟨ak,_,start,next,s.before++(a++ob),od,
    oa++(aft++(copyRest++(tt++(ft++rest)))),?_,rfl,readRun⟩
  calc
    trace = s.before ++ s.after := s.split
    _ = _ := by
      rw [split,bodySplit,sourceSplit,prefixSplit,hoistSplit,aggregateSplit,oracleSplit]
      simp only [List.append_assoc]
end Inv48.MinimumCollateralTrace
