import Inv32ForwardBody
import Inv32Observed
open SolidCore.Solidity.Source Inv32Division Inv32Normal Inv32ForwardSteps Inv32ForwardBody Inv32FloorFastPath
namespace Inv32ForwardCall
def netFee (a f : Nat) := a-Inv32.netInput a f
def endState (r : Runtime) (x y a f : Nat) := (Inv32.quoteExactInput x y a f).map fun q =>
  r.withFrame (frm x y a f q (netFee a f))
theorem execute (n : Nat) (c : Context) (r : Runtime) (x y a f : Nat) (hx : x<R) (hy : y<R) (ha : a<R) (hf : f<R) :
    Ends (endState r x y a f) (Stmt.eval (n+280) Inv32Dispatch.model.core.table c (r.withFrame (frm x y a f 0 0)) Inv32Bodies.Forward.body) := by
  let t := Inv32Dispatch.model.core.table
  let src := r.withFrame (frm x y a f 0 0)
  let outer := src.pushScope
  have inner := block _ t c outer _ _ (Inv32ForwardBody.exec n c r x y a f hx hy ha hf)
  have A := cleanParamExec (n+278) t c outer "reserveIn" x hx rfl (by dsimp [outer,src]; write_forward)
  have B := cleanParamExec (n+278) t c outer "reserveOut" y hy rfl (by dsimp [outer,src]; write_forward)
  have C := cleanParamExec (n+278) t c outer "amountIn" a ha rfl (by dsimp [outer,src]; write_forward)
  have D := cleanParamExec (n+278) t c outer "feeBps" f hf rfl (by dsimp [outer,src]; write_forward)
  have S : Stmt.eval (n+279) t c outer .skip = pure (.normal outer) := by rw [Stmt.eval]
  let statements := [cleanParam "reserveIn",cleanParam "reserveOut",cleanParam "amountIn",cleanParam "feeBps",.skip,.skip,.block ss]
  have sequence := step _ _ _ _ _ _ _ _ A (step _ _ _ _ _ _ _ _ B (step _ _ _ _ _ _ _ _ C
    (step _ _ _ _ _ _ _ _ D (step _ _ _ _ _ _ _ _ S (step _ _ _ _ _ _ _ _ S (Inv32InverseCall.single _ _ _ _ _ _ inner))))))
  have whole := block (n+279) t c src statements _ sequence
  change Ends _ (Stmt.eval _ _ _ _ (.block statements))
  unfold endState; unfold Inv32ForwardBody.next at whole
  cases H : Inv32.quoteExactInput x y a f <;> rw [H] at whole <;> exact whole

def Binds (r : Runtime) (targets : List String) (x y a f : Nat) (prog : SolI Result) : Prop :=
  match Inv32.quoteExactInput x y a f with
  | some q => prog = internalCallAssign r targets [.word q,.word (netFee a f)]
  | none => ∃ next err, prog = pure (Result.reverted next err)
theorem call (n : Nat) (c : Context) (r : Runtime) (s1 s2 s3 s4 : String) (targets : List String) (x y a f : Nat)
    (hx : x<R) (hy : y<R) (ha : a<R) (hf : f<R) (X : r.lookupLocal? s1 = some (.word x))
    (Y : r.lookupLocal? s2 = some (.word y)) (A : r.lookupLocal? s3 = some (.word a)) (F : r.lookupLocal? s4 = some (.word f)) :
    Binds r targets x y a f (Stmt.eval (n+281) Inv32Dispatch.model.core.table c r (.internalCall targets Inv32Bodies.Forward.key
      [.var s1,.var s2,.var s3,.var s4])) := by
  obtain ⟨fn,link,ps,rs,bd⟩ := Inv32Library.linkForward
  let empty := {r with locals := []}
  let src := empty.withFrame (frm x y a f 0 0)
  have enter : internalCallEnter? fn [.word x,.word y,.word a,.word f] r = some (src,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]; simp [Inv32Library.decl,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,frm,src,empty,Runtime.withFrame]
  have body := execute n {c with checked := true} empty x y a f hx hy ha hf
  rw [← bd] at body
  unfold endState at body
  unfold Binds
  cases Q : Inv32.quoteExactInput x y a f with
  | none =>
    rw [Q] at body; obtain ⟨next,err,ev⟩ := body
    exact ⟨next,err,Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ (Inv32CeilCall.args4 _ _ _ _ _ _ _ _ _ _ X Y A F) link enter ev⟩
  | some q =>
    rw [Q] at body
    let next := empty.withFrame (frm x y a f q (netFee a f))
    change Stmt.eval _ _ _ src fn.body = pure (.normal next) at body
    rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ (Inv32CeilCall.args4 _ _ _ _ _ _ _ _ _ _ X Y A F) link enter body]
    simp [internalCallFinish,rs,collectReturnBindingsRef,collectReturnBindingsRef.collect,Inv32Library.decl,next,frm,empty,
      Runtime.withFrame,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,Runtime.derefMemoryValueDeep,
      Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind]
end Inv32ForwardCall
