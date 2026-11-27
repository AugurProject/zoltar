import Inv48EscrowJoinCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.EscrowJoin
open Inv48.EscrowPrefix
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

def constructorValues (sponsor oracle collateral rep gas : Nat) : List Value :=
  [.word sponsor,.word oracle,.word collateral,.word rep,.word gas]

theorem constructorList (n : Nat) (c : Context) (r : Runtime)
    (sponsor oracle collateral rep gas : Nat)
    (S : r.lookupLocal? "sponsor" = some (.word sponsor))
    (O : r.loadImmutableField c "openOracle" = .ok (.word oracle))
    (C : r.loadImmutableField c "collateralToken" = .ok (.word collateral))
    (R : r.lookupLocal? "rep" = some (.word rep))
    (G : r.lookupLocal? "callbackGasLimit" = some (.word gas)) :
    Expr.evalListFuel (n+7) c r
      [.var "sponsor",.immutable "openOracle",.immutable "collateralToken",
       .var "rep",.var "callbackGasLimit"] =
      pure (constructorValues sponsor oracle collateral rep gas,r) := by
  rw [Expr.evalListFuel,Inv32Guards.readWord _ _ _ _ _ S]
  simp only [pb]
  have oracleRead : Expr.evalFuel (n+4+1) c r (.immutable "openOracle") =
      pure (.word oracle,r) := by rw [Expr.evalFuel]; simp only [O]; rfl
  have collateralRead : Expr.evalFuel (n+3+1) c r (.immutable "collateralToken") =
      pure (.word collateral,r) := by rw [Expr.evalFuel]; simp only [C]; rfl
  rw [Expr.evalListFuel,oracleRead]
  simp only [pb]
  rw [Expr.evalListFuel,collateralRead]
  simp only [pb]
  rw [Expr.evalListFuel,Inv32Guards.readWord _ _ _ _ _ R]
  simp only [pb]
  rw [Expr.evalListFuel,Inv32Guards.readWord _ _ _ _ _ G]
  simp only [pb]
  rw [Expr.evalListFuel]
  rfl

theorem constructorTree (n : Nat) (c : Context) (r : Runtime)
    (sponsor oracle collateral rep gas : Nat)
    (S : r.lookupLocal? "sponsor" = some (.word sponsor))
    (O : r.loadImmutableField c "openOracle" = .ok (.word oracle))
    (C : r.loadImmutableField c "collateralToken" = .ok (.word collateral))
    (R : r.lookupLocal? "rep" = some (.word rep))
    (G : r.lookupLocal? "callbackGasLimit" = some (.word gas)) :
    Expr.evalFuel (n+8) c r constructorArgs =
      (match abiEncodeValues? [.address,.address,.address,.address,.uint256]
        (constructorValues sponsor oracle collateral rep gas) with
       | some bytes => pure (.bytes bytes,r)
       | none => throw (SolidityFailure.revert RevertData.typeMismatch)) := by
  unfold constructorArgs
  rw [Expr.evalFuel,constructorList n c r sponsor oracle collateral rep gas S O C R G]
  simp only [pb]
  have material : r.materializeForValueUseList c (constructorValues sponsor oracle collateral rep gas) =
      .ok (constructorValues sponsor oracle collateral rep gas) := by
    simp [constructorValues,Runtime.materializeForValueUseList,Runtime.materializeForValueUse,
      Runtime.materializeForValueUseFuel,Bind.bind,Except.bind]
  rw [material]
  rfl

/-- Constructor evaluation changes no runtime, even though encoding may fail. -/
theorem constructorSuccessful (n : Nat) (c : Context) (r final : Runtime)
    (sponsor oracle collateral rep gas : Nat) (value : Value)
    (S : r.lookupLocal? "sponsor" = some (.word sponsor))
    (O : r.loadImmutableField c "openOracle" = .ok (.word oracle))
    (C : r.loadImmutableField c "collateralToken" = .ok (.word collateral))
    (R : r.lookupLocal? "rep" = some (.word rep))
    (G : r.lookupLocal? "callbackGasLimit" = some (.word gas))
    (trace : Interaction.Transcript)
    (run : ExecutesOK (Expr.evalFuel (n+8) c r constructorArgs) trace (value,final)) :
    ∃ bytes, trace = [] ∧ value = .bytes bytes ∧ final = r := by
  rw [constructorTree n c r sponsor oracle collateral rep gas S O C R G] at run
  split at run
  next bytes encoded =>
    have h := pureResult _ _ _ run
    cases h.2
    exact ⟨bytes,h.1,rfl,rfl⟩
  next failed => cases run

/-- The response and transcript come from the actual create request. No live
    locals after creation are premises. -/
theorem creationFromOriginalLocals (n : Nat) (c : Context) (r final : Runtime)
    (sponsor oracle collateral rep gas : Nat) (value : Value)
    (S : r.lookupLocal? "sponsor" = some (.word sponsor))
    (O : r.loadImmutableField c "openOracle" = .ok (.word oracle))
    (C : r.loadImmutableField c "collateralToken" = .ok (.word collateral))
    (R : r.lookupLocal? "rep" = some (.word rep))
    (G : r.lookupLocal? "callbackGasLimit" = some (.word gas))
    (trace : Interaction.Transcript)
    (run : ExecutesOK (Expr.evalFuel (n+9) c r creationExpr) trace (value,final)) :
    ∃ (bytes : List Byte) (response : CreateResponse),
      trace = [⟨.external (snapshotWorld c r.state)
        (.create (buildCreateRequest c "SharedPoolReportEscrow" bytes 0 none)), response⟩] ∧
      (decodeCreateResponse response "SharedPoolReportEscrow" bytes 0 none).success = true ∧
      value = .word (u256ToWord response.address) ∧ final.locals = r.locals := by
  obtain ⟨pair,bytes,before,response,args,asBytes,joined,success,val,locals⟩ :=
    creationSuccessful (n+7) c r final value trace run
  obtain ⟨encoded,empty,eqValue,eqRuntime⟩ :=
    constructorSuccessful n c r pair.2 sponsor oracle collateral rep gas pair.1 S O C R G before args
  refine ⟨bytes,response,?_,success,val,locals.trans (congrArg Runtime.locals eqRuntime)⟩
  have stateEq : pair.2.state = r.state := congrArg Runtime.state eqRuntime
  rw [stateEq] at joined
  simpa only [empty,List.nil_append] using joined

#print axioms creationFromOriginalLocals
#print axioms constructorList
#print axioms constructorTree
#print axioms constructorSuccessful
end Inv48.EscrowJoin
