import Inv44Event
import Inv44ConstructorWrite
import Inv44ConstructorReadback
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv44.Constructor
theorem emit (n : Nat) (c : Context) (r : Runtime) (xs : List Nat) (decls : c.eventDecls=model.core.context.eventDecls)
    (addressesValid : valid xs) (input : InputRef r xs) :
    Stmt.eval (n+1) model.core.table c r (.emitEvent eventName [.var name])=
      pure (.normal {r with state:=logged r.state xs}) := by
  have words (k : Nat) (ys : List Nat) : r.materializeForValueUseListFuel c (k+1) (ys.map Value.word)=.ok (ys.map Value.word) := by
    induction ys with
    | nil => rw [List.map_nil,Runtime.materializeForValueUseListFuel]
    | cons a ys ih => simp only [List.map_cons,Runtime.materializeForValueUseListFuel,Runtime.materializeForValueUseFuel,ih,Bind.bind,Except.bind]
  have mat : r.materializeForValueUseList c [array xs]=.ok [array xs] := by
    simp [array,Runtime.materializeForValueUseList,Runtime.materializeForValueUse,Runtime.materializeForValueUseFuel,words,Bind.bind,Except.bind]
  have vals : Expr.evalList c r [.var name]=pure ([array xs],r) := by
    change Expr.evalListFuel 3 c r [.var name]=_
    rw [Expr.evalListFuel,value 1 c r xs input];simp only [Inv08.Authority.bindPure,Expr.evalListFuel]
  rw [Stmt.eval];dsimp only;rw [eventLookup c decls]
  change (do match ← (Expr.evalList c r [.var name]).caught with
             | .ok (values,rt) => match rt.materializeForValueUseList c ((List.range 1).filterMap
                     (fun i => ((([0] : List Nat).zip values).find? (fun (p : Nat × Value) => p.1==i)).map Prod.snd)) with
               | .ok vs => match rt.emitEvent c eventName vs with
                 | .ok updated=>pure (Result.normal updated) | .error err=>pure (.reverted r err)
               | .error err=>pure (.reverted r err)
             | .error err=>pure (.reverted r err))=_
  rw [vals]
  change (match r.materializeForValueUseList c [array xs] with
      | .ok vs => match r.emitEvent c eventName vs with
        | .ok updated=> (pure (.normal updated) : SolI Result) | .error err=>pure (.reverted r err)
      | .error err=>pure (.reverted r err))=_
  simp only [mat,emitResult c r xs decls addressesValid]

theorem successBody (n : Nat) (c : Context) (r : Runtime) (xs : List Nat)
    (fields : c.storageFields=model.core.context.storageFields) (decls : c.eventDecls=model.core.context.eventDecls)
    (empty : r.state.loadSlot 0=0) (cap : xs.length≤256) (addressesValid : valid xs) :
    let dst := {(localized r xs).popScope with state:=logged (install xs r.state) xs}
    ctor.body.eval (n+3) model.core.table c (r.withFrame (frame (array xs)))=pure (.normal dst) := by
  let t := model.core.table
  let src := r.withFrame (frame (array xs))
  let loc := localized r xs
  let rt := loc.pushScope
  let store := {rt with state:=install xs r.state}
  let dst := {rt with state:=logged (install xs r.state) xs}
  have G := guardEvaluates n c r xs (lt_of_le_of_lt cap (by decide))
  dsimp only at G;rw [if_pos cap] at G
  have input := inputPointer r xs
  have W := assignArray n c rt xs fields empty cap input
  have E := emit n c store xs decls addressesValid (inputWithState rt (install xs r.state) xs input)
  have inner : Stmt.eval (n+2) t c loc (.block (guard.value::writes))=pure (.normal dst.popScope) := by
    apply Inv32Hoist.block _ _ _ _ dst _
    apply Eq.trans (Inv32FloorStart.seqStep _ _ _ _ _ _ _ G)
    apply Eq.trans (Inv32FloorStart.seqStep _ _ _ _ _ _ _ W)
    exact (Inv32FloorStart.seqStep _ _ _ _ _ _ [] E).trans (by rw [Stmt.evalList])
  have L : Stmt.eval (n+2) t c src.pushScope (.memoryLocalize ty name)=pure (.normal loc) := by
    rw [Stmt.eval];dsimp only;rw [copy]
  have S : Stmt.eval (n+2) t c src.pushScope .skip=pure (.normal src.pushScope) := by rw [Stmt.eval]
  rw [bodyFromSource]
  apply Inv32Hoist.block _ _ _ _ dst.popScope _
  apply Eq.trans (Inv32FloorStart.seqStep _ _ _ _ _ _ _ S)
  apply Eq.trans (Inv32FloorStart.seqStep _ _ _ _ _ _ _ L)
  exact (Inv32FloorStart.seqStep _ _ _ _ _ _ [] inner).trans (by rw [Stmt.evalList])

def context (n : Nat) (c : Context) (sender : Nat) := {c with sender:=sender,value:=0,construction:=true,selfDispatch?:=some (ABI.selfDispatchHook (n+3) model.core 0)}
def deployed (n : Nat) (c : Context) (s : State) (sender : Nat) (xs : List Nat) :=
  {logged (install xs (entry (context n c sender) s)) xs with constructorOutput?:=none}

/-- Successful external construction persists the configured addresses in order and emits their exact ABI log. -/
theorem construct (n : Nat) (c : Context) (s : State) (sender : Nat) (xs : List Nat)
    (fields : c.storageFields=model.core.context.storageFields) (decls : c.eventDecls=model.core.context.eventDecls)
    (empty : s.loadSlot 0=0) (cap : xs.length≤256) (addressesValid : valid xs) :
    TypeCheck.CheckedContract.constructWithContext? (n+3) model c s sender 0 [array xs]=some (.returned (deployed n c s sender xs) []) := by
  let ctx := context n c sender
  let r := Inv08.Release.baseRuntime ctx s
  let dst := {(localized r xs).popScope with state:=logged (install xs r.state) xs}
  have present : sourceFn?=some ctor := (Option.some_get existsFn).symm
  unfold TypeCheck.CheckedContract.constructWithContext?
  change sourceFn? >>= _ = _
  rw [present];change ctor.call? (n+3) model.core.table ctx s [array xs]=_
  have accepts : ctor.acceptsValue ctx.value=true := by simp [ctx,context,FunctionDef.acceptsValue,wordEq]
  have ev := successBody n ctx r xs fields decls empty cap addressesValid
  have run : ctor.evalBodyEntry (n+3) model.core.table ctx s [array xs]=some (pure (.normal dst)) := by
    unfold FunctionDef.evalBodyEntry;rw [accepts,initial];exact congrArg some ev
  have ret : ctor.collectReturns dst=.ok [] := by unfold FunctionDef.collectReturns;rw [returns];rfl
  unfold FunctionDef.call? FunctionDef.call;rw [run]
  change some (ctor.callBodyResult s (.normal dst))=_
  simp only [FunctionDef.callBodyResult,ret,List.map_nil];rfl
end Inv44.Constructor
