import Inv48EscrowPrefixTree
open SolidCore.Solidity.Source
open EvmCompiler.Simulation
namespace Inv48.EscrowPrefix
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

def constructorArgs : Expr := .encode .plain none []
  [.address,.address,.address,.address,.uint256]
  [.var "sponsor",.immutable "openOracle",.immutable "collateralToken",
    .var "rep",.var "callbackGasLimit"]

def creationExpr : Expr :=
  .contractCreate "SharedPoolReportEscrow" constructorArgs (.word 0) none true

def creationReply (r : Runtime) (response : ContractCreationResult × State) :
    SolI (Value × Runtime) :=
  if response.1.success then
    pure (.word response.1.address,
      ({r with state := response.2}).recordExternalInteraction (.contractCreation response.1))
  else throw (SolidityFailure.revert (.fromRawBytes response.1.output))

def creationAfterArgs (c : Context) (pair : Value × Runtime) : SolI (Value × Runtime) :=
  match pair.1.asBytes? with
  | none => throw (SolidityFailure.revert RevertData.typeMismatch)
  | some bytes => emitContractCreation c pair.2.state "SharedPoolReportEscrow" bytes 0 none
      >>= creationReply pair.2

/-- Exact creation expression tree, retaining both argument evaluation and the
    external creation request. This has no runtime-local hypotheses. -/
theorem creationTree (fuel : Nat) (c : Context) (r : Runtime) :
    Expr.evalFuel (fuel+2) c r creationExpr =
      (Expr.evalFuel (fuel+1) c r constructorArgs >>= creationAfterArgs c) := by
  unfold creationExpr
  rw [Expr.evalFuel,Expr.evalFuel]
  change (Expr.evalFuel (fuel+1) c r constructorArgs >>= fun pair => _) = _
  apply congrArg (fun k => Expr.evalFuel (fuel+1) c r constructorArgs >>= k)
  funext pair
  rcases pair with ⟨value,runtime⟩
  have n1 : ("SharedPoolReportEscrow" == "#yul.create") = false := by decide
  have n2 : ("SharedPoolReportEscrow" == "#yul.createBubble") = false := by decide
  simp only [isRawCreateName,n1,n2,Bool.false_and,Bool.or_false,
    Bool.false_eq_true,if_false]
  simp only [pb]
  have nz : SolidCore.Solidity.Shared.norm (normWord 0) = 0 := by decide
  rw [nz]
  cases h : value.asBytes? <;> simp only [creationAfterArgs,h]
  · rfl
  · apply congrArg (fun k => emitContractCreation c runtime.state "SharedPoolReportEscrow" _ 0 none >>= k)
    funext response
    rfl

/-- A successful creation-expression branch identifies the actual response,
    not a separately chosen escrow address. -/
theorem creationSuccessful (fuel : Nat) (c : Context) (r final : Runtime)
    (value : Value) (trace : Interaction.Transcript)
    (run : ExecutesOK (Expr.evalFuel (fuel+2) c r creationExpr) trace (value,final)) :
    ∃ (pair : Value × Runtime) (bytes : List Byte) (before : Interaction.Transcript) (response : CreateResponse),
      ExecutesOK (Expr.evalFuel (fuel+1) c r constructorArgs) before pair ∧
      pair.1.asBytes? = some bytes ∧
      trace = before ++ [⟨.external (snapshotWorld c pair.2.state)
        (.create (buildCreateRequest c "SharedPoolReportEscrow" bytes 0 none)), response⟩] ∧
      (decodeCreateResponse response "SharedPoolReportEscrow" bytes 0 none).success = true ∧
      value = .word (u256ToWord response.address) ∧
      final.locals = pair.2.locals := by
  rw [creationTree] at run
  obtain ⟨pair,before,after,joined,args,rest⟩ := bindSuccessful _ _ _ _ run
  unfold creationAfterArgs at rest
  cases hb : pair.1.asBytes? with
  | none =>
    rw [hb] at rest
    cases rest
  | some bytes =>
    rw [hb] at rest
    obtain ⟨response,tcreate,treply,splitTrace,created,replied⟩ := bindSuccessful _ _ _ _ rest
    unfold emitContractCreation at created
    cases created with
    | request answer tail =>
      cases tail
      unfold creationReply at replied
      split at replied
      next successful =>
        have result := pureResult _ _ _ replied
        cases result.2
        refine ⟨pair,bytes,before,answer,args,hb,?_,successful,rfl,rfl⟩
        simpa [result.1] using joined.trans (congrArg (before ++ ·) splitTrace)
      next failed => cases replied

#print axioms creationTree
#print axioms creationSuccessful
end Inv48.EscrowPrefix
