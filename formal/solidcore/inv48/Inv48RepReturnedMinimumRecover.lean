import Inv48RepReturnedMinimumDecoded
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.RepReturnedMinimum
open Inv48.MinimumCollateralTrace Inv48.RequestDispatch Inv48.WrapperTraversal Inv48.MinimumSuccessWords
open Inv48.CollateralMinimum Inv48.CloneRead Inv48.CloneGetters
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false

structure Joined (trace : Interaction.Transcript) (out : Result) where
  n : Nat
  context : Context
  caller : Runtime
  start : Runtime
  final : Runtime
  value : Result
  fn : InternalFunction
  returns : fn.returns = [⟨"_ret0",.uint256,false⟩]
  saved : LocalEnv
  publicFinal : Runtime
  before : Interaction.Transcript
  during : Interaction.Transcript
  tail : Interaction.Transcript
  finishTrace : Interaction.Transcript
  rest : Interaction.Transcript
  split : trace = before ++ (during ++ (tail ++ (finishTrace ++ rest)))
  prefixTrace : Interaction.Transcript
  prefixRun : Interaction.Executes (Stmt.evalList n table context
    (Inv48.RepMinimum.callee caller).pushScope.pushScope.pushScope (sourceList.take 4))
    prefixTrace (.ok (.normal start))
  read : Interaction.Executes (Stmt.eval n table context start
    (Inv48.Minima.readWord (Inv48.Minima.oracleData 2328446634 view))) during (.ok (.normal final))
  tailRun : Interaction.Executes (Stmt.evalList n table context final Inv48.Minima.repTail) tail (.ok value)
  finishRun : Interaction.Executes (internalCallFinish fn [Inv48.Positive.ret2] saved
    (((value.mapRuntime Runtime.popScope).mapRuntime Runtime.popScope).mapRuntime Runtime.popScope))
    finishTrace (.ok (.normal publicFinal))
  continuation : Result → SolI Result
  publicRun : Interaction.Executes (continuation (.normal publicFinal)) rest (.ok out)

theorem recover (h : CompletedBody fuel c r trace out [Inv48.Positive.ret2] Inv48.Positive.key2) :
    Nonempty (Joined trace out) := by
  obtain ⟨s,pf,during,rest,split,entered,last⟩ := h
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
    continuation := s.continuation, publicRun := last }⟩
  · rw [returns]; rfl
  · calc
      trace = s.before ++ s.after := s.split
      _ = _ := by rw [split,traceEq,sp,sp2]; simp only [List.append_assoc]
  · rwa [innerEq] at pre
  · rwa [valueEq] at finish
end Inv48.RepReturnedMinimum
