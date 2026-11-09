// Patch: editor for the amount of money (inventory item PID 41)
import { useState } from 'preact/hooks'

import { hstack } from '~/styled-system/patterns'

import type { UseDisclosureReturn } from './hooks/use-disclosure'

import { css } from '../styled-system/css'
import { flex } from '../styled-system/patterns/flex'
import { ModalButton } from './components/buttons'
import { InputField } from './components/input-field'
import { useDisclosure } from './hooks/use-disclosure'
import Modal from './modal'
import { useAPIStore } from './store'

const MAX_MONEY = 99_999_999

const moneyButtonActive = flex({
  cursor: 'pointer',
  _hover: { textDecoration: 'underline' },
  mr: '2',
})

const moneyButtonDisabled = flex({
  cursor: 'not-allowed',
  mr: '2',
})

const MoneyChangerModal = (p: { disclosure: UseDisclosureReturn }) => {
  const { isOpen, onClose } = p.disclosure
  const setProp = useAPIStore(s => s.setProp)
  const money = useAPIStore(s => s.data.money ?? -1)
  const [text, setText] = useState(String(money))
  const amount = Number.parseInt(text, 10)
  const isValid = Number.isFinite(amount) && amount >= 1 && amount <= MAX_MONEY

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <label htmlFor="money" class={css({ display: 'block', fs: 'xl' })}>
        Money ($)
      </label>
      <InputField
        name="money"
        value={text}
        onInput={event => setText(event.currentTarget.value.replaceAll(/\D/g, ''))}
        size="lg"
        variant="dark"
        maxLength={8}
        // oxlint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
      />
      <div class={hstack({ gap: '4', justify: 'flex-end', mt: '4' })}>
        <ModalButton onClick={onClose} kind="secondary">
          Close
        </ModalButton>
        <ModalButton
          kind="primary"
          onClick={() => {
            setProp('money', amount)
            onClose()
          }}
          isDisabled={!isValid}
        >
          Save
        </ModalButton>
      </div>
    </Modal>
  )
}

export const MoneyChanger = () => {
  const disclosure = useDisclosure()
  const money = useAPIStore(s => s.data.money ?? -1)
  const hasMoney = money >= 1

  return (
    <>
      <div
        class={flex({
          justify: 'space-between',
          mr: '2.5',
          color: { base: 'green.200', _hover: 'gray.50' },
        })}
      >
        <p>Money</p>
        <button
          aria-label="Change money"
          // oxlint-disable-next-line react/jsx-handler-names
          onClick={hasMoney ? disclosure.onToggle : undefined}
          title={hasMoney ? 'Click to change' : 'Pick up at least $1 in game first'}
          class={hasMoney ? moneyButtonActive : moneyButtonDisabled}
        >
          {hasMoney ? `$${money}` : '—'}
        </button>
      </div>
      {disclosure.isOpen && <MoneyChangerModal disclosure={disclosure} />}
    </>
  )
}
