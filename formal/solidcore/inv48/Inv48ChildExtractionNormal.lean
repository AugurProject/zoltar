import Inv48ChildExtractionSafety
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv48.EscrowPrefix
namespace Inv48.ChildExtraction
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

theorem finishReturned (contract : Contract) (fn : FunctionDef) (state : State)
    (r : Result) (result : ABI.AbiCallResult)
    (finished : finish contract fn state r = .ok result) (success : result.success = true) :
    ∃ out values, fn.callBodyResult state r = .returned out values ∧
      ABI.encodeValues? (fn.returns.map BindingDecl.ty) values = some result.output := by
  unfold finish at finished
  cases cr : fn.callBodyResult state r with
  | returned out values =>
    simp only [cr,ABI.Contract.encodeCalldataResult?] at finished
    cases enc : ABI.encodeValues? (fn.returns.map BindingDecl.ty) values with
    | none => simp [enc] at finished
    | some output =>
      simp only [enc] at finished
      cases finished
      exact ⟨out,values,rfl,enc⟩
  | reverted out err =>
    simp only [cr,ABI.Contract.encodeCalldataResult?] at finished
    cases enc : ABI.Contract.encodeRevertData? contract err with
    | none => simp [enc] at finished
    | some output =>
      simp only [enc] at finished
      cases finished
      cases success

/-- On a normal body leaf, success entails successful named-return
collection and encoding of those very collected values. -/
theorem normalCollection (contract : Contract) (fn : FunctionDef) (state : State)
    (final : Runtime) (result : ABI.AbiCallResult)
    (finished : finish contract fn state (.normal final) = .ok result)
    (success : result.success = true) :
    ∃ values, fn.collectReturns final = .ok values ∧
      ABI.encodeValues? (fn.returns.map BindingDecl.ty)
        (values.map Value.untagFixedBytes) = some result.output := by
  obtain ⟨out,values,returned,encoded⟩ := finishReturned _ _ _ _ _ finished success
  cases collected : fn.collectReturns final with
  | error err => simp only [FunctionDef.callBodyResult,collected] at returned; cases returned
  | ok vals =>
    simp only [FunctionDef.callBodyResult,collected,CallResult.returned.injEq] at returned
    obtain ⟨rfl,rfl⟩ := returned
    exact ⟨vals,rfl,encoded⟩

theorem noEmptyOutput : ABI.encodeValues?
    (Inv48.EscrowEntry.fn.returns.map BindingDecl.ty) [] = none := by
  rw [Inv48.EscrowEntry.metadata.2.1]
  rfl

/-- Successful canonical ABI completion implies normal body completion for
this registered AST. Fuel sufficiency is supplied independently. -/
theorem normalWithEncoding (fuel budget : Nat) (rows : ScriptedResponder) (c : Context) (state : State)
    (payer sponsor a p halt bounty gas : Nat)
    (canonical : Canonical
      (Inv48.RequestQuote.calldata 2391489481 payer sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas)
      (Inv48.EscrowEntry.arguments payer sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas))
    (served : Inv48.NestedResponder.Served c state
      (Inv48.RequestQuote.calldata 2391489481 payer sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas) fuel budget rows)
    (success : served.result.success = true) :
    ∃ tree final,
      Inv48.EscrowEntry.fn.evalBodyEntry fuel Inv48.Source.model.core.table
        (Inv48.PublicInvariant.childContext c
          (Inv48.RequestQuote.calldata 2391489481 payer sponsor a
            (Inv48.QuoteExec.repAmount a p) halt bounty gas)) state
        (Inv48.EscrowEntry.arguments payer sponsor a
          (Inv48.QuoteExec.repAmount a p) halt bounty gas) = some tree ∧
      ExecutesOK tree served.nested.observed.trace (.normal final) ∧
      finish Inv48.Source.model.core Inv48.EscrowEntry.fn state (.normal final) = .ok served.result := by
  obtain ⟨tree,r,entry,exec,finished⟩ := body fuel budget rows c state _ _ canonical served
  have aligned := observedMatches budget rows _ served.nested.observed served.nested.computed
  have folded := foldTrace rows tree _ r aligned exec
  have zero : (Inv48.PublicInvariant.childContext c
      (Inv48.RequestQuote.calldata 2391489481 payer sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas)).value = 0 := rfl
  rw [Inv48.EscrowEntry.publicEntryTree fuel _ state payer sponsor a
    (Inv48.QuoteExec.repAmount a p) halt bounty gas zero] at entry
  have treeEq := Option.some.inj entry
  rw [← treeEq] at folded
  have noReturn := Inv12.noEarlyExit 100 fuel Inv48.EscrowEntry.fn.body safe
    Inv48.Source.model.core.table
    (Inv48.PublicInvariant.childContext c (Inv48.RequestQuote.calldata 2391489481 payer sponsor a
      (Inv48.QuoteExec.repAmount a p) halt bounty gas))
    (Inv48.EscrowEntry.entry
      (Inv48.PublicInvariant.childContext c (Inv48.RequestQuote.calldata 2391489481 payer sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas)) state payer sponsor a
      (Inv48.QuoteExec.repAmount a p) halt bounty gas) rows
  obtain ⟨out,values,returned,encoded⟩ := finishReturned _ _ _ _ _ finished success
  cases r with
  | normal final => exact ⟨tree,final, by rw [Inv48.EscrowEntry.publicEntryTree fuel _ state payer sponsor a
      (Inv48.QuoteExec.repAmount a p) halt bounty gas zero]; exact entry,exec,finished⟩
  | returned rr vs => exact False.elim (noReturn rr vs folded)
  | constructorReturned rr code =>
    simp only [FunctionDef.callBodyResult,CallResult.returned.injEq] at returned
    obtain ⟨rfl,rfl⟩ := returned
    rw [noEmptyOutput] at encoded
    contradiction
  | selfdestructed rr =>
    simp only [FunctionDef.callBodyResult,CallResult.returned.injEq] at returned
    obtain ⟨rfl,rfl⟩ := returned
    rw [noEmptyOutput] at encoded
    contradiction
  | reverted rr err => cases returned
  | broke rr => cases returned
  | continued rr => cases returned

theorem normal (fuel budget : Nat) (rows : ScriptedResponder) (c : Context) (state : State)
    (payer sponsor a p halt bounty gas : Nat)
    (canonical : Canonical
      (Inv48.RequestQuote.calldata 2391489481 payer sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas)
      (Inv48.EscrowEntry.arguments payer sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas))
    (served : Inv48.NestedResponder.Served c state
      (Inv48.RequestQuote.calldata 2391489481 payer sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas) fuel budget rows)
    (success : served.result.success = true) :
    ∃ tree final,
      Inv48.EscrowEntry.fn.evalBodyEntry fuel Inv48.Source.model.core.table
        (Inv48.PublicInvariant.childContext c
          (Inv48.RequestQuote.calldata 2391489481 payer sponsor a
            (Inv48.QuoteExec.repAmount a p) halt bounty gas)) state
        (Inv48.EscrowEntry.arguments payer sponsor a
          (Inv48.QuoteExec.repAmount a p) halt bounty gas) = some tree ∧
      ExecutesOK tree served.nested.observed.trace (.normal final) := by
  obtain ⟨tree,final,entry,exec,_⟩ := normalWithEncoding fuel budget rows c state
    payer sponsor a p halt bounty gas canonical served success
  exact ⟨tree,final,entry,exec⟩

theorem sufficient (fuel budget : Nat) (rows : ScriptedResponder) (c : Context) (state : State)
    (payer sponsor a p halt bounty gas : Nat)
    (enough : 47 ≤ fuel)
    (canonical : Canonical
      (Inv48.RequestQuote.calldata 2391489481 payer sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas)
      (Inv48.EscrowEntry.arguments payer sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas))
    (served : Inv48.NestedResponder.Served c state
      (Inv48.RequestQuote.calldata 2391489481 payer sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas) fuel budget rows) :
    Inv48.PublicInvariant.SuccessfulBodyExtraction c state payer sponsor a p halt bounty gas
      fuel budget rows served := by
  intro success
  obtain ⟨tree,final,entry,exec⟩ := normal fuel budget rows c state payer sponsor a p halt bounty gas canonical served success
  have eq : fuel = (fuel-47)+47 := by omega
  exact ⟨fuel-47,final,tree,eq,by simpa only [← eq] using entry,exec⟩

#print axioms normalWithEncoding
#print axioms normal
#print axioms sufficient
end Inv48.ChildExtraction
