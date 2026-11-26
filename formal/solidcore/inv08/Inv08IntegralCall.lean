import Inv08IntegralBindings
open SolidCore.Solidity.Source Inv32Division Inv03.Bodies
namespace Inv08.Integral
def frame (tm id e p : Nat) : Frame := [("timestamp",.word tm),("expiredId",.word id),
  ("ethIntegralNumerator",.word e),("repIntegralNumerator",.word p)]
def slots (r : Runtime) (tm id e p : Nat) := (r.withFrame (frame tm id e p)).pushScope.pushScope
def atLatest (r : Runtime) (tm id e p : Nat) := (slots r tm id e p).declareLocal "latest"
  (.storageSlotRef (mappingStorageSlot 7 (stored r.state .latest)) ExpiryStorage.layout)
def atBoth (r : Runtime) (tm id e p : Nat) := (atLatest r tm id e p).declareLocal "expired"
  (.storageSlotRef (mappingStorageSlot 7 id) ExpiryStorage.layout)
def numerator (s : State) (tm id : Nat) (eth : Bool) :=
  total s (mappingStorageSlot 7 (stored s .latest)) (mappingStorageSlot 7 id) tm eth
def RateOrder (s : State) (id : Nat) :=
  ∀ eth, rate s (mappingStorageSlot 7 id) eth ≤ rate s (mappingStorageSlot 7 (stored s .latest)) eth
macro "integral_write" : tactic => `(tactic|
  simp [atBoth,atLatest,slots,frame,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.declareLocal,
    Runtime.withFrame,Runtime.pushScope,LocalEnv.declare,LocalEnv.lookup?,LocalEnv.assign?,Frame.lookup?,Frame.assign?,Value.coerceLike?])
set_option maxHeartbeats 800000 in
theorem execute (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (tm id : Nat) (tf : tm<2^48) (idf : id<2^48)
    (fields : c.storageFields=model.core.context.storageFields) (ordered : RateOrder r.state id)
    (fits : ∀ eth, numerator r.state tm id eth<R) :
    let e := numerator r.state tm id true
    let p := numerator r.state tm id false
    body.value.eval (n+3) t c (r.withFrame (frame tm id 0 0)) = pure (.normal (r.withFrame (frame tm id e p))) := by
  let e := numerator r.state tm id true
  let p := numerator r.state tm id false
  let src := r.withFrame (frame tm id 0 0)
  let rt := atBoth r tm id
  have A := bind n t c (slots r tm id 0 0) "latest" (stored r.state .latest) loadLast.value
    (lt_trans (Expiry.latestFits _) (by decide)) fields (lastRead _ _ fields)
  have B := bind n t c (atLatest r tm id 0 0) "expired" id (.var "expiredId") (lt_trans idf (by decide)) fields
    (localReads c _ _ _ (by rfl))
  have ER := atSlots c (rt 0 0) true _ _ tm (by rfl) (by rfl) rfl (lt_trans tf (by decide)) (ordered true) (fits true)
  have PR := atSlots c (rt e 0) false _ _ tm (by rfl) (by rfl) rfl (lt_trans tf (by decide)) (ordered false) (fits false)
  have E := Inv32Assign.scalarCast n t c (rt 0 0) (rt e 0) "ethIntegralNumerator" 0 e _ _ _ rfl
    (ER _ (Nat.le_succ _)) (by dsimp only [rt]; integral_write)
  have P := Inv32Assign.scalarCast n t c (rt e 0) (rt e p) "repIntegralNumerator" 0 p _ _ _ rfl
    (PR _ (Nat.le_succ _)) (by dsimp only [rt]; integral_write)
  have inner : (block setup).value.eval (n+2) t c src.pushScope =
      pure (.normal (r.withFrame (frame tm id e p)).pushScope) :=
    Inv32Hoist.block _ _ _ _ (rt e p) _ ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ A).trans
      ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ B).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ E).trans
      ((Inv32FloorStart.seqStep _ _ _ _ _ _ [] P).trans (by rw [Stmt.evalList])))))
  have X := Inv32Assign.scalarCast (n+1) t c src.pushScope src.pushScope "timestamp" tm tm _ _ _ rfl
    (Expiry.local48 c _ "timestamp" tm tf rfl _ (Nat.le_succ _)) (by dsimp [src]; integral_write)
  have Y := Inv32Assign.scalarCast (n+1) t c src.pushScope src.pushScope "expiredId" id id _ _ _ rfl
    (Expiry.local48 c _ "expiredId" id idf rfl _ (Nat.le_succ _)) (by dsimp [src]; integral_write)
  have S : Stmt.eval (n+2) t c src.pushScope .skip = pure (.normal src.pushScope) := by rw [Stmt.eval]
  exact Inv32Hoist.block _ _ _ _ (r.withFrame (frame tm id e p)).pushScope _ ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ X).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ Y).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ S).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ S).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ [] inner).trans (by rw [Stmt.evalList]))))))

theorem call (n : Nat) (c : Context) (r : Runtime) (x y : String) (targets : List String) (tm id : Nat)
    (T : r.lookupLocal? x=some (.word tm)) (I : r.lookupLocal? y=some (.word id))
    (tf : tm<2^48) (idf : id<2^48) (fields : c.storageFields=model.core.context.storageFields)
    (ordered : RateOrder r.state id) (fits : ∀ eth, numerator r.state tm id eth<R) :
    Stmt.eval (n+4) model.core.table c r (.internalCall targets key [.var x,.var y]) =
      internalCallAssign r targets [.word (numerator r.state tm id true),.word (numerator r.state tm id false)] := by
  obtain ⟨fn,linked,ps,rs,bd⟩ := link
  let empty := {r with locals := []}
  let src := empty.withFrame (frame tm id 0 0)
  have enter : internalCallEnter? fn [.word tm,.word id] r=some (src,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]
    simp [Inv32Library.decl,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,frame,empty,src,Runtime.withFrame]
  have E := execute n model.core.table {c with checked:=true} empty tm id tf idf fields ordered fits
  change Stmt.eval _ _ _ src _ = _ at E
  rw [←bd] at E
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ (Inv32ProductCall.args c r x y tm id T I) linked enter E]
  simp [internalCallFinish,rs,collectReturnBindingsRef,collectReturnBindingsRef.collect,Inv32Library.decl,
    Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind,
    empty,frame,Runtime.withFrame,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?]
end Inv08.Integral
