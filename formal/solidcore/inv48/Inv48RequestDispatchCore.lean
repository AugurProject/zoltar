import Inv48RequestGuardsPublic
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.RequestDispatch
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

/-- A pure terminal adapter cannot add or remove transcript events. -/
theorem terminal {α β : Type} (tree : SolI α)
    (f : α → Except SolidityFailure β) (trace : Interaction.Transcript) (y : β)
    (run : Interaction.Executes (tree >>= fun x => .done (f x)) trace (.ok y)) :
    ∃ x, Interaction.Executes tree trace (.ok x) ∧ f x = .ok y := by
  induction tree generalizing trace with
  | done out =>
    cases out with
    | error err => cases run
    | ok x =>
      change Interaction.Executes (.done (f x)) trace (.ok y) at run
      cases fx : f x with
      | error err => rw [fx] at run; cases run
      | ok z => rw [fx] at run; cases run; exact ⟨x,.done _,fx⟩
  | request q next ih =>
    cases run with
    | request answer tail =>
      obtain ⟨x, exec, eq⟩ := ih answer _ tail
      exact ⟨x, .request answer exec, eq⟩

/-- Keep collection and ABI output encoding explicit, including their failures. -/
def finish (contract : Contract) (fn : FunctionDef) (state : State) (r : Result) :
    Except SolidityFailure ABI.AbiCallResult :=
  match ABI.Contract.encodeCalldataResult? contract fn (fn.callBodyResult state r) with
  | some result => .ok result
  | none => .error .outOfFuel

theorem adapter (contract : Contract) (fn : FunctionDef) (state : State) (tree : SolI Result) :
    ((Functor.map (fn.callBodyResult state) tree : SolI CallResult) >>=
      fun cr => ABI.liftAbiEncode (ABI.Contract.encodeCalldataResult? contract fn cr)) =
    (tree >>= fun r => .done (finish contract fn state r)) := by
  induction tree with
  | done out =>
    cases out with
    | error err => rfl
    | ok r =>
      change ABI.liftAbiEncode (ABI.Contract.encodeCalldataResult? contract fn (fn.callBodyResult state r)) =
        .done (finish contract fn state r)
      cases enc : ABI.Contract.encodeCalldataResult? contract fn (fn.callBodyResult state r) with
      | none => simp [ABI.liftAbiEncode,finish,enc]
      | some result =>
        simp only [ABI.liftAbiEncode,finish,enc]
        rfl
  | request q next ih =>
    change Interaction.request q _ = Interaction.request q _
    congr 1
    funext a
    exact ih a

/-- Static canonical dispatch, independent of whether the body succeeds. -/
theorem dispatch (fuel : Nat) (contract : Contract) (base : Context) (state : State)
    (self sender value : Nat) (data : List Byte) (selector : Nat)
    (fn : FunctionDef) (args : List Value)
    (read : ABI.readSelector? data = some selector)
    (selected : contract.findFunctionBySelector? selector = some fn)
    (decoded : ABI.decodeFunctionArgs? fn (data.drop ABI.selectorBytes) = .ok args)
    (accepts : fn.acceptsValue value = true) :
    ABI.Contract.callCalldataAtFromWithContext fuel contract base state self sender value data =
      (fn.evalBodyEntry fuel contract.table
        (ABI.Contract.callContextAtWithBase contract base self sender value data) state args).map
        (fun tree => tree >>= fun r => .done (finish contract fn state r)) := by
  unfold ABI.Contract.callCalldataAtFromWithContext
  simp only [read,selected,decoded,accepts,if_true]
  unfold FunctionDef.call
  cases entry : fn.evalBodyEntry fuel contract.table
    (ABI.Contract.callContextAtWithBase contract base self sender value data) state args with
  | none => rfl
  | some tree => exact congrArg some (adapter _ _ _ tree)

/-- Invert any completed raw dispatch. No responder, budget, or successful
search premise is used; the complete transcript is preserved. -/
theorem body (fuel : Nat) (contract : Contract) (base : Context) (state : State)
    (self sender value : Nat) (data : List Byte) (selector : Nat)
    (fn : FunctionDef) (args : List Value)
    (read : ABI.readSelector? data = some selector)
    (selected : contract.findFunctionBySelector? selector = some fn)
    (decoded : ABI.decodeFunctionArgs? fn (data.drop ABI.selectorBytes) = .ok args)
    (accepts : fn.acceptsValue value = true)
    (raw : SolI ABI.AbiCallResult) (trace : Interaction.Transcript) (out : ABI.AbiCallResult)
    (linked : ABI.Contract.callCalldataAtFromWithContext fuel contract base state self sender value data = some raw)
    (run : Interaction.Executes raw trace (.ok out)) :
    ∃ tree r, fn.evalBodyEntry fuel contract.table
        (ABI.Contract.callContextAtWithBase contract base self sender value data) state args = some tree ∧
      Interaction.Executes tree trace (.ok r) ∧ finish contract fn state r = .ok out := by
  rw [dispatch fuel contract base state self sender value data selector fn args read selected decoded accepts] at linked
  cases entry : fn.evalBodyEntry fuel contract.table
    (ABI.Contract.callContextAtWithBase contract base self sender value data) state args with
  | none => simp [entry] at linked
  | some tree =>
    simp only [entry,Option.map_some,Option.some.injEq] at linked
    rw [← linked] at run
    obtain ⟨r,exec,done⟩ := terminal tree _ _ _ run
    exact ⟨tree,r,rfl,exec,done⟩
end Inv48.RequestDispatch
