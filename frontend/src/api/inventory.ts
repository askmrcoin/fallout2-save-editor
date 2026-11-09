/**
 * Patch: inventory editing (add / remove / quantity / mutate).
 *
 * Layout of one inventory entry (big-endian), see fallout2-ce objectRead/objectDataRead:
 *   0x00 quantity
 *   0x04 object: id, tile, x, y, sx, sy, frame, rotation, fid, flags, elevation,
 *        pid, cid, lightDistance, lightIntensity, outline, sid, scriptIndex   (18 x int32)
 *   +0x48 inventory length, capacity, pointer (nested items for containers)
 *   +0x54 data flags
 *   +0x58 item type specific data (weapon 8 bytes, ammo/misc/key 4 bytes)
 *   then `inventory length` nested entries (containers only)
 */

export enum ItemType {
  ARMOR = 0,
  CONTAINER = 1,
  DRUG = 2,
  WEAPON = 3,
  AMMO = 4,
  MISC = 5,
  KEY = 6,
}

export interface ItemProto {
  pid: number
  type: ItemType
  fid: number
  flags: number
  lightDistance: number
  lightIntensity: number
  name: string
  ammoTypePid: number
  ammoCapacity: number
  ammoQuantity: number
  charges: number
  keyCode: number
}

export type ProtoMap = Map<number, ItemProto>

/** Unique items from Fallout 2 special encounters (shown as a separate category). */
export const SPECIAL_ENCOUNTER_PIDS: ReadonlySet<number> = new Set([
  390, // Solar Scorcher (Guardian of Forever)
  421, // Holy Hand Grenade (King Arthur's Knights)
  524, // Bridgekeeper's Robes (Bridge of Death)
  120, // Alien Blaster (trader Willy)
  525, // Hypo (crashed shuttle)
  424, // Monument Chunk (giant stone head)
  474, // Daisies (remains of a whale)
])

export const OBJECT_EQUIPPED = 0x07_00_00_00

// Object flags that come from the item prototype (see objectCreateWithFidPid)
const PROTO_FLAG_MASK = 0x08 | 0x10 | 0x8_00 | 0xf_c0_00 | 0x20_00_00_00 | 0x80_00_00_00

const DUDE_INV_LENGTH = 0x48
const DUDE_INV_CAPACITY = 0x4c
const DUDE_SIZE = 0x80

const QTY = 0x00
const OBJ = 0x04
const O_ID = 0x00
const O_TILE = 0x04
const O_FID = 0x20
const O_FLAGS = 0x24
const O_PID = 0x2c
const O_CID = 0x30
const O_LIGHT_DISTANCE = 0x34
const O_LIGHT_INTENSITY = 0x38
const O_SID = 0x40
const O_SCRIPT_INDEX = 0x44
const O_INV_LENGTH = 0x48
const O_INV_CAPACITY = 0x4c
const O_INV_POINTER = 0x50
const O_DATA_FLAGS = 0x54
const O_EXTRA = 0x58
const BASE_SIZE = OBJ + O_EXTRA

const DUDE_ID = 18_000
const MAX_QTY = 99_999_999

export const extraSize = (type: ItemType): number => {
  switch (type) {
    case ItemType.WEAPON: {
      return 8
    }
    case ItemType.AMMO:
    case ItemType.MISC:
    case ItemType.KEY: {
      return 4
    }
    default: {
      return 0
    }
  }
}

export interface InvRecord {
  offset: number
  size: number
  qty: number
  pid: number
  id: number
  flags: number
  type: ItemType
  equipped: boolean
  nested: InvRecord[]
}

export type InventoryOp =
  | { kind: 'add'; pid: number; qty: number }
  | { kind: 'remove'; index: number }
  | { kind: 'setQty'; index: number; qty: number }
  | { kind: 'mutate'; index: number; pid: number }

export const isSpecialEncounterItem = (pid: number): boolean => SPECIAL_ENCOUNTER_PIDS.has(pid)

const parseRecord = (dv: DataView, offset: number, protos: ProtoMap, depth: number): InvRecord => {
  if (depth > 4) {
    throw new Error('Inventory nesting too deep')
  }
  if (offset + BASE_SIZE > dv.byteLength) {
    throw new Error('Inventory runs past end of file')
  }

  const qty = dv.getInt32(offset + QTY)
  const pid = dv.getInt32(offset + OBJ + O_PID)
  const proto = protos.get(pid)

  if (!proto) {
    throw new Error(`Unknown item PID ${pid} at offset ${offset}`)
  }
  if (qty < 1 || qty > 2_000_000_000) {
    throw new Error(`Invalid quantity ${qty} for item PID ${pid}`)
  }

  const nestedCount = dv.getInt32(offset + OBJ + O_INV_LENGTH)
  if (nestedCount < 0 || nestedCount > 10_000) {
    throw new Error(`Invalid nested item count for item PID ${pid}`)
  }

  const flags = dv.getInt32(offset + OBJ + O_FLAGS)
  let cursor = offset + BASE_SIZE + extraSize(proto.type)
  const nested: InvRecord[] = []

  for (let i = 0; i < nestedCount; i += 1) {
    const rec = parseRecord(dv, cursor, protos, depth + 1)
    nested.push(rec)
    cursor += rec.size
  }

  return {
    offset,
    size: cursor - offset,
    qty,
    pid,
    id: dv.getInt32(offset + OBJ + O_ID),
    flags,
    type: proto.type,
    equipped: (flags & OBJECT_EQUIPPED) !== 0,
    nested,
  }
}

/** Parses the player's inventory. `dudeOffset` is the start of the player object (F5). */
export const parseInventory = (
  dv: DataView,
  dudeOffset: number,
  protos: ProtoMap,
): { records: InvRecord[]; end: number } => {
  const count = dv.getInt32(dudeOffset + DUDE_INV_LENGTH)
  if (count < 0 || count > 10_000) {
    throw new Error(`Invalid inventory size ${count}`)
  }

  let cursor = dudeOffset + DUDE_SIZE
  const records: InvRecord[] = []

  for (let i = 0; i < count; i += 1) {
    const rec = parseRecord(dv, cursor, protos, 0)
    records.push(rec)
    cursor += rec.size
  }

  return { records, end: cursor }
}

const splice = (buf: Uint8Array, start: number, deleteCount: number, insert: Uint8Array) => {
  const out = new Uint8Array(buf.length - deleteCount + insert.length)
  out.set(buf.subarray(0, start), 0)
  out.set(insert, start)
  out.set(buf.subarray(start + deleteCount), start + insert.length)
  return out
}

const setDudeInventoryLength = (buf: Uint8Array, dudeOffset: number, length: number) => {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const capacity = dv.getInt32(dudeOffset + DUDE_INV_CAPACITY)
  dv.setInt32(dudeOffset + DUDE_INV_LENGTH, length)
  // The engine allocates `capacity` slots and then reads `length` items
  dv.setInt32(dudeOffset + DUDE_INV_CAPACITY, Math.max(capacity, length))
}

const collectIds = (records: InvRecord[], out: number[] = []): number[] => {
  for (const rec of records) {
    out.push(rec.id)
    collectIds(rec.nested, out)
  }
  return out
}

const nextObjectId = (records: InvRecord[]): number => {
  const ids = new Set(collectIds(records))
  let id = Math.max(1_000, ...ids) + 1
  while (ids.has(id) || id === DUDE_ID) {
    id += 1
  }
  return id
}

/**
 * Builds a new inventory entry for `proto`. Generic object fields are copied
 * from `template` (an existing entry) when given, otherwise engine defaults are used.
 */
const buildRecord = (
  proto: ItemProto,
  qty: number,
  id: number,
  template?: Uint8Array,
): Uint8Array => {
  const out = new Uint8Array(BASE_SIZE + extraSize(proto.type))
  const dv = new DataView(out.buffer)
  const o = OBJ

  let templateFlags = 0
  if (template) {
    out.set(template.subarray(0, BASE_SIZE), 0)
    templateFlags = new DataView(template.buffer, template.byteOffset).getInt32(OBJ + O_FLAGS)
  } else {
    dv.setInt32(o + O_TILE, -1)
    dv.setInt32(o + O_CID, -1)
  }

  const flags = (templateFlags & ~(OBJECT_EQUIPPED | PROTO_FLAG_MASK)) | (proto.flags & PROTO_FLAG_MASK)

  dv.setInt32(QTY, qty)
  dv.setInt32(o + O_ID, id)
  dv.setInt32(o + O_FID, proto.fid)
  dv.setInt32(o + O_FLAGS, flags)
  dv.setInt32(o + O_PID, proto.pid)
  dv.setInt32(o + O_LIGHT_DISTANCE, proto.lightDistance)
  dv.setInt32(o + O_LIGHT_INTENSITY, proto.lightIntensity)
  dv.setInt32(o + O_SID, -1)
  dv.setInt32(o + O_SCRIPT_INDEX, -1)
  dv.setInt32(o + O_INV_LENGTH, 0)
  dv.setInt32(o + O_INV_CAPACITY, 0)
  dv.setInt32(o + O_INV_POINTER, 0)
  dv.setInt32(o + O_DATA_FLAGS, 0)

  const e = o + O_EXTRA
  switch (proto.type) {
    case ItemType.WEAPON: {
      dv.setInt32(e, Math.max(0, proto.ammoCapacity))
      dv.setInt32(e + 4, proto.ammoTypePid)
      break
    }
    case ItemType.AMMO: {
      dv.setInt32(e, Math.max(0, proto.ammoQuantity))
      break
    }
    case ItemType.MISC: {
      dv.setInt32(e, Math.max(0, proto.charges))
      break
    }
    case ItemType.KEY: {
      dv.setInt32(e, proto.keyCode)
      break
    }
    default:
  }

  return out
}

const clampQty = (_pid: number, qty: number): number => Math.min(MAX_QTY, Math.max(1, Math.trunc(qty)))

/**
 * Applies an inventory operation and returns the new save buffer.
 * Throws with a human readable message when the operation is not allowed.
 */
export const applyInventoryOp = (
  buf: Uint8Array,
  dudeOffset: number,
  protos: ProtoMap,
  op: InventoryOp,
): Uint8Array => {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const { records, end } = parseInventory(dv, dudeOffset, protos)
  const getRecord = (index: number): InvRecord => {
    const rec = records[index]
    if (!rec) {
      throw new Error(`No inventory item #${index}`)
    }
    return rec
  }

  switch (op.kind) {
    case 'setQty': {
      const rec = getRecord(op.index)
      const out = buf.slice()
      new DataView(out.buffer).setInt32(rec.offset + QTY, clampQty(rec.pid, op.qty))
      return out
    }

    case 'remove': {
      const rec = getRecord(op.index)
      if (rec.equipped) {
        throw new Error('Item is equipped. Unequip it in the game first.')
      }
      const out = splice(buf, rec.offset, rec.size, new Uint8Array(0))
      setDudeInventoryLength(out, dudeOffset, records.length - 1)
      return out
    }

    case 'add': {
      const proto = protos.get(op.pid)
      if (!proto) {
        throw new Error(`Unknown item PID ${op.pid}`)
      }

      const existing = records.find(
        r => r.pid === op.pid && !r.equipped && r.nested.length === 0 && r.type !== ItemType.CONTAINER,
      )
      if (existing) {
        // Stack with an existing entry like the game does
        const out = buf.slice()
        const odv = new DataView(out.buffer)
        odv.setInt32(existing.offset + QTY, clampQty(op.pid, existing.qty + op.qty))
        return out
      }

      const templateRec = records.find(r => !r.equipped) ?? records[0]
      const template = templateRec
        ? buf.subarray(templateRec.offset, templateRec.offset + BASE_SIZE)
        : undefined
      const rec = buildRecord(proto, clampQty(op.pid, op.qty), nextObjectId(records), template)
      const out = splice(buf, end, 0, rec)
      setDudeInventoryLength(out, dudeOffset, records.length + 1)
      return out
    }

    case 'mutate': {
      const rec = getRecord(op.index)
      const proto = protos.get(op.pid)
      if (!proto) {
        throw new Error(`Unknown item PID ${op.pid}`)
      }
      if (rec.equipped) {
        throw new Error('Item is equipped. Unequip it in the game first.')
      }
      if (rec.nested.length > 0) {
        throw new Error('Empty the container in the game first.')
      }

      // Keep the object's own identity (id, position fields), change what it is
      const template = buf.subarray(rec.offset, rec.offset + BASE_SIZE)
      const newRec = buildRecord(proto, clampQty(op.pid, rec.qty), rec.id, template)
      return splice(buf, rec.offset, rec.size, newRec)
    }

    default: {
      throw new Error('Unknown inventory operation')
    }
  }
}
