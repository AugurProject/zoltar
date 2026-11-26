import Inv32WrapperExec
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Dispatch Inv32Wrapper
namespace Inv32Observed
def ctx := {model.core.context with selfDispatch? := some (Source.ABI.selfDispatchHook 50000 model.core 0)}
def initial : Runtime :=
  let st := { State.empty with
    selfBalance := Shared.addWord (Shared.Account.balanceAt ctx.accountBalances ctx.self) ctx.value
    worldMutatedSinceAdoption := true }
  { state := st, locals := [] }
theorem checked : ctx.checked = true := by native_decide
theorem accepts (d : Direction) : (selected d).acceptsValue ctx.value = true := by cases d <;> native_decide
theorem params (d : Direction) : (selected d).params = Inv32Internal.wordBindings ["reserveIn","reserveOut",input d,"feeBps"] :=
  Inv32Internal.wordBindingsOf _ _ (by cases d <;> native_decide)
theorem returns (d : Direction) : (selected d).returns = Inv32Internal.wordBindings [output d,"feeAmount"] :=
  Inv32Internal.wordBindingsOf _ _ (by cases d <;> native_decide)
theorem frameOk (d : Direction) (x y a f : Nat) : (selected d).initialFrame? (args x y a f) = some (frame d x y a f) := by
  unfold FunctionDef.initialFrame? FunctionDef.returnDefaultBindings
  rw [params,returns]
  simp [args,Inv32Internal.wordBindings,BindingDecl.bindArgs?,BindingDecl.bindArg?,BindingDecl.defaultBinding,
    Ty.coerceValue?,Ty.defaultValue,frame]
theorem bodyResult (d : Direction) (r : Runtime) (q f : Nat) :
    (selected d).callBodyResult State.empty (.returned r [.word q,.word f]) =
      .returned {r.state with constructorOutput? := none} [.word q,.word f] := by
  simp [FunctionDef.callBodyResult,FunctionDef.coerceReturnValues,returns,Inv32Internal.wordBindings,
    coerceReturnBindings,coerceReturnBindings.coerce,Ty.coerceValue?,Runtime.derefMemoryValueDeep,
    Runtime.derefMemoryValueWithFuel,Bind.bind,Except.bind,Value.untagFixedBytes]

def observation : Option (Nat × Nat) → Inv32Source.Outcome
  | none => .reverted
  | some (q,f) => .returned q f
theorem publicQuote (d : Direction) (x y a f : Nat) (o : Option (Nat × Nat))
    (hx : x<R) (hy : y<R) (ha : a<R) (hf : f<R)
    (called : Binds (work initial d x y a f 0 0) d o
      (Source.Stmt.eval 49996 model.core.table ctx (work initial d x y a f 0 0) (callStmt d))) :
    Inv32Source.quote (method d) x y a f = observation o := by
  have run := Inv32WrapperExec.execute 49995 ctx initial d x y a f o hx hy ha hf called
  rw [quoteExecutesSelectedBody]
  change observe ((selected d).call? 50000 model.core.table ctx State.empty (args x y a f)) = _
  have entry : (selected d).evalBodyEntry 50000 model.core.table ctx State.empty (args x y a f) =
      some (Source.Stmt.eval 50000 model.core.table ctx (top initial d x y a f) (selected d).body) := by
    unfold FunctionDef.evalBodyEntry
    rw [if_pos (accepts d),frameOk]; rfl
  unfold FunctionDef.call? FunctionDef.call
  rw [entry]
  cases o with
  | none =>
    obtain ⟨nr,e,ev⟩ := run
    change Source.Stmt.eval 50000 _ _ _ _ = pure (Result.reverted nr e) at ev
    rw [ev]; rfl
  | some p =>
    obtain ⟨q,fee⟩ := p
    obtain ⟨nr,effect,ev⟩ := run
    change Source.Stmt.eval 50000 _ _ _ _ = pure (Result.returned nr [.word q,.word fee]) at ev
    rw [ev]
    change observe (some ((selected d).callBodyResult State.empty (.returned nr [.word q,.word fee]))) = _
    rw [bodyResult]; rfl
end Inv32Observed
