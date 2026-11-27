import Inv48WrapperTraversalExecution
import Inv48WrapperTraversalMetadata
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.RequestClassify Inv48.FundingFallthrough
namespace Inv48.WrapperTraversal
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- A real, successful literal shared invocation and its enclosing trace slices. -/
def Recovered (root : SolI Result) (targets : List String) (args : List Expr)
    (trace : Interaction.Transcript) (out : Result) (fuel : Nat) :=
  ∃ s : Site root Inv48.Source.model.core.table
      (.internalCall targets Inv48.RequestQuote.requestKey args) trace out,
    s.fuel = fuel ∧ ∃ final during rest, s.after = during++rest ∧
      Interaction.Executes (Stmt.eval fuel Inv48.Source.model.core.table s.context s.runtime
        (.internalCall targets Inv48.RequestQuote.requestKey args)) during (.ok (.normal final)) ∧
      Interaction.Executes (s.continuation (.normal final)) rest (.ok out)

theorem oneUint (types : List Ty) (h : uintReturn types = true) : types = [.uint256] := by
  cases types with
  | nil => cases h
  | cons ty tail =>
    cases ty <;> cases tail <;> first | rfl | cases h

theorem successfulBodyOrdinary (fn : FunctionDef) (state : State) (v : Result)
    (out : ABI.AbiCallResult) (types : fn.returns.map BindingDecl.ty = [.uint256])
    (done : finish Inv48.Source.model.core fn state v = .ok out)
    (success : out.success = true) : ¬ Escapes v := by
  cases v with
  | normal _ => simp [Escapes]
  | returned _ _ => simp [Escapes]
  | constructorReturned r code =>
    simp [finish,FunctionDef.callBodyResult,ABI.Contract.encodeCalldataResult?,types,
      ABI.encodeValues?,ABI.encodeValuesAux?,ABI.Ty.listAbiHeadWords?,ABI.Ty.abiHeadWords?,ABI.Ty.isDynamicAbi,ABI.Ty.staticAbiHeadWords?] at done
  | selfdestructed r =>
    simp [finish,FunctionDef.callBodyResult,ABI.Contract.encodeCalldataResult?,types,
      ABI.encodeValues?,ABI.encodeValuesAux?,ABI.Ty.listAbiHeadWords?,ABI.Ty.abiHeadWords?,ABI.Ty.isDynamicAbi,ABI.Ty.staticAbiHeadWords?] at done
  | reverted r err =>
    cases enc : ABI.Contract.encodeRevertData? Inv48.Source.model.core err.untagFixedBytes <;>
      simp [finish,FunctionDef.callBodyResult,ABI.Contract.encodeCalldataResult?,enc] at done
    subst out
    cases success
  | broke r =>
    cases enc : ABI.Contract.encodeRevertData? Inv48.Source.model.core RevertData.typeMismatch <;>
      simp [finish,FunctionDef.callBodyResult,ABI.Contract.encodeCalldataResult?,enc] at done
    subst out
    cases success
  | continued r =>
    cases enc : ABI.Contract.encodeRevertData? Inv48.Source.model.core RevertData.typeMismatch <;>
      simp [finish,FunctionDef.callBodyResult,ABI.Contract.encodeCalldataResult?,enc] at done
    subst out
    cases success

/-- Both entry points, arbitrary decoded batch values, and the original raw ABI
trace. No successful wrapper-occurrence or quote-search premise is supplied. -/
theorem rawQuote (name : String) (wrapper : FunctionDef) (member : name ∈ wrappers)
    (wrapperRegistered : Inv48.Source.model.core.findFunctionByName? name = some wrapper)
    (p : Plan Inv48.Source.model.core.table wrapper.body)
    (fn : InternalFunction) (registered : request = some fn) (n : Nat)
    (base : Context) (state : State) (self sender value : Nat) (data : List Byte)
    (selector : Nat) (args : List Value)
    (read : ABI.readSelector? data = some selector)
    (selected : Inv48.Source.model.core.findFunctionBySelector? selector = some wrapper)
    (decoded : ABI.decodeFunctionArgs? wrapper (data.drop ABI.selectorBytes) = .ok args)
    (raw : SolI ABI.AbiCallResult) (trace : Interaction.Transcript) (out : ABI.AbiCallResult)
    (linked : ABI.Contract.callCalldataAtFromWithContext (n+4+p.depth) Inv48.Source.model.core
      base state self sender value data = some raw)
    (run : Interaction.Executes raw trace (.ok out)) (success : out.success = true) :
    ∃ entryRuntime result,
      finish Inv48.Source.model.core wrapper state result = .ok out ∧
      Interaction.Executes (Stmt.eval (n+4+p.depth) Inv48.Source.model.core.table
        (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data)
        entryRuntime wrapper.body) trace (.ok result) ∧
      Recovered (Stmt.eval (n+4+p.depth) Inv48.Source.model.core.table
        (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data)
        entryRuntime wrapper.body) p.targets p.args trace result (n+4) ∧
      Nonempty (Site (Stmt.eval (n+4+p.depth) Inv48.Source.model.core.table
        (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data)
        entryRuntime wrapper.body) Inv48.Source.model.core.table
        Inv48.RequestQuote.quoteCaptureP.value trace result) := by
  have facts := List.all_eq_true.mp bothMetadata name member
  rw [wrapperRegistered,Option.any_some] at facts
  simp only [Bool.and_eq_true] at facts
  have accepts : wrapper.acceptsValue value = true := by simp [FunctionDef.acceptsValue,facts.1]
  obtain ⟨tree,result,entry,exec,done⟩ := body (n+4+p.depth) Inv48.Source.model.core base state
    self sender value data selector wrapper args read selected decoded accepts raw trace out linked run
  have ordinary := successfulBodyOrdinary wrapper state result out (oneUint _ facts.2) done success
  unfold FunctionDef.evalBodyEntry at entry
  simp only [FunctionDef.acceptsValue,facts.1,Bool.true_or,if_true] at entry
  cases framed : wrapper.initialFrame? args with
  | none => simp [framed] at entry
  | some frame =>
    simp only [framed,Option.some.injEq] at entry
    rw [← entry] at exec
    exact ⟨_,result,done,exec,invocation wrapper p n _ _ trace result ordinary exec,
      quote wrapper p fn registered n _ _ trace result ordinary exec⟩
end Inv48.WrapperTraversal
