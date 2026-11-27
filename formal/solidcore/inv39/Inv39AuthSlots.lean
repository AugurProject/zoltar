import Inv39RawAuthShape
import Inv39AllowanceSlots
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Auth
abbrev nonceMap : StorageLayout := .mapping .address (.scalar .uint256)
abbrev flagMap : StorageLayout := .mapping .address (.mapping (.fixedBytes 32) (.scalar .bool))
abbrev root : StorageBase := .slot position layout
def nonceSlot (owner : Nat) := mappingStorageSlot position (Shared.norm owner)
def flagSlot (owner nonce : Nat) := mappingStorageSlot (mappingStorageSlot (position+1) (Shared.norm owner)) (Shared.norm nonce)
private def nonceMember : Option (Nat × StorageLayout) → Bool
  | some (n,.mapping .address (.scalar .uint256))=>n==position | _=>false
private def flagMember : Option (Nat × StorageLayout) → Bool
  | some (n,.mapping .address (.mapping (.fixedBytes 32) (.scalar .bool)))=>n==position+1 | _=>false
private theorem member0 : structFieldStorageSlot? position [nonceMap,flagMap] (Shared.norm 0)=some (position,nonceMap) := by
  have valid : nonceMember (structFieldStorageSlot? position [nonceMap,flagMap] (Shared.norm 0)) := by native_decide
  unfold nonceMember at valid; split at valid <;> simp_all
private theorem member1 : structFieldStorageSlot? position [nonceMap,flagMap] (Shared.norm 1)=some (position+1,flagMap) := by
  have valid : flagMember (structFieldStorageSlot? position [nonceMap,flagMap] (Shared.norm 1)) := by native_decide
  unfold flagMember at valid; split at valid <;> simp_all
theorem member (s : State) (base idx next : Nat) (fields : List StorageLayout) (l : StorageLayout)
    (tail : List Source.Value) (field : structFieldStorageSlot? base fields (Shared.norm idx)=some (next,l)) :
    s.resolveStoragePathSlot base (.struct fields) (.word idx::tail)=s.resolveStoragePathSlot next l tail := by
  have twice : Shared.norm (Shared.norm idx)=Shared.norm idx := Nat.mod_mod _ _
  rw [State.resolveStoragePathSlot]; simp [Source.Value.expectWord,Bind.bind,Except.bind,twice,field]
theorem fixedKey (base v : Nat) : mappingStorageSlotForKey base (.fixedBytes 32) (.fixedBytes 32 v)=.ok (mappingStorageSlot base (Shared.norm v)) := by
  simp [mappingStorageSlotForKey,coerceMappingKeyWordAs,Value.forceAbiLazy,Ty.coerceValue?,Value.asStorageWord?,Bind.bind,Except.bind,wordBytes,normWord,Shared.norm,Shared.wordModulus,EvmYul.UInt256.size]
theorem fixedStep (s : State) (base next : Nat) (k : Source.Value) (l : StorageLayout)
    (hash : mappingStorageSlotForKey base (.fixedBytes 32) k=.ok next) :
    s.resolveStoragePathSlot base (.mapping (.fixedBytes 32) l) [k]=.ok (next,l) := by
  rw [State.resolveStoragePathSlot,hash]; exact Allowance.doneSlot s next l
theorem flagResolved (s : State) (base next last : Nat) (o nonce : Source.Value)
    (a : mappingStorageSlotForKey base .address o=.ok next) (b : mappingStorageSlotForKey next (.fixedBytes 32) nonce=.ok last) :
    s.resolveStoragePathSlot base flagMap [o,nonce]=.ok (last,.scalar .bool) := by
  rw [Allowance.step _ _ _ _ _ _ a,fixedStep _ _ _ _ _ b]
theorem noncePath (c : Context) (r : Runtime) (owner : Nat) :
    r.resolveStorageBasePath c root [.word 0,.word owner]=.ok (nonceSlot owner,.scalar .uint256) := by
  apply Allowance.resolveFrom _ _ _ _ position _ layout _ rfl
  unfold layout nonceSlot
  rw [member _ _ _ _ _ _ _ member0,Allowance.step _ _ _ _ _ _ (Allowance.key _ _),Allowance.doneSlot]
theorem flagPath (c : Context) (r : Runtime) (owner nonce : Nat) :
    r.resolveStorageBasePath c root [.word 1,.word owner,.fixedBytes 32 nonce]=.ok (flagSlot owner nonce,.scalar .bool) := by
  apply Allowance.resolveFrom _ _ _ _ position _ layout _ rfl
  unfold layout; rw [member _ _ _ _ _ _ _ member1]
  exact flagResolved _ _ _ _ _ _ (Allowance.key _ _) (fixedKey _ _)
end Inv39.Auth
