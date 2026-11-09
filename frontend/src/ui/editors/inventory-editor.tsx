// Patch: inventory editor (add / remove / quantity / mutate) with a separate
// category for items from special encounters.
import { useMemo, useState } from 'preact/hooks'

import { flex, hstack } from '~/styled-system/patterns'

import type { InvRecord, ItemProto } from '../../api/inventory'

import { ITEMS } from '../../api/data/items'
import { isSpecialEncounterItem, ItemType } from '../../api/inventory'
import { css, cx } from '../../styled-system/css'
import { ModalButton } from '../components/buttons'
import { InputField } from '../components/input-field'
import Modal from '../modal'
import { useAPIStore } from '../store'
import { useToaster } from '../toaster/store'

type Category = 'all' | 'special' | ItemType

const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'special', label: '★ Special' },
  { key: 'all', label: 'All' },
  { key: ItemType.WEAPON, label: 'Weapons' },
  { key: ItemType.AMMO, label: 'Ammo' },
  { key: ItemType.ARMOR, label: 'Armor' },
  { key: ItemType.DRUG, label: 'Drugs' },
  { key: ItemType.MISC, label: 'Misc' },
  { key: ItemType.KEY, label: 'Keys' },
  { key: ItemType.CONTAINER, label: 'Bags' },
]

const MAX_QTY = 99_999_999

const itemName = (pid: number, protos: Map<number, ItemProto>): string =>
  protos.get(pid)?.name || ITEMS[String(pid)]?.desc || `Item ${pid}`

const rowStyle = flex({
  justify: 'space-between',
  align: 'center',
  gap: '2',
  color: 'green.200',
  _hover: { color: 'gray.50' },
})

const smallButton = css({
  cursor: 'pointer',
  px: '1',
  color: 'beige.500',
  _hover: { color: 'gray.50' },
})

const smallButtonDisabled = css({
  px: '1',
  color: 'gray.600',
  cursor: 'not-allowed',
})

const dangerButton = css({
  cursor: 'pointer',
  px: '1',
  color: 'red.400',
  _hover: { color: 'gray.50' },
})

const addButton = css({
  cursor: 'pointer',
  color: 'beige.500',
  mb: '2',
  _hover: { color: 'gray.50' },
})

const mutedText = css({ color: 'gray.400' })

const chip = css({
  cursor: 'pointer',
  px: '2',
  py: '0.5',
  rounded: 'sm',
  fs: 'sm',
  bg: 'gray.100',
  color: 'gray.800',
  _hover: { bg: 'gray.300' },
})

const chipActive = css({
  cursor: 'pointer',
  px: '2',
  py: '0.5',
  rounded: 'sm',
  fs: 'sm',
  bg: 'gray.600',
  color: 'white',
})

const pickerList = cx(
  css({
    mt: '3',
    maxH: '[320px]',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    fs: 'md',
  }),
  'styled-scrollbar',
)

const pickerRow = css({
  textAlign: 'left',
  cursor: 'pointer',
  px: '2',
  py: '0.5',
  rounded: 'sm',
  _hover: { bg: 'gray.100' },
})

const pickerRowActive = css({
  textAlign: 'left',
  cursor: 'pointer',
  px: '2',
  py: '0.5',
  rounded: 'sm',
  bg: 'gray.600',
  color: 'white',
})

const hintText = css({ fs: 'sm', color: 'gray.500', mt: '2' })

interface PickerProps {
  mode: 'add' | 'mutate'
  target?: InvRecord | undefined
  onClose: () => void
}

const ItemPicker = (p: PickerProps) => {
  const toast = useToaster()
  const itemProtos = useAPIStore(s => s.itemProtos)
  const inventory = useAPIStore(s => s.inventory)
  const inventoryOp = useAPIStore(s => s.inventoryOp)
  const protoMap = useMemo(() => new Map(itemProtos.map(x => [x.pid, x])), [itemProtos])

  const [category, setCategory] = useState<Category>('special')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<number | undefined>(undefined)
  const [qtyText, setQtyText] = useState('1')

  const owned = new Set(inventory.map(r => r.pid))
  const q = query.trim().toLowerCase()

  const list = itemProtos
    .filter(x => {
      if (category === 'special') {
        return isSpecialEncounterItem(x.pid)
      }
      return category === 'all' || x.type === category
    })
    .map(x => ({ proto: x, name: itemName(x.pid, protoMap) }))
    .filter(x => !x.name.startsWith('Item ') || q.length > 0)
    .filter(x => q.length === 0 || x.name.toLowerCase().includes(q) || String(x.proto.pid) === q)
    .toSorted((a, b) => a.name.localeCompare(b.name))

  const qty = Number.parseInt(qtyText, 10)
  const isQtyValid = p.mode === 'mutate' || (Number.isFinite(qty) && qty >= 1 && qty <= MAX_QTY)
  const canApply = selected !== undefined && isQtyValid

  const apply = () => {
    if (selected === undefined) {
      return
    }
    try {
      if (p.mode === 'add') {
        inventoryOp({ kind: 'add', pid: selected, qty })
        toast.success(`Added ${itemName(selected, protoMap)}`)
      } else if (p.target) {
        const index = inventory.findIndex(r => r.offset === p.target?.offset)
        inventoryOp({ kind: 'mutate', index, pid: selected })
        toast.success(`Turned into ${itemName(selected, protoMap)}`)
      }
      p.onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <Modal isOpen onClose={p.onClose} size="lg">
      <p class={css({ fs: 'xl', mb: '2' })}>
        {p.mode === 'add'
          ? 'Add item'
          : `Turn "${itemName(p.target?.pid ?? 0, protoMap)}" into…`}
      </p>

      <div class={flex({ wrap: 'wrap', gap: '1' })}>
        {CATEGORIES.map(c => (
          <button
            key={String(c.key)}
            class={category === c.key ? chipActive : chip}
            onClick={() => {
              setCategory(c.key)
              setSelected(undefined)
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      <InputField
        name="item-search"
        value={query}
        placeholder="Search by name or PID"
        onInput={event => setQuery(event.currentTarget.value)}
        size="md"
        variant="light"
      />

      <div class={pickerList}>
        {list.length === 0 && <p class={hintText}>Nothing found.</p>}
        {list.map(({ proto, name }) => (
          <button
            key={proto.pid}
            class={selected === proto.pid ? pickerRowActive : pickerRow}
            onClick={() => setSelected(proto.pid)}
          >
            {isSpecialEncounterItem(proto.pid) ? '★ ' : ''}
            {name}
            {owned.has(proto.pid) ? ' (owned)' : ''}
          </button>
        ))}
      </div>

      {category === 'special' && (
        <p class={hintText}>Items from special encounters.</p>
      )}

      {p.mode === 'add' && selected !== undefined && (
        <InputField
          name="item-qty"
          value={qtyText}
          onInput={event => setQtyText(event.currentTarget.value.replaceAll(/\D/g, ''))}
          size="md"
          variant="light"
          maxLength={8}
        />
      )}

      <div class={hstack({ gap: '4', justify: 'flex-end', mt: '4' })}>
        <ModalButton onClick={p.onClose} kind="secondary">
          Close
        </ModalButton>
        <ModalButton kind="primary" onClick={apply} isDisabled={!canApply}>
          {p.mode === 'add' ? 'Add' : 'Mutate'}
        </ModalButton>
      </div>
    </Modal>
  )
}

const QtyModal = (p: { record: InvRecord; name: string; onClose: () => void }) => {
  const toast = useToaster()
  const inventory = useAPIStore(s => s.inventory)
  const inventoryOp = useAPIStore(s => s.inventoryOp)
  const [text, setText] = useState(String(p.record.qty))
  const qty = Number.parseInt(text, 10)
  const isValid = Number.isFinite(qty) && qty >= 1 && qty <= MAX_QTY

  const apply = () => {
    try {
      const index = inventory.findIndex(r => r.offset === p.record.offset)
      inventoryOp({ kind: 'setQty', index, qty })
      p.onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <Modal isOpen onClose={p.onClose} size="md">
      <label htmlFor="inv-qty" class={css({ display: 'block', fs: 'xl' })}>
        {p.name}
      </label>
      <InputField
        name="inv-qty"
        value={text}
        onInput={event => setText(event.currentTarget.value.replaceAll(/\D/g, ''))}
        size="lg"
        variant="dark"
        maxLength={8}
        // oxlint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
      />
      <div class={hstack({ gap: '4', justify: 'flex-end', mt: '4' })}>
        <ModalButton onClick={p.onClose} kind="secondary">
          Close
        </ModalButton>
        <ModalButton kind="primary" onClick={apply} isDisabled={!isValid}>
          Save
        </ModalButton>
      </div>
    </Modal>
  )
}

export const InventoryEditor = () => {
  const toast = useToaster()
  const inventory = useAPIStore(s => s.inventory)
  const itemProtos = useAPIStore(s => s.itemProtos)
  const protoStatus = useAPIStore(s => s.protoStatus)
  const protoError = useAPIStore(s => s.protoError)
  const currentSaveFile = useAPIStore(s => s.currentSaveFile)
  const inventoryOp = useAPIStore(s => s.inventoryOp)
  const protoMap = useMemo(() => new Map(itemProtos.map(x => [x.pid, x])), [itemProtos])

  const [picker, setPicker] = useState<{ mode: 'add' | 'mutate'; target?: InvRecord | undefined }>()
  const [qtyRecord, setQtyRecord] = useState<InvRecord>()
  const [confirmDelete, setConfirmDelete] = useState<number>()

  if (!currentSaveFile) {
    return <p class={mutedText}>Open a save file first.</p>
  }
  if (protoStatus === 'loading') {
    return <p class={mutedText}>Reading game data…</p>
  }
  if (protoStatus !== 'ready') {
    return (
      <p class={mutedText}>
        Inventory editing needs the game files (master.dat next to the data folder).
        {protoError ? ` ${protoError}` : ''}
      </p>
    )
  }

  const run = (fn: () => void) => {
    try {
      fn()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div class={flex({ direction: 'column' })}>
      <button class={addButton} onClick={() => setPicker({ mode: 'add' })}>
        + ADD ITEM
      </button>

      {inventory.map((rec, index) => {
        const name = itemName(rec.pid, protoMap)
        const isSpecial = isSpecialEncounterItem(rec.pid)
        const isLocked = rec.equipped
        const tag = [
          isSpecial ? '★' : '',
          rec.equipped ? '[E]' : '',
          rec.nested.length > 0 ? `(${rec.nested.length} inside)` : '',
        ]
          .filter(Boolean)
          .join(' ')

        return (
          <div key={`${rec.offset}-${rec.pid}`} class={rowStyle}>
            <span>
              {name} {tag}
            </span>
            <span class={flex({ align: 'center', gap: '0.5' })}>
              <button
                class={rec.qty <= 1 ? smallButtonDisabled : smallButton}
                disabled={rec.qty <= 1}
                aria-label="Decrease"
                onClick={() => run(() => inventoryOp({ kind: 'setQty', index, qty: rec.qty - 1 }))}
              >
                −
              </button>
              <button class={smallButton} onClick={() => setQtyRecord(rec)}
              >
                {rec.qty}
              </button>
              <button
                class={smallButton}
                aria-label="Increase"
                onClick={() => run(() => inventoryOp({ kind: 'setQty', index, qty: rec.qty + 1 }))}
              >
                +
              </button>
              <button
                class={isLocked ? smallButtonDisabled : smallButton}
                disabled={isLocked}
                title={isLocked ? 'Unequip in game first' : 'Turn into another item'}
                onClick={() => setPicker({ mode: 'mutate', target: rec })}
              >
                M
              </button>
              <button
                class={isLocked ? smallButtonDisabled : dangerButton}
                disabled={isLocked}
                title={isLocked ? 'Unequip in game first' : 'Delete'}
                onClick={() => {
                  if (confirmDelete === rec.offset) {
                    setConfirmDelete(undefined)
                    run(() => inventoryOp({ kind: 'remove', index }))
                  } else {
                    setConfirmDelete(rec.offset)
                  }
                }}
              >
                {confirmDelete === rec.offset ? 'SURE?' : 'X'}
              </button>
            </span>
          </div>
        )
      })}

      {picker && (
        <ItemPicker mode={picker.mode} target={picker.target} onClose={() => setPicker(undefined)} />
      )}
      {qtyRecord && (
        <QtyModal
          record={qtyRecord}
          name={itemName(qtyRecord.pid, protoMap)}
          onClose={() => setQtyRecord(undefined)}
        />
      )}
    </div>
  )
}
