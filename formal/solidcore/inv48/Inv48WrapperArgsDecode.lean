import Inv48WrapperArgsSource
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Shapes
namespace Inv48.WrapperArgs
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

def params : List BindingDecl := [⟨"proposedRepPerEthPrice",.uint256,false⟩,
  ⟨"requestedInitialAttoWeth",.uint256,false⟩,⟨"bountyAttoEth",.uint256,false⟩]
def paramsP := seq [
  Inv48.EscrowTrace.bindingPattern (lit "proposedRepPerEthPrice") Ty_uint256 (lit false),
  Inv48.EscrowTrace.bindingPattern (lit "requestedInitialAttoWeth") Ty_uint256 (lit false),
  Inv48.EscrowTrace.bindingPattern (lit "bountyAttoEth") Ty_uint256 (lit false)]
def metadataCheck := Inv48.FundingFallthrough.wrappers.all fun name =>
  (Inv48.Source.model.core.findFunctionByName? name).any fun fn =>
    paramsP.test (fn.params.take 3)
theorem checkedMetadata : metadataCheck = true := by native_decide

theorem parameterPrefix (name : String) (fn : FunctionDef)
    (member : name ∈ Inv48.FundingFallthrough.wrappers)
    (registered : Inv48.Source.model.core.findFunctionByName? name = some fn) :
    fn.params = params ++ fn.params.drop 3 := by
  have h := List.all_eq_true.mp checkedMetadata name member
  simp only [metadataCheck,registered,Option.any_some] at h
  have eq : fn.params.take 3 = params := paramsP.sound _ h
  rw [← eq]
  exact (List.take_append_drop 3 fn.params).symm

/-- The public initial frame contains the decoded words even when the trailing
argument is an arbitrary successfully bound batch. No bound on its array length.
This establishes entry only, before wrapper cleanup and validation execution. -/
theorem initialFrameWords (fn : FunctionDef) (rest : List BindingDecl)
    (metadata : fn.params = params ++ rest) (p a b : Nat) (more : List Value)
    (frame : Frame)
    (framed : fn.initialFrame? ([.word p,.word a,.word b] ++ more) = some frame) :
    Frame.lookup? frame "proposedRepPerEthPrice" = some (.word p) ∧
    Frame.lookup? frame "requestedInitialAttoWeth" = some (.word a) ∧
    Frame.lookup? frame "bountyAttoEth" = some (.word b) := by
  simp only [FunctionDef.initialFrame?,metadata,params,List.cons_append,List.nil_append,
    BindingDecl.bindArgs?,BindingDecl.bindArg?,Ty.coerceValue?] at framed
  cases bound : BindingDecl.bindArgs? rest more with
  | none => simp [bound] at framed
  | some tail =>
    simp only [bound] at framed
    cases framed
    simp [Frame.lookup?]
/-- Reuse the executable public cleanup proof, rather than assuming the three
post-cleanup lookups. This stops before the callback getter and call hoists. -/
theorem simplePublicPrefix (n : Nat) (c : Context) (state : State) (p a b : Nat)
    (hp : p < 2^256) (ha : a < 2^256) (hb : b < 2^256) :
    Stmt.evalList (n+1) Inv48.Source.model.core.table c
      (Inv48.RequestPrologue.publicBase c state p a b).pushScope
      Inv48.RequestPrologue.publicPrologueP.value =
    pure (.normal (Inv48.RequestPrologue.publicBase c state p a b).pushScope) :=
  Inv48.RequestPrologue.publicPrologueExecution n c state p a b hp ha hb
end Inv48.WrapperArgs
