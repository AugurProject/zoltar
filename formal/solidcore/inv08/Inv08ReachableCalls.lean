import Inv08FundedStep
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv08.FundingHistory
abbrev StateCall (n : Nat) (name : String) (c : Context) (s : State) (args : List Value) :=
  TypeCheck.CheckedContract.callTargetWithContext? n model (.name name) c s args

structure Deployer (c : Context) (tm d : Nat) : Prop where
  fields : c.storageFields=model.core.context.storageFields
  imms : c.immutableFields=model.core.context.immutableFields
  free : c.value=0
  sender : c.sender<R
  time : tm<Packed.B
  duration : d<Packed.B
  positive : 0<d
  current : tm≤EnvWord.blockTimestamp.eval c
  size : (Authority.bytes c (Release.baseRuntime c (Initialize.fresh c.sender))).length=65
  binding : Authority.prefixWord (Authority.bytes c (Release.baseRuntime c (Initialize.fresh c.sender))) 20≠0

structure Authorized (c : Context) (s : State) : Prop where
  fields : c.storageFields=model.core.context.storageFields
  free : c.value=0
  clone : Authority.Clone c (Release.baseRuntime c s)

structure ValidState (s : State) (d : Nat) (fs : List Funding) : Prop where
  funded : Funded s d fs
  budget : Budgeted s

theorem carryResult {s t : State} {x y : List Value} {r : Option CallResult}
    (run : r=some (.returned s x)) (observed : r=some (.returned t y)) (v : ValidState s d fs) :
    ValidState t d fs := by
  cases Option.some.inj (run.symm.trans observed)
  exact v

theorem initBudget (c : Context) (tm d : Nat) : Budgeted (Initialize.output c (Initialize.fresh c.sender) tm d) := by
  let s := Release.entryState c (Initialize.fresh c.sender)
  exact budgetTransport (initializeStorage s tm d) _ rfl (genesisBudget s tm d (Initialize.freshSlot c))

theorem onInitialize (n : Nat) (c : Context) (tm d : Nat) (dep : Deployer c tm d) (sep : Separated 0)
    (returned : StateCall (n+42) "initialize" c (Initialize.fresh c.sender) [.word tm,.word d]=some (.returned out [])) :
    ValidState out d [] := by
  have run := Initialize.generated n c tm d dep.free dep.fields dep.imms dep.sender dep.time dep.duration dep.positive dep.current dep.size dep.binding
  apply carryResult run returned
  exact ⟨fundedGenesis _ _ _ dep.time dep.duration dep.positive sep,
    initBudget c tm d⟩

theorem onRelease (n : Nat) (c : Context) (v : ValidState s d fs) (auth : Authorized c s) (tm : Nat)
    (tf : tm<Packed.B) (fwd : stored s .through≤tm) (current : tm≤EnvWord.blockTimestamp.eval c) (sep : Separated fs.length)
    (returned : StateCall (n+70) "release" c s [.word tm]=some (.returned out outputs)) :
    ValidState out d fs := by
  have ok := ready v.funded.accounts tm tf fwd
  have run := Release.release n c s tm auth.fields auth.free auth.clone ok current
  apply carryResult run returned
  exact ⟨fundedRelease v.funded c tm tf fwd sep,budgetTransport _ _ (Release.outputStorage c s tm) (releaseBudget s tm ok v.budget)⟩
end Inv08.FundingHistory
