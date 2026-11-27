import Inv12ArgumentList
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv12
def abiWords (xs : List Nat) := xs.flatMap (wordToBytesBE wordBytes)
def wordTypes (xs : List Nat) := xs.map (fun _ => Ty.uint256)

theorem encodeWords (xs : List Nat) : abiEncodeValues? (wordTypes xs) (xs.map Value.word)=some (abiWords xs) := by
  have heads : Ty.listAbiHeadWords? (wordTypes xs)=some xs.length := by
    induction xs with
    | nil => rfl
    | cons x xs ih =>
      change (do let a ← Ty.abiHeadWords? .uint256; let b ← Ty.listAbiHeadWords? (wordTypes xs); some (a+b))=_
      rw [ih]; simp [Ty.abiHeadWords?,Ty.isDynamicAbi,Ty.staticAbiHeadWords?,Nat.add_comm]
  have payload (off : Nat) : abiEncodeValuesAux? (wordTypes xs) (xs.map Value.word) off=some (abiWords xs,[],off) := by
    clear heads
    induction xs with
    | nil => rfl
    | cons x xs ih =>
      change abiEncodeValuesAux? (.uint256 :: wordTypes xs) (.word x :: xs.map Value.word) off=_
      simp [abiEncodeValuesAux?,Ty.isDynamicAbi,abiEncodeStaticValue?,abiStaticBytes?,ih,abiWords]
  simp [abiEncodeValues?,heads,payload,Bind.bind,Option.bind]

def wireBytes (selector : Nat) (xs : List Nat) := wordToBytesBE selectorBytes selector++abiWords xs

theorem wireClean (s : Nat) (xs : List Nat) : (wireBytes s xs).map normByte=wireBytes s xs := by
  unfold wireBytes;rw [List.map_append,bytesClean]
  congr 1
  induction xs with
  | nil => rfl
  | cons x xs ih =>
    change (_++abiWords xs).map normByte=_
    rw [List.map_append,bytesClean,ih];rfl

def encodeWordsExpr (selector : Nat) (exprs : List Source.Expr) :=
  Source.Expr.encode .withSelector (some (.word selector)) [] (exprs.map (fun _ => .uint256)) exprs

theorem calldata (c : Context) (r : Runtime) (selector : Nat) (sel : selector<Inv32Division.R)
    (exprs : List Source.Expr) (words : List Nat) (reads : List.Forall₂ (Inv40.Reads c r) exprs words) :
    (encodeWordsExpr selector exprs).evalWithRuntimeByContext c r=.ok (.bytes (wireBytes selector words),r) := by
  have vals := List.Forall₂.cons (Inv08.Authority.literal c r selector sel) reads
  have types : exprs.map (fun _ => Ty.uint256)=wordTypes words := by
    clear vals
    induction reads with
    | nil => rfl
    | cons _ _ ih => exact congrArg (List.cons Ty.uint256) ih
  have liftOk {α : Type} (v : α) : (liftM (Except.ok v : Except RevertData α) : SolI α)=pure v := rfl
  have pureEval : (encodeWordsExpr selector exprs).eval c r=pure (.bytes (wireBytes selector words),r) := by
    unfold encodeWordsExpr Expr.eval
    rw [Expr.evalFuel]
    rw [readList c r _ _ vals _ (by simp [Expr.orderFuel,Expr.listEvalFuel])]
    simp only [Inv08.Authority.bindPure,List.map_cons]
    simp [Value.expectWord,show Shared.norm selector=selector from Nat.mod_eq_of_lt sel,
      materialWords,liftOk,types,encodeWords,wireBytes,Inv08.Authority.bindPure]
  unfold Expr.evalWithRuntimeByContext
  rw [pureEval];rfl
end Inv12
