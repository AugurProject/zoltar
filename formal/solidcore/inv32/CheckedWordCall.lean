import Inv32Internal

open SolidCore.Solidity SolidCore.Solidity.Source
namespace CheckedWordCall

private theorem dispatch (model : TypeCheck.CheckedContract) (fn : FunctionDef)
    (name : String) (args : List Source.Value) (frame : Frame)
    (found : model.core.findFunctionByName? name = some fn)
    (frameOk : fn.initialFrame? args = some frame) :
    model.core.resolveCallFunction? (.name name) args = some fn := by
  obtain ⟨ok,before,after,parts,skip⟩ := List.find?_eq_some_iff_append.mp found
  apply List.find?_eq_some_iff_append.mpr
  refine ⟨?_,before,after,parts,?_⟩
  · simp [ok,frameOk]
  · intro fn mem
    have absent := skip fn mem
    simp_all

def ctx (model : TypeCheck.CheckedContract) : Source.Context := {model.core.context with selfDispatch? := some (Source.ABI.selfDispatchHook 50000 model.core 0)}
def initial (ctx : Source.Context) (s : State) : Runtime :=
  {state := {s with selfBalance := Shared.addWord (Shared.Account.balanceAt ctx.accountBalances ctx.self) ctx.value,
                    worldMutatedSinceAdoption := true}, locals := []}

def read (model : TypeCheck.CheckedContract) (s : State) (name : String) (args : List Source.Value) : Option Nat := do
  let .returned _ [.word v] ← TypeCheck.CheckedContract.call? 50000 model
    (.name name) s args | none
  return v

theorem returnsWord (model : TypeCheck.CheckedContract) (fn : FunctionDef) (name : String)
    (s : State) (args : List Source.Value) (frame : Frame) (v : Nat)
    (found : model.core.findFunctionByName? name = some fn)
    (frameOk : fn.initialFrame? args = some frame)
    (returns : fn.returns = Inv32Internal.wordBindings ["_ret0"])
    (accepts : fn.acceptsValue (ctx model).value = true)
    (ev : let start := (initial (ctx model) s).withFrame frame
          Source.Stmt.eval 50000 model.core.table (ctx model) start fn.body =
            pure (.returned start [.word v])) : read model s name args = some v := by
  let c := ctx model
  let start := (initial c s).withFrame frame
  have enter : fn.evalBodyEntry 50000 model.core.table c s args =
      some (Source.Stmt.eval 50000 model.core.table c start fn.body) := by
    unfold FunctionDef.evalBodyEntry
    rw [if_pos accepts,frameOk]; rfl
  have result : fn.callBodyResult s (.returned start [.word v]) =
      .returned {start.state with constructorOutput? := none} [.word v] := by
    simp [FunctionDef.callBodyResult,FunctionDef.coerceReturnValues,returns,Inv32Internal.wordBindings,
      coerceReturnBindings,coerceReturnBindings.coerce,Ty.coerceValue?,Runtime.derefMemoryValueDeep,
      Runtime.derefMemoryValueWithFuel,Bind.bind,Except.bind,Value.untagFixedBytes]
  unfold read TypeCheck.CheckedContract.call? Source.ABI.Contract.callSelfDispatch?
    Source.ABI.Contract.callWithSelfDispatch
  rw [dispatch model fn name args frame found frameOk]
  change (do let .returned _ [.word v] ← fn.call? 50000 model.core.table c s args
               | none
             return v) = _
  unfold FunctionDef.call? FunctionDef.call
  rw [enter]
  change Source.Stmt.eval 50000 _ _ start fn.body = pure (.returned start [.word v]) at ev
  rw [ev]
  change (match fn.callBodyResult s (.returned start [.word v]) with
    | .returned _ [.word v] => some v | _ => none) = _
  rw [result]

theorem reverts (model : TypeCheck.CheckedContract) (fn : FunctionDef) (name : String)
    (s : State) (args : List Source.Value) (frame : Frame) (next : Runtime) (err : RevertData)
    (found : model.core.findFunctionByName? name = some fn)
    (frameOk : fn.initialFrame? args = some frame)
    (accepts : fn.acceptsValue (ctx model).value = true)
    (ev : let start := (initial (ctx model) s).withFrame frame
          Source.Stmt.eval 50000 model.core.table (ctx model) start fn.body =
            pure (.reverted next err)) : read model s name args = none := by
  let c := ctx model
  let start := (initial c s).withFrame frame
  have enter : fn.evalBodyEntry 50000 model.core.table c s args =
      some (Source.Stmt.eval 50000 model.core.table c start fn.body) := by
    unfold FunctionDef.evalBodyEntry
    rw [if_pos accepts,frameOk]; rfl
  unfold read TypeCheck.CheckedContract.call? Source.ABI.Contract.callSelfDispatch?
    Source.ABI.Contract.callWithSelfDispatch
  rw [dispatch model fn name args frame found frameOk]
  change (do let .returned _ [.word v] ← fn.call? 50000 model.core.table c s args
               | none
             return v) = _
  unfold FunctionDef.call? FunctionDef.call
  rw [enter]
  change Source.Stmt.eval 50000 _ _ start fn.body = pure (.reverted next err) at ev
  rw [ev]
  rfl

end CheckedWordCall
