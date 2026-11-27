import Inv48RequestDispatchCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.RequestDispatch
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000
private theorem findAgreement {α : Type} (fs : List α) (p q : α → Bool)
    (agree : fs.all (fun f => p f == q f) = true) : fs.find? p = fs.find? q := by
  induction fs with
  | nil => rfl
  | cons a rest ih =>
    simp only [List.all_cons,Bool.and_eq_true,beq_iff_eq] at agree
    simp only [List.find?_cons,agree.1]
    split
    · rfl
    · exact ih agree.2


def requestSelector : Nat := 4245215698

theorem selectorSignature : ABI.selectorFromSignature
    "requestSecurityPoolPrice(uint256,uint256,uint256)" = requestSelector := by native_decide

theorem selectorAgreement : Inv48.Source.model.core.functions.all
    (fun f => (match f.selector? with
      | some candidate => wordEq candidate requestSelector
      | none => false) == (f.name == "requestSecurityPoolPrice")) = true := by native_decide

theorem selectorIdentity : Inv48.Source.model.core.findFunctionBySelector? requestSelector =
    Inv48.RequestPrologue.publicRequest := findAgreement _ _ _ selectorAgreement

/-- Canonical raw ABI assumptions contain only selector and argument decoding,
not a successful execution or a successful prefix search. -/
structure Canonical (fn : FunctionDef) (data : List Byte) (p a bounty : Nat) : Prop where
  read : ABI.readSelector? data = some requestSelector
  decoded : ABI.decodeFunctionArgs? fn (data.drop ABI.selectorBytes) =
    .ok [.word p,.word a,.word bounty]

/-- Arbitrary successful raw public dispatch yields actual body execution at
its real credited entry runtime, with the exact raw-dispatch transcript. -/
theorem publicBody (fuel : Nat) (base : Context) (state : State)
    (self sender value : Nat) (data : List Byte) (p a bounty : Nat)
    (fn : FunctionDef) (registered : Inv48.RequestPrologue.publicRequest = some fn)
    (canonical : Canonical fn data p a bounty)
    (raw : SolI ABI.AbiCallResult) (trace : Interaction.Transcript) (out : ABI.AbiCallResult)
    (linked : ABI.Contract.callCalldataAtFromWithContext fuel Inv48.Source.model.core base state
      self sender value data = some raw)
    (run : Interaction.Executes raw trace (.ok out)) :
    ∃ r, Interaction.Executes
      (Stmt.eval fuel Inv48.Source.model.core.table
        (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data)
        (Inv48.RequestPrologue.publicBase
          (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data)
          state p a bounty) fn.body) trace (.ok r) ∧
      finish Inv48.Source.model.core fn state r = .ok out := by
  have metadata := Inv48.RequestPrologue.publicRegistered
  obtain ⟨actual,found,params,returns,payable,_⟩ := metadata
  have eq : actual = fn := Option.some.inj (found.symm.trans registered)
  subst actual
  have accepts : fn.acceptsValue value = true := by simp [FunctionDef.acceptsValue,payable]
  obtain ⟨tree,r,entry,exec,done⟩ := body fuel Inv48.Source.model.core base state self sender value data
    requestSelector fn [.word p,.word a,.word bounty] canonical.read
    (selectorIdentity.trans registered) canonical.decoded accepts raw trace out linked run
  have known := Inv48.RequestGuards.publicEntryFor fuel
    (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data)
    state p a bounty fn registered
  rw [known] at entry
  have treeEq := Option.some.inj entry
  exact ⟨r,treeEq ▸ exec,done⟩
end Inv48.RequestDispatch
