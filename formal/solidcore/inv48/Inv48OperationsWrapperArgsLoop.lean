import Inv48OperationsWrapperArgsSource
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.OperationsWrapperArgs
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

def loopParts : Expr × Stmt × Stmt :=
  match loopP.value with
  | .block [_,.forLoop _ cond post body] => (cond,post,body)
  | _ => (.word 0,.skip,.skip)
def loopCondition := loopParts.1
def loopPost := loopParts.2.1
def loopIteration := loopParts.2.2

theorem actualLoopShape : loopP.value = .block [
    .varDecl .uint256 "index" (some (.word 0)),
    .forLoop .skip loopCondition loopPost loopIteration] := by rfl

theorem checkedIteration : Inv48.WrapperTraversal.safe 100
    Inv48.Source.model.core.table loopIteration = true := by decide

theorem checkedPost : Inv48.WrapperTraversal.safe 100
    Inv48.Source.model.core.table loopPost = true := by decide

theorem iterationFalls (n : Nat) (c : Context) (r : Runtime) :
    Inv48.WrapperTraversal.Falling
      (Stmt.eval n Inv48.Source.model.core.table c r loopIteration) :=
  Inv48.WrapperTraversal.safeSound 100 loopIteration checkedIteration n c r

theorem postFalls (n : Nat) (c : Context) (r : Runtime) :
    Inv48.WrapperTraversal.Falling
      (Stmt.eval n Inv48.Source.model.core.table c r loopPost) :=
  Inv48.WrapperTraversal.safeSound 100 loopPost checkedPost n c r

/-- Instantiates the existing generic preserver with the actual generated
loop. The four semantic leaf obligations below are EXPLICIT RESIDUALS.
This theorem does not claim to discharge them or establish rawEntry. -/
theorem generatedLoopInvariant (c : Context) (P : Runtime → Prop)
    (condition : ∀ r, P r → ∃ result, Expr.eval c r loopCondition = pure result)
    (iterationPreserves : ∀ n r final tr, P r →
      Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c r loopIteration)
        tr (.ok (.normal final)) → P final)
    (postPreserves : ∀ n r final tr, P r →
      Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c r loopPost)
        tr (.ok (.normal final)) → P final)
    (conditionPreserves : ∀ r v mid, P r →
      Expr.eval c r loopCondition = pure (v,mid) → P mid)
    (n : Nat) (r final : Runtime) (trace : Interaction.Transcript) (start : P r)
    (run : Interaction.Executes
      (Stmt.evalFor n Inv48.Source.model.core.table c r loopCondition loopPost loopIteration)
      trace (.ok (.normal final))) : P final :=
  Inv48.WrapperArgs.forInvariant Inv48.Source.model.core.table c loopCondition loopPost loopIteration P
    condition (fun n r => iterationFalls n c r) (fun n r => postFalls n c r)
    iterationPreserves postPreserves conditionPreserves n r final trace start run
end Inv48.OperationsWrapperArgs
