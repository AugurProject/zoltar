import Inv44ConstructorShape
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv44.Constructor
def localized (r : Runtime) (xs : List Nat) := ((r.allocMemory (array xs)).1.withFrame (frame (.memoryRef r.nextMemory))).pushScope

theorem copy (r : Runtime) (xs : List Nat) :
    (r.withFrame (frame (array xs))).pushScope.localizeMemoryLocal ty name = some (localized r xs) := by
  let base := (r.withFrame (frame (array xs))).pushScope
  have copyValues (vs : List Nat) : base.memoryStoredValues (vs.map Value.word)=(base,vs.map Value.word) := by
    induction vs with
    | nil => rw [List.map_nil,Runtime.memoryStoredValues]
    | cons a l ih => simp only [List.map_cons,Runtime.memoryStoredValues,Value.isMemoryObject,Bool.false_eq_true,if_false,ih]
  have storage : base.memoryStoredValue (array xs)=(base,array xs) := by
    simp [array,Runtime.memoryStoredValue,copyValues]
  have ref : base.lookupLocal? name=some (array xs) := rfl
  change base.localizeMemoryLocal ty name=_
  unfold Runtime.localizeMemoryLocal
  rw [ref]
  change (do let v ← ty.coerceValue? (array xs)
             let (s,w) := base.memoryStoredValue v
             let (s',ptr) := s.allocMemory w
             s'.assignLocalRaw? name ptr)=_
  rw [coerced]; simp only [Bind.bind,Option.bind,storage]
  simp [base,localized,frame,Runtime.allocMemory,Runtime.assignLocalRaw?,Runtime.pushScope,Runtime.withFrame,LocalEnv.assign?,Frame.assign?]

theorem guardEvaluates (n : Nat) (c : Context) (r : Runtime) (xs : List Nat) (fit : xs.length<R) :
    let rt := (localized r xs).pushScope
    guard.value.eval (n+1) model.core.table c rt =
      pure (if xs.length≤256 then .normal rt else .reverted rt (.error reason)) := by
  let rt := (localized r xs).pushScope
  have found : rt.lookupLocal? name=some (.memoryRef r.nextMemory) := rfl
  have notStorage : rt.lookupStorageBase? name=none := by simp [Runtime.lookupStorageBase?,found]
  have mem : rt.loadMemory? r.nextMemory=some (array xs) := by
    change ((r.memory.insert r.nextMemory (array xs))[r.nextMemory]?)=_
    exact Std.HashMap.getElem?_insert_self
  have variableRead (k : Nat) : Expr.evalFuel (k+1) c rt (.var name)=pure (array xs,rt) := by
    rw [Expr.evalFuel,notStorage,found]
    simp [Runtime.derefMemoryValue,mem,Inv08.Authority.liftPure,Inv08.Authority.bindPure]
  have lengthRead : Inv40.Reads c rt length.value xs.length := by
    intro fuel enough
    change 2≤fuel at enough
    obtain ⟨k,rfl⟩ := Nat.exists_eq_add_of_le enough
    rw [Nat.add_comm]
    change Expr.evalFuel (k+2) c rt (.length (.var name))=_
    rw [Expr.evalFuel,notStorage,variableRead k]
    simp [array,Value.length?,Inv08.Authority.bindPure]
  have maxRead : Inv40.Reads c rt limit.value 256 := by
    have first := Inv08.ReleaseQuote.readClean (Inv08.Authority.castBits (Inv08.Authority.literal c rt 255 (by decide)) 256 (by decide) (by decide) (by decide)) (by decide)
    exact Inv08.Authority.double (Inv08.ReleaseQuote.binary first (Inv08.Authority.literal c rt 1 (by decide))
      .add (by intro h;cases h) (by intro h;cases h) (Inv40.addWords _ 255 1 (by decide))) (by decide)
  have le : Source.BinaryOp.apply c.checked .le (.word xs.length) (.word 256)=.ok (.word (if xs.length≤256 then 1 else 0)) := Inv32WideGuards.leWord _ _ fit (by decide)
  have compare := Inv08.ReleaseQuote.binary (Inv08.ReleaseQuote.readClean lengthRead fit) maxRead .le (by intro h;cases h) (by intro h;cases h) le
  have testVal : test.value.eval c rt=pure (.word (boolWord (decide (xs.length≤256))),rt) := by
    by_cases h : xs.length≤256 <;> simpa only [h,if_true,if_false,decide_true,decide_false,boolWord] using compare _ (Nat.le_succ _)
  have run := Inv32QuoteGuard.requireEval n model.core.table c rt _ _ reason testVal
  by_cases h : xs.length≤256 <;> simpa only [h,if_true,if_false,decide_true,decide_false] using run

set_option maxHeartbeats 900000 in
theorem rejectedBody (n : Nat) (c : Context) (r : Runtime) (xs : List Nat) (large : 256<xs.length) (fit : xs.length<R) :
    ctor.body.eval (n+3) model.core.table c (r.withFrame (frame (array xs))) =
      pure (.reverted ((localized r xs).popScope) (.error reason)) := by
  let t := model.core.table
  let src := r.withFrame (frame (array xs))
  let loc := localized r xs
  let rt := loc.pushScope
  have G := guardEvaluates n c r xs fit
  dsimp only at G
  rw [if_neg (Nat.not_le_of_gt large)] at G
  change guard.value.eval (n+1) t c rt=pure (.reverted rt (.error reason)) at G
  have inner : Stmt.eval (n+2) t c loc (.block (guard.value::writes))=pure (.reverted loc (.error reason)) := by
    rw [Stmt.eval];dsimp only;rw [Stmt.evalList,G];rfl
  have L : Stmt.eval (n+2) t c src.pushScope (.memoryLocalize ty name)=pure (.normal loc) := by
    rw [Stmt.eval];dsimp only;rw [copy]
  have S : Stmt.eval (n+2) t c src.pushScope .skip=pure (.normal src.pushScope) := by rw [Stmt.eval]
  rw [bodyFromSource,Stmt.eval];dsimp only
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ S,Inv32FloorStart.seqStep _ _ _ _ _ _ _ L,Stmt.evalList,inner];rfl

/-- The actual constructor rejects each representable address array longer than 256 before storing it. -/
theorem rejectsOversize (n : Nat) (c : Context) (s : State) (sender : Nat) (xs : List Nat) (large : 256<xs.length) (fit : xs.length<R) :
    TypeCheck.CheckedContract.constructWithContext? (n+3) model c s sender 0 [array xs]=some (.reverted s (.error reason)) := by
  let ctx := {c with sender:=sender,value:=0,construction:=true,selfDispatch?:=some (ABI.selfDispatchHook (n+3) model.core 0)}
  let r := Inv08.Release.baseRuntime ctx s
  have present : sourceFn?=some ctor := (Option.some_get existsFn).symm
  unfold TypeCheck.CheckedContract.constructWithContext?
  change sourceFn? >>= _ = _
  rw [present];change ctor.call? (n+3) model.core.table ctx s [array xs]=_
  have accepts : ctor.acceptsValue ctx.value=true := by simp [ctx,FunctionDef.acceptsValue,wordEq]
  have ev := rejectedBody n ctx r xs large fit
  have run : ctor.evalBodyEntry (n+3) model.core.table ctx s [array xs]=some (pure (.reverted (localized r xs).popScope (.error reason))) := by
    unfold FunctionDef.evalBodyEntry;rw [accepts,initial];exact congrArg some ev
  unfold FunctionDef.call? FunctionDef.call;rw [run];rfl
end Inv44.Constructor
