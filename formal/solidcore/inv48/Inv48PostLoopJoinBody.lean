import Inv48PostLoopJoinSite
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.RequestClassify Inv48.FundingFallthrough
open Inv48.WrapperTraversal
namespace Inv48.PostLoopJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- A successful actual wrapper body supplies a validation Site with an exact
post-loop continuation. No occurrence or suffix-execution hypothesis. -/
theorem actualValidationSite (wrapper : FunctionDef)
    (found : Inv48.OperationsWrapperArgs.wrapper = some wrapper)
    (n : Nat) (c : Context) (r : Runtime) (tr : Interaction.Transcript) (out : Result)
    (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.eval (n+9) Inv48.Source.model.core.table c r wrapper.body)
      tr (.ok out)) :
    ∃ ys zs, ∃ s : Site (Stmt.eval (n+9) Inv48.Source.model.core.table c r wrapper.body)
        Inv48.Source.model.core.table Inv48.OperationsWrapperArgs.loopP.value tr out,
      s.fuel = n+7 ∧ s.context = c ∧ s.continuation = enclosing (n+7) c ys zs := by
  obtain ⟨xs,us,ys,zs,shape,safeX,safeU⟩ := sourceBlocks wrapper found
  refine ⟨ys,zs,?_⟩
  have shaped := run
  rw [shape] at shaped
  have result := validationSite (n+7) c r xs us ys zs safeX safeU tr out ordinary shaped
  rw [shape]
  exact result

/-- Residuals 3–5 are closed conditionally only on the initial validation
Inputs/scalar boundary. Every later run, lookup and Site is recovered from
this same completed wrapper body; the public checked context is derived. -/
theorem publicBodyEntry (wrapper : FunctionDef)
    (found : Inv48.OperationsWrapperArgs.wrapper = some wrapper)
    (n : Nat) (base : Context) (self sender value : Nat) (data : List Byte)
    (r : Runtime) (tr : Interaction.Transcript) (out : Result)
    (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.eval (n+9) Inv48.Source.model.core.table
      (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data)
      r wrapper.body) tr (.ok out)) :
    ∃ validation : Site (Stmt.eval (n+9) Inv48.Source.model.core.table
        (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data)
        r wrapper.body) Inv48.Source.model.core.table Inv48.OperationsWrapperArgs.loopP.value tr out,
      validation.fuel = n+7 ∧
      ∀ p a b gas batch, p < 2^256 → a < 2^256 → b < 2^256 →
      Inv48.BatchInputLoop.Inputs validation.runtime p a b batch →
      validation.runtime.lookupLocal? "requiredGas" = some (.word gas) →
      ∀ fn : InternalFunction,
      Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.requestKey = some fn →
      ∃ needed g, needed ≤ g ∧ g < 2^32 ∧ 4000000+g ≤ 10000000 ∧
        ∃ call : Site (Stmt.eval (n+9) Inv48.Source.model.core.table
          (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data)
          r wrapper.body) Inv48.Source.model.core.table Inv48.SimpleWrapperArgs.call tr out,
          call.fuel = n+5 ∧
          Inv48.WrapperArgs.TempValues call.runtime (SolidCore.Solidity.Shared.norm sender) p a b (4000000+g) ∧
          ∃ result bt ft rest mid,
            call.after = (bt++ft)++rest ∧
            Interaction.Executes (Stmt.eval (n+4) Inv48.Source.model.core.table
              (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data)
              (Inv48.GuardArgsFrame.entry call.runtime (SolidCore.Solidity.Shared.norm sender)
                p a b (4000000+g)) fn.body) bt (.ok result) ∧
            Interaction.Executes (internalCallFinish fn ["_ret__requestPrice_0"] call.runtime.locals result)
              ft (.ok (.normal mid)) ∧
            Interaction.Executes (call.continuation (.normal mid)) rest (.ok out) := by
  let c := ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data
  obtain ⟨ys,zs,s,fuel,context,continuation⟩ := actualValidationSite wrapper found n c r tr out ordinary run
  refine ⟨s,fuel,?_⟩
  intro p a b gas batch hp ha hb inputs scalar fn registered
  have result := fromValidation n c ys zs s fuel context continuation ordinary
    (publicChecked base self sender value data) p a b gas batch hp ha hb inputs scalar fn registered
  have ctx : {c with checked := true} = c := by rfl
  obtain ⟨needed,g,le,hg,limit,call,cf,cc,temps,result,bt,ft,rest,mid,sp,body,finish,last⟩ := result
  refine ⟨needed,g,le,hg,limit,call,cf,temps,result,bt,ft,rest,mid,sp,?_,finish,last⟩
  simpa only [ctx] using body
end Inv48.PostLoopJoin
